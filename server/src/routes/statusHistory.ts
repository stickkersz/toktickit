import { Router, type Request, type Response } from "express";
import type { TicketStatus } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { isValidId } from "../ids.js";

// GET /api/tickets/:id/history (Lab 4 api-spec endpoint 6). Read only: Status Changes are written by the
// status move and Ticket create alone, in their own transactions, and no route edits or deletes one (BR-24).
export const statusHistoryRouter = Router();

const anyRole = [requireAuth, requireRole("REQUESTER", "IT_STAFF", "ADMINISTRATOR")];

// BR-25: the entries do not chain when a move was made before Lab 4 recorded moves. A gap stays a gap
// after later moves, so every link is checked, not only the last one.
export function hasUnrecordedChanges(entries: { fromStatus: TicketStatus | null; toStatus: TicketStatus }[], current: TicketStatus): boolean {
  for (let i = 1; i < entries.length; i++) if (entries[i].fromStatus !== entries[i - 1].toStatus) return true;
  return entries.length === 0 ? current !== "NEW" : entries[entries.length - 1].toStatus !== current;
}

statusHistoryRouter.get("/api/tickets/:id/history", ...anyRole, async (req: Request, res: Response) => {
  try {
    const ticketId = Number(req.params.id);
    if (!isValidId(ticketId)) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");
    const prisma = getPrisma();
    // A Requester reads their own Ticket's history only (BR-26); another's is a 404, as for the Ticket itself.
    const where = req.user!.role === "REQUESTER" ? { id: ticketId, requesterId: req.user!.id } : { id: ticketId };
    const ticket = await prisma.ticket.findFirst({ where, select: { currentStatus: true } });
    if (!ticket) return sendError(res, 404, "NOT_FOUND", "Ticket not found.");

    const rows = await prisma.statusChange.findMany({
      where: { ticketId },
      orderBy: [{ changedAt: "asc" }, { id: "asc" }],
      include: { changedBy: { select: { id: true, name: true } } },
    });
    res.status(200).json({
      entries: rows.map((r) => ({
        id: r.id,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        changedBy: r.changedBy,
        changedAt: r.changedAt,
        resolutionSummary: r.resolutionSummary,
      })),
      earlierChangesUnrecorded: hasUnrecordedChanges(rows, ticket.currentStatus),
    });
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the status history.");
  }
});
