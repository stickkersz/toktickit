import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// BR-39 on all four create endpoints: Action create (Issue 03) and Ticket, Public Comment, and Internal
// Note create (Issue 08). API-15 to API-18.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, staff2: Caller, requester: Caller, requester2: Caller;
let requesterId: number;

let n = 0;
async function makeTicket() {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-5${String(n).padStart(5, "0")}`,
      requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Idempotency fixture ${n}`,
      description: "A fixture for the Idempotency-Key tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: "IN_PROGRESS",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  });
}

const body = () => ({ actionAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), description: "Replace the LAN cable at desk 4B." });
const send = (by: Caller, ticketId: number, key: string | undefined, payload: Record<string, unknown>) => {
  const req = by.post(`/api/tickets/${ticketId}/actions`);
  return (key === undefined ? req : req.set("Idempotency-Key", key)).send(payload);
};
const count = (ticketId: number) => iso.db.client.actionTaken.count({ where: { ticketId } });

beforeAll(async () => {
  staff = await signedIn((await createUser({ role: "IT_STAFF" })).user);
  staff2 = await signedIn((await createUser({ role: "IT_STAFF" })).user);
  const r = (await createUser({ role: "REQUESTER" })).user;
  requesterId = r.id;
  requester = await signedIn(r);
  requester2 = await signedIn((await createUser({ role: "REQUESTER" })).user);
});

describe("Idempotency-Key on Action create", () => {
  // API-15 / AC-39, BR-39 (Action create)
  it("creates one Action for two sends of one key; the second is a 200 replay of the same record", async () => {
    const t = await makeTicket();
    const key = randomUUID();
    const payload = body();
    const first = await send(staff, t.id, key, payload);
    expect(first.status).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const second = await send(staff, t.id, key, payload);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await count(t.id)).toBe(1);
    // An upper-case copy of the key is the same key.
    expect((await send(staff, t.id, key.toUpperCase(), payload)).status).toBe(200);
    expect(await count(t.id)).toBe(1);
  });

  // API-16 / AC-40, BR-39 (Action create)
  it("refuses the same key with a different request, and replays one that differs only in surrounding whitespace", async () => {
    const t = await makeTicket();
    const key = randomUUID();
    const payload = body();
    expect((await send(staff, t.id, key, payload)).status).toBe(201);
    const row = await iso.db.client.actionTaken.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(row.idempotencyKey).toBe(key);
    expect(row.requestHash).toMatch(/^[0-9a-f]{64}$/);

    const changed = await send(staff, t.id, key, { ...payload, description: "Replace the cable at desk 4C." });
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: "IDEMPOTENCY_KEY_REUSED", message: "This request was already submitted with different content. Refresh and try again." });
    // The same key on another Ticket is a different request, never a replay of the first Ticket's Action.
    const elsewhere = await makeTicket();
    expect((await send(staff, elsewhere.id, key, payload)).body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await count(elsewhere.id)).toBe(0);
    const spaced = await send(staff, t.id, key, { ...payload, description: `  ${payload.description}  ` });
    expect(spaced.status).toBe(200);
    expect(await count(t.id)).toBe(1);
  });

  // API-17 / BR-39 (Action create)
  it("refuses a malformed key; lets exactly one of two simultaneous sends create; keeps two users' equal keys apart", async () => {
    const t = await makeTicket();
    for (const key of ["abc", "6f1c2a7e3b0d4e559a512b8f0c1d7e44", " "]) {
      const res = await send(staff, t.id, key, body());
      expect(res.status, key).toBe(400);
      expect(res.body.fields).toEqual({ idempotencyKey: "Idempotency-Key must be a UUID." });
    }
    expect(await count(t.id)).toBe(0);

    const same = randomUUID();
    const payload = body();
    const pair = await Promise.all([send(staff, t.id, same, payload), send(staff, t.id, same, payload)]);
    expect(pair.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await count(t.id)).toBe(1);

    const t2 = await makeTicket();
    const clash = randomUUID();
    const race = await Promise.all([send(staff, t2.id, clash, payload), send(staff, t2.id, clash, { ...payload, description: "A different description." })]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count(t2.id)).toBe(1);

    const shared = randomUUID();
    expect((await send(staff, t.id, shared, payload)).status).toBe(201);
    expect((await send(staff2, t.id, shared, payload)).status).toBe(201);
    expect(await count(t.id)).toBe(3);
  });

  // API-18 / BR-39, BR-47 (Action create)
  it("creates a new Action for every keyless send", async () => {
    const t = await makeTicket();
    const payload = body();
    expect((await send(staff, t.id, undefined, payload)).status).toBe(201);
    expect((await send(staff, t.id, undefined, payload)).status).toBe(201);
    expect(await count(t.id)).toBe(2);
    const rows = await iso.db.client.actionTaken.findMany({ where: { ticketId: t.id } });
    expect(rows.every((r) => r.idempotencyKey === null && r.requestHash === null)).toBe(true);
  });
});

// The three create endpoints that gained the key in Issue 08, run through the same cases. Each test files
// its own Ticket, so counts are per Ticket (comments, notes) or per unique summary (Tickets).
interface Endpoint {
  name: string;
  caller: () => Caller;
  // A second user who may also use this endpoint, for "one key, two users".
  other: () => Caller;
  path: (ticketId: number) => string;
  payload: (tag: string) => Record<string, unknown>;
  // The same request with one accepted field changed.
  changed: (p: Record<string, unknown>) => Record<string, unknown>;
  count: (ticketId: number, tag: string) => Promise<number>;
  hashes: (ticketId: number, tag: string) => Promise<(string | null)[]>;
}

const ticketBody = (tag: string) => ({
  summary: `Keyed ticket ${tag}`,
  description: "The projector in room 4 will not detect the HDMI input from the lectern PC.",
  requestedPriority: "MEDIUM",
  categoryId: 1,
  relatedSystemId: 1,
});
const content = (what: string) => (tag: string) => ({ body: `A ${what} for the Idempotency-Key tests, ${tag}.` });

const ENDPOINTS: Endpoint[] = [
  {
    name: "Ticket create",
    caller: () => requester,
    other: () => requester2,
    path: () => "/api/tickets",
    payload: ticketBody,
    changed: (p) => ({ ...p, description: `${p.description} It started this morning.` }),
    count: (_t, tag) => iso.db.client.ticket.count({ where: { summary: `Keyed ticket ${tag}` } }),
    hashes: async (_t, tag) => (await iso.db.client.ticket.findMany({ where: { summary: `Keyed ticket ${tag}` } })).map((r) => r.requestHash),
  },
  {
    name: "Public Comment create",
    caller: () => requester,
    other: () => staff,
    path: (id) => `/api/tickets/${id}/comments`,
    payload: content("comment"),
    changed: (p) => ({ body: `${p.body} Edited.` }),
    count: (t) => iso.db.client.publicComment.count({ where: { ticketId: t } }),
    hashes: async (t) => (await iso.db.client.publicComment.findMany({ where: { ticketId: t } })).map((r) => r.requestHash),
  },
  {
    name: "Internal Note create",
    caller: () => staff,
    other: () => staff2,
    path: (id) => `/api/tickets/${id}/notes`,
    payload: content("note"),
    changed: (p) => ({ body: `${p.body} Edited.` }),
    count: (t) => iso.db.client.internalNote.count({ where: { ticketId: t } }),
    hashes: async (t) => (await iso.db.client.internalNote.findMany({ where: { ticketId: t } })).map((r) => r.requestHash),
  },
];

const post = (by: Caller, path: string, key: string | undefined, payload: Record<string, unknown>) => {
  const req = by.post(path);
  return (key === undefined ? req : req.set("Idempotency-Key", key)).send(payload);
};

describe.each(ENDPOINTS)("Idempotency-Key on $name", (e) => {
  // API-15 / AC-39, BR-39
  it("creates one record for two sends of one key; the second is a 200 replay of the same record", async () => {
    const t = await makeTicket();
    const tag = randomUUID();
    const key = randomUUID();
    const first = await post(e.caller(), e.path(t.id), key, e.payload(tag));
    expect(first.status).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const second = await post(e.caller(), e.path(t.id), key.toUpperCase(), e.payload(tag));
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await e.count(t.id, tag)).toBe(1);
  });

  // API-16 / AC-40, BR-39
  it("refuses the same key with a changed field or another Ticket, and replays a whitespace-only difference", async () => {
    const t = await makeTicket();
    const tag = randomUUID();
    const key = randomUUID();
    const payload = e.payload(tag);
    expect((await post(e.caller(), e.path(t.id), key, payload)).status).toBe(201);

    const changed = await post(e.caller(), e.path(t.id), key, e.changed(payload));
    expect(changed.status).toBe(409);
    expect(changed.body).toEqual({ error: "IDEMPOTENCY_KEY_REUSED", message: "This request was already submitted with different content. Refresh and try again." });

    // A comment or note key reused on a different Ticket is a different request (the path is in the hash).
    const other = await makeTicket();
    if (e.path(other.id) !== e.path(t.id)) {
      expect((await post(e.caller(), e.path(other.id), key, payload)).status).toBe(409);
      expect(await e.count(other.id, tag)).toBe(0);
    }

    // Free text only: a priority code is validated as sent, so padding it is a 400, not a replay.
    const padded = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, ["summary", "description", "body"].includes(k) ? `  ${v}\n` : v]));
    const replay = await post(e.caller(), e.path(t.id), key, padded);
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");

    expect(await e.count(t.id, tag)).toBe(1);
    expect(await e.hashes(t.id, tag)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });

  // API-17 / BR-39
  it("refuses a malformed key; lets exactly one of two simultaneous sends create; keeps two users' equal keys apart", async () => {
    const t = await makeTicket();
    const tag = randomUUID();
    const bad = await post(e.caller(), e.path(t.id), "not-a-uuid", e.payload(tag));
    expect(bad.status).toBe(400);
    expect(bad.body.fields.idempotencyKey).toBe("Idempotency-Key must be a UUID.");
    expect(await e.count(t.id, tag)).toBe(0);

    // Equal bodies at the same moment: one record, the other a replay.
    const same = randomUUID();
    const pair = await Promise.all([post(e.caller(), e.path(t.id), same, e.payload(tag)), post(e.caller(), e.path(t.id), same, e.payload(tag))]);
    expect(pair.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await e.count(t.id, tag)).toBe(1);

    // Different bodies at the same moment: one 201, one 409, one record.
    const t2 = await makeTicket();
    const tag2 = randomUUID();
    const clash = randomUUID();
    const p2 = e.payload(tag2);
    const mixed = await Promise.all([post(e.caller(), e.path(t2.id), clash, p2), post(e.caller(), e.path(t2.id), clash, e.changed(p2))]);
    expect(mixed.map((r) => r.status).sort()).toEqual([201, 409]);
    const created = mixed.find((r) => r.status === 201)!;
    const stored = e.name === "Ticket create" ? await iso.db.client.ticket.count({ where: { id: created.body.id } }) : await e.count(t2.id, tag2);
    expect(stored).toBe(1);

    // One key, two users: each gets their own record.
    const t3 = await makeTicket();
    const tag3 = randomUUID();
    const shared = randomUUID();
    expect((await post(e.caller(), e.path(t3.id), shared, e.payload(tag3))).status).toBe(201);
    expect((await post(e.other(), e.path(t3.id), shared, e.payload(tag3))).status).toBe(201);
    expect(await e.count(t3.id, tag3)).toBe(2);
  });

  // API-18 / BR-39, BR-47
  it("creates a new record for every keyless send, with no key or hash stored", async () => {
    const t = await makeTicket();
    const tag = randomUUID();
    expect((await post(e.caller(), e.path(t.id), undefined, e.payload(tag))).status).toBe(201);
    expect((await post(e.caller(), e.path(t.id), undefined, e.payload(tag))).status).toBe(201);
    expect(await e.count(t.id, tag)).toBe(2);
    expect(await e.hashes(t.id, tag)).toEqual([null, null]);
  });
});
