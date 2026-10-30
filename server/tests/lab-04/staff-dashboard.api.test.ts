import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Prisma, TicketStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { seedContent } from "../../prisma/seedContent.js";
import { seedActions, seedStatusHistory } from "../../prisma/seedLab4.js";
import { seedTickets } from "../../prisma/seedTickets.js";
import { ZERO_STAFF_EMAIL, seedUsers } from "../../prisma/seedUsers.js";
import { signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 4 api-spec endpoint 9 (BR-28, BR-31, BR-32, BR-34, BR-36) on its own throwaway database holding the
// full seed, so every figure has real rows to count.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, admin: Caller, zeroStaff: Caller, requester: Caller;
let staffId: number;
const STATUSES: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const ACTIVE: Prisma.TicketWhereInput = { currentStatus: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] } };

beforeAll(async () => {
  const db = iso.db.client;
  await seedUsers(db);
  await seedTickets(db);
  await seedContent(db);
  await seedStatusHistory(db);
  await seedActions(db);
  const user = (email: string) => db.user.findUniqueOrThrow({ where: { email } });
  const pim = await user("pimchanok.somboon@toktickit.test");
  staffId = pim.id;
  staff = await signedIn(pim);
  admin = await signedIn(await user("aekkarat.wongsa@toktickit.test"));
  zeroStaff = await signedIn(await user(ZERO_STAFF_EMAIL));
  requester = await signedIn(await user("kanokwan.srisuwan@toktickit.test"));
  // Seeded accounts start with a pending password change, which requireAuth enforces with 403.
  await db.user.updateMany({ data: { mustChangePassword: false } });
});

describe("GET /api/dashboard/staff", () => {
  // DASH-01 / AC-28, BR-31
  it("gives every figure exactly the count of its defining query", async () => {
    const db = iso.db.client;
    const res = await staff.get("/api/dashboard/staff");
    expect(res.status).toBe(200);
    const m = res.body.metrics;
    expect(res.body.timeZone).toBe("Asia/Bangkok");

    const needsOwner = await db.ticket.count({
      where: { currentStatus: { notIn: ["CLOSED", "CANCELLED"] }, OR: [{ ownerId: null }, { owner: { is: { OR: [{ isActive: false }, { role: "REQUESTER" }] } } }] },
    });
    expect(m.unassigned.count).toBe(needsOwner);
    expect(m.myTickets.count).toBe(await db.ticket.count({ where: { ...ACTIVE, ownerId: staffId } }));
    expect(m.urgent.count).toBe(await db.ticket.count({ where: { ...ACTIVE, itPriority: "HIGH" } }));
    expect(m.byStatus.map((s: { status: string }) => s.status)).toEqual(STATUSES);
    for (const s of m.byStatus) expect(s.count, s.status).toBe(await db.ticket.count({ where: { currentStatus: s.status } }));

    const planned = await db.actionTaken.findMany({ where: { status: "PLANNED", responsibleStaffId: staffId }, orderBy: [{ actionAt: "asc" }, { id: "asc" }] });
    expect(res.body.myPlannedActions.count).toBe(planned.length);
    expect(res.body.myPlannedActions.items.map((a: { actionId: number }) => a.actionId)).toEqual(planned.slice(0, 5).map((a) => a.id));

    const recent = await db.ticket.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 5 });
    expect(res.body.recentlyUpdated.map((t: { id: number }) => t.id)).toEqual(recent.map((t) => t.id));
    // Non-zero on the seed: the figures prove something.
    expect([m.unassigned.count, m.myTickets.count, m.urgent.count, res.body.myPlannedActions.count].every((c) => c > 0)).toBe(true);
  });

  // DASH-02 / AC-30, BR-34
  it("gives a staff member with nothing assigned zero for their own figures, and keeps every card", async () => {
    const res = await zeroStaff.get("/api/dashboard/staff");
    expect(res.status).toBe(200);
    expect(res.body.metrics.myTickets.count).toBe(0);
    expect(res.body.myPlannedActions).toEqual({ count: 0, items: [] });
    expect(res.body.metrics.byStatus).toHaveLength(8);
  });

  // DASH-03 / AC-31, BR-36
  it("links every figure to a queue that shows exactly the counted Tickets", async () => {
    const res = await staff.get("/api/dashboard/staff");
    const m = res.body.metrics;
    const links: [string, number][] = [
      [m.unassigned.link, m.unassigned.count],
      [m.myTickets.link, m.myTickets.count],
      [m.urgent.link, m.urgent.count],
      ...m.byStatus.map((s: { link: string; count: number }) => [s.link, s.count] as [string, number]),
    ];
    for (const [link, count] of links) {
      expect(link, link).toMatch(/^\/staff\/tickets\?/);
      const queue = await staff.get(`/api${link}&pageSize=50`);
      expect(queue.status, link).toBe(200);
      expect(queue.body.pagination.total, link).toBe(count);
    }
    for (const item of res.body.myPlannedActions.items) expect(item.link).toBe(`/staff/tickets/${item.ticketId}?tab=actions`);
    for (const item of res.body.recentlyUpdated) expect(item.link).toBe(`/staff/tickets/${item.id}`);
  });

  // DASH-04 / BR-28, AC-38
  it("keeps every list to 5 items, latest first, and cuts a long description to 120 characters", async () => {
    const db = iso.db.client;
    const ticket = await db.ticket.findFirstOrThrow({ where: { ...ACTIVE } });
    const long = "Check the switch port, the patch panel, and the cable run along the corridor ceiling, then retest the link for an hour. ".repeat(2);
    for (let i = 0; i < 6; i++) {
      await db.actionTaken.create({
        data: { ticketId: ticket.id, actionAt: new Date(Date.now() - (10 - i) * 60_000), description: i === 0 ? long : `Short planned action ${i}`, recordedById: staffId, responsibleStaffId: staffId },
      });
    }
    const res = await staff.get("/api/dashboard/staff");
    const items = res.body.myPlannedActions.items;
    expect(items).toHaveLength(5);
    expect(res.body.myPlannedActions.count).toBeGreaterThan(5);
    const times = items.map((a: { actionAt: string }) => Date.parse(a.actionAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const a of items) expect(a.description.length).toBeLessThanOrEqual(120);
    // The long one is the earliest of the six, so it is among the five shown.
    const cut = items.find((a: { description: string }) => a.description.startsWith("Check the switch port"));
    expect(cut.description).toHaveLength(120);
    expect(cut.description.endsWith("…")).toBe(true);
    expect(res.body.recentlyUpdated.length).toBeLessThanOrEqual(5);
    const updated = res.body.recentlyUpdated.map((t: { updatedAt: string }) => Date.parse(t.updatedAt));
    expect(updated).toEqual([...updated].sort((a, b) => b - a));
    expect(Object.keys(res.body.recentlyUpdated[0]).sort()).toEqual(["currentStatus", "id", "link", "summary", "ticketNumber", "updatedAt"]);
  });
});

describe("dashboard authorization", () => {
  // SEC-04 / AC-33, BR-32
  it("gives an Administrator the account counts and IT Staff no accounts key at all", async () => {
    const db = iso.db.client;
    expect((await staff.get("/api/dashboard/staff")).body).not.toHaveProperty("accounts");
    const res = await admin.get("/api/dashboard/staff");
    expect(res.status).toBe(200);
    const active = async (role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR") => db.user.count({ where: { role, isActive: true } });
    expect(res.body.accounts).toEqual({
      active: { REQUESTER: await active("REQUESTER"), IT_STAFF: await active("IT_STAFF"), ADMINISTRATOR: await active("ADMINISTRATOR") },
      inactive: await db.user.count({ where: { isActive: false } }),
      link: "/admin/users",
    });
  });

  // SEC-03 / AC-34, BR-35
  it("refuses a Requester the staff dashboard and IT Staff and Administrators the Requester dashboard, with no figure in the body", async () => {
    const r = await requester.get("/api/dashboard/staff");
    expect(r.status).toBe(403);
    expect(Object.keys(r.body).sort()).toEqual(["error", "message"]);
    for (const caller of [staff, admin]) {
      const s = await caller.get("/api/dashboard/requester");
      expect(s.status).toBe(403);
      expect(Object.keys(s.body).sort()).toEqual(["error", "message"]);
    }
  });

  // SEC-02 / AC-34
  it("answers 401 with no data on every Lab 4 endpoint without a session", async () => {
    const t = await iso.db.client.ticket.findFirstOrThrow();
    const a = await iso.db.client.actionTaken.findFirstOrThrow();
    const calls = [
      request(app).get("/api/dashboard/staff"),
      request(app).get("/api/dashboard/requester"),
      request(app).get(`/api/tickets/${t.id}/actions`),
      request(app).post(`/api/tickets/${t.id}/actions`).send({ actionAt: new Date().toISOString(), description: "No session here." }),
      request(app).patch(`/api/actions/${a.id}`).send({ version: a.version, description: "No session here." }),
      request(app).post(`/api/actions/${a.id}/complete`).send({ version: a.version, result: "No session here." }),
      request(app).post(`/api/actions/${a.id}/cancel`).send({ version: a.version, reason: "No session here." }),
      request(app).get(`/api/tickets/${t.id}/history`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
    }
  });
});

