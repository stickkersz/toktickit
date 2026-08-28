import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import * as prismaModule from "../../src/prisma.js";

const validBody = {
  requesterId: 1,
  categoryId: 1,
  relatedSystemId: 1,
  summary: "Laptop battery drains quickly",
  description: "The battery falls below 20 percent after a short session, every day this week.",
  requestedPriority: "MEDIUM",
};

// Requires the DB to be migrated and seeded first (BR-37).
describe("POST /api/tickets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // API-01
  it("creates a Ticket with a valid body", async () => {
    const res = await request(app).post("/api/tickets").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{6,}$/);
    expect(res.body).toMatchObject({
      requesterId: validBody.requesterId,
      categoryId: validBody.categoryId,
      relatedSystemId: validBody.relatedSystemId,
      summary: validBody.summary,
      description: validBody.description,
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
    });
  });

  it("generates a unique ticketNumber per Ticket", async () => {
    const first = await request(app).post("/api/tickets").send(validBody);
    const second = await request(app).post("/api/tickets").send(validBody);

    expect(first.body.ticketNumber).not.toBe(second.body.ticketNumber);
  });

  // API-02
  it("rejects missing/out-of-range Summary and Description with both field errors", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .send({ ...validBody, summary: "hi", description: "too short" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields.summary).toBeDefined();
    expect(res.body.fields.description).toBeDefined();
    // Field validation runs and short-circuits before the create transaction,
    // so no row exists for this rejected submission specifically.
    expect(
      await getPrisma().ticket.findFirst({ where: { summary: "hi" } }),
    ).toBeNull();
  });

  it("rejects a missing/invalid requestedPriority", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .send({ ...validBody, requestedPriority: "URGENT" });

    expect(res.status).toBe(400);
    expect(res.body.fields.requestedPriority).toBeDefined();
  });

  // API-03
  it("rejects an unknown categoryId/relatedSystemId", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .send({ ...validBody, categoryId: 999999, relatedSystemId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields.categoryId).toBeDefined();
    expect(res.body.fields.relatedSystemId).toBeDefined();
  });

  // API-18: inactive Category/RelatedSystem, seeded per BR-37 specifically for this.
  it("rejects an inactive categoryId and, separately, an inactive relatedSystemId", async () => {
    const inactiveCategory = await getPrisma().category.findFirst({ where: { isActive: false } });
    const inactiveRelatedSystem = await getPrisma().relatedSystem.findFirst({
      where: { isActive: false },
    });

    const res = await request(app)
      .post("/api/tickets")
      .send({
        ...validBody,
        categoryId: inactiveCategory!.id,
        relatedSystemId: inactiveRelatedSystem!.id,
      });

    expect(res.status).toBe(400);
    expect(res.body.fields.categoryId).toBeDefined();
    expect(res.body.fields.relatedSystemId).toBeDefined();
  });

  it("rejects an unknown or inactive requesterId", async () => {
    const inactiveRequester = await getPrisma().requesterUser.findFirst({
      where: { isActive: false },
    });

    const res = await request(app)
      .post("/api/tickets")
      .send({ ...validBody, requesterId: inactiveRequester!.id });

    expect(res.status).toBe(400);
    expect(res.body.fields.requesterId).toBeDefined();
  });

  it("rejects non-integer ids (e.g. 1.5) rather than passing them through to the database", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .send({ ...validBody, categoryId: 1.5, relatedSystemId: 1.5, requesterId: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields.categoryId).toBeDefined();
    expect(res.body.fields.relatedSystemId).toBeDefined();
    expect(res.body.fields.requesterId).toBeDefined();
  });

  it("returns the documented safe 500 shape when a reference lookup fails", async () => {
    vi.spyOn(prismaModule, "getPrisma").mockReturnValue({
      requesterUser: { findFirst: () => Promise.reject(new Error("connection refused")) },
      category: { findFirst: () => Promise.resolve(null) },
      relatedSystem: { findFirst: () => Promise.resolve(null) },
    } as unknown as ReturnType<typeof prismaModule.getPrisma>);

    const res = await request(app).post("/api/tickets").send(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "INTERNAL_ERROR",
      message: "Unable to create the Ticket.",
    });
  });
});
