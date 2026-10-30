import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// BR-39 on POST /api/tickets/:id/actions. The rows API-15 to API-18 cover all four create endpoints;
// Ticket, Public Comment, and Internal Note create join this file when they gain the key.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let staff: Caller, staff2: Caller;
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
  requesterId = (await createUser({ role: "REQUESTER" })).user.id;
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
