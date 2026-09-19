import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { TicketStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { ALL_STATUSES, isTransitionPermitted, permittedNext } from "../../src/ticketStatus.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// Staff Ticket operations (api-spec.md endpoints 6 and 8 to 10) and the staff Ticket Detail,
// against a throwaway database. Every Ticket is created fresh by the test that needs it.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let staff: Session;
let staffId: number;
let staff2Id: number;
let staff2: Session;
let adminId: number;
let inactiveStaffId: number;
let demotedId: number;
let requester: Session;
let requesterId: number;
let n = 0;

async function makeTicket(o: { status?: TicketStatus; ownerId?: number | null; requesterId?: number } = {}) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-7${String(n).padStart(5, "0")}`,
      requesterId: o.requesterId ?? requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Ops fixture ${n}`,
      description: "A fixture for the staff operations tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: o.status ?? "NEW",
      ownerId: o.ownerId === undefined ? null : o.ownerId,
    },
  });
}
const stored = (id: number) => iso.db.client.ticket.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const s = await createUser({ role: "IT_STAFF" });
  [staff, staffId] = [await signedIn(s.user), s.user.id];
  const s2 = await createUser({ role: "IT_STAFF" });
  [staff2, staff2Id] = [await signedIn(s2.user), s2.user.id];
  adminId = (await createUser({ role: "ADMINISTRATOR" })).user.id;
  inactiveStaffId = (await createUser({ role: "IT_STAFF", isActive: false })).user.id;
  demotedId = (await createUser({ role: "REQUESTER" })).user.id;
  const r = await createUser();
  [requester, requesterId] = [await signedIn(r.user), r.user.id];
});

describe("who may operate on a Ticket", () => {
  // API-10 (partial) / AC-12, AC-22
  it("refuses a Requester with 403 and an anonymous caller with 401 on every operation, changing nothing", async () => {
    const t = await makeTicket({ status: "OPEN", ownerId: staffId });
    const calls: [string, () => Promise<{ status: number; body: { error?: string } }>][] = [
      ["owner", () => requester.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: null })],
      ["priority", () => requester.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "HIGH" })],
      ["status", () => requester.patch(`/api/staff/tickets/${t.id}/status`).send({ currentStatus: "IN_PROGRESS" })],
      ["owners", () => requester.get("/api/staff/owners")],
    ];
    for (const [label, call] of calls) {
      const res = await call();
      expect(res.status, label).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    }
    for (const res of [
      await request(app).patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: null }),
      await request(app).patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "HIGH" }),
      await request(app).patch(`/api/staff/tickets/${t.id}/status`).send({ currentStatus: "IN_PROGRESS" }),
      await request(app).get("/api/staff/owners"),
    ]) {
      expect(res.status).toBe(401);
    }
    const after = await stored(t.id);
    expect(after).toMatchObject({ ownerId: staffId, itPriority: "MEDIUM", currentStatus: "OPEN" });
  });
});

describe("Ticket Detail for IT Staff", () => {
  it("shows any Ticket to IT Staff and to an Administrator, with ownership, IT Priority and the permitted next statuses", async () => {
    const t = await makeTicket({ status: "OPEN", ownerId: staffId });
    const res = await staff.get(`/api/tickets/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: t.id,
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: "OPEN",
      ownerId: staffId,
      ownerIsActive: true,
      ownerEligible: true,
      requesterIsActive: true,
      resolutionSummary: null,
      requesterResolutionFlaggedAt: null,
      attachments: [],
    });
    expect(res.body.permittedNextStatuses.sort()).toEqual(["CANCELLED", "IN_PROGRESS", "WAITING_FOR_REQUESTER"]);

    const admin = await signedIn({ id: adminId });
    expect((await admin.get(`/api/tickets/${t.id}`)).status).toBe(200);
  });

  it("does not give a Requester the staff-only fields, and still holds them to their own Ticket", async () => {
    const t = await makeTicket({ status: "OPEN", ownerId: staffId });
    const own = await requester.get(`/api/tickets/${t.id}`);
    expect(own.status).toBe(200);
    for (const key of ["itPriority", "ownerId", "ownerName", "ownerEligible", "ownerIsActive", "requesterIsActive", "permittedNextStatuses"]) {
      expect(own.body[key], key).toBeUndefined();
    }
    expect(own.body).toMatchObject({ resolutionSummary: null, requesterResolutionFlaggedAt: null });

    const stranger = await signedIn((await createUser()).user);
    expect((await stranger.get(`/api/tickets/${t.id}`)).status).toBe(404);
  });

  it("opens a Ticket whose Requester is inactive, and marks the Requester (BR-60)", async () => {
    const gone = (await createUser({ isActive: false })).user;
    const t = await makeTicket({ requesterId: gone.id });
    const res = await staff.get(`/api/tickets/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.requesterIsActive).toBe(false);
  });

  it("reports an ineligible owner by name with the reason, and gets a plain 404 for a Ticket that does not exist", async () => {
    const t = await makeTicket({ status: "OPEN", ownerId: inactiveStaffId });
    const res = await staff.get(`/api/tickets/${t.id}`);
    expect(res.body).toMatchObject({ ownerId: inactiveStaffId, ownerIsActive: false, ownerEligible: false });
    expect((await staff.get("/api/tickets/999999")).status).toBe(404);
    expect((await staff.get("/api/tickets/abc")).status).toBe(404);
  });
});

describe("PATCH /api/staff/tickets/:id/owner", () => {
  // API-19 / AC-18, BR-19
  it("lets IT Staff claim an unassigned Ticket, and answers with the updated Ticket", async () => {
    const t = await makeTicket();
    const res = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staffId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, ownerId: staffId, ownerIsActive: true, ownerEligible: true });
    expect((await stored(t.id)).ownerId).toBe(staffId);
    // Claiming what you already own is not an error.
    expect((await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staffId })).status).toBe(200);
  });

  it("lets an Administrator claim as well as IT Staff", async () => {
    const admin = await signedIn({ id: adminId });
    const t = await makeTicket();
    const res = await admin.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: adminId });
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe(adminId);
  });

  it("lets only one of two simultaneous claims win, and the other is told ALREADY_ASSIGNED", async () => {
    const t = await makeTicket();
    const [a, b] = await Promise.all([
      staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staffId }),
      staff2.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staff2Id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe("ALREADY_ASSIGNED");
    const winnerId = a.status === 200 ? staffId : staff2Id;
    expect((await stored(t.id)).ownerId).toBe(winnerId);
  });

  // API-20 / AC-19, BR-20
  it("reassigns to another active IT Staff member or Administrator, whether or not it is assigned, and unassigns", async () => {
    const t = await makeTicket({ ownerId: staffId });
    const toOther = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staff2Id });
    expect(toOther.status).toBe(200);
    expect(toOther.body.ownerId).toBe(staff2Id);

    const toAdmin = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: adminId });
    expect(toAdmin.body.ownerId).toBe(adminId);

    const fresh = await makeTicket();
    expect((await staff.patch(`/api/staff/tickets/${fresh.id}/owner`).send({ ownerId: staff2Id })).body.ownerId).toBe(staff2Id);

    const cleared = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ ownerId: null, ownerName: null, ownerEligible: null });
    expect((await stored(t.id)).ownerId).toBeNull();
    // Unassigning an unassigned Ticket is not an error either.
    expect((await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: null })).status).toBe(200);
  });

  // API-21 / AC-20, BR-18
  it("refuses an owner who is inactive, who is a Requester, or who does not exist, and leaves the owner alone", async () => {
    const t = await makeTicket({ ownerId: staffId });
    for (const [label, ownerId] of [
      ["an inactive IT Staff member", inactiveStaffId],
      ["a user with the Requester role", demotedId],
      ["a Requester", requesterId],
      ["a user id that does not exist", 999999],
    ] as const) {
      const res = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId });
      expect(res.status, label).toBe(409);
      expect(res.body.error, label).toBe("INVALID_OWNER");
    }
    expect((await stored(t.id)).ownerId).toBe(staffId);
  });

  it("rejects a malformed body with 400 and a field message, before looking at the Ticket", async () => {
    const t = await makeTicket();
    for (const body of [{}, { ownerId: "7" }, { ownerId: 0 }, { ownerId: -3 }, { ownerId: 1.5 }, { ownerId: true }, { ownerId: [1] }]) {
      const res = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.fields.ownerId).toBeDefined();
    }
    expect((await stored(t.id)).ownerId).toBeNull();
  });

  it("answers 404 for a Ticket that does not exist or a malformed id", async () => {
    expect((await staff.patch("/api/staff/tickets/999999/owner").send({ ownerId: staffId })).status).toBe(404);
    expect((await staff.patch("/api/staff/tickets/abc/owner").send({ ownerId: staffId })).status).toBe(404);
  });
});

describe("GET /api/staff/owners", () => {
  // API-55 / BR-18
  it("lists active IT Staff and Administrators only, with id, name and role and nothing else", async () => {
    const res = await staff.get("/api/staff/owners");
    expect(res.status).toBe(200);
    const ids = (res.body as { id: number }[]).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([staffId, staff2Id, adminId]));
    expect(ids).not.toContain(inactiveStaffId);
    expect(ids).not.toContain(demotedId);
    expect(ids).not.toContain(requesterId);
    for (const o of res.body as Record<string, unknown>[]) {
      expect(Object.keys(o).sort()).toEqual(["id", "name", "role"]);
      expect(["IT_STAFF", "ADMINISTRATOR"]).toContain(o.role);
    }
    const names = (res.body as { name: string }[]).map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("PATCH /api/staff/tickets/:id/priority", () => {
  // API-22 / AC-21, BR-21
  it("changes IT Priority and leaves Requested Priority untouched", async () => {
    const t = await makeTicket();
    const res = await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "HIGH" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ itPriority: "HIGH", requestedPriority: "MEDIUM" });
    const row = await stored(t.id);
    expect(row).toMatchObject({ itPriority: "HIGH", requestedPriority: "MEDIUM" });
    // Setting it back, and setting it to what it already is, both work.
    expect((await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "LOW" })).body.itPriority).toBe("LOW");
    expect((await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "LOW" })).status).toBe(200);
  });

  it("rejects a value outside LOW, MEDIUM and HIGH with 400, and a missing Ticket with 404", async () => {
    const t = await makeTicket();
    for (const itPriority of ["URGENT", "high", "", null, 2, undefined]) {
      const res = await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority });
      expect(res.status, String(itPriority)).toBe(400);
      expect(res.body.fields.itPriority).toBeDefined();
    }
    expect((await stored(t.id)).itPriority).toBe("MEDIUM");
    expect((await staff.patch("/api/staff/tickets/999999/priority").send({ itPriority: "LOW" })).status).toBe(404);
  });

  it("ignores a requestedPriority sent along with it: Requested Priority has no way to change", async () => {
    const t = await makeTicket();
    await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "LOW", requestedPriority: "HIGH" });
    expect((await stored(t.id)).requestedPriority).toBe("MEDIUM");
  });
});

describe("PATCH /api/staff/tickets/:id/status", () => {
  const move = (s: Session, id: number, body: object) => s.patch(`/api/staff/tickets/${id}/status`).send(body);

  // API-23 / AC-23, BR-25, BR-26
  it("refuses every move BR-25 does not list, including to the current status, with the permitted set named, and changes nothing", async () => {
    let refused = 0;
    for (const from of ALL_STATUSES) {
      const t = await makeTicket({ status: from, ownerId: staffId });
      for (const to of ALL_STATUSES) {
        if (isTransitionPermitted(from, to)) continue;
        const res = await move(staff, t.id, { currentStatus: to, resolutionSummary: "A valid summary for a refused move." });
        expect(res.status, `${from} to ${to}`).toBe(409);
        expect(res.body.error, `${from} to ${to}`).toBe("INVALID_TRANSITION");
        expect(res.body.currentStatus).toBe(from);
        expect(res.body.permitted.sort()).toEqual([...permittedNext(from)].sort());
        expect(res.body.message).toContain(from);
        refused++;
      }
      expect((await stored(t.id)).currentStatus, from).toBe(from);
    }
    expect(refused).toBe(8 * 8 - 14);
  });

  it("performs every move BR-25 does list, when the Ticket has an eligible owner", async () => {
    let moved = 0;
    for (const from of ALL_STATUSES) {
      for (const to of permittedNext(from)) {
        const t = await makeTicket({ status: from, ownerId: staffId });
        const res = await move(staff, t.id, { currentStatus: to, resolutionSummary: "Confirmed fixed with the Requester." });
        expect(res.status, `${from} to ${to}`).toBe(200);
        expect(res.body.currentStatus).toBe(to);
        expect((await stored(t.id)).currentStatus).toBe(to);
        moved++;
      }
    }
    expect(moved).toBe(14);
  });

  // API-24 / AC-24, BR-27
  it("requires a Resolution Summary of 10 to 2000 characters to resolve, keeps the Ticket unresolved without one, and stores it trimmed", async () => {
    const t = await makeTicket({ status: "IN_PROGRESS", ownerId: staffId });
    for (const resolutionSummary of [undefined, "", "   ", "too short", "         x         ", "x".repeat(2001)]) {
      const res = await move(staff, t.id, { currentStatus: "RESOLVED", resolutionSummary });
      expect(res.status, String(resolutionSummary)).toBe(400);
      expect(res.body.fields.resolutionSummary).toBeDefined();
    }
    expect((await stored(t.id)).currentStatus).toBe("IN_PROGRESS");
    expect((await stored(t.id)).resolutionSummary).toBeNull();

    const ok = await move(staff, t.id, { currentStatus: "RESOLVED", resolutionSummary: "  Replaced the faulty access point.  " });
    expect(ok.status).toBe(200);
    expect(await stored(t.id)).toMatchObject({ currentStatus: "RESOLVED", resolutionSummary: "Replaced the faulty access point." });

    // The Requester can read it (BR-27).
    const seen = await requester.get(`/api/tickets/${t.id}`);
    expect(seen.body).toMatchObject({ currentStatus: "RESOLVED", resolutionSummary: "Replaced the faulty access point." });
  });

  it("does not ask for a Resolution Summary on any other move, and does not store one sent with it", async () => {
    const t = await makeTicket({ status: "OPEN", ownerId: staffId });
    const res = await move(staff, t.id, { currentStatus: "IN_PROGRESS", resolutionSummary: "Not wanted for this move." });
    expect(res.status).toBe(200);
    expect((await stored(t.id)).resolutionSummary).toBeNull();
  });

  // API-25 / AC-25, BR-28
  it("refuses IN_PROGRESS, RESOLVED and CLOSED on an unassigned Ticket with OWNER_REQUIRED, leaving the status alone", async () => {
    for (const [from, to] of [
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "RESOLVED"],
      ["WAITING_FOR_REQUESTER", "RESOLVED"],
      ["REOPENED", "IN_PROGRESS"],
      ["RESOLVED", "CLOSED"],
    ] as const) {
      const t = await makeTicket({ status: from });
      const res = await move(staff, t.id, { currentStatus: to, resolutionSummary: "A valid summary for this move." });
      expect(res.status, `${from} to ${to}`).toBe(409);
      expect(res.body.error).toBe("OWNER_REQUIRED");
      expect((await stored(t.id)).currentStatus).toBe(from);
    }
  });

  it("still allows an unassigned Ticket to make the moves that need no owner", async () => {
    for (const [from, to] of [
      ["NEW", "OPEN"],
      ["NEW", "CANCELLED"],
      ["OPEN", "WAITING_FOR_REQUESTER"],
      ["OPEN", "CANCELLED"],
      ["RESOLVED", "REOPENED"],
    ] as const) {
      const t = await makeTicket({ status: from });
      expect((await move(staff, t.id, { currentStatus: to })).status, `${from} to ${to}`).toBe(200);
    }
  });

  it("checks the transition before the owner: a move that is not permitted is INVALID_TRANSITION even without an owner", async () => {
    const t = await makeTicket({ status: "NEW" });
    const res = await move(staff, t.id, { currentStatus: "CLOSED" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVALID_TRANSITION");
  });

  it("rejects an unknown or missing status with 400, and a missing Ticket with 404", async () => {
    const t = await makeTicket({ ownerId: staffId });
    for (const currentStatus of ["DONE", "open", "", null, 4, undefined]) {
      const res = await move(staff, t.id, { currentStatus });
      expect(res.status, String(currentStatus)).toBe(400);
      expect(res.body.fields.currentStatus).toBeDefined();
    }
    expect((await move(staff, 999999, { currentStatus: "OPEN" })).status).toBe(404);
    expect((await move(staff, t.id, { currentStatus: "OPEN" })).status).toBe(200);
  });

  it("lets only one of two conflicting moves win, and the loser is told the move is not permitted", async () => {
    const t = await makeTicket({ status: "RESOLVED", ownerId: staffId });
    const [close, reopen] = await Promise.all([
      move(staff, t.id, { currentStatus: "CLOSED" }),
      move(staff2, t.id, { currentStatus: "REOPENED" }),
    ]);
    expect([close.status, reopen.status].sort()).toEqual([200, 409]);
    const loser = close.status === 409 ? close : reopen;
    expect(loser.body.error).toBe("INVALID_TRANSITION");
    expect((await stored(t.id)).currentStatus).toBe(close.status === 200 ? "CLOSED" : "REOPENED");
  });

  // Review round 1 (songt888): the write must be conditional on the very status that was validated.
  // Re-reading the status between the check and the write let a concurrent change be treated as
  // the status that had been checked, so an unvalidated move, even out of a terminal state, went
  // through. These tests change the Ticket in the gap between the check and the write itself.
  describe("a change that lands between the check and the write", () => {
    // Wraps the isolated client so that, right after the validation read returns, the Ticket is
    // changed by someone else, exactly as a concurrent request would.
    function interfereAfterValidation(ticketId: number, change: () => Promise<unknown>) {
      const real = iso.db.client;
      let validated = false;
      return iso.override({
        session: real.session,
        ticket: {
          findUnique: async (args: Parameters<typeof real.ticket.findUnique>[0]) => {
            const found = await real.ticket.findUnique(args);
            // The first read that carries the status is the validation read.
            if (!validated && args?.where && "id" in args.where && args.where.id === ticketId && args.select && "currentStatus" in args.select) {
              validated = true;
              await change();
            }
            return found;
          },
          findUniqueOrThrow: real.ticket.findUniqueOrThrow.bind(real.ticket),
          updateMany: real.ticket.updateMany.bind(real.ticket),
        },
      });
    }

    it("never lets a move out of a terminal state through: a Ticket closed after the check stays closed", async () => {
      const t = await makeTicket({ status: "IN_PROGRESS", ownerId: staffId });
      // IN_PROGRESS to RESOLVED is permitted, so the check passes; then the Ticket is CANCELLED.
      const restore = interfereAfterValidation(t.id, () => iso.db.client.ticket.update({ where: { id: t.id }, data: { currentStatus: "CANCELLED" } }));
      try {
        const res = await move(staff, t.id, { currentStatus: "RESOLVED", resolutionSummary: "A valid summary for this move." });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("INVALID_TRANSITION");
        expect(res.body.currentStatus).toBe("CANCELLED");
      } finally {
        restore();
      }
      const after = await stored(t.id);
      expect(after.currentStatus).toBe("CANCELLED");
      expect(after.resolutionSummary).toBeNull();
    });

    it("refuses a move that was valid when checked but is not valid from the status the Ticket has now", async () => {
      const t = await makeTicket({ status: "OPEN", ownerId: staffId });
      // OPEN to IN_PROGRESS passes the check; then someone moves it to WAITING_FOR_REQUESTER and RESOLVED-side
      // moves would differ, so the only safe outcome is that the write applies to nothing and is re-judged.
      const restore = interfereAfterValidation(t.id, () => iso.db.client.ticket.update({ where: { id: t.id }, data: { currentStatus: "CLOSED" } }));
      try {
        const res = await move(staff, t.id, { currentStatus: "IN_PROGRESS" });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("INVALID_TRANSITION");
      } finally {
        restore();
      }
      expect((await stored(t.id)).currentStatus).toBe("CLOSED");
    });

    it("re-judges the move from the new status: if it is still permitted from there it is refused as changed, not silently applied", async () => {
      const t = await makeTicket({ status: "OPEN", ownerId: staffId });
      // OPEN to CANCELLED passes; then the Ticket moves to IN_PROGRESS, from which CANCELLED is also permitted.
      const restore = interfereAfterValidation(t.id, () => iso.db.client.ticket.update({ where: { id: t.id }, data: { currentStatus: "IN_PROGRESS" } }));
      try {
        const res = await move(staff, t.id, { currentStatus: "CANCELLED" });
        // Not applied on the strength of a check made against a status the Ticket no longer had.
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("INVALID_TRANSITION");
        expect(res.body.message).toMatch(/changed/i);
      } finally {
        restore();
      }
      expect((await stored(t.id)).currentStatus).toBe("IN_PROGRESS");
    });

    it("does not resolve or close a Ticket whose owner became ineligible after the check", async () => {
      const owner = (await createUser({ role: "IT_STAFF" })).user;
      const t = await makeTicket({ status: "IN_PROGRESS", ownerId: owner.id });
      const restore = interfereAfterValidation(t.id, () => iso.db.client.user.update({ where: { id: owner.id }, data: { isActive: false } }));
      try {
        const res = await move(staff, t.id, { currentStatus: "RESOLVED", resolutionSummary: "A valid summary for this move." });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("OWNER_REQUIRED");
      } finally {
        restore();
      }
      expect((await stored(t.id)).currentStatus).toBe("IN_PROGRESS");
    });
  });

  it("lets an Administrator change status too", async () => {
    const admin = await signedIn({ id: adminId });
    const t = await makeTicket({ status: "NEW" });
    expect((await move(admin, t.id, { currentStatus: "OPEN" })).status).toBe(200);
  });
});

describe("POST /api/tickets/:id/resolution-indication", () => {
  const flag = (s: Session, id: number | string) => s.post(`/api/tickets/${id}/resolution-indication`);

  // API-26 / AC-26, BR-29
  it("records the timestamp, refreshes it on a repeat, and never changes the status", async () => {
    const t = await makeTicket({ status: "IN_PROGRESS", ownerId: staffId });
    const first = await flag(requester, t.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: t.id, currentStatus: "IN_PROGRESS" });
    const stamp1 = new Date(first.body.requesterResolutionFlaggedAt).getTime();
    expect(stamp1).toBeGreaterThan(Date.now() - 10_000);

    await new Promise((r) => setTimeout(r, 20));
    const second = await flag(requester, t.id);
    expect(second.status).toBe(200);
    expect(new Date(second.body.requesterResolutionFlaggedAt).getTime()).toBeGreaterThan(stamp1);

    const row = await stored(t.id);
    expect(row.currentStatus).toBe("IN_PROGRESS");
    expect(row.requesterResolutionFlaggedAt).not.toBeNull();
    // Staff see the signal, and it is not mistaken for a status.
    const detail = await staff.get(`/api/tickets/${t.id}`);
    expect(detail.body.requesterResolutionFlaggedAt).not.toBeNull();
    expect(detail.body.currentStatus).toBe("IN_PROGRESS");
  });

  it("works in every non-terminal status", async () => {
    for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "REOPENED"] as const) {
      const t = await makeTicket({ status });
      const res = await flag(requester, t.id);
      expect(res.status, status).toBe(200);
      expect(res.body.currentStatus).toBe(status);
    }
  });

  // API-27 / BR-29
  it("answers 409 TICKET_TERMINAL for a CLOSED or CANCELLED Ticket and records nothing", async () => {
    for (const status of ["CLOSED", "CANCELLED"] as const) {
      const t = await makeTicket({ status });
      const res = await flag(requester, t.id);
      expect(res.status, status).toBe(409);
      expect(res.body.error).toBe("TICKET_TERMINAL");
      expect((await stored(t.id)).requesterResolutionFlaggedAt).toBeNull();
    }
  });

  it("is Requester-only and own-Ticket-only: staff get 403, a stranger and a missing Ticket get 404, a bad id 400, no session 401", async () => {
    const t = await makeTicket({ status: "OPEN" });
    expect((await flag(staff, t.id)).status).toBe(403);
    expect((await stored(t.id)).requesterResolutionFlaggedAt).toBeNull();

    const stranger = await signedIn((await createUser()).user);
    expect((await flag(stranger, t.id)).status).toBe(404);
    expect((await flag(requester, 999999)).status).toBe(404);
    const bad = await flag(requester, "abc");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("VALIDATION_ERROR");
    expect((await request(app).post(`/api/tickets/${t.id}/resolution-indication`)).status).toBe(401);
  });
});
