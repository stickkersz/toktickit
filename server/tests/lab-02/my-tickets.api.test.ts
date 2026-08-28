import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

async function createTicket(
  requesterId: number,
  overrides: {
    summary?: string;
    categoryId?: number;
    relatedSystemId?: number;
    requestedPriority?: "LOW" | "MEDIUM" | "HIGH";
  } = {},
) {
  const res = await request(app)
    .post("/api/tickets")
    .send({
      requesterId,
      categoryId: overrides.categoryId ?? 1,
      relatedSystemId: overrides.relatedSystemId ?? 1,
      summary: overrides.summary ?? `My Tickets test ${randomUUID()}`,
      description: "Created to exercise GET /api/tickets end to end.",
      requestedPriority: overrides.requestedPriority ?? "LOW",
    });
  return res.body as { id: number; ticketNumber: string };
}

// Requires the DB to be migrated and seeded first (BR-37).
describe("GET /api/tickets", () => {
  // API-04
  it("scopes results to the requesting Requester only", async () => {
    const markerA = `OwnerA-${randomUUID()}`;
    const markerB = `OwnerB-${randomUUID()}`;
    await createTicket(1, { summary: markerA });
    await createTicket(2, { summary: markerB });

    const resA = await request(app).get("/api/tickets").query({ requesterId: 1, search: markerA });
    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].summary).toBe(markerA);

    const crossOwner = await request(app)
      .get("/api/tickets")
      .query({ requesterId: 1, search: markerB });
    expect(crossOwner.body.data).toHaveLength(0);
  });

  // API-05
  it("combines search and filters with AND", async () => {
    const marker = `Combo-${randomUUID()}`;
    await createTicket(1, { summary: `${marker} A`, categoryId: 2, requestedPriority: "HIGH" });
    await createTicket(1, { summary: `${marker} B`, categoryId: 3, requestedPriority: "HIGH" });

    const res = await request(app).get("/api/tickets").query({
      requesterId: 1,
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
    const res = await request(app)
      .get("/api/tickets")
      .query({ requesterId: 1, search: `no-such-ticket-${randomUUID()}` });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  });

  // API-07 / BR-23
  it("paginates correctly across pages with no duplicates or gaps", async () => {
    const marker = `Page-${randomUUID()}`;
    const created = [];
    for (let i = 0; i < 12; i++) {
      created.push(await createTicket(1, { summary: `${marker} ${i}` }));
    }

    const seenIds = new Set<number>();
    for (const page of [1, 2, 3]) {
      const res = await request(app)
        .get("/api/tickets")
        .query({ requesterId: 1, search: marker, pageSize: 5, page });

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
    await createTicket(1, { summary: marker });

    const badPage = await request(app)
      .get("/api/tickets")
      .query({ requesterId: 1, search: marker, page: "abc", pageSize: "999" });

    expect(badPage.status).toBe(200);
    expect(badPage.body.pagination.page).toBe(1);
    expect(badPage.body.pagination.pageSize).toBe(10);
  });

  it("falls back to the default sort for an unrecognized sort value", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .query({ requesterId: 1, sort: "not-a-real-field" });

    expect(res.status).toBe(200);
  });

  it("rejects a missing or inactive requesterId", async () => {
    const missing = await request(app).get("/api/tickets");
    expect(missing.status).toBe(400);

    const inactiveRequester = await request(app).get("/api/tickets").query({ requesterId: 999999 });
    expect(inactiveRequester.status).toBe(400);
  });
});
