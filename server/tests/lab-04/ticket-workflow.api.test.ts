import { beforeAll, describe, expect, it } from "vitest";
import type { ActionStatus, TicketStatus } from "@prisma/client";
import { ALL_STATUSES, isTransitionPermitted } from "../../src/ticketStatus.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 4 api-spec endpoints 6, 7 and 8: the final transition matrix, the resolution gate, the stale-status
// check, the Status History, and the cancellation of Planned Actions. Its own throwaway database.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, admin: Caller, requester: Caller, otherRequester: Caller;
let staffId: number, adminId: number, requesterId: number;

const HOUR = 60 * 60 * 1000;
const SUMMARY = "Replaced the LAN cable; the link is stable.";
let n = 0;
async function makeTicket(o: { status?: TicketStatus; owner?: number | null; requester?: number } = {}) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-4${String(n).padStart(5, "0")}`,
      requesterId: o.requester ?? requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Workflow fixture ${n}`,
      description: "A fixture for the Ticket workflow tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: o.status ?? "IN_PROGRESS",
      ownerId: o.owner === undefined ? staffId : o.owner,
      createdAt: new Date(Date.now() - 2 * HOUR),
    },
  });
}
async function addAction(ticketId: number, status: ActionStatus) {
  return iso.db.client.actionTaken.create({
    data: {
      ticketId,
      actionAt: new Date(Date.now() - HOUR),
      description: `A ${status.toLowerCase()} action`,
      status,
      recordedById: staffId,
      responsibleStaffId: staffId,
      ...(status === "COMPLETED" ? { result: "Done and tested.", performedById: staffId, completedAt: new Date(Date.now() - HOUR / 2), version: 2 } : {}),
      ...(status === "CANCELLED" ? { cancelReason: "Not needed.", cancelledById: staffId, cancelledAt: new Date(Date.now() - HOUR / 2), version: 2 } : {}),
    },
  });
}
const move = (by: Caller, id: number, body: Record<string, unknown>) => by.patch(`/api/staff/tickets/${id}/status`).send(body);
const status = async (id: number) => (await iso.db.client.ticket.findUniqueOrThrow({ where: { id } })).currentStatus;
const changes = (ticketId: number) => iso.db.client.statusChange.findMany({ where: { ticketId }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });

beforeAll(async () => {
  const make = async (role: "IT_STAFF" | "ADMINISTRATOR" | "REQUESTER") => {
    const u = (await createUser({ role })).user;
    return [await signedIn(u), u.id] as const;
  };
  [staff, staffId] = await make("IT_STAFF");
  [admin, adminId] = await make("ADMINISTRATOR");
  [requester, requesterId] = await make("REQUESTER");
  [otherRequester] = await make("REQUESTER");
});

describe("PATCH /api/staff/tickets/:id/status", () => {
  // WF-01 / AC-18, BR-20
  it("applies exactly the BR-20 moves for IT Staff and Administrators, refuses every other one, and refuses every move to a Requester", async () => {
    const permitted: string[] = [];
    for (const [caller, label] of [[staff, "staff"], [admin, "admin"]] as const) {
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          const t = await makeTicket({ status: from });
          if (to === "RESOLVED") await addAction(t.id, "COMPLETED");
          const res = await move(caller, t.id, { fromStatus: from, currentStatus: to, ...(to === "RESOLVED" ? { resolutionSummary: SUMMARY } : {}) });
          if (isTransitionPermitted(from, to)) {
            expect(res.status, `${label} ${from} to ${to}`).toBe(200);
            expect(await status(t.id)).toBe(to);
            if (label === "staff") permitted.push(`${from}>${to}`);
          } else {
            expect(res.status, `${label} ${from} to ${to}`).toBe(409);
            expect(res.body.error).toBe("INVALID_TRANSITION");
            expect(await status(t.id)).toBe(from);
          }
        }
      }
    }
    // The final matrix: Lab 3's fourteen moves plus Waiting for Requester and Reopened to Cancelled.
    expect(permitted).toHaveLength(16);
    expect(permitted).toEqual(expect.arrayContaining(["WAITING_FOR_REQUESTER>CANCELLED", "REOPENED>CANCELLED"]));

    const t = await makeTicket({ status: "OPEN" });
    for (const to of ALL_STATUSES) {
      const res = await move(requester, t.id, { fromStatus: "OPEN", currentStatus: to });
      expect(res.status, to).toBe(403);
    }
    expect(await status(t.id)).toBe("OPEN");
  }, 120_000);

  // WF-02 / AC-19, BR-21
  it("refuses Resolved while any Action is Planned, through the API directly, and writes nothing", async () => {
    const t = await makeTicket();
    await addAction(t.id, "COMPLETED");
    await addAction(t.id, "PLANNED");
    await addAction(t.id, "PLANNED");
    const before = await changes(t.id);
    const res = await move(staff, t.id, { fromStatus: "IN_PROGRESS", currentStatus: "RESOLVED", resolutionSummary: SUMMARY });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "ACTIONS_INCOMPLETE", plannedActions: 2 });
    expect(await status(t.id)).toBe("IN_PROGRESS");
    expect(await changes(t.id)).toEqual(before);
    expect((await iso.db.client.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolutionSummary).toBeNull();
  });

  // WF-03 / AC-20, BR-21
  it("refuses Resolved when no Action is Completed, including when every Action was Cancelled", async () => {
    for (const actions of [[], ["CANCELLED", "CANCELLED"]] as ActionStatus[][]) {
      const t = await makeTicket();
      for (const s of actions) await addAction(t.id, s);
      const res = await move(staff, t.id, { fromStatus: "IN_PROGRESS", currentStatus: "RESOLVED", resolutionSummary: SUMMARY });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "NO_COMPLETED_ACTION", completedActions: 0 });
      expect(await status(t.id)).toBe("IN_PROGRESS");
    }
  });

  // WF-04 / AC-21
  it("resolves when every Action is final and one is Completed, recording the summary in the history", async () => {
    const t = await makeTicket({ status: "WAITING_FOR_REQUESTER" });
    await addAction(t.id, "COMPLETED");
    await addAction(t.id, "CANCELLED");
    const res = await move(staff, t.id, { fromStatus: "WAITING_FOR_REQUESTER", currentStatus: "RESOLVED", resolutionSummary: `  ${SUMMARY}  ` });
    expect(res.status).toBe(200);
    expect(res.body.currentStatus).toBe("RESOLVED");
    const last = (await changes(t.id)).at(-1)!;
    expect(last).toMatchObject({ fromStatus: "WAITING_FOR_REQUESTER", toStatus: "RESOLVED", changedById: staffId, resolutionSummary: SUMMARY });
  });

  // WF-05 / AC-22, BR-23
  it("refuses a move from a status the Ticket no longer has, naming the current status and its moves, and needs fromStatus", async () => {
    const t = await makeTicket({ status: "IN_PROGRESS" });
    const before = await changes(t.id);
    const res = await move(staff, t.id, { fromStatus: "OPEN", currentStatus: "WAITING_FOR_REQUESTER" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: "STATUS_CHANGED",
      message: "This Ticket moved to In Progress while you were viewing it. Check the current status and try again.",
      currentStatus: "IN_PROGRESS",
      permitted: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    });
    // Even though the move is permitted from the status it has now, nothing is applied.
    expect(await status(t.id)).toBe("IN_PROGRESS");
    expect(await changes(t.id)).toEqual(before);

    for (const fromStatus of [undefined, "", "DONE", 3]) {
      const bad = await move(staff, t.id, { fromStatus, currentStatus: "WAITING_FOR_REQUESTER" });
      expect(bad.status, String(fromStatus)).toBe(400);
      expect(bad.body.fields).toHaveProperty("fromStatus");
    }
  });

  // WF-06 / AC-23, BR-24
  it("appends one Status Change per move, in order, writes neither the move nor the entry when the entry fails, and no route changes history", async () => {
    const t = await makeTicket({ status: "NEW" });
    await addAction(t.id, "COMPLETED");
    for (const [from, to] of [["NEW", "OPEN"], ["OPEN", "IN_PROGRESS"], ["IN_PROGRESS", "RESOLVED"], ["RESOLVED", "REOPENED"]] as const) {
      const res = await move(admin, t.id, { fromStatus: from, currentStatus: to, ...(to === "RESOLVED" ? { resolutionSummary: SUMMARY } : {}) });
      expect(res.status, `${from} to ${to}`).toBe(200);
    }
    const history = await changes(t.id);
    expect(history.map((c) => [c.fromStatus, c.toStatus])).toEqual([["NEW", "OPEN"], ["OPEN", "IN_PROGRESS"], ["IN_PROGRESS", "RESOLVED"], ["RESOLVED", "REOPENED"]]);
    expect(history.every((c) => c.changedById === adminId)).toBe(true);

    // The Status Change insert fails: the move is rolled back with it.
    const real = iso.db.client;
    const restore = iso.override(
      new Proxy(real, {
        get(target, prop) {
          if (prop === "$transaction") {
            return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
              real.$transaction(
                (tx) =>
                  fn(
                    new Proxy(tx, {
                      get(t2, p2) {
                        if (p2 === "statusChange") return { create: async () => Promise.reject(new Error("injected")) };
                        const v = Reflect.get(t2, p2);
                        return typeof v === "function" ? v.bind(t2) : v;
                      },
                    }),
                  ),
                opts,
              );
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    );
    try {
      const res = await move(admin, t.id, { fromStatus: "REOPENED", currentStatus: "IN_PROGRESS" });
      expect(res.status).toBe(500);
    } finally {
      restore();
    }
    expect(await status(t.id)).toBe("REOPENED");
    expect(await changes(t.id)).toHaveLength(history.length);

    for (const method of ["patch", "delete"] as const) {
      expect((await admin[method](`/api/tickets/${t.id}/history/${history[0].id}`)).status).toBe(404);
      expect((await admin[method](`/api/tickets/${t.id}/history`)).status).toBe(404);
    }
    expect((await admin.post(`/api/tickets/${t.id}/history`)).status).toBe(404);
  });

  // WF-07 / AC-13, BR-15
  it("cancels every Planned Action with the Ticket, from Open, Waiting for Requester, and Reopened, bumping each version; Completed ones stay", async () => {
    for (const from of ["OPEN", "WAITING_FOR_REQUESTER", "REOPENED"] as const) {
      const t = await makeTicket({ status: from });
      const planned = await addAction(t.id, "PLANNED");
      const done = await addAction(t.id, "COMPLETED");
      const res = await move(staff, t.id, { fromStatus: from, currentStatus: "CANCELLED" });
      expect(res.status, from).toBe(200);
      const p = await iso.db.client.actionTaken.findUniqueOrThrow({ where: { id: planned.id } });
      expect(p).toMatchObject({ status: "CANCELLED", cancelReason: "Ticket cancelled", cancelledById: staffId, version: planned.version + 1 });
      expect(p.cancelledAt).not.toBeNull();
      expect(await iso.db.client.actionTaken.findUniqueOrThrow({ where: { id: done.id } })).toEqual(done);
      // An edit form still open on the Planned Action is told the Ticket can no longer be worked (checked
      // first, api-spec endpoint 3), never STALE_ACTION, and changes nothing.
      const late = await staff.patch(`/api/actions/${planned.id}`).send({ version: planned.version, description: "Edited after the cancel." });
      expect(late.status).toBe(409);
      expect(late.body.error).toBe("TICKET_NOT_WORKABLE");
      expect((await iso.db.client.actionTaken.findUniqueOrThrow({ where: { id: planned.id } })).description).toBe(planned.description);
    }
  });

  // WF-09 / BR-21
  it("never ends with a Resolved Ticket holding a Planned Action when an Action create and a resolve race, 20 times", async () => {
    for (let i = 0; i < 20; i++) {
      const t = await makeTicket();
      await addAction(t.id, "COMPLETED");
      const [created, resolved] = await Promise.all([
        staff.post(`/api/tickets/${t.id}/actions`).send({ actionAt: new Date().toISOString(), description: "Racing the resolve." }),
        move(admin, t.id, { fromStatus: "IN_PROGRESS", currentStatus: "RESOLVED", resolutionSummary: SUMMARY }),
      ]);
      const final = await status(t.id);
      const plannedLeft = await iso.db.client.actionTaken.count({ where: { ticketId: t.id, status: "PLANNED" } });
      expect(final === "RESOLVED" && plannedLeft > 0, `round ${i}`).toBe(false);
      if (final === "RESOLVED") expect(created.body.error).toBe("TICKET_NOT_WORKABLE");
      else expect(resolved.body.error).toBe("ACTIONS_INCOMPLETE");
    }
  }, 60_000);

  // WF-10 / BR-22
  it("reports the first failing check in the contract's order: 400, 404, STATUS_CHANGED, INVALID_TRANSITION, OWNER_REQUIRED, then the gate", async () => {
    const noOwner = await makeTicket({ status: "OPEN", owner: null });
    // 400 before 404.
    expect((await move(staff, 999_999, { currentStatus: "RESOLVED" })).status).toBe(400);
    expect((await move(staff, 999_999, { fromStatus: "OPEN", currentStatus: "OPEN" })).status).toBe(404);
    // STATUS_CHANGED before INVALID_TRANSITION.
    expect((await move(staff, noOwner.id, { fromStatus: "NEW", currentStatus: "CLOSED" })).body.error).toBe("STATUS_CHANGED");
    // INVALID_TRANSITION before OWNER_REQUIRED.
    expect((await move(staff, noOwner.id, { fromStatus: "OPEN", currentStatus: "CLOSED" })).body.error).toBe("INVALID_TRANSITION");
    // OWNER_REQUIRED before the gate (no Completed Action either).
    const unowned = await makeTicket({ status: "IN_PROGRESS", owner: null });
    expect((await move(staff, unowned.id, { fromStatus: "IN_PROGRESS", currentStatus: "RESOLVED", resolutionSummary: SUMMARY })).body.error).toBe("OWNER_REQUIRED");
    // ACTIONS_INCOMPLETE before NO_COMPLETED_ACTION.
    const owned = await makeTicket();
    await addAction(owned.id, "PLANNED");
    expect((await move(staff, owned.id, { fromStatus: "IN_PROGRESS", currentStatus: "RESOLVED", resolutionSummary: SUMMARY })).body.error).toBe("ACTIONS_INCOMPLETE");
  });
});

describe("the Requester's indication and Ticket creation", () => {
  // WF-08 / AC-26, BR-27
  it("records 'problem appears resolved' without changing the status or the history", async () => {
    const t = await makeTicket({ status: "WAITING_FOR_REQUESTER" });
    const before = await changes(t.id);
    const res = await requester.post(`/api/tickets/${t.id}/resolution-indication`);
    expect(res.status).toBe(200);
    expect(await status(t.id)).toBe("WAITING_FOR_REQUESTER");
    expect(await changes(t.id)).toEqual(before);
  });

  // WF-11 / BR-24
  it("writes the creation as a Status Change from none to New, by the Requester, with the Ticket", async () => {
    const res = await requester.post("/api/tickets").send({
      categoryId: 1,
      relatedSystemId: 1,
      summary: "Workflow creation check",
      description: "Created to check that the creation is recorded in the history.",
      requestedPriority: "LOW",
    });
    expect(res.status).toBe(201);
    const ticket = await iso.db.client.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(await changes(ticket.id)).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "NEW", changedById: requesterId, changedAt: ticket.createdAt, resolutionSummary: null }),
    ]);
  });
});

describe("GET /api/tickets/:id/history", () => {
  // SEC-05 / AC-25, BR-26
  it("shows the history oldest first to IT Staff and the owning Requester, and 404 to another Requester", async () => {
    const t = await makeTicket({ status: "OPEN" });
    await iso.db.client.statusChange.create({ data: { ticketId: t.id, fromStatus: null, toStatus: "NEW", changedById: requesterId, changedAt: t.createdAt } });
    await move(staff, t.id, { fromStatus: "OPEN", currentStatus: "WAITING_FOR_REQUESTER" });
    for (const caller of [staff, admin, requester]) {
      const res = await caller.get(`/api/tickets/${t.id}/history`);
      expect(res.status).toBe(200);
      expect(res.body.entries.map((e: { toStatus: string }) => e.toStatus)).toEqual(["NEW", "WAITING_FOR_REQUESTER"]);
      expect(res.body.entries[1]).toMatchObject({ fromStatus: "OPEN", changedBy: { id: staffId, name: "Test User" }, resolutionSummary: null });
      expect(JSON.stringify(res.body)).not.toMatch(/@|email/);
    }
    // NEW to OPEN was never recorded, so the history says so.
    expect((await staff.get(`/api/tickets/${t.id}/history`)).body.earlierChangesUnrecorded).toBe(true);
    const other = await otherRequester.get(`/api/tickets/${t.id}/history`);
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ error: "NOT_FOUND", message: "Ticket not found." });
    expect((await staff.get("/api/tickets/999999/history")).status).toBe(404);
  });

  // MIG-03 / AC-24, BR-25
  it("keeps the gap flag of a migrated Ticket after later Lab 4 moves, and none for one whose history chains", async () => {
    // What the migration backfill leaves: one creation row only.
    const legacy = await makeTicket({ status: "IN_PROGRESS" });
    const fresh = await makeTicket({ status: "NEW" });
    for (const t of [legacy, fresh]) {
      await iso.db.client.statusChange.create({ data: { ticketId: t.id, fromStatus: null, toStatus: "NEW", changedById: t.requesterId, changedAt: t.createdAt } });
    }
    const flag = async (id: number) => (await staff.get(`/api/tickets/${id}/history`)).body.earlierChangesUnrecorded;
    expect(await flag(legacy.id)).toBe(true);
    expect(await flag(fresh.id)).toBe(false);
    expect((await move(staff, legacy.id, { fromStatus: "IN_PROGRESS", currentStatus: "WAITING_FOR_REQUESTER" })).status).toBe(200);
    expect((await move(staff, fresh.id, { fromStatus: "NEW", currentStatus: "OPEN" })).status).toBe(200);
    expect(await flag(legacy.id)).toBe(true);
    expect(await flag(fresh.id)).toBe(false);
  });
});

describe("GET /api/tickets/:id resolution gate", () => {
  // API-20 / BR-21
  it("tells IT Staff the Planned and Completed counts and whether the Ticket can be resolved; a Requester never receives it", async () => {
    const t = await makeTicket();
    const gate = async () => (await staff.get(`/api/tickets/${t.id}`)).body.resolutionGate;
    expect(await gate()).toEqual({ plannedActions: 0, completedActions: 0, canResolve: false });
    await addAction(t.id, "PLANNED");
    await addAction(t.id, "COMPLETED");
    await addAction(t.id, "CANCELLED");
    expect(await gate()).toEqual({ plannedActions: 1, completedActions: 1, canResolve: false });
    await iso.db.client.actionTaken.updateMany({ where: { ticketId: t.id, status: "PLANNED" }, data: { status: "COMPLETED" } });
    expect(await gate()).toEqual({ plannedActions: 0, completedActions: 2, canResolve: true });
    expect((await admin.get(`/api/tickets/${t.id}`)).body.resolutionGate.canResolve).toBe(true);
    const own = await requester.get(`/api/tickets/${t.id}`);
    expect(own.status).toBe(200);
    expect(own.body).not.toHaveProperty("resolutionGate");
  });
});

