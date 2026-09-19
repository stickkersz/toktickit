import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 3: the Requester is the authenticated session, not a `requesterId` (BR-11).
// Two Requesters on a throwaway database with the reference data seeded.
useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let a: Session;
let aId: number;
let b: Session;

beforeAll(async () => {
  const ua = (await createUser()).user;
  aId = ua.id;
  a = await signedIn(ua);
  b = await signedIn((await createUser()).user);
});

async function createTicket(as: Session) {
  const res = await as.post("/api/tickets").send({
    categoryId: 1,
    relatedSystemId: 1,
    summary: "Ticket Detail test ticket",
    description: "Created to test GET /api/tickets/:id end to end.",
    requestedPriority: "MEDIUM",
  });
  return res.body as { id: number; ticketNumber: string };
}

describe("GET /api/tickets/:id", () => {
  it("returns full detail, including an empty attachments array, for the owning Requester", async () => {
    const ticket = await createTicket(a);

    const res = await a.get(`/api/tickets/${ticket.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      requesterId: aId,
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
    const ticket = await createTicket(a);
    const uploadRes = await a
      .post(`/api/tickets/${ticket.id}/attachments`)
      .attach("files", Buffer.from("x"), { filename: "photo.png", contentType: "image/png" });
    const attachmentId = uploadRes.body.uploaded[0].id as number;
    await a.delete(`/api/attachments/${attachmentId}`).send({ reason: "Wrong file attached by mistake" });

    const res = await a.get(`/api/tickets/${ticket.id}`);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0]).toMatchObject({
      id: attachmentId,
      isRemoved: true,
      removalReason: "Wrong file attached by mistake",
    });
  });

  // Lab 2 answered a missing requesterId with 400. That input no longer exists
  // (BR-11): with no session the answer is 401, and no Ticket content is returned.
  it("returns 401 with no session, and no Ticket content", async () => {
    const ticket = await createTicket(a);

    const res = await request(app).get(`/api/tickets/${ticket.id}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHENTICATED");
    expect(res.body.summary).toBeUndefined();
  });

  // API-09
  it("returns 404, never 403, for a nonexistent Ticket id", async () => {
    const res = await a.get("/api/tickets/999999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  // API-09
  it("returns 404, never 403, for a Ticket owned by a different Requester", async () => {
    const ticket = await createTicket(a);

    const res = await b.get(`/api/tickets/${ticket.id}`);
    expect(res.status).toBe(404);
    expect(res.body.summary).toBeUndefined();
  });

  // API-19 / BR-38. Lab 2 answered a deactivated owner with 404. Under Lab 3 the
  // deactivated user's session stops working first (BR-08), so the answer is 401;
  // the query still carries the `requester.isActive` clause as a second guard.
  it("stops serving the owning Requester once they have been deactivated", async () => {
    const { user } = await createUser();
    const session = await signedIn(user);
    const ticket = await createTicket(session);

    expect((await session.get(`/api/tickets/${ticket.id}`)).status).toBe(200);

    await getPrisma().user.update({ where: { id: user.id }, data: { isActive: false } });

    const after = await session.get(`/api/tickets/${ticket.id}`);
    expect(after.status).toBe(401);
    expect(after.body.summary).toBeUndefined();
  });
});
