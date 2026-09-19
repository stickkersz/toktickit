import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { UPLOAD_DIR } from "../../src/attachmentStorage.js";
import { createUser, signedIn, useIsolatedDatabase } from "../lab-03/helpers.js";

// Lab 3: the Requester is the authenticated session, not a `requesterId` field,
// query parameter or body (BR-11). Two Requesters on a throwaway database with the
// reference data seeded. Uploads are answered 401 or 403 before multer runs, so an
// unauthorized request never spools a file to disk (BR-55).
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let a: Session;
let b: Session;

beforeAll(async () => {
  a = await signedIn((await createUser()).user);
  b = await signedIn((await createUser()).user);
});

async function createTicket(as: Session = a) {
  const res = await as.post("/api/tickets").send({
    categoryId: 1,
    relatedSystemId: 1,
    summary: "Attachment test ticket",
    description: "Created to test the attachment upload endpoint end to end.",
    requestedPriority: "LOW",
  });
  return res.body.id as number;
}

async function createTicketWithAttachment(as: Session = a) {
  const ticketId = await createTicket(as);
  const uploadRes = await as
    .post(`/api/tickets/${ticketId}/attachments`)
    .attach("files", Buffer.from("fake image bytes"), {
      filename: "receipt.jpg",
      contentType: "image/jpeg",
    });
  return { ticketId, attachmentId: uploadRes.body.uploaded[0].id as number };
}

describe("POST /api/tickets/:id/attachments", () => {
  // API-10
  it("accepts one valid file", async () => {
    const ticketId = await createTicket();

    const res = await a
      .post(`/api/tickets/${ticketId}/attachments`)
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

    const res = await a
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", big, { filename: "big.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ALL_FILES_REJECTED");
    expect(res.body.failed[0].reason).toBe("FILE_TOO_LARGE");
  });

  // API-12
  it("rejects a .docx file with ALL_FILES_REJECTED / UNSUPPORTED_TYPE", async () => {
    const ticketId = await createTicket();

    const res = await a
      .post(`/api/tickets/${ticketId}/attachments`)
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
      const res = await a
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach("files", Buffer.from("x"), {
          filename: `file-${i}.jpg`,
          contentType: "image/jpeg",
        });
      expect(res.status).toBe(201);
    }

    const sixth = await a
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("x"), { filename: "file-6.jpg", contentType: "image/jpeg" });

    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toBe("ALL_FILES_REJECTED");
    expect(sixth.body.failed[0].reason).toBe("MAX_ATTACHMENTS_EXCEEDED");
  });

  // API-17 (upload leg)
  it("rejects an upload from a non-owning Requester with 404", async () => {
    const ticketId = await createTicket(a);

    const res = await b
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("x"), { filename: "file.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(404);
  });

  it("keeps an already-persisted file's row and disk copy when a later file in the batch fails", async () => {
    const ticketId = await createTicket();
    const realPrisma = iso.db.client;
    let createCalls = 0;

    const restore = iso.override({
      // Authentication still runs for real, so the request reaches the route.
      session: realPrisma.session,
      ticket: realPrisma.ticket,
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRaw: async () => 0,
          attachment: {
            count: (args: unknown) =>
              (realPrisma.attachment.count as (a: unknown) => unknown)(args),
            create: (args: unknown) => {
              createCalls += 1;
              if (createCalls === 2) {
                return Promise.reject(new Error("simulated database failure"));
              }
              return (realPrisma.attachment.create as (a: unknown) => unknown)(args);
            },
          },
        }),
    });

    try {
      const res = await a
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach("files", Buffer.from("a"), { filename: "a.jpg", contentType: "image/jpeg" })
        .attach("files", Buffer.from("b"), { filename: "b.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(500);

      const saved = await realPrisma.attachment.findMany({ where: { ticketId } });
      expect(saved).toHaveLength(1);
      expect(saved[0].originalFilename).toBe("a.jpg");
      expect(existsSync(path.join(UPLOAD_DIR, saved[0].storedFilename))).toBe(true);
    } finally {
      restore();
    }
  });

  // API-23 / BR-25, BR-31, api-spec.md §7
  it("accounts for every submitted file when the batch fails part-way through", async () => {
    const ticketId = await createTicket();
    const realPrisma = iso.db.client;
    let createCalls = 0;

    // Three files: the first commits, the second throws, and the third is
    // never reached at all. The third is the one that used to disappear
    // from the response entirely, leaving the Requester with no way to know
    // it still needed retrying.
    const restore = iso.override({
      // Authentication still runs for real, so the request reaches the route.
      session: realPrisma.session,
      ticket: realPrisma.ticket,
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRaw: async () => 0,
          attachment: {
            count: (args: unknown) =>
              (realPrisma.attachment.count as (a: unknown) => unknown)(args),
            create: (args: unknown) => {
              createCalls += 1;
              if (createCalls === 2) {
                return Promise.reject(new Error("simulated database failure"));
              }
              return (realPrisma.attachment.create as (a: unknown) => unknown)(args);
            },
          },
        }),
    });

    try {
      const res = await a
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach("files", Buffer.from("a"), { filename: "first.jpg", contentType: "image/jpeg" })
        .attach("files", Buffer.from("b"), { filename: "second.jpg", contentType: "image/jpeg" })
        .attach("files", Buffer.from("c"), { filename: "third.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(500);

      // The committed file is reported as uploaded, not silently lost.
      expect(res.body.uploaded).toHaveLength(1);
      expect(res.body.uploaded[0].originalFilename).toBe("first.jpg");

      // Both the file that threw and the one never reached are named, so the
      // response accounts for all three files the Requester submitted.
      const failedNames = (res.body.failed as { originalFilename: string; reason: string }[])
        .map((f) => f.originalFilename)
        .sort();
      expect(failedNames).toEqual(["second.jpg", "third.jpg"]);
      for (const entry of res.body.failed) {
        expect(entry.reason).toBe("UPLOAD_FAILED");
        expect(entry.message).toMatch(/retry/i);
      }

      const reported = res.body.uploaded.length + res.body.failed.length;
      expect(reported).toBe(3);
    } finally {
      restore();
    }
  });
});

describe("GET /api/attachments/:id", () => {
  it("returns metadata for an active attachment owned by the requester", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await a
      .get(`/api/attachments/${attachmentId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: attachmentId,
      originalFilename: "receipt.jpg",
      isRemoved: false,
    });
    expect(res.body.removedAt).toBeUndefined();
  });

  // Lab 2 answered a missing requesterId with 400. That input no longer exists
  // (BR-11): with no session the answer is 401 and no metadata is returned.
  it("returns 401 with no session, and no metadata", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await request(app).get(`/api/attachments/${attachmentId}`);
    expect(res.status).toBe(401);
    expect(res.body.originalFilename).toBeUndefined();
  });

  // API-17 (metadata leg)
  it("returns 404 for a non-owning Requester, never leaking metadata", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await b
      .get(`/api/attachments/${attachmentId}`);

    expect(res.status).toBe(404);
    expect(res.body.originalFilename).toBeUndefined();
  });

  it("returns 404 for a nonexistent attachment id", async () => {
    const res = await a.get("/api/attachments/999999");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/attachments/:id/download", () => {
  it("streams file bytes for an active attachment with the stored mimeType", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await a
      .get(`/api/attachments/${attachmentId}/download`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.headers["content-disposition"]).toContain("receipt.jpg");
    expect(res.body.toString()).toBe("fake image bytes");
  });

  // API-15
  it("returns 410 ATTACHMENT_REMOVED for a removed attachment, no bytes returned", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);
    await a
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "Wrong file attached by mistake" });

    const res = await a
      .get(`/api/attachments/${attachmentId}/download`);

    expect(res.status).toBe(410);
    expect(res.body.error).toBe("ATTACHMENT_REMOVED");
  });

  // API-17 (download leg)
  it("returns 404 for a non-owning Requester, never leaking file bytes", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await b
      .get(`/api/attachments/${attachmentId}/download`);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/attachments/:id", () => {
  // API-14
  it("soft-removes an active attachment with a valid reason, retaining metadata", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await a
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "Duplicate of another attachment" });

    expect(res.status).toBe(200);
    expect(res.body.isRemoved).toBe(true);
    expect(res.body.removalReason).toBe("Duplicate of another attachment");
    expect(res.body.originalFilename).toBe("receipt.jpg");
  });

  it("returns 400 VALIDATION_ERROR when reason is out of the 5-200 character range", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await a
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "hi" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 409 ALREADY_REMOVED on a second removal attempt", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);
    await a
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "Duplicate of another attachment" });

    const res = await a
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "Duplicate of another attachment" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_REMOVED");
  });

  // API-17 (removal leg)
  it("returns 404 for a non-owning Requester and does not remove the attachment", async () => {
    const { attachmentId } = await createTicketWithAttachment(a);

    const res = await b
      .delete(`/api/attachments/${attachmentId}`)
      .send({ reason: "Attempted removal by a non-owner" });

    expect(res.status).toBe(404);

    const stillActive = await getPrisma().attachment.findUnique({ where: { id: attachmentId } });
    expect(stillActive?.isRemoved).toBe(false);
  });
});

// API-20 / BR-38. Lab 2 answered a deactivated Requester with 404 on every endpoint.
// Under Lab 3 the deactivated user's session stops working first (BR-08), so each
// answer is 401; the queries still carry the `requester.isActive` clause as a
// second guard.
describe("Attachment endpoints — deactivated Requester", () => {
  it("returns 401 on GET metadata, GET download, DELETE, and POST upload once the Requester is inactive", async () => {
    const { user } = await createUser();
    const session = await signedIn(user);
    const { ticketId, attachmentId } = await createTicketWithAttachment(session);

    await getPrisma().user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    expect((await session.get(`/api/attachments/${attachmentId}`)).status).toBe(401);
    expect((await session.get(`/api/attachments/${attachmentId}/download`)).status).toBe(401);
    expect(
      (await session.delete(`/api/attachments/${attachmentId}`).send({ reason: "Attempt after deactivation" }))
        .status,
    ).toBe(401);
    expect(
      (
        await session
          .post(`/api/tickets/${ticketId}/attachments`)
          .attach("files", Buffer.from("x"), { filename: "after-deactivation.jpg", contentType: "image/jpeg" })
      ).status,
    ).toBe(401);

    const stored = await getPrisma().attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(stored.isRemoved).toBe(false);
  });
});

// API-21 / BR-39
describe("POST /api/tickets/:id/attachments — concurrent uploads at the active-attachment limit", () => {
  it("never lets concurrent requests push active attachments past 5", async () => {
    const ticketId = await createTicket();

    for (let i = 0; i < 4; i++) {
      const res = await a
        .post(`/api/tickets/${ticketId}/attachments`)
        .attach("files", Buffer.from("x"), { filename: `pre-${i}.jpg`, contentType: "image/jpeg" });
      expect(res.status).toBe(201);
    }

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        a
          .post(`/api/tickets/${ticketId}/attachments`)
          .attach("files", Buffer.from("x"), { filename: `race-${i}.jpg`, contentType: "image/jpeg" }),
      ),
    );

    const succeeded = attempts.filter((r) => r.status === 201);
    const rejected = attempts.filter(
      (r) => r.status === 400 && r.body.error === "ALL_FILES_REJECTED",
    );
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    const active = await getPrisma().attachment.count({ where: { ticketId, isRemoved: false } });
    expect(active).toBe(5);
  });
});

// API-22 / BR-30, api-spec.md §10
describe("DELETE /api/attachments/:id — concurrent removals of the same attachment", () => {
  it("removes it once and returns the documented 409 to the loser, keeping the first reason", async () => {
    const ticketId = await createTicket();
    const uploadRes = await a
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("x"), { filename: "race.jpg", contentType: "image/jpeg" });
    const attachmentId = uploadRes.body.uploaded[0].id as number;

    // Both requests read an active row before either writes, which is exactly
    // the interleaving that previously let the second overwrite the first's
    // removedAt/removalReason and still answer 200.
    const [first, second] = await Promise.all([
      a
        .delete(`/api/attachments/${attachmentId}`)
        .send({ reason: "First removal reason" }),
      a
        .delete(`/api/attachments/${attachmentId}`)
        .send({ reason: "Second removal reason" }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = first.status === 409 ? first : second;
    expect(loser.body.error).toBe("ALREADY_REMOVED");

    // BR-30: the surviving audit trail is the winner's, not a later overwrite.
    const stored = await getPrisma().attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(stored.isRemoved).toBe(true);
    const winner = first.status === 200 ? first : second;
    expect(stored.removalReason).toBe(winner.body.removalReason);
  });
});

// API-16
describe("Ticket creation is independent of a later attachment failure (BR-25)", () => {
  it("keeps the Ticket queryable by its ticketNumber even if its one attachment upload fails", async () => {
    const createRes = await a
      .post("/api/tickets")
      .send({
        categoryId: 1,
        relatedSystemId: 1,
        summary: "Ticket survives a failed attachment",
        description: "Verifies BR-25: an attachment failure never rolls back ticket creation.",
        requestedPriority: "LOW",
      });
    const ticketId = createRes.body.id as number;

    const attachRes = await a
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("not really a docx"), {
        filename: "notes.docx",
        contentType: "application/msword",
      });

    expect(attachRes.status).toBe(400);

    const stillExists = await getPrisma().ticket.findUnique({ where: { id: ticketId } });
    expect(stillExists?.ticketNumber).toBe(createRes.body.ticketNumber);
  });
});
