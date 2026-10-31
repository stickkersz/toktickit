import { beforeAll, describe, expect, it } from "vitest";
import { isValidId } from "../../src/ids.js";
import { parseStaffQueueQuery } from "../../src/staffQueueQuery.js";
import { parseTicketListQuery } from "../../src/ticketListQuery.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Review on #83 and its sweep: an integer read from a request that does not fit a Postgres INTEGER makes
// Prisma throw, so every such input is range-checked and answered as invalid (400) or not found (404),
// never with a 500. Applies to every Lab 2, Lab 3, and Lab 4 route.
const iso = useIsolatedDatabase({ referenceData: true });

type Caller = Awaited<ReturnType<typeof signedIn>>;
let requester: Caller, staff: Caller, admin: Caller;
let ticketId: number;
const HUGE = ["2147483648", "100000000000"];

beforeAll(async () => {
  const r = (await createUser()).user;
  requester = await signedIn(r);
  staff = await signedIn((await createUser({ role: "IT_STAFF" })).user);
  admin = await signedIn((await createUser({ role: "ADMINISTRATOR" })).user);
  const created = await requester.post("/api/tickets").send({
    categoryId: 1,
    relatedSystemId: 1,
    summary: "Range-check fixture",
    description: "A Ticket the integer range tests point at, long enough to be valid.",
    requestedPriority: "LOW",
  });
  ticketId = created.body.id;
});

describe("integers read from a request (BR-47, review on #83)", () => {
  // SEC-07
  it("treats an id above 2147483647 as no id", () => {
    expect(isValidId(2147483647)).toBe(true);
    expect(isValidId(2147483648)).toBe(false);
    expect(isValidId(0)).toBe(false);
    expect(isValidId(1.5)).toBe(false);
    expect(isValidId("5")).toBe(false);
  });

  // SEC-07
  it("falls back to the defaults for an out-of-range category, owner, or page filter", async () => {
    const big = { category: "2147483648", owner: "2147483648", page: "100000000000000000000" };
    expect(parseStaffQueueQuery(big)).toMatchObject({ categoryId: null, owner: null, page: 1 });
    expect(parseTicketListQuery(big)).toMatchObject({ categoryId: null, page: 1 });
    expect(parseStaffQueueQuery({ owner: "2147483647", page: "2147483647" })).toMatchObject({ owner: { kind: "id", id: 2147483647 }, page: 2147483647 });
    expect((await staff.get("/api/staff/tickets").query(big)).status).toBe(200);
    expect((await requester.get("/api/tickets").query(big)).status).toBe(200);
    // The largest page still reaches the database: with pageSize 50 the offset is about 1.07e11, which
    // Prisma takes as a 64-bit skip and answers with an empty page (review on #83).
    const queue = await staff.get("/api/staff/tickets").query({ page: "2147483647", pageSize: "50" });
    expect(queue.status).toBe(200);
    expect(queue.body.tickets).toEqual([]);
    const mine = await requester.get("/api/tickets").query({ page: "2147483647", pageSize: "50" });
    expect(mine.status).toBe(200);
    expect(mine.body.data).toEqual([]);
  });

  // SEC-07
  it("answers 404 for an out-of-range id in any path, and 400 for one in a body", async () => {
    for (const id of HUGE) {
      const paths: [string, Promise<{ status: number }>][] = [
        ["ticket detail", requester.get(`/api/tickets/${id}`)],
        ["attachment metadata", requester.get(`/api/attachments/${id}`)],
        ["attachment download", requester.get(`/api/attachments/${id}/download`)],
        ["attachment remove", requester.delete(`/api/attachments/${id}`).send({ reason: "Out of range id" })],
        ["attachment upload", requester.post(`/api/tickets/${id}/attachments`).attach("files", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" })],
        ["comments", requester.get(`/api/tickets/${id}/comments`)],
        ["post comment", requester.post(`/api/tickets/${id}/comments`).send({ body: "Out of range" })],
        ["notes", staff.get(`/api/tickets/${id}/notes`)],
        ["owner", staff.patch(`/api/staff/tickets/${id}/owner`).send({ ownerId: null })],
        ["priority", staff.patch(`/api/staff/tickets/${id}/priority`).send({ itPriority: "HIGH" })],
        ["status", staff.patch(`/api/staff/tickets/${id}/status`).send({ fromStatus: "NEW", currentStatus: "OPEN" })],
        ["admin user", admin.patch(`/api/admin/users/${id}`).send({ isActive: false })],
        ["actions", staff.get(`/api/tickets/${id}/actions`)],
      ];
      for (const [label, pending] of paths) expect((await pending).status, `${label} ${id}`).toBe(404);
      // This Lab 2 route already answered 400 for a malformed id; it keeps that answer.
      expect((await requester.post(`/api/tickets/${id}/resolution-indication`)).status, `indication ${id}`).toBe(400);

      const big = Number(id);
      const create = await requester.post("/api/tickets").send({ categoryId: big, relatedSystemId: big, summary: "Should not exist", description: "Never written because the ids are out of range.", requestedPriority: "LOW" });
      expect(create.status, `create ${id}`).toBe(400);
      const owner = await staff.patch(`/api/staff/tickets/${ticketId}/owner`).send({ ownerId: big });
      expect(owner.status, `ownerId ${id}`).toBe(400);
      expect(owner.body.fields).toHaveProperty("ownerId");
    }
    expect(await iso.db.client.ticket.count({ where: { summary: "Should not exist" } })).toBe(0);
    expect((await iso.db.client.ticket.findUniqueOrThrow({ where: { id: ticketId } })).ownerId).toBeNull();
  });
});

describe("Ticket Owner reassign (Lab 3 BR-18, review on #83 sweep)", () => {
  // SEC-08
  it("refuses an owner deactivated after the request was checked but before the Ticket is written", async () => {
    const leaving = (await createUser({ role: "IT_STAFF" })).user;
    const real = iso.db.client;
    let interfered = false;
    const deactivate = async () => {
      if (interfered) return;
      interfered = true;
      await real.user.update({ where: { id: leaving.id }, data: { isActive: false } });
    };
    // The deactivation commits just before the write, whichever way the write is made.
    const restore = iso.override(
      new Proxy(real, {
        get(target, prop) {
          if (prop === "$transaction") {
            return async (...args: Parameters<typeof real.$transaction>) => {
              await deactivate();
              return (real.$transaction as (...a: unknown[]) => unknown)(...args);
            };
          }
          if (prop === "ticket") {
            return new Proxy(real.ticket, {
              get(t, p) {
                const value = Reflect.get(t, p);
                if (p === "update") return async (...a: unknown[]) => (await deactivate(), (value as (...x: unknown[]) => unknown).apply(t, a));
                return typeof value === "function" ? value.bind(t) : value;
              },
            });
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    );
    try {
      const res = await staff.patch(`/api/staff/tickets/${ticketId}/owner`).send({ ownerId: leaving.id });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("INVALID_OWNER");
    } finally {
      restore();
    }
    expect((await iso.db.client.ticket.findUniqueOrThrow({ where: { id: ticketId } })).ownerId).toBeNull();
  });
});
