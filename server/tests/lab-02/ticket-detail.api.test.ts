import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

async function createTicket(requesterId = 1) {
  const res = await request(app)
    .post("/api/tickets")
    .send({
      requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: "Ticket Detail test ticket",
      description: "Created to test GET /api/tickets/:id end to end.",
      requestedPriority: "MEDIUM",
    });
  return res.body as { id: number; ticketNumber: string };
}

// Requires the DB to be migrated and seeded first (BR-37).
describe("GET /api/tickets/:id", () => {
  it("returns full detail, including an empty attachments array, for the owning Requester", async () => {
    const ticket = await createTicket(1);

    const res = await request(app).get(`/api/tickets/${ticket.id}`).query({ requesterId: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requesterId: 1,
      summary: "Ticket Detail test ticket",
      requestedPriority: "MEDIUM",
      currentStatus: "NEW",
      attachments: [],
    });
    expect(res.body.requesterName).toBeTruthy();
    expect(res.body.categoryName).toBeTruthy();
    expect(res.body.relatedSystemName).toBeTruthy();
  });

  it("includes both active and removed attachments with their reasons", async () => {
    const ticket = await createTicket(1);
    const uploadRes = await request(app)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("x"), { filename: "photo.png", contentType: "image/png" });
    const attachmentId = uploadRes.body.uploaded[0].id as number;
    await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "Wrong file attached by mistake" });

    const res = await request(app).get(`/api/tickets/${ticket.id}`).query({ requesterId: 1 });

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0]).toMatchObject({
      id: attachmentId,
      isRemoved: true,
      removalReason: "Wrong file attached by mistake",
    });
  });

  it("returns 400 when requesterId is missing or non-numeric", async () => {
    const ticket = await createTicket(1);

    const res = await request(app).get(`/api/tickets/${ticket.id}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  // API-09
  it("returns 404, never 403, for a nonexistent Ticket id", async () => {
    const res = await request(app).get("/api/tickets/999999").query({ requesterId: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  // API-09
  it("returns 404, never 403, for a Ticket owned by a different Requester", async () => {
    const ticket = await createTicket(1);

    const res = await request(app).get(`/api/tickets/${ticket.id}`).query({ requesterId: 2 });
    expect(res.status).toBe(404);
    expect(res.body.summary).toBeUndefined();
  });

  // API-19 / BR-38
  it("returns 404 once the owning Requester has been deactivated", async () => {
    const requester = await getPrisma().requesterUser.create({
      data: { name: "Temp Requester", email: `temp-${randomUUID()}@example.com`, isActive: true },
    });
    const ticket = await createTicket(requester.id);

    const before = await request(app)
      .get(`/api/tickets/${ticket.id}`)
      .query({ requesterId: requester.id });
    expect(before.status).toBe(200);

    await getPrisma().requesterUser.update({
      where: { id: requester.id },
      data: { isActive: false },
    });

    const after = await request(app)
      .get(`/api/tickets/${ticket.id}`)
      .query({ requesterId: requester.id });
    expect(after.status).toBe(404);
  });
});
