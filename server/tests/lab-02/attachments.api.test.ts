import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import * as prismaModule from "../../src/prisma.js";
import { UPLOAD_DIR } from "../../src/attachmentStorage.js";

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

async function createTicketWithAttachment(requesterId = 1) {
  const ticketId = await createTicket(requesterId);
  const uploadRes = await request(app)
    .post(`/api/tickets/${ticketId}/attachments`)
    .field("requesterId", String(requesterId))
    .attach("files", Buffer.from("fake image bytes"), {
      filename: "receipt.jpg",
      contentType: "image/jpeg",
    });
  return { ticketId, attachmentId: uploadRes.body.uploaded[0].id as number };
}

// Requires the DB to be migrated and seeded first (BR-37).
describe("POST /api/tickets/:id/attachments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  // API-17 (upload leg)
  it("rejects an upload from a non-owning Requester with 404", async () => {
    const ticketId = await createTicket(1);

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "2")
      .attach("files", Buffer.from("x"), { filename: "file.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(404);
  });

  it("keeps an already-persisted file's row and disk copy when a later file in the batch fails", async () => {
    const ticketId = await createTicket();
    const realPrisma = getPrisma();
    let createCalls = 0;

    vi.spyOn(prismaModule, "getPrisma").mockReturnValue({
      ticket: realPrisma.ticket,
      attachment: {
        create: (args: Parameters<(typeof realPrisma)["attachment"]["create"]>[0]) => {
          createCalls += 1;
          if (createCalls === 2) {
            return Promise.reject(new Error("simulated database failure"));
          }
          return realPrisma.attachment.create(args);
        },
      },
    } as unknown as ReturnType<typeof prismaModule.getPrisma>);

    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .field("requesterId", "1")
      .attach("files", Buffer.from("a"), { filename: "a.jpg", contentType: "image/jpeg" })
      .attach("files", Buffer.from("b"), { filename: "b.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(500);

    const saved = await realPrisma.attachment.findMany({ where: { ticketId } });
    expect(saved).toHaveLength(1);
    expect(saved[0].originalFilename).toBe("a.jpg");
    expect(existsSync(path.join(UPLOAD_DIR, saved[0].storedFilename))).toBe(true);
  });
});

describe("GET /api/attachments/:id", () => {
  it("returns metadata for an active attachment owned by the requester", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .query({ requesterId: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: attachmentId,
      originalFilename: "receipt.jpg",
      isRemoved: false,
    });
    expect(res.body.removedAt).toBeUndefined();
  });

  it("returns 400 when requesterId is missing or non-numeric", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app).get(`/api/attachments/${attachmentId}`);
    expect(res.status).toBe(400);
  });

  // API-17 (metadata leg)
  it("returns 404 for a non-owning Requester, never leaking metadata", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .query({ requesterId: 2 });

    expect(res.status).toBe(404);
    expect(res.body.originalFilename).toBeUndefined();
  });

  it("returns 404 for a nonexistent attachment id", async () => {
    const res = await request(app).get("/api/attachments/999999").query({ requesterId: 1 });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/attachments/:id/download", () => {
  it("streams file bytes for an active attachment with the stored mimeType", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .get(`/api/attachments/${attachmentId}/download`)
      .query({ requesterId: 1 });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.headers["content-disposition"]).toContain("receipt.jpg");
    expect(res.body.toString()).toBe("fake image bytes");
  });

  // API-15
  it("returns 410 ATTACHMENT_REMOVED for a removed attachment, no bytes returned", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);
    await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "Wrong file attached by mistake" });

    const res = await request(app)
      .get(`/api/attachments/${attachmentId}/download`)
      .query({ requesterId: 1 });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("ATTACHMENT_REMOVED");
  });

  // API-17 (download leg)
  it("returns 404 for a non-owning Requester, never leaking file bytes", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .get(`/api/attachments/${attachmentId}/download`)
      .query({ requesterId: 2 });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/attachments/:id", () => {
  // API-14
  it("soft-removes an active attachment with a valid reason, retaining metadata", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "Duplicate of another attachment" });

    expect(res.status).toBe(200);
    expect(res.body.isRemoved).toBe(true);
    expect(res.body.removalReason).toBe("Duplicate of another attachment");
    expect(res.body.originalFilename).toBe("receipt.jpg");
  });

  it("returns 400 VALIDATION_ERROR when reason is out of the 5-200 character range", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "hi" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 409 ALREADY_REMOVED on a second removal attempt", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);
    await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "Duplicate of another attachment" });

    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 1, reason: "Duplicate of another attachment" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_REMOVED");
  });

  // API-17 (removal leg)
  it("returns 404 for a non-owning Requester and does not remove the attachment", async () => {
    const { attachmentId } = await createTicketWithAttachment(1);

    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .send({ requesterId: 2, reason: "Attempted removal by a non-owner" });

    expect(res.status).toBe(404);

    const stillActive = await getPrisma().attachment.findUnique({ where: { id: attachmentId } });
    expect(stillActive?.isRemoved).toBe(false);
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
