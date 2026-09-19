import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { TicketPriority, TicketStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// The IT Staff Ticket Queue (api-spec.md endpoint 7) against a throwaway database with a
// known set of Tickets. Ids are matched by summary, never by position in a global count.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
type Row = {
  id: number;
  ticketNumber: string;
  summary: string;
  categoryName: string;
  requesterName: string;
  requesterIsActive: boolean;
  requestedPriority: string;
  itPriority: string;
  currentStatus: string;
  ownerId: number | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
  ownerEligible: boolean | null;
  createdAt: string;
};

let staff: Session;
let staffId: number;
let otherStaffId: number;
let inactiveStaffId: number;
let requesterAsOwnerId: number;
let inactiveRequesterId: number;

// Every Ticket the file makes is named `Q-<label>` so it can be told apart and looked up.
const summaries = new Map<string, string>();

async function makeTicket(
  label: string,
  o: {
    requesterId: number;
    categoryId?: number;
    requested?: TicketPriority;
    it?: TicketPriority;
    status?: TicketStatus;
    ownerId?: number | null;
    createdAt?: Date;
  },
) {
  const summary = `Q-${label} queue fixture`;
  summaries.set(label, summary);
  const n = summaries.size;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-8${String(n).padStart(5, "0")}`,
      requesterId: o.requesterId,
      categoryId: o.categoryId ?? 1,
      relatedSystemId: 1,
      summary,
      description: "A fixture for the staff queue tests, long enough to be valid.",
      requestedPriority: o.requested ?? "LOW",
      itPriority: o.it ?? o.requested ?? "LOW",
      currentStatus: o.status ?? "NEW",
      ownerId: o.ownerId ?? null,
      createdAt: o.createdAt ?? new Date(Date.now() - n * 60_000),
    },
  });
}

const list = (s: Session, query: Record<string, string | number> = {}) => s.get("/api/staff/tickets").query({ search: "Q-", ...query });
const labelsOf = (rows: Row[]) => rows.map((r) => r.summary.replace(/^Q-/, "").replace(/ queue fixture$/, ""));

beforeAll(async () => {
  const s = await createUser({ role: "IT_STAFF" });
  staff = await signedIn(s.user);
  staffId = s.user.id;
  otherStaffId = (await createUser({ role: "IT_STAFF" })).user.id;
  inactiveStaffId = (await createUser({ role: "IT_STAFF", isActive: false })).user.id;
  requesterAsOwnerId = (await createUser({ role: "REQUESTER" })).user.id; // demoted staff
  const a = (await createUser()).user;
  const b = (await createUser()).user;
  inactiveRequesterId = (await createUser({ isActive: false })).user.id;

  const day = 24 * 60 * 60 * 1000;
  const t0 = Date.now();
  await makeTicket("alpha", { requesterId: a.id, categoryId: 4, requested: "HIGH", it: "HIGH", status: "NEW", createdAt: new Date(t0 - 1 * day) });
  await makeTicket("bravo", { requesterId: b.id, categoryId: 2, requested: "MEDIUM", it: "LOW", status: "OPEN", ownerId: staffId, createdAt: new Date(t0 - 2 * day) });
  await makeTicket("charlie", { requesterId: a.id, categoryId: 4, requested: "LOW", it: "MEDIUM", status: "IN_PROGRESS", ownerId: otherStaffId, createdAt: new Date(t0 - 3 * day) });
  await makeTicket("delta", { requesterId: b.id, categoryId: 3, requested: "HIGH", it: "HIGH", status: "RESOLVED", ownerId: staffId, createdAt: new Date(t0 - 4 * day) });
  await makeTicket("echo", { requesterId: a.id, categoryId: 2, requested: "MEDIUM", it: "MEDIUM", status: "CLOSED", ownerId: inactiveStaffId, createdAt: new Date(t0 - 5 * day) });
  await makeTicket("foxtrot", { requesterId: inactiveRequesterId, categoryId: 1, requested: "LOW", it: "LOW", status: "NEW", createdAt: new Date(t0 - 6 * day) });
  await makeTicket("golf", { requesterId: b.id, categoryId: 4, requested: "HIGH", it: "MEDIUM", status: "OPEN", ownerId: inactiveStaffId, createdAt: new Date(t0 - 7 * day) });
  await makeTicket("hotel", { requesterId: a.id, categoryId: 3, requested: "MEDIUM", it: "HIGH", status: "OPEN", ownerId: requesterAsOwnerId, createdAt: new Date(t0 - 8 * day) });
  await makeTicket("india", { requesterId: b.id, categoryId: 1, requested: "LOW", it: "LOW", status: "CANCELLED", createdAt: new Date(t0 - 9 * day) });
  await makeTicket("juliet", { requesterId: a.id, categoryId: 1, requested: "HIGH", it: "HIGH", status: "WAITING_FOR_REQUESTER", ownerId: otherStaffId, createdAt: new Date(t0 - 10 * day) });
  await makeTicket("kilo", { requesterId: b.id, categoryId: 2, requested: "LOW", it: "LOW", status: "REOPENED", ownerId: staffId, createdAt: new Date(t0 - 11 * day) });
  await makeTicket("lima", { requesterId: a.id, categoryId: 3, requested: "MEDIUM", it: "MEDIUM", status: "NEW", createdAt: new Date(t0 - 12 * day) });
});

describe("GET /api/staff/tickets: who may call it", () => {
  it("answers 401 with no session and 403 for a Requester, with no Ticket content in either body", async () => {
    const anonymous = await request(app).get("/api/staff/tickets");
    expect(anonymous.status).toBe(401);
    const requester = await signedIn((await createUser()).user);
    const denied = await requester.get("/api/staff/tickets");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "FORBIDDEN", message: "You do not have permission to do that." });
  });

  it("lets an Administrator in as well as IT Staff", async () => {
    const admin = await signedIn((await createUser({ role: "ADMINISTRATOR" })).user);
    const res = await list(admin);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(12);
  });
});

describe("GET /api/staff/tickets: listing, search, filters, sort, pagination", () => {
  // API-16 / AC-16, AC-17
  it("lists Tickets from every Requester with ownership and status information", async () => {
    const res = await list(staff, { pageSize: 50 });
    expect(res.status).toBe(200);
    const rows = res.body.tickets as Row[];
    expect(rows).toHaveLength(12);
    const alpha = rows.find((r) => r.summary.startsWith("Q-alpha"))!;
    expect(alpha).toMatchObject({
      categoryName: "Network",
      requestedPriority: "HIGH",
      itPriority: "HIGH",
      currentStatus: "NEW",
      ownerId: null,
      ownerName: null,
      ownerIsActive: null,
      ownerEligible: null,
      requesterIsActive: true,
    });
    expect(alpha.ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    expect(alpha.requesterName).toBeTruthy();
    expect(Object.keys(alpha).sort()).toEqual(
      [
        "categoryName", "createdAt", "currentStatus", "id", "itPriority", "ownerEligible", "ownerId", "ownerIsActive",
        "ownerName", "requestedPriority", "requesterIsActive", "requesterName", "requesterResolutionFlaggedAt",
        "summary", "ticketNumber", "updatedAt",
      ].sort(),
    );
    const bravo = rows.find((r) => r.summary.startsWith("Q-bravo"))!;
    expect(bravo).toMatchObject({ ownerId: staffId, ownerEligible: true, ownerIsActive: true, currentStatus: "OPEN" });
    // IT Priority is reported separately from Requested Priority (AC-21).
    expect(bravo).toMatchObject({ requestedPriority: "MEDIUM", itPriority: "LOW" });
  });

  it("searches ticket number and summary, partially and case-insensitively", async () => {
    const bySummary = await list(staff, { search: "q-CHARLIE" });
    expect(labelsOf(bySummary.body.tickets)).toEqual(["charlie"]);

    const all = (await list(staff, { pageSize: 50 })).body.tickets as Row[];
    const number = all.find((r) => r.summary.startsWith("Q-delta"))!.ticketNumber;
    expect(labelsOf((await list(staff, { search: number })).body.tickets)).toEqual(["delta"]);
    expect(labelsOf((await list(staff, { search: number.toLowerCase().slice(4, 12) })).body.tickets)).toContain("delta");
  });

  it("filters by status, IT Priority and category, each on its own", async () => {
    expect(labelsOf((await list(staff, { status: "OPEN", sort: "ticketNumber" })).body.tickets)).toEqual(["bravo", "golf", "hotel"]);
    expect((await list(staff, { itPriority: "HIGH" })).body.pagination.total).toBe(4); // alpha, delta, hotel, juliet
    expect((await list(staff, { itPriority: "LOW" })).body.pagination.total).toBe(4); // bravo, foxtrot, india, kilo
    expect((await list(staff, { category: 4 })).body.pagination.total).toBe(3); // alpha, charlie, golf
    expect((await list(staff, { category: 999999 })).body.pagination.total).toBe(0);
  });

  it("combines every filter and the search with AND", async () => {
    const res = await list(staff, { search: "queue fixture", status: "OPEN", itPriority: "MEDIUM", category: 4 });
    expect(labelsOf(res.body.tickets)).toEqual(["golf"]);
    const none = await list(staff, { status: "OPEN", itPriority: "MEDIUM", category: 1 });
    expect(none.body.tickets).toEqual([]);
  });

  it("sorts by each documented field in both directions, breaking ties by id descending", async () => {
    const asc = (await list(staff, { sort: "createdAt", pageSize: 50 })).body.tickets as Row[];
    const desc = (await list(staff, { sort: "-createdAt", pageSize: 50 })).body.tickets as Row[];
    expect(labelsOf(asc)).toEqual(labelsOf(desc).slice().reverse());
    expect(labelsOf(desc)[0]).toBe("alpha"); // the newest

    const byPriorityDesc = (await list(staff, { sort: "-itPriority", pageSize: 50 })).body.tickets as Row[];
    const order = { LOW: 0, MEDIUM: 1, HIGH: 2 } as Record<string, number>;
    const ranks = byPriorityDesc.map((r) => order[r.itPriority]);
    expect(ranks).toEqual([...ranks].sort((x, y) => y - x));
    // Within one priority the tie-break is id descending.
    const highs = byPriorityDesc.filter((r) => r.itPriority === "HIGH").map((r) => r.id);
    expect(highs).toEqual([...highs].sort((x, y) => y - x));

    const byStatus = (await list(staff, { sort: "currentStatus", pageSize: 50 })).body.tickets as Row[];
    expect(byStatus[0].currentStatus).toBe("NEW");
    expect(byStatus.at(-1)!.currentStatus).toBe("CANCELLED");

    const byNumber = (await list(staff, { sort: "ticketNumber", pageSize: 50 })).body.tickets as Row[];
    expect(byNumber.map((r) => r.ticketNumber)).toEqual(byNumber.map((r) => r.ticketNumber).slice().sort());
    expect((await list(staff, { sort: "updatedAt", pageSize: 50 })).status).toBe(200);
  });

  it("paginates with consistent metadata and no duplicates or gaps across pages", async () => {
    const seen: number[] = [];
    for (const page of [1, 2, 3]) {
      const res = await list(staff, { pageSize: 5, page, sort: "-itPriority" });
      expect(res.status).toBe(200);
      expect(res.body.pagination).toEqual({ page, pageSize: 5, total: 12, totalPages: 3 });
      seen.push(...(res.body.tickets as Row[]).map((r) => r.id));
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    const full = ((await list(staff, { pageSize: 50, sort: "-itPriority" })).body.tickets as Row[]).map((r) => r.id);
    expect(seen).toEqual(full);

    // A page past the end is empty with honest metadata, not an error.
    const beyond = await list(staff, { pageSize: 5, page: 9 });
    expect(beyond.status).toBe(200);
    expect(beyond.body.tickets).toEqual([]);
    expect(beyond.body.pagination).toMatchObject({ page: 9, total: 12, totalPages: 3 });
  });

  it("falls back to the defaults for stale or hostile query values instead of failing", async () => {
    const res = await staff.get("/api/staff/tickets").query({
      search: "Q-", sort: "-nope", page: "0", pageSize: "1000", status: "BOGUS", itPriority: "URGENT", category: "abc", owner: "nobody",
    });
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 10, total: 12 });
    expect(labelsOf(res.body.tickets)[0]).toBe("alpha"); // default newest first
  });

  // API-18 / L2-BR-24
  it("returns an empty array with total 0 for a query that matches nothing, not an error", async () => {
    const res = await list(staff, { search: "zzz-no-such-ticket" });
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  });

  it("treats search text as text: LIKE wildcards, escapes and SQL are matched literally", async () => {
    for (const search of ["%", "_", "'; DROP TABLE \"Ticket\"; --", "\\", "Q-%", "Q-_lpha"]) {
      const res = await staff.get("/api/staff/tickets").query({ search });
      expect(res.status, search).toBe(200);
      expect(res.body.pagination.total, search).toBe(0);
    }
    expect((await list(staff)).body.pagination.total).toBe(12);

    // And the same characters are found when they really are in a summary.
    const requester = (await createUser()).user;
    const odd = await iso.db.client.ticket.create({
      data: {
        ticketNumber: "TKT-2026-899999",
        requesterId: requester.id,
        categoryId: 1,
        relatedSystemId: 1,
        summary: "Battery at 50% and file_name back\\slash",
        description: "A fixture holding the characters that LIKE treats specially.",
        requestedPriority: "LOW",
        itPriority: "LOW",
      },
    });
    try {
      for (const search of ["50%", "file_name", "back\\slash"]) {
        const res = await staff.get("/api/staff/tickets").query({ search });
        expect(res.body.tickets.map((r: Row) => r.id), search).toEqual([odd.id]);
      }
      expect((await staff.get("/api/staff/tickets").query({ search: "50_" })).body.tickets).toEqual([]);
    } finally {
      await iso.db.client.ticket.delete({ where: { id: odd.id } });
    }
  });

  it("returns the documented safe 500 when the database fails", async () => {
    const restore = iso.override({
      session: iso.db.client.session,
      ticket: {
        count: () => Promise.reject(new Error("connection refused: secret detail")),
        findMany: () => Promise.reject(new Error("connection refused: secret detail")),
      },
    });
    try {
      const res = await list(staff);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "INTERNAL_ERROR", message: "Unable to load the ticket queue." });
    } finally {
      restore();
    }
  });
});

describe("GET /api/staff/tickets: the owner filter", () => {
  // API-17 / AC-16
  it("returns exactly the matching Tickets for unassigned, me, and a specific id", async () => {
    const unassigned = await list(staff, { owner: "unassigned", sort: "ticketNumber" });
    expect(labelsOf(unassigned.body.tickets).sort()).toEqual(["alpha", "foxtrot", "india", "lima"]);
    expect((unassigned.body.tickets as Row[]).every((r) => r.ownerId === null)).toBe(true);

    const mine = await list(staff, { owner: "me" });
    expect(labelsOf(mine.body.tickets).sort()).toEqual(["bravo", "delta", "kilo"]);

    const theirs = await list(staff, { owner: otherStaffId });
    expect(labelsOf(theirs.body.tickets).sort()).toEqual(["charlie", "juliet"]);

    // `me` means the caller: the other member of staff sees their own two.
    const otherSession = await signedIn({ id: otherStaffId });
    expect(labelsOf((await list(otherSession, { owner: "me" })).body.tickets).sort()).toEqual(["charlie", "juliet"]);
  });

  // API-49 / AC-41, BR-57, BR-59
  it("needs-owner returns open Tickets that are unassigned or have an ineligible owner, and nothing else", async () => {
    const res = await list(staff, { owner: "needs-owner", pageSize: 50 });
    const rows = res.body.tickets as Row[];
    // unassigned and open: alpha (NEW), foxtrot (NEW, inactive Requester), lima (NEW).
    // ineligible owner and open: golf (inactive owner), hotel (owner is now a Requester).
    // Excluded: india (CANCELLED, unassigned), echo (CLOSED, inactive owner), and every
    // Ticket with an eligible owner.
    expect(labelsOf(rows).sort()).toEqual(["alpha", "foxtrot", "golf", "hotel", "lima"]);

    const golf = rows.find((r) => r.summary.startsWith("Q-golf"))!;
    expect(golf).toMatchObject({ ownerId: inactiveStaffId, ownerIsActive: false, ownerEligible: false });
    const hotel = rows.find((r) => r.summary.startsWith("Q-hotel"))!;
    expect(hotel).toMatchObject({ ownerId: requesterAsOwnerId, ownerIsActive: true, ownerEligible: false });
    expect(rows.find((r) => r.summary.startsWith("Q-foxtrot"))).toMatchObject({ requesterIsActive: false });
  });

  it("keeps a closed Ticket's ineligible owner visible in the ordinary list, marked, while excluding it from needs-owner", async () => {
    const echo = ((await list(staff, { pageSize: 50 })).body.tickets as Row[]).find((r) => r.summary.startsWith("Q-echo"))!;
    expect(echo).toMatchObject({ currentStatus: "CLOSED", ownerId: inactiveStaffId, ownerEligible: false });
    expect(labelsOf((await list(staff, { owner: "unassigned" })).body.tickets)).not.toContain("echo");
    expect(labelsOf((await list(staff, { owner: "needs-owner" })).body.tickets)).not.toContain("echo");
  });

  it("combines needs-owner with the search and with a status filter without one overwriting the other", async () => {
    expect(labelsOf((await list(staff, { owner: "needs-owner", search: "golf" })).body.tickets)).toEqual(["golf"]);
    expect(labelsOf((await list(staff, { owner: "needs-owner", status: "OPEN" })).body.tickets).sort()).toEqual(["golf", "hotel"]);
    expect((await list(staff, { owner: "needs-owner", status: "CLOSED" })).body.tickets).toEqual([]);
  });

  it("derives ownerEligible on every read: reactivating an owner makes their Tickets eligible again with no Ticket write", async () => {
    const before = await iso.db.client.ticket.findFirstOrThrow({ where: { summary: "Q-golf queue fixture" } });
    await iso.db.client.user.update({ where: { id: inactiveStaffId }, data: { isActive: true } });
    try {
      const rows = (await list(staff, { pageSize: 50 })).body.tickets as Row[];
      expect(rows.find((r) => r.summary.startsWith("Q-golf"))).toMatchObject({ ownerIsActive: true, ownerEligible: true });
      expect(labelsOf((await list(staff, { owner: "needs-owner" })).body.tickets)).not.toContain("golf");
      const after = await iso.db.client.ticket.findFirstOrThrow({ where: { summary: "Q-golf queue fixture" } });
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(after.ownerId).toBe(before.ownerId);
    } finally {
      await iso.db.client.user.update({ where: { id: inactiveStaffId }, data: { isActive: false } });
    }
  });
});
