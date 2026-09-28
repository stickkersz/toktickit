import { Router, type Request, type Response } from "express";
import type { Prisma, TicketStatus } from "@prisma/client";
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
    if (ownerId !== null && !(typeof ownerId === "number" && Number.isInteger(ownerId) && ownerId > 0)) {
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

    // BR-18: the target must exist, be active, and hold the IT Staff or Administrator role.
    const target = await prisma.user.findUnique({ where: { id: ownerId }, select: { isActive: true, role: true } });
    if (!target || isEligibleOwner(target) !== true) {
      return sendError(res, 409, "INVALID_OWNER", "That user cannot be a Ticket Owner: they must be an active IT Staff member or Administrator.");
    }

    if (ownerId === req.user!.id) {
      // A claim (BR-19, BR-58). The condition is part of the write itself, so two people
      // claiming at once cannot both win: it succeeds while the Ticket has no owner, is
      // already yours, or its owner is ineligible, and the loser gets ALREADY_ASSIGNED.
      const claimed = await prisma.ticket.updateMany({
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
      if (claimed.count === 0) {
        return sendError(res, 409, "ALREADY_ASSIGNED", "This Ticket already has an owner. Ask them, or an administrator, to reassign it.");
      }
    } else {
      // Assigning or reassigning to someone else, whether or not it is currently assigned (BR-20).
      await prisma.ticket.update({ where: { id: ticketId }, data: { ownerId } });
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

// PATCH /api/staff/tickets/:id/status (endpoint 10, FR-14, BR-25 to BR-28, BR-58).
// Checked in this order: the request itself (400), the Ticket (404), the transition
// (409 INVALID_TRANSITION), then the owner (409 OWNER_REQUIRED).
staffTicketsRouter.patch("/api/staff/tickets/:id/status", ...staffOnly, async (req: Request, res: Response) => {
  try {
    const ticketId = ticketIdFrom(req);
    const target: unknown = req.body?.currentStatus;
    if (!isTicketStatus(target)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Unknown status.", { currentStatus: "Choose one of the eight Ticket statuses." });
    }
    let summary: string | undefined;
    if (target === "RESOLVED") {
      const result = validateResolutionSummary(req.body?.resolutionSummary);
      if (result.error) return sendError(res, 400, "VALIDATION_ERROR", result.error, { resolutionSummary: result.error });
      summary = result.value;
    }
    if (ticketId === null) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");

    const prisma = getPrisma();

    // Judges the move against ONE read of the Ticket and hands back the status it judged. That
    // exact status is what the write is conditional on: judging one read and then guarding the
    // write with a second, unjudged read would let a concurrent change be mistaken for the status
    // that had been checked, and an unvalidated move, even one out of CLOSED or CANCELLED, would
    // go through.
    type Verdict = { ok: true; from: TicketStatus } | { ok: false; refusal: Refusal };
    type Refusal = { status: 404 } | { status: 409; code: "INVALID_TRANSITION" | "OWNER_REQUIRED"; from: TicketStatus };
    const judge = async (): Promise<Verdict> => {
      const t = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { currentStatus: true, owner: { select: { isActive: true, role: true } } },
      });
      if (!t) return { ok: false, refusal: { status: 404 } };
      if (!isTransitionPermitted(t.currentStatus, target)) {
        return { ok: false, refusal: { status: 409, code: "INVALID_TRANSITION", from: t.currentStatus } };
      }
      if (requiresOwner(target) && isEligibleOwner(t.owner) !== true) {
        return { ok: false, refusal: { status: 409, code: "OWNER_REQUIRED", from: t.currentStatus } };
      }
      return { ok: true, from: t.currentStatus };
    };
    const respondRefusal = (r: Refusal) => {
      if (r.status === 404) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");
      if (r.code === "INVALID_TRANSITION") {
        const permitted = permittedNext(r.from);
        return res.status(409).json({
          error: "INVALID_TRANSITION",
          message:
            permitted.length > 0
              ? `A Ticket that is ${r.from} cannot move to ${target}. It can move to: ${permitted.join(", ")}.`
              : `A Ticket that is ${r.from} cannot move to any other status.`,
          currentStatus: r.from,
          permitted,
        });
      }
      return sendError(res, 409, "OWNER_REQUIRED", `A Ticket needs an active IT Staff owner before it can move to ${target}. Claim it or assign an owner first.`);
    };

    const verdict = await judge();
    if (!verdict.ok) return respondRefusal(verdict.refusal);

    // Conditional on the Ticket still being in the status that was judged, and on the owner still
    // being eligible when one is required. If it has moved on, nothing is written and the move is
    // judged again from where the Ticket actually is: it is never applied on the strength of a
    // check made against a status the Ticket no longer has.
    const moved = await prisma.ticket.updateMany({
      where: {
        id: ticketId,
        currentStatus: verdict.from,
        ...(requiresOwner(target) ? { owner: { is: { isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } } } } : {}),
      },
      data: { currentStatus: target, ...(summary !== undefined ? { resolutionSummary: summary } : {}) },
    });
    if (moved.count === 0) {
      const again = await judge();
      if (!again.ok) return respondRefusal(again.refusal);
      // Still permitted from its new status, but that is not the status it was judged against.
      return res.status(409).json({
        error: "INVALID_TRANSITION",
        message: "The Ticket changed while you were editing it. Reload and try again.",
        currentStatus: again.from,
        permitted: permittedNext(again.from),
      });
    }

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: staffTicketInclude });
    res.status(200).json(serializeStaffTicket(updated));
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to change the Ticket status.");
  }
});
