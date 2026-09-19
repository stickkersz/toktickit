import { Router, type Request, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { escapeLike } from "../searchText.js";
import { parseStaffQueueQuery } from "../staffQueueQuery.js";

export const staffTicketsRouter = Router();

// BR-57: an owner is eligible only while their account is active and their role is
// IT Staff or Administrator. Derived from the owner's current row on every read and
// never stored, so reactivating a user makes them eligible again with no repair.
export function isEligibleOwner(owner: { isActive: boolean; role: string } | null): boolean | null {
  if (!owner) return null;
  return owner.isActive && (owner.role === "IT_STAFF" || owner.role === "ADMINISTRATOR");
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
          include: {
            category: { select: { name: true } },
            requester: { select: { name: true, isActive: true } },
            owner: { select: { name: true, isActive: true, role: true } },
          },
        }),
      ]);

      res.status(200).json({
        tickets: tickets.map((t) => ({
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
        })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    } catch {
      sendError(res, 500, "INTERNAL_ERROR", "Unable to load the ticket queue.");
    }
  },
);
