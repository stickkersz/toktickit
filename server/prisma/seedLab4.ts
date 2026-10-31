import type { ActionStatus, Prisma, PrismaClient, TicketStatus } from "@prisma/client";
import { SEED_TICKETS } from "./seedTickets.js";

// Lab 4 BR-46: Status History and Actions Taken for the seeded Tickets. Nothing here is sensitive.
//
// Both functions are idempotent and never touch work done through the application. They only add
// to a seeded Ticket whose status is still the one the seed gave it and that has none of the rows
// they would add, so a second run adds nothing, and a Ticket someone has moved or worked on keeps
// exactly what it has. The Tickets and users must already be seeded.

const STAFF1 = "pimchanok.somboon@toktickit.test";
const STAFF2 = "wichai.charoen@toktickit.test";
const STAFF3 = "anucha.prasert@toktickit.test";
const FORMER = "sunisa.kaewmanee@toktickit.test"; // inactive
const ADMIN = "aekkarat.wongsa@toktickit.test";

const MINUTE = 60_000;

// Held for each whole run, so two seeds started together cannot both find a row missing and both add it.
const SEED_HISTORY_LOCK = 4_270_702;
const SEED_ACTIONS_LOCK = 4_270_703;

// Long enough for a first run on a slow machine; Prisma's default is 5 seconds.
export const SEED_TRANSACTION_TIMEOUT = 30_000;

// BR-38: a Ticket's last activity is its latest move, Action write, or Public Comment, never an
// Internal Note. Called only for a Ticket this run has just added rows to.
async function touchLastActivity(tx: Prisma.TransactionClient, ticketId: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Ticket" SET "updatedAt" = GREATEST(
      (SELECT max("changedAt") FROM "StatusChange" WHERE "ticketId" = ${ticketId}),
      (SELECT max("updatedAt") FROM "ActionTaken" WHERE "ticketId" = ${ticketId}),
      (SELECT max("createdAt") FROM "PublicComment" WHERE "ticketId" = ${ticketId}))
    WHERE id = ${ticketId}`;
}

// The moves that take a new Ticket to each status, using only permitted transitions (BR-20).
const PATHS: Record<TicketStatus, TicketStatus[]> = {
  NEW: [],
  OPEN: ["OPEN"],
  IN_PROGRESS: ["OPEN", "IN_PROGRESS"],
  WAITING_FOR_REQUESTER: ["OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER"],
  RESOLVED: ["OPEN", "IN_PROGRESS", "RESOLVED"],
  CLOSED: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  REOPENED: ["OPEN", "IN_PROGRESS", "RESOLVED", "REOPENED"],
  CANCELLED: ["CANCELLED"],
};

// Move n happens n hours after creation, after the seeded Actions that came before it; a Cancel
// happens 5 minutes after creation, as the seeded comment on the duplicate request says.
const moveAt = (createdAt: Date, n: number, to: TicketStatus) =>
  new Date(createdAt.getTime() + (to === "CANCELLED" ? 5 * MINUTE : n * 60 * MINUTE));

// The Reopened Ticket has no Resolution Summary any more; its earlier resolution had this one.
const EARLIER_RESOLUTION: Record<string, string> = {
  "TKT-2026-900007": "Restarted the registration service and confirmed a submit returns within two seconds.",
};

export async function seedStatusHistory(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_HISTORY_LOCK})`;
    const users = new Map((await tx.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
    const tickets = await tx.ticket.findMany({
      where: { ticketNumber: { in: SEED_TICKETS.map((t) => t.ticketNumber) } },
      include: { statusChanges: { select: { fromStatus: true } } },
    });

    for (const ticket of tickets) {
      const def = SEED_TICKETS.find((t) => t.ticketNumber === ticket.ticketNumber)!;
      // The creation row is a fact for every Ticket; the migration backfill may already have written it (BR-25).
      const addCreation = !ticket.statusChanges.some((c) => c.fromStatus === null);
      if (addCreation) {
        await tx.statusChange.create({
          data: { ticketId: ticket.id, fromStatus: null, toStatus: "NEW", changedById: ticket.requesterId, changedAt: ticket.createdAt },
        });
      }
      // The later moves are only described for a Ticket still in its seeded status with no recorded move.
      if (ticket.currentStatus !== def.status || ticket.statusChanges.some((c) => c.fromStatus !== null)) {
        if (addCreation) await touchLastActivity(tx, ticket.id);
        continue;
      }
      const mover = users.get(def.owner ?? STAFF1)!;
      let from: TicketStatus = "NEW";
      for (const [i, to] of PATHS[def.status].entries()) {
        await tx.statusChange.create({
          data: {
            ticketId: ticket.id,
            fromStatus: from,
            toStatus: to,
            changedById: mover,
            changedAt: moveAt(ticket.createdAt, i + 1, to),
            resolutionSummary: to === "RESOLVED" ? (def.resolutionSummary ?? EARLIER_RESOLUTION[def.ticketNumber]) : null,
          },
        });
        from = to;
      }
      await touchLastActivity(tx, ticket.id);
    }
  }, { timeout: SEED_TRANSACTION_TIMEOUT });
}

interface SeedAction {
  ticket: string;
  // Action Date/Time as minutes after the Ticket was created; Recorded at is the same moment.
  minutesAfter: number;
  recordedBy: string;
  responsible: string;
  description: string;
  status: ActionStatus;
  // Completed: who did it and the Result, 15 minutes after the Action Date/Time.
  performedBy?: string;
  result?: string;
  // Cancelled: who cancelled it and why, 10 minutes after the Action Date/Time unless stated.
  cancelledBy?: string;
  cancelReason?: string;
  cancelledMinutesAfter?: number;
  followUpNote?: string;
  attachmentNotes?: string;
}

// Tickets with zero, one, and several Actions; every Action status; follow-up; two Responsible Staff on
// one Ticket; and one Planned Action still naming the inactive IT Staff account (BR-08). Resolved and
// Closed Tickets hold only final Actions with at least one Completed (BR-21); the Cancelled Ticket's
// Action was cancelled with it (BR-15); Planned Actions sit only on workable Tickets (BR-14).
const ACTIONS: SeedAction[] = [
  { ticket: "TKT-2026-900002", minutesAfter: 90, recordedBy: STAFF1, responsible: STAFF1, status: "PLANNED", description: "Swap the USB cable to the card reader during the morning round." },

  { ticket: "TKT-2026-900003", minutesAfter: 50, recordedBy: STAFF2, responsible: STAFF2, status: "COMPLETED", performedBy: STAFF2, description: "Reproduce the upload error with a large PDF.", result: "Reproduced with a 12 MB PDF; files under 10 MB upload normally.", followUpNote: "Raise the proxy and application upload limits together and retest." },
  { ticket: "TKT-2026-900003", minutesAfter: 60, recordedBy: STAFF2, responsible: STAFF2, status: "CANCELLED", cancelledBy: STAFF2, description: "Clear the browser cache on the Requester's laptop.", cancelReason: "Not needed: the error comes from the server." },
  { ticket: "TKT-2026-900003", minutesAfter: 160, recordedBy: STAFF2, responsible: STAFF3, status: "PLANNED", description: "Raise the proxy upload limit to 20 MB and retest the upload." },

  { ticket: "TKT-2026-900004", minutesAfter: 35, recordedBy: STAFF3, responsible: STAFF3, status: "COMPLETED", performedBy: STAFF3, description: "Unlock the portal account and check the lock log.", result: "Account unlocked; the lock came from the three-attempts rule.", followUpNote: "Confirm with the Requester that the lock has not come back." },

  { ticket: "TKT-2026-900005", minutesAfter: 70, recordedBy: STAFF1, responsible: STAFF1, status: "COMPLETED", performedBy: STAFF1, description: "Replace the second floor access point.", result: "Access point replaced; the connection stayed stable for 30 minutes.", attachmentNotes: "Photo of the old unit's power supply label." },
  { ticket: "TKT-2026-900005", minutesAfter: 120, recordedBy: STAFF1, responsible: STAFF3, status: "COMPLETED", performedBy: STAFF3, description: "Run a signal survey in room 214.", result: "Signal strong across the room; no drops in 20 minutes." },

  { ticket: "TKT-2026-900006", minutesAfter: 40, recordedBy: STAFF2, responsible: STAFF2, status: "COMPLETED", performedBy: STAFF2, description: "Swap the catalog terminal keyboard for a spare.", result: "Keyboard swapped and every key tested." },

  { ticket: "TKT-2026-900007", minutesAfter: 100, recordedBy: ADMIN, responsible: ADMIN, status: "COMPLETED", performedBy: ADMIN, description: "Restart the registration service and test a submit.", result: "A submit returned within two seconds after the restart." },
  { ticket: "TKT-2026-900007", minutesAfter: 250, recordedBy: ADMIN, responsible: STAFF2, status: "PLANNED", description: "Check the registration service logs around the time of the freeze." },

  { ticket: "TKT-2026-900008", minutesAfter: 3, recordedBy: STAFF1, responsible: STAFF1, status: "CANCELLED", cancelledBy: STAFF1, cancelledMinutesAfter: 5, description: "Check whether the access request is a duplicate.", cancelReason: "Ticket cancelled" },

  { ticket: "TKT-2026-900009", minutesAfter: 40, recordedBy: FORMER, responsible: FORMER, status: "PLANNED", description: "Run the battery health report on the laptop." },

  { ticket: "TKT-2026-900014", minutesAfter: 70, recordedBy: FORMER, responsible: FORMER, status: "COMPLETED", performedBy: FORMER, description: "Rebuild the catalog search index.", result: "Index rebuilt; titles the library holds are found again." },
];

export const SEED_ACTION_COUNT = ACTIONS.length;

export async function seedActions(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEED_ACTIONS_LOCK})`;
    const users = new Map((await tx.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]));
    const user = (email: string) => {
      const id = users.get(email);
      if (id === undefined) throw new Error(`seedActions: no user "${email}", seed the users first`);
      return id;
    };
    const tickets = await tx.ticket.findMany({
      where: { ticketNumber: { in: [...new Set(ACTIONS.map((a) => a.ticket))] } },
      include: { _count: { select: { actions: true } } },
    });

    for (const ticket of tickets) {
      const def = SEED_TICKETS.find((t) => t.ticketNumber === ticket.ticketNumber)!;
      if (ticket.currentStatus !== def.status || ticket._count.actions > 0) continue;
      for (const a of ACTIONS.filter((x) => x.ticket === ticket.ticketNumber)) {
        const actionAt = new Date(ticket.createdAt.getTime() + a.minutesAfter * MINUTE);
        const completedAt = a.status === "COMPLETED" ? new Date(actionAt.getTime() + 15 * MINUTE) : null;
        const cancelledAt =
          a.status === "CANCELLED" ? new Date(ticket.createdAt.getTime() + (a.cancelledMinutesAfter ?? a.minutesAfter + 10) * MINUTE) : null;
        await tx.actionTaken.create({
          data: {
            ticketId: ticket.id,
            actionAt,
            description: a.description,
            result: a.result ?? null,
            status: a.status,
            followUpRequired: a.followUpNote !== undefined,
            followUpNote: a.followUpNote ?? null,
            attachmentNotes: a.attachmentNotes ?? null,
            recordedById: user(a.recordedBy),
            responsibleStaffId: user(a.responsible),
            performedById: a.performedBy ? user(a.performedBy) : null,
            completedAt,
            cancelledById: a.cancelledBy ? user(a.cancelledBy) : null,
            cancelledAt,
            cancelReason: a.cancelReason ?? null,
            // A finished Action was completed or cancelled once, which moved its version on (BR-13).
            version: a.status === "PLANNED" ? 1 : 2,
            createdAt: actionAt,
            updatedAt: completedAt ?? cancelledAt ?? actionAt,
          },
        });
      }
      await touchLastActivity(tx, ticket.id);
    }
  }, { timeout: SEED_TRANSACTION_TIMEOUT });
}
