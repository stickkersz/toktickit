import { Router, type Request, type Response } from "express";
import { Prisma, type TicketStatus } from "@prisma/client";
import { getPrisma } from "../prisma.js";
import { sendError } from "../httpErrors.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { RESOLVED_STATUSES, TIME_ZONE, activeWhere, cut, needsOwnerWhere, resolvedWithinWhere, windowStart } from "../dashboardWindow.js";

// Lab 4 api-spec endpoints 9 and 10. Every figure is counted by the database at request time; lists are
// capped at 5, and the client receives no Ticket collection to count itself (BR-28).
export const dashboardsRouter = Router();

const LIST = 5;
// api-spec endpoint 9: all eight, in BR-20's order, zeros included.
const BR20_ORDER: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const ticketItem = (t: { id: number; ticketNumber: string; summary: string; currentStatus: TicketStatus; updatedAt: Date }, link: string) => ({
  id: t.id,
  ticketNumber: t.ticketNumber,
  summary: t.summary,
  currentStatus: t.currentStatus,
  updatedAt: t.updatedAt,
  link,
});
const listSelect = { id: true, ticketNumber: true, summary: true, currentStatus: true, updatedAt: true } as const;

// Endpoint 9: IT Staff and Administrators, across every Requester (BR-31); account counts for an
// Administrator only (BR-32).
dashboardsRouter.get("/api/dashboard/staff", requireAuth, requireRole("IT_STAFF", "ADMINISTRATOR"), async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const me = req.user!.id;
    const [unassigned, myTickets, urgent, grouped, plannedCount, planned, recent] = await Promise.all([
      prisma.ticket.count({ where: { AND: needsOwnerWhere } }),
      prisma.ticket.count({ where: { ...activeWhere, ownerId: me } }),
      prisma.ticket.count({ where: { ...activeWhere, itPriority: "HIGH" } }),
      prisma.ticket.groupBy({ by: ["currentStatus"], _count: { _all: true } }),
      prisma.actionTaken.count({ where: { status: "PLANNED", responsibleStaffId: me } }),
      prisma.actionTaken.findMany({
        where: { status: "PLANNED", responsibleStaffId: me },
        orderBy: [{ actionAt: "asc" }, { id: "asc" }],
        take: LIST,
        select: { id: true, ticketId: true, description: true, actionAt: true, ticket: { select: { ticketNumber: true } } },
      }),
      prisma.ticket.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIST, select: listSelect }),
    ]);
    const byStatus = BR20_ORDER.map((status) => ({
      status,
      count: grouped.find((g) => g.currentStatus === status)?._count._all ?? 0,
      link: `/staff/tickets?status=${status}`,
    }));

    const body: Record<string, unknown> = {
      generatedAt: new Date(),
      timeZone: TIME_ZONE,
      metrics: {
        unassigned: { count: unassigned, link: "/staff/tickets?owner=needs-owner" },
        myTickets: { count: myTickets, link: "/staff/tickets?owner=me&statusGroup=active" },
        urgent: { count: urgent, link: "/staff/tickets?itPriority=HIGH&statusGroup=active" },
        byStatus,
      },
      myPlannedActions: {
        count: plannedCount,
        items: planned.map((a) => ({
          actionId: a.id,
          ticketId: a.ticketId,
          ticketNumber: a.ticket.ticketNumber,
          description: cut(a.description),
          actionAt: a.actionAt,
          link: `/staff/tickets/${a.ticketId}?tab=actions`,
        })),
      },
      recentlyUpdated: recent.map((t) => ticketItem(t, `/staff/tickets/${t.id}`)),
    };

    if (req.user!.role === "ADMINISTRATOR") {
      const roles = await prisma.user.groupBy({ by: ["role"], where: { isActive: true }, _count: { _all: true } });
      const active = (role: string) => roles.find((r) => r.role === role)?._count._all ?? 0;
      body.accounts = {
        active: { REQUESTER: active("REQUESTER"), IT_STAFF: active("IT_STAFF"), ADMINISTRATOR: active("ADMINISTRATOR") },
        inactive: await prisma.user.count({ where: { isActive: false } }),
        link: "/admin/users",
      };
    }
    res.status(200).json(body);
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the dashboard.");
  }
});

// Endpoint 10: the signed-in Requester's own Tickets only. The Requester comes from the session; no
// parameter is read (BR-35).
dashboardsRouter.get("/api/dashboard/requester", requireAuth, requireRole("REQUESTER"), async (req: Request, res: Response) => {
  try {
    const prisma = getPrisma();
    const mine = { requesterId: req.user!.id };
    const now = new Date();
    const week = windowStart(7, now);
    const month = windowStart(30, now);
    const [open, waiting, updatedCount, updated, resolvedCount, resolved] = await Promise.all([
      prisma.ticket.count({ where: { ...mine, ...activeWhere } }),
      prisma.ticket.count({ where: { ...mine, currentStatus: "WAITING_FOR_REQUESTER" } }),
      prisma.ticket.count({ where: { ...mine, updatedAt: { gte: week } } }),
      prisma.ticket.findMany({ where: { ...mine, updatedAt: { gte: week } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIST, select: listSelect }),
      prisma.ticket.count({ where: { ...mine, ...resolvedWithinWhere(month) } }),
      // The resolution time is the latest Status Change to Resolved (BR-33).
      prisma.$queryRaw<{ id: number; ticketNumber: string; summary: string; currentStatus: TicketStatus; resolvedAt: Date }[]>(Prisma.sql`
        SELECT t."id", t."ticketNumber", t."summary", t."currentStatus", max(s."changedAt") AS "resolvedAt"
        FROM "Ticket" t JOIN "StatusChange" s ON s."ticketId" = t."id" AND s."toStatus" = 'RESOLVED'
        WHERE t."requesterId" = ${mine.requesterId} AND t."currentStatus"::text IN (${Prisma.join(RESOLVED_STATUSES)})
        GROUP BY t."id"
        HAVING max(s."changedAt") >= ${month}
        ORDER BY "resolvedAt" DESC, t."id" DESC
        LIMIT ${LIST}`),
    ]);
    res.status(200).json({
      generatedAt: now,
      timeZone: TIME_ZONE,
      metrics: {
        open: { count: open, link: "/tickets?statusGroup=active" },
        waitingForYou: { count: waiting, link: "/tickets?status=WAITING_FOR_REQUESTER" },
        recentlyUpdated: { count: updatedCount, windowDays: 7, link: "/tickets?updatedWithinDays=7&sort=-updatedAt" },
        recentlyResolved: { count: resolvedCount, windowDays: 30, link: "/tickets?resolvedWithinDays=30&sort=-updatedAt" },
      },
      recentlyUpdated: updated.map((t) => ticketItem(t, `/tickets/${t.id}`)),
      recentlyResolved: resolved.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        summary: t.summary,
        currentStatus: t.currentStatus,
        resolvedAt: t.resolvedAt,
        link: `/tickets/${t.id}`,
      })),
    });
  } catch {
    sendError(res, 500, "INTERNAL_ERROR", "Unable to load the dashboard.");
  }
});
