import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, TicketStatus } from "@prisma/client";
import { permittedNext } from "../../src/ticketStatus.js";
import { seedReferenceData } from "../../prisma/seedReference.js";
import { seedContent } from "../../prisma/seedContent.js";
import { SEED_TICKET_NUMBERS, seedTickets } from "../../prisma/seedTickets.js";
import { ZERO_REQUESTER_EMAIL, ZERO_STAFF_EMAIL, seedUsers } from "../../prisma/seedUsers.js";
import { seedActions, seedStatusHistory } from "../../prisma/seedLab4.js";
import { createScratchDb, migrateDeploy, type ScratchDb } from "../lab-03/helpers.js";

const SETUP_TIMEOUT = 90_000;

async function seedAll(client: PrismaClient) {
  await seedReferenceData(client);
  await seedUsers(client);
  await seedTickets(client);
  await seedContent(client);
  await seedStatusHistory(client);
  await seedActions(client);
}

const WORKABLE: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"];
const DAY = 24 * 60 * 60 * 1000;

describe("Lab 4 seed on a fresh database", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await createScratchDb();
    migrateDeploy(db.url);
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  const actions = () => db.client.actionTaken.findMany({ orderBy: { id: "asc" } });
  const changes = () => db.client.statusChange.findMany({ orderBy: [{ ticketId: "asc" }, { changedAt: "asc" }, { id: "asc" }] });

  // MIG-04 / AC-46, BR-46
  it("is idempotent: a second run adds and changes nothing", async () => {
    await seedAll(db.client);
    const first = { actions: await actions(), changes: await changes(), tickets: await db.client.ticket.findMany({ orderBy: { id: "asc" } }) };
    await seedAll(db.client);
    expect(await actions()).toEqual(first.actions);
    expect(await changes()).toEqual(first.changes);
    expect(await db.client.ticket.findMany({ orderBy: { id: "asc" } })).toEqual(first.tickets);
    expect(first.actions.length).toBeGreaterThan(0);
  }, SETUP_TIMEOUT);

  // MIG-04 / AC-46, BR-46
  it("holds Tickets with zero, one, and several Actions, in every Action status, with follow-up and two Responsible Staff on one Ticket", async () => {
    const tickets = await db.client.ticket.findMany({ where: { ticketNumber: { in: SEED_TICKET_NUMBERS } }, include: { actions: true } });
    const sizes = tickets.map((t) => t.actions.length);
    expect(sizes).toContain(0);
    expect(sizes).toContain(1);
    expect(sizes.some((n) => n >= 3)).toBe(true);

    const all = tickets.flatMap((t) => t.actions);
    expect(new Set(all.map((a) => a.status))).toEqual(new Set(["PLANNED", "COMPLETED", "CANCELLED"]));
    expect(all.some((a) => a.followUpRequired && (a.followUpNote ?? "").length >= 5)).toBe(true);
    expect(tickets.some((t) => new Set(t.actions.map((a) => a.responsibleStaffId)).size >= 2)).toBe(true);
    // One Planned Action names the inactive IT Staff account, so BR-08's "no longer eligible" marker has a real row.
    const inactiveStaff = await db.client.user.findMany({ where: { role: "IT_STAFF", isActive: false }, select: { id: true } });
    expect(all.some((a) => a.status === "PLANNED" && inactiveStaff.some((u) => u.id === a.responsibleStaffId))).toBe(true);
  });

  // MIG-04 / BR-03 to BR-15, BR-21
  it("obeys the Action rules and the resolution gate on every seeded row", async () => {
    const tickets = await db.client.ticket.findMany({ include: { actions: true } });
    const staff = new Set((await db.client.user.findMany({ where: { role: { in: ["IT_STAFF", "ADMINISTRATOR"] } } })).map((u) => u.id));
    for (const t of tickets) {
      const planned = t.actions.filter((a) => a.status === "PLANNED");
      const completed = t.actions.filter((a) => a.status === "COMPLETED");
      if (!WORKABLE.includes(t.currentStatus)) expect(planned, t.ticketNumber).toHaveLength(0);
      if (t.currentStatus === "RESOLVED" || t.currentStatus === "CLOSED") expect(completed.length, t.ticketNumber).toBeGreaterThanOrEqual(1);
      for (const a of t.actions) {
        const where = `${t.ticketNumber} action ${a.id}`;
        expect(a.description.length, where).toBeGreaterThanOrEqual(5);
        expect(a.actionAt.getTime(), where).toBeGreaterThanOrEqual(t.createdAt.getTime());
        expect(staff.has(a.recordedById) && staff.has(a.responsibleStaffId), where).toBe(true);
        expect(a.followUpRequired ? (a.followUpNote ?? "").length >= 5 : a.followUpNote === null, where).toBe(true);
        if (a.status === "COMPLETED") {
          expect((a.result ?? "").length, where).toBeGreaterThanOrEqual(5);
          expect(a.performedById !== null && a.completedAt !== null, where).toBe(true);
          expect(a.actionAt.getTime(), where).toBeLessThanOrEqual(a.completedAt!.getTime());
        } else {
          expect(a.performedById === null && a.completedAt === null && a.result === null, where).toBe(true);
        }
        if (a.status === "CANCELLED") {
          expect(a.cancelledById !== null && a.cancelledAt !== null && (a.cancelReason ?? "").length >= 5, where).toBe(true);
        } else {
          expect(a.cancelledById === null && a.cancelledAt === null && a.cancelReason === null, where).toBe(true);
        }
        expect(a.version, where).toBe(a.status === "PLANNED" ? 1 : 2);
      }
    }
  });

  // MIG-04 / BR-24, BR-25, BR-46
  it("gives every seeded Ticket a Status History that starts at New and reaches its current status by permitted moves", async () => {
    const tickets = await db.client.ticket.findMany({ include: { statusChanges: { orderBy: [{ changedAt: "asc" }, { id: "asc" }] } } });
    expect(new Set(tickets.map((t) => t.currentStatus)).size).toBe(8);
    for (const t of tickets) {
      const h = t.statusChanges;
      expect(h[0], t.ticketNumber).toMatchObject({ fromStatus: null, toStatus: "NEW", changedById: t.requesterId, changedAt: t.createdAt });
      for (let i = 1; i < h.length; i++) {
        expect(h[i].fromStatus, t.ticketNumber).toBe(h[i - 1].toStatus);
        expect(permittedNext(h[i].fromStatus!), `${t.ticketNumber} ${h[i].fromStatus} to ${h[i].toStatus}`).toContain(h[i].toStatus);
        expect(h[i].changedAt.getTime()).toBeGreaterThan(h[i - 1].changedAt.getTime());
        expect(h[i].resolutionSummary === null, t.ticketNumber).toBe(h[i].toStatus !== "RESOLVED");
      }
      expect(h[h.length - 1].toStatus, t.ticketNumber).toBe(t.currentStatus);
      expect(h[h.length - 1].changedAt.getTime()).toBeLessThan(Date.now());
    }
  });

  // MIG-04 / BR-38, BR-46
  it("sets each seeded Ticket's last activity to its latest seeded move, Action, or Public Comment, never an Internal Note", async () => {
    const tickets = await db.client.ticket.findMany({
      where: { ticketNumber: { in: SEED_TICKET_NUMBERS } },
      include: { statusChanges: true, actions: true, publicComments: true, internalNotes: true },
    });
    for (const t of tickets) {
      const times = [
        ...t.statusChanges.map((c) => c.changedAt),
        ...t.actions.map((a) => a.updatedAt),
        ...t.publicComments.map((c) => c.createdAt),
      ].map((d) => d.getTime());
      expect(t.updatedAt.getTime(), t.ticketNumber).toBe(Math.max(...times));
    }
    // TKT-2026-900009's latest entry is an Internal Note (15 hours in); its last activity stays earlier.
    const noteLast = tickets.find((t) => t.ticketNumber === "TKT-2026-900009")!;
    expect(Math.max(...noteLast.internalNotes.map((n) => n.createdAt.getTime()))).toBeGreaterThan(noteLast.updatedAt.getTime());
  });

  // MIG-04 / AC-46, BR-46 (zero and non-zero dashboard figures)
  it("has a Requester and an IT Staff user whose own figures are all zero, and other users whose figures are not", async () => {
    const requester = await db.client.user.findUniqueOrThrow({ where: { email: ZERO_REQUESTER_EMAIL }, include: { tickets: true } });
    expect(requester).toMatchObject({ role: "REQUESTER", isActive: true });
    expect(requester.tickets).toHaveLength(0);

    const staff = await db.client.user.findUniqueOrThrow({ where: { email: ZERO_STAFF_EMAIL } });
    expect(staff).toMatchObject({ role: "IT_STAFF", isActive: true });
    expect(await db.client.ticket.count({ where: { ownerId: staff.id } })).toBe(0);
    expect(await db.client.actionTaken.count({ where: { responsibleStaffId: staff.id } })).toBe(0);

    // Non-zero: someone has Planned Actions, Tickets wait for a Requester, and a Ticket was resolved
    // in the last 30 days and is still Resolved or Closed.
    expect(await db.client.actionTaken.count({ where: { status: "PLANNED", responsibleStaff: { isActive: true } } })).toBeGreaterThan(0);
    expect(await db.client.ticket.count({ where: { currentStatus: "WAITING_FOR_REQUESTER" } })).toBeGreaterThan(0);
    const recent = await db.client.statusChange.findMany({
      where: { toStatus: "RESOLVED", changedAt: { gte: new Date(Date.now() - 30 * DAY) }, ticket: { currentStatus: { in: ["RESOLVED", "CLOSED"] } } },
    });
    expect(recent.length).toBeGreaterThan(0);
  });
});

describe("Lab 4 seed on a database that already has data", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await createScratchDb();
    migrateDeploy(db.url);
    await seedReferenceData(db.client);
    await seedUsers(db.client);
    await seedTickets(db.client);
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-04 / BR-25, BR-46
  it("never duplicates a migrated creation row and never invents history or work for a Ticket moved through the application", async () => {
    const migrated = await db.client.ticket.findUniqueOrThrow({ where: { ticketNumber: SEED_TICKET_NUMBERS[5] } });
    // What the migration backfill writes for a Ticket that existed before Lab 4.
    await db.client.statusChange.create({ data: { ticketId: migrated.id, fromStatus: null, toStatus: "NEW", changedById: migrated.requesterId, changedAt: migrated.createdAt } });
    // A Ticket someone moved after it was seeded no longer matches the seed's definition.
    const moved = await db.client.ticket.update({ where: { ticketNumber: SEED_TICKET_NUMBERS[1] }, data: { currentStatus: "CANCELLED" } });

    await seedStatusHistory(db.client);
    await seedActions(db.client);

    const migratedHistory = await db.client.statusChange.findMany({ where: { ticketId: migrated.id }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });
    expect(migratedHistory.filter((c) => c.fromStatus === null)).toHaveLength(1);
    expect(migratedHistory.at(-1)!.toStatus).toBe(migrated.currentStatus);

    // Its creation is a fact and is recorded; the moves the seed would have described are not.
    const movedHistory = await db.client.statusChange.findMany({ where: { ticketId: moved.id } });
    expect(movedHistory).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "NEW", changedById: moved.requesterId, changedAt: moved.createdAt })]);
    expect(await db.client.actionTaken.count({ where: { ticketId: moved.id } })).toBe(0);
  }, SETUP_TIMEOUT);
});
