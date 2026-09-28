import { beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 3: the Requester is the authenticated session, not a `requesterId` in the
// body (BR-11). The database is a throwaway one with the reference data seeded,
// so Category and Related System ids 1 onwards are the seeded ones.
const iso = useIsolatedDatabase({ referenceData: true });

const validBody = {
  categoryId: 1,
  relatedSystemId: 1,
  summary: "Laptop battery drains quickly",
  description: "The battery falls below 20 percent after a short session, every day this week.",
  requestedPriority: "MEDIUM",
};

describe("POST /api/tickets", () => {
  let ari: Awaited<ReturnType<typeof signedIn>>;
  let ariId: number;

  beforeAll(async () => {
    const { user } = await createUser();
    ariId = user.id;
    ari = await signedIn(user);
  });

  // API-01
  it("creates a Ticket with a valid body", async () => {
    const res = await ari.post("/api/tickets").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{6,}$/);
    expect(res.body).toMatchObject({
      requesterId: ariId,
      categoryId: validBody.categoryId,
      relatedSystemId: validBody.relatedSystemId,
      summary: validBody.summary,
      description: validBody.description,
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
    });
  });

  it("generates a unique ticketNumber per Ticket", async () => {
    const first = await ari.post("/api/tickets").send(validBody);
    const second = await ari.post("/api/tickets").send(validBody);

    expect(first.body.ticketNumber).not.toBe(second.body.ticketNumber);
  });

  // API-02
  it("rejects missing/out-of-range Summary and Description with both field errors", async () => {
    const res = await ari
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
    const res = await ari
      .post("/api/tickets")
      .send({ ...validBody, requestedPriority: "URGENT" });

    expect(res.status).toBe(400);
    expect(res.body.fields.requestedPriority).toBeDefined();
  });

  // API-03
  it("rejects an unknown categoryId/relatedSystemId", async () => {
    const res = await ari
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

    const res = await ari
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

  it("rejects non-integer ids (e.g. 1.5) rather than passing them through to the database", async () => {
    const res = await ari
      .post("/api/tickets")
      .send({ ...validBody, categoryId: 1.5, relatedSystemId: 1.5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
    expect(res.body.fields.categoryId).toBeDefined();
    expect(res.body.fields.relatedSystemId).toBeDefined();
  });

  // Lab 2 rejected an unknown or inactive requesterId with a 400. That input no
  // longer exists (BR-11); the equivalent guarantee is that a Requester who is
  // deactivated can no longer create anything (BR-08).
  it("returns 401 once the Requester has been deactivated, and creates nothing", async () => {
    const { user } = await createUser();
    const session = await signedIn(user);
    expect((await session.post("/api/tickets").send(validBody)).status).toBe(201);

    await getPrisma().user.update({ where: { id: user.id }, data: { isActive: false } });
    const after = await session.post("/api/tickets").send({ ...validBody, summary: "After deactivation" });

    expect(after.status).toBe(401);
    expect(await getPrisma().ticket.findFirst({ where: { summary: "After deactivation" } })).toBeNull();
  });

  it("returns the documented safe 500 shape when a reference lookup fails", async () => {
    // A targeted spy on the isolated client's delegate. Session lookup still works,
    // so the request gets past authentication and reaches the failing lookup.
    const spy = vi
      .spyOn(iso.db.client.category, "findFirst")
      .mockRejectedValueOnce(new Error("connection refused"));
    try {
      const res = await ari.post("/api/tickets").send(validBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: "INTERNAL_ERROR",
        message: "Unable to create the Ticket.",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
