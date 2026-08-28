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
