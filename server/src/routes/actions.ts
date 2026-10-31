import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient, type TicketStatus } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { isValidId } from "../ids.js";
import { isEligibleOwner, isEligibleStaffLocked } from "./staffTickets.js";
import {
  validateActionAt,
  validateActionFields,
  validateCancelReason,
  validateCompletionAt,
  validateResult,
} from "../actionValidation.js";
import { IDEMPOTENCY_KEY_MESSAGE, IDEMPOTENCY_KEY_REUSED_MESSAGE, isIdempotencyKey, isUniqueViolation, requestHash } from "../idempotency.js";

// Actions Taken (Lab 4 api-spec.md endpoints 1 to 5). There is no delete route (BR-18).
export const actionsRouter = Router();

const anyRole = [requireAuth, requireRole("REQUESTER", "IT_STAFF", "ADMINISTRATOR")];
// BR-17: a Requester never writes an Action. 403 comes from the role alone, before any lookup.
const staffOnly = [requireAuth, requireRole("IT_STAFF", "ADMINISTRATOR")];

// BR-14: the Ticket statuses in which Actions may be written.
const WORKABLE: readonly TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"];

// The body fields endpoint 2 accepts; they alone make up its request fingerprint (BR-39).
const CREATE_FIELDS = ["actionAt", "description", "responsibleStaffId", "followUpRequired", "followUpNote", "attachmentNotes"] as const;

const person = { select: { id: true, name: true } } as const;
const withPeople = {
  recordedBy: person,
  responsibleStaff: { select: { id: true, name: true, isActive: true, role: true } },
  performedBy: person,
  cancelledBy: person,
  lastEditedBy: person,
} as const;
type ActionRow = Prisma.ActionTakenGetPayload<{ include: typeof withPeople }>;

// The Action item shape. Eligibility is derived from the person's current row on every read (BR-08);
// no email, password data, or role is ever sent. A Requester gets the same shape (BR-17).
function serialize(a: ActionRow) {
  const { isActive, role, ...responsible } = a.responsibleStaff;
  return {
    id: a.id,
    ticketId: a.ticketId,
    status: a.status,
    actionAt: a.actionAt,
    description: a.description,
    result: a.result,
    followUpRequired: a.followUpRequired,
    followUpNote: a.followUpNote,
    attachmentNotes: a.attachmentNotes,
    recordedBy: a.recordedBy,
    recordedAt: a.createdAt,
    responsibleStaff: { ...responsible, eligible: isEligibleOwner({ isActive, role }) === true },
    performedBy: a.performedBy,
    completedAt: a.completedAt,
    cancelledBy: a.cancelledBy,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    lastEditedBy: a.lastEditedBy,
    version: a.version,
    updatedAt: a.updatedAt,
  };
}

const ticketNotFound = (res: Response) => sendError(res, 404, "NOT_FOUND", "Ticket not found.");
const actionNotFound = (res: Response) => sendError(res, 404, "NOT_FOUND", "Action not found.");
const invalid = (res: Response, fields: Record<string, string>) =>
  sendError(res, 400, "VALIDATION_ERROR", Object.keys(fields).length === 1 ? Object.values(fields)[0] : "Some fields are not valid.", fields);
const INVALID_RESPONSIBLE = "Choose an active IT Staff member.";
const invalidResponsible = (res: Response) => sendError(res, 409, "INVALID_RESPONSIBLE", INVALID_RESPONSIBLE, { responsibleStaffId: INVALID_RESPONSIBLE });

// A path id that is not a positive 32-bit integer names nothing: 404, never a 500.
function idFrom(raw: string): number | null {
  const id = Number(raw);
  return isValidId(id) ? id : null;
}


// Locks the Ticket row and says whether it is workable. Every Action write runs inside this lock
// and also updates the Ticket's last activity (BR-19), so writes on one Ticket are serialised: two edits
// from one version cannot both pass the version check, and a resolve or cancel of the Ticket (which takes
// the same row) cannot interleave with an Action write (BR-14, BR-21). The lock is FOR NO KEY UPDATE, not
// FOR SHARE, because the same transaction updates the row: two shared holders upgrading would deadlock.
async function lockTicket(tx: Prisma.TransactionClient, ticketId: number): Promise<{ workable: boolean }> {
  const rows = await tx.$queryRaw<{ currentStatus: TicketStatus }[]>(Prisma.sql`
    SELECT "currentStatus" FROM "Ticket" WHERE "id" = ${ticketId} FOR NO KEY UPDATE`);
  return { workable: rows.length === 1 && WORKABLE.includes(rows[0].currentStatus) };
}
const touchTicket = (tx: Prisma.TransactionClient, ticketId: number) => tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });


// Endpoint 1: a Requester for their own Ticket (404 otherwise), IT Staff and Administrators any Ticket.
actionsRouter.get("/api/tickets/:id/actions", ...anyRole, async (req: Request, res: Response) => {
  try {
    const ticketId = idFrom(req.params.id);
    if (ticketId === null) return ticketNotFound(res);
    const prisma = getPrisma();
    const where = req.user!.role === "REQUESTER" ? { id: ticketId, requesterId: req.user!.id } : { id: ticketId };
    if (!(await prisma.ticket.findFirst({ where, select: { id: true } }))) return ticketNotFound(res);
    // BR-16: Action Date/Time, then creation order, so editing never reorders by status.
    const rows = await prisma.actionTaken.findMany({ where: { ticketId }, include: withPeople, orderBy: [{ actionAt: "asc" }, { id: "asc" }] });
    res.status(200).json(rows.map(serialize));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the actions.");
  }
});

// Endpoint 2: create. Errors in the contract's order: 404, 400, INVALID_RESPONSIBLE, TICKET_NOT_WORKABLE,
// IDEMPOTENCY_KEY_REUSED. A replay of the same request returns the existing Action with 200.
actionsRouter.post("/api/tickets/:id/actions", ...staffOnly, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const prisma = getPrisma();
  let key: string | null = null;
  let hash: string | null = null;
  const findKeyed = () =>
    prisma.actionTaken.findUnique({ where: { recordedById_idempotencyKey: { recordedById: userId, idempotencyKey: key! } }, include: withPeople });
  const replay = (row: ActionRow) => res.status(200).set("Idempotent-Replayed", "true").json(serialize(row));
  const reused = () => sendError(res, 409, "IDEMPOTENCY_KEY_REUSED", IDEMPOTENCY_KEY_REUSED_MESSAGE);
  try {
    const ticketId = idFrom(req.params.id);
    if (ticketId === null) return ticketNotFound(res);
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { createdAt: true } });
    if (!ticket) return ticketNotFound(res);

    const { data, fields } = validateActionFields(req.body, { ticketCreatedAt: ticket.createdAt, now: new Date() });
    const rawKey = req.get("Idempotency-Key");
    if (rawKey !== undefined && !isIdempotencyKey(rawKey)) fields.idempotencyKey = IDEMPOTENCY_KEY_MESSAGE;
    if (Object.keys(fields).length > 0) return invalid(res, fields);

    if (rawKey !== undefined) {
      key = rawKey.toLowerCase();
      // A Follow-Up Note sent with Follow-Up Required off is discarded (BR-04), so it is not part of the
      // request either (api-spec "Fields the endpoint ignores are not part of it").
      const kept = data.followUpRequired ? req.body : { ...req.body, followUpNote: undefined };
      hash = requestHash(`/api/tickets/${ticketId}/actions`, kept, CREATE_FIELDS);
    }
    const prior = key ? await findKeyed() : null;
    if (prior && prior.requestHash === hash) return replay(prior);

    const responsibleStaffId = data.responsibleStaffId ?? userId;
    const outcome = await prisma.$transaction(async (tx) => {
      const { workable } = await lockTicket(tx, ticketId);
      // BR-07 "at the moment it is set": checked inside the lock, as the edit path does, so a
      // deactivation that commits before the insert is seen.
      if (!(await isEligibleStaffLocked(tx, responsibleStaffId))) return "INVALID_RESPONSIBLE" as const;
      if (!workable) return "NOT_WORKABLE" as const;
      if (prior) return "REUSED" as const;
      // Recorded By, Recorded at, status, and version come from the server only (BR-06).
      const row = await tx.actionTaken.create({
        data: {
          ticketId,
          actionAt: data.actionAt!,
          description: data.description!,
          followUpRequired: data.followUpRequired!,
          followUpNote: data.followUpNote ?? null,
          attachmentNotes: data.attachmentNotes ?? null,
          recordedById: userId,
          responsibleStaffId,
          idempotencyKey: key,
          requestHash: hash,
        },
        include: withPeople,
      });
      await touchTicket(tx, ticketId);
      return row;
    });
    if (outcome === "INVALID_RESPONSIBLE") return invalidResponsible(res);
    if (outcome === "NOT_WORKABLE") return notWorkable(res);
    if (outcome === "REUSED") return reused();
    res.status(201).json(serialize(outcome));
  } catch (e) {
    // Two sends of one key at the same moment: the unique constraint let the other one in first.
    if (key && isUniqueViolation(e)) {
      try {
        const winner = await findKeyed();
        if (winner) return winner.requestHash === hash ? replay(winner) : reused();
      } catch {
        // fall through to the safe failure
      }
    }
    sendError(res, 500, "INTERNAL_ERROR", "Unable to add the action.");
  }
});

const notWorkable = (res: Response) =>
  sendError(res, 409, "TICKET_NOT_WORKABLE", "Actions cannot be changed on a Resolved, Closed, or Cancelled Ticket.");

type Loaded = NonNullable<Awaited<ReturnType<typeof loadAction>>>;
const loadAction = (prisma: PrismaClient, id: number) =>
  prisma.actionTaken.findUnique({ where: { id }, include: { ticket: { select: { createdAt: true } } } });

function versionFrom(body: unknown): number | null {
  const v = (body as { version?: unknown } | undefined)?.version;
  return isValidId(v) ? v : null;
}
const VERSION_ERROR = "Version must be the positive whole number you loaded.";

// The shared write path of endpoints 3 to 5 (BR-13, ADR 0004). Inside the Ticket lock: the Ticket must be
// workable, the Action still Planned, and its version the one the user loaded; then `extra` may refuse
// (INVALID_RESPONSIBLE), and the change is applied with the version incremented, conditional on both.
async function writeAction(
  res: Response,
  action: Loaded,
  version: number,
  change: Prisma.ActionTakenUncheckedUpdateManyInput,
  extra?: (tx: Prisma.TransactionClient) => Promise<"INVALID_RESPONSIBLE" | null>,
) {
  const prisma = getPrisma();
  const outcome = await prisma.$transaction(async (tx) => {
    if (!(await lockTicket(tx, action.ticketId)).workable) return "NOT_WORKABLE" as const;
    const current = await tx.actionTaken.findUniqueOrThrow({ where: { id: action.id }, include: withPeople });
    if (current.status !== "PLANNED") return "FINAL" as const;
    if (current.version !== version) return { stale: current };
    if (extra && (await extra(tx))) return "INVALID_RESPONSIBLE" as const;
    const written = await tx.actionTaken.updateMany({
      where: { id: action.id, version, status: "PLANNED" },
      data: { ...change, version: { increment: 1 } },
    });
    if (written.count !== 1) return { stale: await tx.actionTaken.findUniqueOrThrow({ where: { id: action.id }, include: withPeople }) };
    await touchTicket(tx, action.ticketId);
    return tx.actionTaken.findUniqueOrThrow({ where: { id: action.id }, include: withPeople });
  });
  if (outcome === "NOT_WORKABLE") return notWorkable(res);
  if (outcome === "FINAL") return sendError(res, 409, "ACTION_FINAL", "This action is already completed or cancelled.");
  if (outcome === "INVALID_RESPONSIBLE") return invalidResponsible(res);
  if ("stale" in outcome) {
    return res.status(409).json({ error: "STALE_ACTION", message: "Someone else changed this action. Reload it and try again.", action: serialize(outcome.stale) });
  }
  res.status(200).json(serialize(outcome));
}

// Opens endpoints 3 to 5 the same way: 404 for a malformed or missing Action, then the handler.
function onAction(method: "patch" | "post", path: string, label: string, handler: (req: Request, res: Response, action: Loaded) => Promise<unknown>) {
  actionsRouter[method](`/api/actions/:id${path}`, ...staffOnly, async (req: Request, res: Response) => {
    try {
      const id = idFrom(req.params.id);
      if (id === null) return actionNotFound(res);
      const action = await loadAction(getPrisma(), id);
      if (!action) return actionNotFound(res);
      await handler(req, res, action);
    } catch {
      sendError(res, 500, "INTERNAL_ERROR", `Unable to ${label} the action.`);
    }
  });
}

// Endpoint 3: edit a Planned Action, including reassigning it (FR-03, FR-04, BR-12). Only the listed
// fields are read; Recorded By, Recorded at, the Ticket, and the status never change here.
onAction("patch", "", "save", async (req, res, action) => {
  const { data, fields } = validateActionFields(req.body, {
    ticketCreatedAt: action.ticket.createdAt,
    now: new Date(),
    partial: { followUpRequired: action.followUpRequired, followUpNote: action.followUpNote },
  });
  const version = versionFrom(req.body);
  if (version === null) fields.version = VERSION_ERROR;
  if (Object.keys(fields).length > 0) return invalid(res, fields);
  if (Object.keys(data).length === 0) return sendError(res, 400, "VALIDATION_ERROR", "Send at least one field to change.", {});

  const reassign = data.responsibleStaffId;
  await writeAction(res, action, version!, { ...data, lastEditedById: req.user!.id }, async (tx) =>
    reassign === undefined || (await isEligibleStaffLocked(tx, reassign)) ? null : "INVALID_RESPONSIBLE",
  );
});

// Endpoint 4: complete (FR-05, BR-10). Performed By and Completed at come from the session and the clock.
onAction("post", "/complete", "complete", async (req, res, action) => {
  const now = new Date();
  const fields: Record<string, string> = {};
  const result = validateResult(req.body?.result);
  if (result.error) fields.result = result.error;
  let actionAt = action.actionAt;
  if (req.body?.actionAt !== undefined) {
    const corrected = validateActionAt(req.body.actionAt, { ticketCreatedAt: action.ticket.createdAt, now });
    if (corrected.error) fields.actionAt = corrected.error;
    else actionAt = corrected.value!;
  }
  if (!fields.actionAt && !validateCompletionAt(actionAt, now)) {
    fields.actionAt = "A completed action cannot be dated later than now. Correct the date and time.";
  }
  const version = versionFrom(req.body);
  if (version === null) fields.version = VERSION_ERROR;
  if (Object.keys(fields).length > 0) return invalid(res, fields);

  await writeAction(res, action, version!, { status: "COMPLETED", result: result.value!, actionAt, performedById: req.user!.id, completedAt: now });
});

// Endpoint 5: cancel (FR-06, BR-11). The Action stays listed, labelled Cancelled with its reason.
onAction("post", "/cancel", "cancel", async (req, res, action) => {
  const fields: Record<string, string> = {};
  const reason = validateCancelReason(req.body?.reason);
  if (reason.error) fields.reason = reason.error;
  const version = versionFrom(req.body);
  if (version === null) fields.version = VERSION_ERROR;
  if (Object.keys(fields).length > 0) return invalid(res, fields);

  await writeAction(res, action, version!, { status: "CANCELLED", cancelReason: reason.value!, cancelledById: req.user!.id, cancelledAt: new Date() });
});
