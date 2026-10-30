import type { Prisma, TicketStatus } from "@prisma/client";

// BR-29: times are stored in UTC and shown in Asia/Bangkok, UTC+7 with no daylight saving.
export const TIME_ZONE = "Asia/Bangkok";
const BANGKOK_OFFSET = 7 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// "In the last N days": from 00:00 Bangkok on the calendar day N-1 days before today, up to now, so
// "last 7 days" covers today and the six days before it.
export function windowStart(days: number, now: Date = new Date()): Date {
  const bangkok = now.getTime() + BANGKOK_OFFSET;
  const todayStartInBangkok = Math.floor(bangkok / DAY) * DAY;
  return new Date(todayStartInBangkok - (days - 1) * DAY - BANGKOK_OFFSET);
}

// BR-30: an active Ticket is one not Resolved, Closed, or Cancelled.
export const INACTIVE_STATUSES: TicketStatus[] = ["RESOLVED", "CLOSED", "CANCELLED"];
export const RESOLVED_STATUSES: TicketStatus[] = ["RESOLVED", "CLOSED"];
export const activeWhere: Prisma.TicketWhereInput = { currentStatus: { notIn: INACTIVE_STATUSES } };

// L3-BR-59, the queue's needs-owner rule, which the Unassigned figure uses too (BR-31), so the figure and
// its drill-down count the same Tickets.
export const needsOwnerWhere: Prisma.TicketWhereInput[] = [
  { currentStatus: { notIn: ["CLOSED", "CANCELLED"] } },
  { OR: [{ ownerId: null }, { owner: { is: { OR: [{ isActive: false }, { role: "REQUESTER" }] } } }] },
];

// BR-36: a Ticket whose latest resolution falls inside the window and that is still Resolved or Closed. A
// resolution inside the window is the latest one iff any is, since the window runs up to now.
export const resolvedWithinWhere = (start: Date): Prisma.TicketWhereInput => ({
  currentStatus: { in: RESOLVED_STATUSES },
  statusChanges: { some: { toStatus: "RESOLVED", changedAt: { gte: start } } },
});

// Dashboard list descriptions are cut to 120 characters, the last being an ellipsis (api-spec endpoint 9).
export const cut = (text: string, max = 120) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
