import { beforeAll, describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 4 api-spec endpoints 1 to 5. Every test runs against its own migrated throwaway database.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, staff2: Caller, admin: Caller, requester: Caller, otherRequester: Caller;
let staffId: number, staff2Id: number, adminId: number, requesterId: number, otherRequesterId: number;
let inactiveStaffId: number;

let n = 0;
async function makeTicket(o: { status?: TicketStatus; requesterId?: number; createdAt?: Date } = {}) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-6${String(n).padStart(5, "0")}`,
      requesterId: o.requesterId ?? requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Actions fixture ${n}`,
      description: "A fixture for the Actions Taken tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: o.status ?? "IN_PROGRESS",
      createdAt: o.createdAt ?? new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });
}

const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const valid = () => ({ actionAt: ago(HOUR), description: "Replace the LAN cable at desk 4B and retest the link." });
const actionRows = (ticketId: number) => iso.db.client.actionTaken.findMany({ where: { ticketId }, orderBy: { id: "asc" } });
const stored = (id: number) => iso.db.client.actionTaken.findUniqueOrThrow({ where: { id } });

async function create(ticketId: number, body: Record<string, unknown> = {}, by: Caller = staff) {
  return by.post(`/api/tickets/${ticketId}/actions`).send({ ...valid(), ...body });
}
async function planned(ticketId: number, body: Record<string, unknown> = {}) {
  const res = await create(ticketId, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: number; version: number };
}

beforeAll(async () => {
  const make = async (role: "IT_STAFF" | "ADMINISTRATOR" | "REQUESTER") => {
    const u = (await createUser({ role })).user;
    return [await signedIn(u), u.id] as const;
  };
  [staff, staffId] = await make("IT_STAFF");
  [staff2, staff2Id] = await make("IT_STAFF");
  [admin, adminId] = await make("ADMINISTRATOR");
  [requester, requesterId] = await make("REQUESTER");
  [otherRequester, otherRequesterId] = await make("REQUESTER");
  inactiveStaffId = (await createUser({ role: "IT_STAFF", isActive: false })).user.id;
});

describe("GET /api/tickets/:id/actions", () => {
  // API-01 / AC-14, BR-16
  it("lists every Action by Action Date/Time, then creation order, with Recorded By, Responsible Staff and Performed By", async () => {
    const t = await makeTicket();
    const late = await planned(t.id, { actionAt: ago(HOUR), responsibleStaffId: staff2Id });
    const early = await planned(t.id, { actionAt: ago(1.5 * HOUR) });
    const sameTime = await planned(t.id, { actionAt: ago(HOUR) });
    await staff.post(`/api/actions/${early.id}/complete`).send({ version: 1, result: "Cable replaced and link retested." });

    const res = await staff.get(`/api/tickets/${t.id}/actions`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { id: number }) => a.id)).toEqual([early.id, late.id, sameTime.id]);
    const first = res.body[0];
    expect(first.recordedBy).toEqual({ id: staffId, name: "Test User" });
    expect(first.responsibleStaff).toEqual({ id: staffId, name: "Test User", eligible: true });
    expect(first.performedBy).toEqual({ id: staffId, name: "Test User" });
    expect(res.body[1].responsibleStaff.id).toBe(staff2Id);
    expect(res.body[1].performedBy).toBeNull();
    // No email or password data for any person.
    expect(JSON.stringify(res.body)).not.toMatch(/@|passwordHash|email/);
    expect(Object.keys(first).sort()).toEqual(
      ["id", "ticketId", "status", "actionAt", "description", "result", "followUpRequired", "followUpNote", "attachmentNotes", "recordedBy", "recordedAt", "responsibleStaff", "performedBy", "completedAt", "cancelledBy", "cancelledAt", "cancelReason", "lastEditedBy", "version", "updatedAt"].sort(),
    );

    // A Ticket with no Actions returns an empty list.
    expect((await staff.get(`/api/tickets/${(await makeTicket()).id}/actions`)).body).toEqual([]);
  });

  // API-02 / AC-15, BR-17
  it("shows a Requester every Action on their own Ticket, Cancelled ones included, and 404 for another's", async () => {
    const t = await makeTicket();
    const a = await planned(t.id);
    await staff.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: "Duplicate of another action." });
    await planned(t.id);

    const own = await requester.get(`/api/tickets/${t.id}/actions`);
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(2);
    expect(own.body[0]).toMatchObject({ status: "CANCELLED", cancelReason: "Duplicate of another action.", cancelledBy: { id: staffId } });
    expect(own.body).toEqual((await staff.get(`/api/tickets/${t.id}/actions`)).body);

    const other = await otherRequester.get(`/api/tickets/${t.id}/actions`);
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ error: "NOT_FOUND", message: "Ticket not found." });
    for (const id of ["999999", "abc", "0", "2147483648"]) expect((await staff.get(`/api/tickets/${id}/actions`)).status, id).toBe(404);
  });
});

describe("POST /api/tickets/:id/actions", () => {
  // API-03 / AC-01
  it("creates a Planned Action under the right Ticket, recorded by the caller, with the chosen Responsible Staff", async () => {
    const t = await makeTicket();
    const before = await iso.db.client.ticket.findUniqueOrThrow({ where: { id: t.id } });
    const res = await create(t.id, { responsibleStaffId: staff2Id, attachmentNotes: "See photo desk-4b-port.jpg." });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: t.id,
      status: "PLANNED",
      version: 1,
      recordedBy: { id: staffId },
      responsibleStaff: { id: staff2Id, eligible: true },
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: "See photo desk-4b-port.jpg.",
      result: null,
      performedBy: null,
      lastEditedBy: null,
    });
    const row = await stored(res.body.id);
    expect(row).toMatchObject({ ticketId: t.id, recordedById: staffId, responsibleStaffId: staff2Id });
    // Responsible Staff defaults to the caller; an Administrator may record too.
    expect((await create(t.id, {}, admin)).body.responsibleStaff.id).toBe(adminId);
    // Recording an Action is Ticket activity (BR-19).
    const after = await iso.db.client.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  // API-04 / AC-04, BR-07
  it("refuses an inactive user, a Requester, and a missing user as Responsible Staff, on create and on reassign, writing nothing", async () => {
    const t = await makeTicket();
    for (const id of [inactiveStaffId, requesterId, 99_999]) {
      const res = await create(t.id, { responsibleStaffId: id });
      expect(res.status, String(id)).toBe(409);
      expect(res.body.error).toBe("INVALID_RESPONSIBLE");
    }
    expect(await actionRows(t.id)).toHaveLength(0);

    const a = await planned(t.id);
    for (const id of [inactiveStaffId, requesterId, 99_999]) {
      const res = await staff.patch(`/api/actions/${a.id}`).send({ version: 1, responsibleStaffId: id });
      expect(res.status, String(id)).toBe(409);
      expect(res.body.error).toBe("INVALID_RESPONSIBLE");
    }
    expect(await stored(a.id)).toMatchObject({ responsibleStaffId: staffId, version: 1 });
  });

  // API-05 / AC-05, BR-04
  it("requires a Follow-Up Note only when follow-up is required, and clears one sent without it", async () => {
    const t = await makeTicket();
    const missing = await create(t.id, { followUpRequired: true });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("VALIDATION_ERROR");
    expect(Object.keys(missing.body.fields)).toEqual(["followUpNote"]);

    const cleared = await create(t.id, { followUpRequired: false, followUpNote: "Not wanted here." });
    expect(cleared.status).toBe(201);
    expect(cleared.body).toMatchObject({ followUpRequired: false, followUpNote: null });

    const kept = await create(t.id, { followUpRequired: true, followUpNote: "  Check the switch port.  " });
    expect(kept.body).toMatchObject({ followUpRequired: true, followUpNote: "Check the switch port." });
    // Turning it off on edit clears the stored note.
    const off = await staff.patch(`/api/actions/${kept.body.id}`).send({ version: 1, followUpRequired: false });
    expect(off.body).toMatchObject({ followUpRequired: false, followUpNote: null, version: 2 });
  });

  // API-06 / AC-06, BR-03, BR-10, BR-11
  it("accepts each text field at its limits and rejects one character beyond with a fields entry", async () => {
    const t = await makeTicket();
    const x = (k: number) => "x".repeat(k);
    const ok = [
      { description: x(5) },
      { description: x(2000) },
      { followUpRequired: true, followUpNote: x(5) },
      { followUpRequired: true, followUpNote: x(1000) },
      { attachmentNotes: x(1000) },
    ];
    for (const body of ok) expect((await create(t.id, body)).status, JSON.stringify(body).slice(0, 60)).toBe(201);
    const bad: [Record<string, unknown>, string][] = [
      [{ description: x(4) }, "description"],
      [{ description: x(2001) }, "description"],
      [{ followUpRequired: true, followUpNote: x(4) }, "followUpNote"],
      [{ followUpRequired: true, followUpNote: x(1001) }, "followUpNote"],
      [{ attachmentNotes: x(1001) }, "attachmentNotes"],
    ];
    const count = (await actionRows(t.id)).length;
    for (const [body, field] of bad) {
      const res = await create(t.id, body);
      expect(res.status, field).toBe(400);
      expect(res.body.fields, field).toHaveProperty(field);
    }
    expect(await actionRows(t.id)).toHaveLength(count);

    const a = await planned(t.id);
    expect((await staff.post(`/api/actions/${a.id}/complete`).send({ version: 1, result: x(4) })).body.fields).toHaveProperty("result");
    expect((await staff.post(`/api/actions/${a.id}/complete`).send({ version: 1, result: x(2001) })).body.fields).toHaveProperty("result");
    expect((await staff.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: x(4) })).body.fields).toHaveProperty("reason");
    expect((await staff.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: x(501) })).body.fields).toHaveProperty("reason");
    expect((await stored(a.id)).status).toBe("PLANNED");
    expect((await staff.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: x(500) })).status).toBe(200);
    const b = await planned(t.id);
    expect((await staff.post(`/api/actions/${b.id}/complete`).send({ version: 1, result: x(2000) })).status).toBe(200);
  });

  // API-07 / AC-07, BR-05
  it("refuses an Action Date/Time before the Ticket was created, 366 days ahead, or in the future at completion", async () => {
    const t = await makeTicket({ createdAt: new Date(Date.now() - 2 * HOUR) });
    const before = await create(t.id, { actionAt: new Date(t.createdAt.getTime() - 1).toISOString() });
    expect(before.status).toBe(400);
    expect(before.body.fields).toHaveProperty("actionAt");
    const far = await create(t.id, { actionAt: new Date(Date.now() + 366 * 24 * HOUR).toISOString() });
    expect(far.status).toBe(400);
    expect(far.body.fields).toHaveProperty("actionAt");
    expect(await actionRows(t.id)).toHaveLength(0);

    // A Planned Action may be dated ahead, but cannot be completed while it still is.
    const future = await planned(t.id, { actionAt: new Date(Date.now() + 24 * HOUR).toISOString() });
    const done = await staff.post(`/api/actions/${future.id}/complete`).send({ version: 1, result: "Done ahead of time." });
    expect(done.status).toBe(400);
    expect(done.body.fields).toHaveProperty("actionAt");
    const corrected = await staff.post(`/api/actions/${future.id}/complete`).send({ version: 1, result: "Done ahead of time.", actionAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(corrected.status).toBe(400);
    expect(await stored(future.id)).toMatchObject({ status: "PLANNED", version: 1 });
    // Completing with the time corrected to now succeeds (BR-10).
    const fixed = await staff.post(`/api/actions/${future.id}/complete`).send({ version: 1, result: "Done ahead of time.", actionAt: new Date().toISOString() });
    expect(fixed.status).toBe(200);
  });

  // API-08 / AC-16, BR-06
  it("ignores Recorded By, Performed By, status, and timestamps sent by the client", async () => {
    const t = await makeTicket();
    const res = await create(t.id, {
      recordedById: staff2Id,
      performedById: staff2Id,
      status: "COMPLETED",
      result: "Pretend it is done.",
      version: 7,
      createdAt: "2020-01-01T00:00:00.000Z",
      completedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
    const row = await stored(res.body.id);
    expect(row).toMatchObject({ recordedById: staffId, performedById: null, status: "PLANNED", result: null, version: 1, completedAt: null });
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    const done = await staff.post(`/api/actions/${row.id}/complete`).send({ version: 1, result: "Cable replaced.", performedById: staff2Id, completedAt: "2020-01-01T00:00:00.000Z" });
    expect(done.status).toBe(200);
    const after = await stored(row.id);
    expect(after.performedById).toBe(staffId);
    expect(after.completedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("PATCH /api/actions/:id", () => {
  // API-09 / AC-08, BR-12
  it("changes the editable fields only, keeps Recorded By and Recorded at, records Last Edited By, and bumps the version", async () => {
    const t = await makeTicket();
    const a = await planned(t.id);
    const before = await stored(a.id);
    const res = await staff2.patch(`/api/actions/${a.id}`).send({
      version: 1,
      description: "Replace the LAN cable and the wall port.",
      actionAt: ago(0.5 * HOUR),
      responsibleStaffId: staff2Id,
      followUpRequired: true,
      followUpNote: "Check the switch port.",
      attachmentNotes: "Photo in Attachments.",
      // Not editable: ignored.
      ticketId: (await makeTicket()).id,
      status: "COMPLETED",
      recordedById: staff2Id,
      result: "Sneaky result.",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: 2,
      status: "PLANNED",
      description: "Replace the LAN cable and the wall port.",
      responsibleStaff: { id: staff2Id },
      followUpNote: "Check the switch port.",
      attachmentNotes: "Photo in Attachments.",
      lastEditedBy: { id: staff2Id, name: "Test User" },
      recordedBy: { id: staffId },
      result: null,
    });
    const after = await stored(a.id);
    expect(after).toMatchObject({ ticketId: t.id, recordedById: staffId, status: "PLANNED", result: null });
    expect(after.createdAt).toEqual(before.createdAt);

    const nothing = await staff.patch(`/api/actions/${a.id}`).send({ version: 2, status: "CANCELLED" });
    expect(nothing.status).toBe(400);
    for (const version of [undefined, 0, -1, 1.5, "2"]) {
      expect((await staff.patch(`/api/actions/${a.id}`).send({ version, description: "Another description." })).body.fields, String(version)).toHaveProperty("version");
    }
    for (const id of ["999999", "abc", "2147483648"]) expect((await staff.patch(`/api/actions/${id}`).send({ version: 1, description: "Valid text" })).status, id).toBe(404);
  });

  // API-10 / AC-17, BR-08
  it("still names a Responsible Staff member who was deactivated, as no longer eligible, and lets anyone reassign the Action", async () => {
    const t = await makeTicket();
    const leaving = (await createUser({ role: "IT_STAFF" })).user;
    const a = await planned(t.id, { responsibleStaffId: leaving.id });
    await iso.db.client.user.update({ where: { id: leaving.id }, data: { isActive: false } });

    const list = await staff.get(`/api/tickets/${t.id}/actions`);
    expect(list.body[0].responsibleStaff).toEqual({ id: leaving.id, name: "Test User", eligible: false });
    expect((await stored(a.id)).responsibleStaffId).toBe(leaving.id);

    const moved = await staff2.patch(`/api/actions/${a.id}`).send({ version: 1, responsibleStaffId: staff2Id });
    expect(moved.status).toBe(200);
    expect(moved.body.responsibleStaff).toEqual({ id: staff2Id, name: "Test User", eligible: true });
    // A role change away from IT Staff makes them ineligible too.
    const demoted = (await createUser({ role: "IT_STAFF" })).user;
    const b = await planned(t.id, { responsibleStaffId: demoted.id });
    await iso.db.client.user.update({ where: { id: demoted.id }, data: { role: "REQUESTER" } });
    expect((await staff.get(`/api/tickets/${t.id}/actions`)).body.find((x: { id: number }) => x.id === b.id).responsibleStaff.eligible).toBe(false);
  });
});

describe("POST /api/actions/:id/complete and /cancel", () => {
  // API-11 / AC-09, BR-10
  it("completes with the caller as Performed By and the server time, after which the Action is final", async () => {
    const t = await makeTicket();
    const a = await planned(t.id, { responsibleStaffId: staff2Id });
    const res = await staff.post(`/api/actions/${a.id}/complete`).send({ version: 1, result: "  Cable replaced; link stable.  " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "COMPLETED", result: "Cable replaced; link stable.", performedBy: { id: staffId }, version: 2 });
    expect(Math.abs(new Date(res.body.completedAt).getTime() - Date.now())).toBeLessThan(60_000);

    const edit = await staff.patch(`/api/actions/${a.id}`).send({ version: 2, description: "Changed after the fact." });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe("ACTION_FINAL");
    expect((await stored(a.id)).description).toBe(valid().description);
  });

  // API-12 / AC-10, BR-11
  it("cancels with a reason, Cancelled By and Cancelled at, and refuses a second cancel or a complete", async () => {
    const t = await makeTicket();
    const a = await planned(t.id);
    const res = await staff2.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: "  Duplicate of the cable action.  " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "CANCELLED", cancelReason: "Duplicate of the cable action.", cancelledBy: { id: staff2Id }, version: 2, performedBy: null });
    expect(res.body.cancelledAt).not.toBeNull();

    for (const [path, body] of [["cancel", { version: 2, reason: "Cancel it again." }], ["complete", { version: 2, result: "Complete it anyway." }]] as const) {
      const again = await staff.post(`/api/actions/${a.id}/${path}`).send(body);
      expect(again.status, path).toBe(409);
      expect(again.body.error, path).toBe("ACTION_FINAL");
    }
    expect(await stored(a.id)).toMatchObject({ status: "CANCELLED", version: 2, cancelledById: staff2Id });
  });

  // API-13 / AC-11, BR-13
  it("lets the first of two edits from one loaded version win, and refuses the second with the current Action", async () => {
    const t = await makeTicket();
    const a = await planned(t.id);
    const first = await staff.patch(`/api/actions/${a.id}`).send({ version: 1, description: "First editor's description." });
    expect(first.status).toBe(200);
    const second = await staff2.patch(`/api/actions/${a.id}`).send({ version: 1, description: "Second editor's description.", attachmentNotes: "Second note." });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("STALE_ACTION");
    expect(second.body.action).toMatchObject({ id: a.id, version: 2, description: "First editor's description.", attachmentNotes: null });
    expect(await stored(a.id)).toMatchObject({ version: 2, description: "First editor's description.", attachmentNotes: null, lastEditedById: staffId });

    // A complete or cancel from before the edit is stale too, and writes nothing.
    for (const [path, body] of [["complete", { version: 1, result: "Done from an old page." }], ["cancel", { version: 1, reason: "Cancel from an old page." }]] as const) {
      const res = await staff2.post(`/api/actions/${a.id}/${path}`).send(body);
      expect(res.status, path).toBe(409);
      expect(res.body.error, path).toBe("STALE_ACTION");
    }
    expect((await stored(a.id)).status).toBe("PLANNED");

    // Two edits sent at the same moment from one version: exactly one is applied.
    const race = await Promise.all([
      staff.patch(`/api/actions/${a.id}`).send({ version: 2, description: "Racer one wins?" }),
      staff2.patch(`/api/actions/${a.id}`).send({ version: 2, description: "Racer two wins?" }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await stored(a.id)).version).toBe(3);
  });

  // API-14 / AC-12, BR-14
  it("refuses every Action write on a Resolved, Closed, or Cancelled Ticket, writing nothing", async () => {
    for (const status of ["RESOLVED", "CLOSED", "CANCELLED"] as const) {
      const t = await makeTicket();
      const a = await planned(t.id);
      await iso.db.client.ticket.update({ where: { id: t.id }, data: { currentStatus: status } });
      const attempts = [
        await create(t.id),
        await staff.patch(`/api/actions/${a.id}`).send({ version: 1, description: "Edit on a finished Ticket." }),
        await staff.post(`/api/actions/${a.id}/complete`).send({ version: 1, result: "Complete on a finished Ticket." }),
        await staff.post(`/api/actions/${a.id}/cancel`).send({ version: 1, reason: "Cancel on a finished Ticket." }),
      ];
      for (const res of attempts) {
        expect(res.status, status).toBe(409);
        expect(res.body.error, status).toBe("TICKET_NOT_WORKABLE");
      }
      expect(await actionRows(t.id)).toEqual([expect.objectContaining({ id: a.id, status: "PLANNED", version: 1 })]);
    }
    // Every workable status accepts an Action.
    for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] as const) {
      expect((await create((await makeTicket({ status })).id)).status, status).toBe(201);
    }
  });
});

describe("Requester and Action writes", () => {
  // SEC-01 / AC-15, BR-17
  it("answers 403 from the role alone on every write, for own, other, and missing Tickets and Actions, writing nothing", async () => {
    const own = await makeTicket();
    const other = await makeTicket({ requesterId: otherRequesterId });
    const a = await planned(own.id);
    const b = await planned(other.id);
    const before = await iso.db.client.actionTaken.findMany({ orderBy: { id: "asc" } });
    for (const id of [own.id, other.id, 999_999]) {
      const res = await requester.post(`/api/tickets/${id}/actions`).send(valid());
      expect(res.status, `create ${id}`).toBe(403);
      expect(res.body).toEqual({ error: "FORBIDDEN", message: "You do not have permission to do that." });
    }
    for (const id of [a.id, b.id, 999_999]) {
      expect((await requester.patch(`/api/actions/${id}`).send({ version: 1, description: "Requester edit." })).status).toBe(403);
      expect((await requester.post(`/api/actions/${id}/complete`).send({ version: 1, result: "Requester complete." })).status).toBe(403);
      expect((await requester.post(`/api/actions/${id}/cancel`).send({ version: 1, reason: "Requester cancel." })).status).toBe(403);
    }
    expect(await iso.db.client.actionTaken.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    // No delete route exists for anyone (BR-18).
    expect((await admin.delete(`/api/actions/${a.id}`)).status).toBe(404);
    expect(await stored(a.id)).toBeTruthy();
  });
});
