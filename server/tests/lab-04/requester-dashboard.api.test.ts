import { beforeAll, describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import { windowStart } from "../../src/dashboardWindow.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 4 api-spec endpoint 10 and the list filters of section 11 (BR-29, BR-33 to BR-38). Its own
// throwaway database, with fixtures placed exactly where the windows begin and end.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let alice: Caller, bob: Caller, nobody: Caller, staff: Caller;
let aliceId: number, bobId: number, staffId: number;

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
async function ticket(requesterId: number, status: TicketStatus, o: { updatedAt?: Date; resolvedAt?: Date } = {}) {
  n += 1;
  const created = await iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-3${String(n).padStart(5, "0")}`,
      requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Dashboard fixture ${n}`,
      description: "A fixture for the Requester dashboard tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: status,
      ownerId: staffId,
      createdAt: new Date(Date.now() - 60 * DAY),
    },
  });
  if (o.resolvedAt) {
    await iso.db.client.statusChange.create({ data: { ticketId: created.id, fromStatus: "IN_PROGRESS", toStatus: "RESOLVED", changedById: staffId, changedAt: o.resolvedAt, resolutionSummary: "Fixed and checked with the Requester." } });
  }
  // Last activity is set last, so nothing above moves it.
  return iso.db.client.ticket.update({ where: { id: created.id }, data: { updatedAt: o.updatedAt ?? new Date(Date.now() - 20 * DAY) } });
}

beforeAll(async () => {
  const make = async (role: "IT_STAFF" | "REQUESTER") => {
    const u = (await createUser({ role })).user;
    return [await signedIn(u), u.id] as const;
  };
  [staff, staffId] = await make("IT_STAFF");
  [alice, aliceId] = await make("REQUESTER");
  [bob, bobId] = await make("REQUESTER");
  [nobody] = await make("REQUESTER");

  const now = Date.now();
  const week = windowStart(7, new Date(now)).getTime();
  const month = windowStart(30, new Date(now)).getTime();
  // Alice: two open (one waiting), one updated just inside the 7-day window and one just outside it, one
  // resolved inside the 30-day window, one resolved just outside it, one resolved inside but reopened since,
  // one closed whose resolution is inside.
  await ticket(aliceId, "OPEN", { updatedAt: new Date(now - 60_000) });
  await ticket(aliceId, "WAITING_FOR_REQUESTER", { updatedAt: new Date(week + 60_000) });
  await ticket(aliceId, "NEW", { updatedAt: new Date(week - 60_000) });
  await ticket(aliceId, "RESOLVED", { resolvedAt: new Date(month + 60_000) });
  await ticket(aliceId, "RESOLVED", { resolvedAt: new Date(month - 60_000) });
  await ticket(aliceId, "REOPENED", { resolvedAt: new Date(now - 2 * DAY) });
  await ticket(aliceId, "CLOSED", { resolvedAt: new Date(now - 3 * DAY) });
  await ticket(aliceId, "CANCELLED");
  // Bob's Tickets would change every one of Alice's figures if they leaked in.
  for (const s of ["OPEN", "WAITING_FOR_REQUESTER", "RESOLVED"] as const) await ticket(bobId, s, { updatedAt: new Date(now - 1000), resolvedAt: s === "RESOLVED" ? new Date(now - DAY) : undefined });
});

describe("GET /api/dashboard/requester", () => {
  // DASH-05 / AC-29, BR-33
  it("gives every figure exactly the count of its defining query, inside the Bangkok windows", async () => {
    const db = iso.db.client;
    const res = await alice.get("/api/dashboard/requester");
    expect(res.status).toBe(200);
    const m = res.body.metrics;
    const mine = { requesterId: aliceId };
    expect(m.open.count).toBe(await db.ticket.count({ where: { ...mine, currentStatus: { notIn: ["RESOLVED", "CLOSED", "CANCELLED"] } } }));
    expect(m.waitingForYou.count).toBe(await db.ticket.count({ where: { ...mine, currentStatus: "WAITING_FOR_REQUESTER" } }));
    expect(m.recentlyUpdated.count).toBe(await db.ticket.count({ where: { ...mine, updatedAt: { gte: windowStart(7, new Date()) } } }));
    const resolved = await db.$queryRaw<{ id: number }[]>`
      SELECT t.id FROM "Ticket" t JOIN "StatusChange" s ON s."ticketId" = t.id AND s."toStatus" = 'RESOLVED'
      WHERE t."requesterId" = ${aliceId} AND t."currentStatus" IN ('RESOLVED', 'CLOSED')
      GROUP BY t.id HAVING max(s."changedAt") >= ${windowStart(30, new Date())}`;
    expect(m.recentlyResolved.count).toBe(resolved.length);
    // The fixtures were placed so each figure has a known value.
    expect([m.open.count, m.waitingForYou.count, m.recentlyUpdated.count, m.recentlyResolved.count]).toEqual([4, 1, 2, 2]);
    expect(m.recentlyUpdated.windowDays).toBe(7);
    expect(m.recentlyResolved.windowDays).toBe(30);
  });

  // DASH-08 / AC-35, BR-29
  it("counts a Ticket a minute inside each window and not one a minute outside it", async () => {
    const res = await alice.get("/api/dashboard/requester");
    const updated = res.body.recentlyUpdated.map((t: { summary: string }) => t.summary);
    expect(updated).toContain("Dashboard fixture 2"); // a minute after the 7-day window starts
    expect(updated).not.toContain("Dashboard fixture 3"); // a minute before it
    const resolved = res.body.recentlyResolved.map((t: { summary: string }) => t.summary);
    expect(resolved).toContain("Dashboard fixture 4");
    expect(resolved).not.toContain("Dashboard fixture 5");
    // Resolved, then reopened: no longer resolved, so not counted (BR-33).
    expect(resolved).not.toContain("Dashboard fixture 6");
    expect(resolved).toContain("Dashboard fixture 7");
  });

  // DASH-06 / AC-02
  it("shows a Requester only their own Tickets", async () => {
    const res = await bob.get("/api/dashboard/requester");
    expect(res.body.metrics.open.count).toBe(2);
    expect(res.body.metrics.waitingForYou.count).toBe(1);
    expect(res.body.metrics.recentlyResolved.count).toBe(1);
    const ids = [...res.body.recentlyUpdated, ...res.body.recentlyResolved].map((t: { id: number }) => t.id);
    const owners = await iso.db.client.ticket.findMany({ where: { id: { in: ids } }, select: { requesterId: true } });
    expect(owners.every((t) => t.requesterId === bobId)).toBe(true);
  });

  // SEC-06 / AC-02, BR-35
  it("reads no parameter that could widen it", async () => {
    const plain = (await alice.get("/api/dashboard/requester")).body;
    for (const q of [`requesterId=${bobId}`, "owner=me", "all=true", `requester=${bobId}`]) {
      const res = await alice.get(`/api/dashboard/requester?${q}`);
      expect(res.body.metrics, q).toEqual(plain.metrics);
    }
  });

  // DASH-10 / AC-30, BR-34
  it("gives a Requester with no Tickets zero everywhere and empty lists", async () => {
    const res = await nobody.get("/api/dashboard/requester");
    expect(res.status).toBe(200);
    const m = res.body.metrics;
    expect([m.open.count, m.waitingForYou.count, m.recentlyUpdated.count, m.recentlyResolved.count]).toEqual([0, 0, 0, 0]);
    expect(res.body.recentlyUpdated).toEqual([]);
    expect(res.body.recentlyResolved).toEqual([]);
  });

  // DASH-07 / AC-32, BR-36
  it("links every figure to a My Tickets list that shows exactly the counted Tickets", async () => {
    const m = (await alice.get("/api/dashboard/requester")).body.metrics;
    // The client route uses `status`; My Tickets' API keeps its Lab 2 name `currentStatus` (api-spec section 11).
    for (const metric of [m.open, m.waitingForYou, m.recentlyUpdated, m.recentlyResolved]) {
      expect(metric.link).toMatch(/^\/tickets\?/);
      const api = `/api${metric.link}`.replace("status=", "currentStatus=");
      const res = await alice.get(`${api}&pageSize=50`);
      expect(res.status, metric.link).toBe(200);
      expect(res.body.pagination.total, metric.link).toBe(metric.count);
    }
  });

  // DASH-04 (Requester lists) / BR-28
  it("keeps both lists to 5, latest first, each with its resolution time", async () => {
    const res = await alice.get("/api/dashboard/requester");
    for (const list of [res.body.recentlyUpdated, res.body.recentlyResolved]) expect(list.length).toBeLessThanOrEqual(5);
    const updated = res.body.recentlyUpdated.map((t: { updatedAt: string }) => Date.parse(t.updatedAt));
    expect(updated).toEqual([...updated].sort((a, b) => b - a));
    const resolved = res.body.recentlyResolved.map((t: { resolvedAt: string }) => Date.parse(t.resolvedAt));
    expect(resolved).toEqual([...resolved].sort((a, b) => b - a));
    expect(res.body.recentlyResolved[0].link).toBe(`/tickets/${res.body.recentlyResolved[0].id}`);
  });
});

describe("last activity (BR-38)", () => {
  // DASH-09 / BR-38
  it("moves with an Action write, a Public Comment, and an Attachment, and not with an Internal Note", async () => {
    const t = await ticket(aliceId, "IN_PROGRESS", { updatedAt: new Date(Date.now() - 5 * DAY) });
    const at = async () => (await iso.db.client.ticket.findUniqueOrThrow({ where: { id: t.id } })).updatedAt.getTime();
    let before = await at();
    expect((await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "A private note for staff only." })).status).toBe(201);
    expect(await at()).toBe(before);
    expect((await staff.post(`/api/tickets/${t.id}/actions`).send({ actionAt: new Date().toISOString(), description: "Swap the cable." })).status).toBe(201);
    expect(await at()).toBeGreaterThan(before);
    before = await at();
    expect((await alice.post(`/api/tickets/${t.id}/comments`).send({ body: "It still drops every hour." })).status).toBe(201);
    expect(await at()).toBeGreaterThan(before);
    before = await at();
    const upload = await alice.post(`/api/tickets/${t.id}/attachments`).attach("files", Buffer.from("screen"), { filename: "drop.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(await at()).toBeGreaterThan(before);
    before = await at();
    const attachmentId = upload.body.uploaded[0].id;
    expect((await alice.delete(`/api/attachments/${attachmentId}`).send({ reason: "Uploaded the wrong file." })).status).toBe(200);
    expect(await at()).toBeGreaterThan(before);
  });
});

describe("list filters for the drill-downs (api-spec section 11)", () => {
  // API-19 / BR-36
  it("filters My Tickets and the queue by statusGroup, takes all eight statuses on My Tickets, and sorts by last activity", async () => {
    const mine = async (q: string) => (await alice.get(`/api/tickets?${q}&pageSize=50`)).body;
    const active = await mine("statusGroup=active");
    expect(active.data.every((t: { currentStatus: string }) => !["RESOLVED", "CLOSED", "CANCELLED"].includes(t.currentStatus))).toBe(true);
    const resolved = await mine("statusGroup=resolved");
    expect(resolved.data.map((t: { currentStatus: string }) => t.currentStatus).sort()).toEqual(["CLOSED", "RESOLVED", "RESOLVED"]);
    for (const s of ["NEW", "OPEN", "WAITING_FOR_REQUESTER", "REOPENED", "CANCELLED", "CLOSED"]) {
      const res = await mine(`currentStatus=${s}`);
      expect(res.data.length, s).toBeGreaterThan(0);
      expect(res.data.every((t: { currentStatus: string }) => t.currentStatus === s), s).toBe(true);
    }
    // A single status wins over a group (api-spec section 11).
    expect((await mine("statusGroup=active&currentStatus=CLOSED")).data.every((t: { currentStatus: string }) => t.currentStatus === "CLOSED")).toBe(true);
    const sorted = (await mine("sort=-updatedAt")).data.map((t: { updatedAt: string }) => Date.parse(t.updatedAt));
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
    // Unknown values fall back to no filter (L2-BR-23); an out-of-range window too.
    expect((await mine("statusGroup=everything")).pagination.total).toBe((await mine("")).pagination.total);
    expect((await mine("updatedWithinDays=0")).pagination.total).toBe((await mine("")).pagination.total);
    expect((await mine("resolvedWithinDays=91")).pagination.total).toBe((await mine("")).pagination.total);

    const queue = await staff.get("/api/staff/tickets?statusGroup=resolved&pageSize=50");
    expect(queue.status).toBe(200);
    expect(queue.body.tickets.every((t: { currentStatus: string }) => ["RESOLVED", "CLOSED"].includes(t.currentStatus))).toBe(true);
    expect(queue.body.pagination.total).toBe(await iso.db.client.ticket.count({ where: { currentStatus: { in: ["RESOLVED", "CLOSED"] } } }));
  });
});
