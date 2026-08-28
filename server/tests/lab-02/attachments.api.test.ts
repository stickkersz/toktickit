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
      summary: "Attachment test ticket",
      description: "Created to test the attachment upload endpoint end to end.",
      requestedPriority: "LOW",
    });
  return res.body.id as number;
}

// Requires the DB to be migrated and seeded first (BR-37).
describe("POST /api/tickets/:id/attachments", () => {
  // API-10
  it("accepts one valid file", async () => {
    const ticketId = await createTicket();

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("fake image bytes"), {
        filename: "receipt.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(res.body.uploaded).toHaveLength(1);
    expect(res.body.uploaded[0].originalFilename).toBe("receipt.jpg");
    expect(res.body.failed).toHaveLength(0);
  });

  // API-11
  it("rejects a 6 MB file with ALL_FILES_REJECTED / FILE_TOO_LARGE", async () => {
    const ticketId = await createTicket();
    const big = Buffer.alloc(6 * 1024 * 1024);

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", big, { filename: "big.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ALL_FILES_REJECTED");
    expect(res.body.failed[0].reason).toBe("FILE_TOO_LARGE");
  });

  // API-12
  it("rejects a .docx file with ALL_FILES_REJECTED / UNSUPPORTED_TYPE", async () => {
    const ticketId = await createTicket();

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("not really a docx"), {
        filename: "notes.docx",
        contentType: "application/msword",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ALL_FILES_REJECTED");
    expect(res.body.failed[0].reason).toBe("UNSUPPORTED_TYPE");
  });

  // API-13
  it("rejects a 6th file when 5 active attachments already exist", async () => {
    const ticketId = await createTicket();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/attachments`)
        .field("requesterId", "1")
        .attach("files", Buffer.from("x"), {
          filename: `file-${i}.jpg`,
          contentType: "image/jpeg",
        });
      expect(res.status).toBe(201);
    }

    const sixth = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("x"), { filename: "file-6.jpg", contentType: "image/jpeg" });

    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toBe("ALL_FILES_REJECTED");
    expect(sixth.body.failed[0].reason).toBe("MAX_ATTACHMENTS_EXCEEDED");
  });

  it("rejects an upload from a non-owning Requester with 404", async () => {
    const ticketId = await createTicket(1);

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "2")
      .attach("files", Buffer.from("x"), { filename: "file.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(404);
  });
});

// API-16
describe("Ticket creation is independent of a later attachment failure (BR-25)", () => {
  it("keeps the Ticket queryable by its ticketNumber even if its one attachment upload fails", async () => {
    const createRes = await request(app)
      .post("/api/tickets")
      .send({
        requesterId: 1,
        categoryId: 1,
        relatedSystemId: 1,
        summary: "Ticket survives a failed attachment",
        description: "Verifies BR-25: an attachment failure never rolls back ticket creation.",
        requestedPriority: "LOW",
      });
    const ticketId = createRes.body.id as number;

    const attachRes = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("not really a docx"), {
        filename: "notes.docx",
        contentType: "application/msword",
      });

    expect(attachRes.status).toBe(400);

    const stillExists = await getPrisma().ticket.findUnique({ where: { id: ticketId } });
    expect(stillExists?.ticketNumber).toBe(createRes.body.ticketNumber);
  });
});
