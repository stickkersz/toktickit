import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 3: the Requester is the authenticated session, not a `requesterId` query
// parameter (BR-11). Two Requesters, each with their own session, on a throwaway
// database with the reference data seeded.
useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let a: Session;
let b: Session;

beforeAll(async () => {
  a = await signedIn((await createUser()).user);
  b = await signedIn((await createUser()).user);
});

async function createTicket(
  as: Session,
  overrides: {
    summary?: string;
    categoryId?: number;
    relatedSystemId?: number;
    requestedPriority?: "LOW" | "MEDIUM" | "HIGH";
  } = {},
) {
  const res = await as.post("/api/tickets").send({
    categoryId: overrides.categoryId ?? 1,
    relatedSystemId: overrides.relatedSystemId ?? 1,
    summary: overrides.summary ?? `My Tickets test ${randomUUID()}`,
    description: "Created to exercise GET /api/tickets end to end.",
    requestedPriority: overrides.requestedPriority ?? "LOW",
  });
  return res.body as { id: number; ticketNumber: string };
}

describe("GET /api/tickets", () => {
  // API-04
  it("scopes results to the requesting Requester only", async () => {
    const markerA = `OwnerA-${randomUUID()}`;
    const markerB = `OwnerB-${randomUUID()}`;
    await createTicket(a, { summary: markerA });
    await createTicket(b, { summary: markerB });

    const resA = await a.get("/api/tickets").query({ search: markerA });
    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].summary).toBe(markerA);

    const crossOwner = await a.get("/api/tickets").query({ search: markerB });
    expect(crossOwner.body.data).toHaveLength(0);
  });

  // API-05
  it("combines search and filters with AND", async () => {
    const marker = `Combo-${randomUUID()}`;
    await createTicket(a, { summary: `${marker} A`, categoryId: 2, requestedPriority: "HIGH" });
    await createTicket(a, { summary: `${marker} B`, categoryId: 3, requestedPriority: "HIGH" });

    const res = await a.get("/api/tickets").query({
      search: marker,
      category: 2,
      requestedPriority: "HIGH",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].summary).toBe(`${marker} A`);
  });

  // API-06 / BR-24
  it("returns an empty array with valid pagination metadata for a zero-match search, not an error", async () => {
    const res = await a.get("/api/tickets").query({ search: `no-such-ticket-${randomUUID()}` });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  });

  // API-07 / BR-23
  it("paginates correctly across pages with no duplicates or gaps", async () => {
    const marker = `Page-${randomUUID()}`;
    const created = [];
    for (let i = 0; i < 12; i++) {
      created.push(await createTicket(a, { summary: `${marker} ${i}` }));
    }

    const seenIds = new Set<number>();
    for (const page of [1, 2, 3]) {
      const res = await a.get("/api/tickets").query({ search: marker, pageSize: 5, page });

      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({ page, pageSize: 5, total: 12, totalPages: 3 });
      for (const item of res.body.data) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
      }
    }
    expect(seenIds.size).toBe(12);
    expect([...seenIds].sort()).toEqual(created.map((t) => t.id).sort());
  });

  it("falls back to default page/pageSize for non-numeric or out-of-range values", async () => {
    const marker = `Fallback-${randomUUID()}`;
    await createTicket(a, { summary: marker });

    const badPage = await a.get("/api/tickets").query({ search: marker, page: "abc", pageSize: "999" });

    expect(badPage.status).toBe(200);
    expect(badPage.body.pagination.page).toBe(1);
    expect(badPage.body.pagination.pageSize).toBe(10);
  });

  it("falls back to the default sort for an unrecognized sort value", async () => {
    const res = await a.get("/api/tickets").query({ sort: "not-a-real-field" });

    expect(res.status).toBe(200);
  });

  // Lab 2 answered a missing or unknown requesterId with 400. That input no longer
  // exists (BR-11): with no session the answer is 401, and a client that still
  // sends someone else's requesterId is served its own list (API-13).
  it("returns 401 with no session, and never lists another Requester's Tickets when asked to", async () => {
    expect((await request(app).get("/api/tickets")).status).toBe(401);

    const marker = `Foreign-${randomUUID()}`;
    await createTicket(b, { summary: marker });
    const res = await a.get("/api/tickets").query({ requesterId: 999999, search: marker });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
