import { Router, type Request, type Response } from "express";
import { Prisma, type TicketStatus } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { isValidId } from "../ids.js";
import { escapeLike } from "../searchText.js";
import { parseStaffQueueQuery } from "../staffQueueQuery.js";
import {
  isTicketStatus,
  isTransitionPermitted,
  permittedNext,
  requiresOwner,
  validateResolutionSummary,
} from "../ticketStatus.js";

export const staffTicketsRouter = Router();

// BR-57: an owner is eligible only while their account is active and their role is
// IT Staff or Administrator. Derived from the owner's current row on every read and
// never stored, so reactivating a user makes them eligible again with no repair.
export function isEligibleOwner(owner: { isActive: boolean; role: string } | null): boolean | null {
  if (!owner) return null;
  return owner.isActive && (owner.role === "IT_STAFF" || owner.role === "ADMINISTRATOR");
}

// The same rule, read inside the caller's write transaction with a share lock on the user's row
// (BR-18 here, Lab 4 BR-07 for Responsible Staff). A deactivation or role change locks that row
// FOR UPDATE (adminUsers lockPeople), so it either waits for the write or is seen by it: nobody
// deactivated a moment before the write is ever set (review on Lab 4 #83).
export async function isEligibleStaffLocked(tx: Prisma.TransactionClient, userId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ isActive: boolean; role: string }[]>(Prisma.sql`
    SELECT "isActive", "role"::text AS "role" FROM "User" WHERE "id" = ${userId} FOR SHARE`);
  return isEligibleOwner(rows[0] ?? null) === true;
}

// What every staff-facing Ticket response needs, so the list, the detail and every mutation
// return the same item shape (api-spec.md endpoint 7).
export const staffTicketInclude = {
  category: { select: { name: true } },
  requester: { select: { name: true, isActive: true } },
  owner: { select: { name: true, isActive: true, role: true } },
} satisfies Prisma.TicketInclude;

type StaffTicketRow = Prisma.TicketGetPayload<{ include: typeof staffTicketInclude }>;

export function serializeStaffTicket(t: StaffTicketRow) {
  return {
    id: t.id,
    ticketNumber: t.ticketNumber,
    summary: t.summary,
    categoryName: t.category.name,
    requesterName: t.requester.name,
    requesterIsActive: t.requester.isActive,
    requestedPriority: t.requestedPriority,
    itPriority: t.itPriority,
    currentStatus: t.currentStatus,
    ownerId: t.ownerId,
    ownerName: t.owner?.name ?? null,
    ownerIsActive: t.owner ? t.owner.isActive : null,
    ownerEligible: isEligibleOwner(t.owner),
    requesterResolutionFlaggedAt: t.requesterResolutionFlaggedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// GET /api/staff/tickets (api-spec.md endpoint 7, FR-10, BR-59).
staffTicketsRouter.get(
  "/api/staff/tickets",
  requireAuth,
  requireRole("IT_STAFF", "ADMINISTRATOR"),
  async (req: Request, res: Response) => {
    try {
      const query = parseStaffQueueQuery(req.query as Record<string, unknown>);

      // Filters combine with AND, and with `search`. AND is a list so that search and
      // the needs-owner filter, which both use OR, cannot overwrite each other.
      const and: Prisma.TicketWhereInput[] = [];
      if (query.search) {
        const text = escapeLike(query.search);
        and.push({
          OR: [
            { ticketNumber: { contains: text, mode: "insensitive" } },
            { summary: { contains: text, mode: "insensitive" } },
          ],
        });
      }
      if (query.status) and.push({ currentStatus: query.status });
      if (query.itPriority) and.push({ itPriority: query.itPriority });
      if (query.categoryId !== null) and.push({ categoryId: query.categoryId });

      switch (query.owner?.kind) {
        case "id":
          and.push({ ownerId: query.owner.id });
          break;
        case "unassigned":
          and.push({ ownerId: null });
          break;
        case "me":
          and.push({ ownerId: req.user!.id });
          break;
        case "needs-owner":
          // Open Tickets that are unassigned or whose owner is ineligible. A CLOSED or
          // CANCELLED Ticket keeps its marker but is excluded: nothing more is expected
          // of it (BR-59).
          and.push({ currentStatus: { notIn: ["CLOSED", "CANCELLED"] } });
          and.push({
            OR: [{ ownerId: null }, { owner: { is: { OR: [{ isActive: false }, { role: "REQUESTER" }] } } }],
          });
          break;
      }
      const where: Prisma.TicketWhereInput = and.length > 0 ? { AND: and } : {};

      const { page, pageSize, sortField, sortDirection } = query;
      const [total, tickets] = await Promise.all([
        getPrisma().ticket.count({ where }),
        getPrisma().ticket.findMany({
          where,
          // Ties on every sort break by id descending, so paging never repeats or skips a row.
          orderBy: [{ [sortField]: sortDirection }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: staffTicketInclude,
        }),
      ]);

      res.status(200).json({
        tickets: tickets.map(serializeStaffTicket),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch {
      sendError(res, 500, "INTERNAL_ERROR", "Unable to load the ticket queue.");
    }
  },
);

// ---------------------------------------------------------------------------
// Staff Ticket operations (api-spec.md endpoints 8 to 10).
// ---------------------------------------------------------------------------

const staffOnly = [requireAuth, requireRole("IT_STAFF", "ADMINISTRATOR")];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

// A Ticket id in the path that is not a positive integer names no Ticket: 404, as everywhere.
function ticketIdFrom(req: Request): number | null {
  const id = Number(req.params.id);
  return isValidId(id) ? id : null;
}

// Owners who can be assigned: active IT Staff and Administrators (BR-18). The client fills the
// Ticket Owner select from this. It carries no email and never a password hash.
staffTicketsRouter.get("/api/staff/owners", ...staffOnly, async (_req: Request, res: Response) => {
  try {
    const owners = await getPrisma().user.findMany({
      where: { isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    res.status(200).json(owners);
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the list of owners.");
  }
});

// PATCH /api/staff/tickets/:id/owner (endpoint 8, FR-12, BR-17 to BR-20, BR-58).
// One operation with no separate verbs: claiming is sending your own id.
staffTicketsRouter.patch("/api/staff/tickets/:id/owner", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const ticketId = ticketIdFrom(req);
    const ownerId: unknown = req.body?.ownerId;
    if (ownerId !== null && !isValidId(ownerId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "ownerId must be a user id, or null to unassign.", {
        ownerId: "ownerId must be a user id, or null to unassign.",
      });
    }
    if (ticketId === null) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");

    const prisma = getPrisma();
    const existing = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });
    if (!existing) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");

    if (ownerId === null) {
      // BR-20: unassigning is always permitted.
      const updated = await prisma.ticket.update({
        where: { id: ticketId },
        data: { ownerId: null },
        include: staffTicketInclude,
      });
      return res.status(200).json(serializeStaffTicket(updated));
    }

    // BR-18: the target must exist, be active, and hold the IT Staff or Administrator role, checked
    // inside the same transaction as the write and with the target's row share-locked.
    const outcome = await prisma.$transaction(async (tx) => {
      if (!(await isEligibleStaffLocked(tx, ownerId))) return "INVALID_OWNER" as const;
      if (ownerId === req.user!.id) {
        // A claim (BR-19, BR-58). The condition is part of the write itself, so two people
        // claiming at once cannot both win: it succeeds while the Ticket has no owner, is
        // already yours, or its owner is ineligible, and the loser gets ALREADY_ASSIGNED.
        const claimed = await tx.ticket.updateMany({
          where: {
            id: ticketId,
            OR: [
              { ownerId: null },
              { ownerId: req.user!.id },
              { owner: { is: { OR: [{ isActive: false }, { role: "REQUESTER" }] } } },
            ],
          },
          data: { ownerId: req.user!.id },
        });
        if (claimed.count === 0) return "ALREADY_ASSIGNED" as const;
      } else {
        // Assigning or reassigning to someone else, whether or not it is currently assigned (BR-20).
        await tx.ticket.update({ where: { id: ticketId }, data: { ownerId } });
      }
      return "OK" as const;
    });
    if (outcome === "INVALID_OWNER") {
      return sendError(res, 409, "INVALID_OWNER", "That user cannot be a Ticket Owner: they must be an active IT Staff member or Administrator.");
    }
    if (outcome === "ALREADY_ASSIGNED") {
      return sendError(res, 409, "ALREADY_ASSIGNED", "This Ticket already has an owner. Ask them, or an administrator, to reassign it.");
    }

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: staffTicketInclude });
    res.status(200).json(serializeStaffTicket(updated));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to change the Ticket Owner.");
  }
});

// PATCH /api/staff/tickets/:id/priority (endpoint 9, FR-13, BR-21, BR-22).
staffTicketsRouter.patch("/api/staff/tickets/:id/priority", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const ticketId = ticketIdFrom(req);
    const value: unknown = req.body?.itPriority;
    if (typeof value !== "string" || !(PRIORITIES as readonly string[]).includes(value)) {
      return sendError(res, 400, "VALIDATION_ERROR", "IT Priority must be LOW, MEDIUM or HIGH.", {
        itPriority: "IT Priority must be LOW, MEDIUM or HIGH.",
      });
    }
    if (ticketId === null) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");

    const prisma = getPrisma();
    if (!(await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } }))) {
      return sendError(res, 404, "NOT_FOUND", "Ticket not found.");
    }
    // Only itPriority is written: Requested Priority is immutable (BR-21).
    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { itPriority: value as (typeof PRIORITIES)[number] },
      include: staffTicketInclude,
    });
    res.status(200).json(serializeStaffTicket(updated));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to change the IT Priority.");
  }
});

// PATCH /api/staff/tickets/:id/status (Lab 3 endpoint 10, changed by Lab 4 api-spec endpoint 7: FR-07 to
// FR-09, BR-15, BR-20 to BR-24). Checked in this order: the request (400), the Ticket (404), the status the
// user saw (409 STATUS_CHANGED), the transition (409 INVALID_TRANSITION), the owner (409 OWNER_REQUIRED), and
// for Resolved the gate (409 ACTIONS_INCOMPLETE, then NO_COMPLETED_ACTION).
//
// Everything after the request checks runs in one transaction holding FOR UPDATE on the Ticket row: the
// judgement, the move, its Status Change, and a cancel's cascade to Planned Actions. Action writes take the
// same row (routes/actions.ts), so an Action cannot be added between the gate and the move (BR-21), and
// the owner's row is share-locked so a deactivation cannot slip in either.
const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

type MoveOutcome =
  | { kind: "moved" }
  | { kind: "notFound" }
  | { kind: "changed"; current: TicketStatus }
  | { kind: "invalid"; current: TicketStatus }
  | { kind: "ownerRequired" }
  | { kind: "incomplete"; plannedActions: number }
  | { kind: "noCompleted" };

staffTicketsRouter.patch("/api/staff/tickets/:id/status", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const ticketId = ticketIdFrom(req);
    const target: unknown = req.body?.currentStatus;
    const from: unknown = req.body?.fromStatus;
    const fields: Record<string, string> = {};
    if (!isTicketStatus(target)) fields.currentStatus = "Choose one of the eight Ticket statuses.";
    // BR-23: the status the user saw, so a move is never applied against a status they did not see.
    if (!isTicketStatus(from)) fields.fromStatus = "Send the status the Ticket had when you chose the move.";
    let summary: string | undefined;
    if (target === "RESOLVED") {
      const result = validateResolutionSummary(req.body?.resolutionSummary);
      if (result.error) fields.resolutionSummary = result.error;
      else summary = result.value;
    }
    if (Object.keys(fields).length > 0) {
      return sendError(res, 400, "VALIDATION_ERROR", Object.keys(fields).length === 1 ? Object.values(fields)[0] : "Some fields are not valid.", fields);
    }
    if (ticketId === null) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");
    const to = target as TicketStatus;
    const seen = from as TicketStatus;
    const userId = req.user!.id;

    const outcome = await getPrisma().$transaction(async (tx): Promise<MoveOutcome> => {
      const rows = await tx.$queryRaw<{ currentStatus: TicketStatus; ownerId: number | null }[]>(Prisma.sql`
        SELECT "currentStatus", "ownerId" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`);
      if (rows.length === 0) return { kind: "notFound" };
      const { currentStatus, ownerId } = rows[0];
      if (currentStatus !== seen) return { kind: "changed", current: currentStatus };
      if (!isTransitionPermitted(currentStatus, to)) return { kind: "invalid", current: currentStatus };
      if (requiresOwner(to) && (ownerId === null || !(await isEligibleStaffLocked(tx, ownerId)))) return { kind: "ownerRequired" };
      if (to === "RESOLVED") {
        const counts = await tx.actionTaken.groupBy({ by: ["status"], where: { ticketId }, _count: { _all: true } });
        const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
        if (count("PLANNED") > 0) return { kind: "incomplete", plannedActions: count("PLANNED") };
        if (count("COMPLETED") === 0) return { kind: "noCompleted" };
      }

      await tx.ticket.update({ where: { id: ticketId }, data: { currentStatus: to, ...(summary !== undefined ? { resolutionSummary: summary } : {}) } });
      await tx.statusChange.create({
        data: { ticketId, fromStatus: currentStatus, toStatus: to, changedById: userId, resolutionSummary: to === "RESOLVED" ? summary! : null },
      });
      if (to === "CANCELLED") {
        // BR-15: a Cancelled Ticket leaves no work hanging. Each Planned Action is cancelled with the Ticket
        // and its version moved on, as any cancellation does (BR-13).
        await tx.actionTaken.updateMany({
          where: { ticketId, status: "PLANNED" },
          data: { status: "CANCELLED", cancelReason: "Ticket cancelled", cancelledById: userId, cancelledAt: new Date(), version: { increment: 1 } },
        });
      }
      return { kind: "moved" };
    });

    switch (outcome.kind) {
      case "notFound":
        return sendError(res, 404, "NOT_FOUND", "Ticket not found.");
      case "changed":
        return res.status(409).json({
          error: "STATUS_CHANGED",
          message: `This Ticket moved to ${STATUS_LABEL[outcome.current]} while you were viewing it. Check the current status and try again.`,
          currentStatus: outcome.current,
          permitted: permittedNext(outcome.current),
        });
      case "invalid": {
        const permitted = permittedNext(outcome.current);
        return res.status(409).json({
          error: "INVALID_TRANSITION",
          message:
            permitted.length > 0
              ? `A Ticket that is ${outcome.current} cannot move to ${to}. It can move to: ${permitted.join(", ")}.`
              : `A Ticket that is ${outcome.current} cannot move to any other status.`,
          currentStatus: outcome.current,
          permitted,
        });
      }
      case "ownerRequired":
        return sendError(res, 409, "OWNER_REQUIRED", `A Ticket needs an active IT Staff owner before it can move to ${to}. Claim it or assign an owner first.`);
      case "incomplete":
        return res.status(409).json({
          error: "ACTIONS_INCOMPLETE",
          message: `This ticket cannot be resolved yet: ${outcome.plannedActions} planned ${outcome.plannedActions === 1 ? "action is" : "actions are"} still open.`,
          plannedActions: outcome.plannedActions,
        });
      case "noCompleted":
        return res.status(409).json({ error: "NO_COMPLETED_ACTION", message: "Record and complete at least one action before resolving.", completedActions: 0 });
    }
    const updated = await getPrisma().ticket.findUniqueOrThrow({ where: { id: ticketId }, include: staffTicketInclude });
    res.status(200).json(serializeStaffTicket(updated));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to change the Ticket status.");
  }
});
