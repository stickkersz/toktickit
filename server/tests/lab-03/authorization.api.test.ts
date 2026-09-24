import { beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../src/prisma.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// Authorization by direct API call, never through the UI (BR-16). Later Issues extend
// this file for their own endpoints. Two Requesters on a throwaway database.
useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let a: Session;
let aId: number;
let b: Session;
let bId: number;
let bTicketId: number;
let bAttachmentId: number;

beforeAll(async () => {
  const ua = (await createUser()).user;
  const ub = (await createUser()).user;
  [aId, bId] = [ua.id, ub.id];
  a = await signedIn(ua);
  b = await signedIn(ub);

  const created = await b.post("/api/tickets").send({
    categoryId: 1,
    relatedSystemId: 1,
    summary: "Belongs to Requester B",
    description: "Created by B so that A can try, and fail, to reach it.",
    requestedPriority: "LOW",
  });
  bTicketId = created.body.id;
  const upload = await b
    .post(`/api/tickets/${bTicketId}/attachments`)
    .attach("files", Buffer.from("b's file"), { filename: "b.jpg", contentType: "image/jpeg" });
  bAttachmentId = upload.body.uploaded[0].id;
});

describe("the authenticated identity, not a client-supplied requesterId", () => {
  // API-13 / AC-03, BR-11
  it("uses the session for a Ticket created while the body names another Requester", async () => {
    const res = await a.post("/api/tickets").send({
      requesterId: bId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: "Created by A, claiming to be B",
      description: "The body carries B's id; the Ticket must still belong to A.",
      requestedPriority: "LOW",
    });

    expect(res.status).toBe(201);
    expect(res.body.requesterId).toBe(aId);
    const stored = await getPrisma().ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.requesterId).toBe(aId);
  });

  it("lists only the caller's Tickets when the query names another Requester", async () => {
    const res = await a.get("/api/tickets").query({ requesterId: bId });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain("Belongs to Requester B");
  });

  it("never returns another Requester's data for any endpoint, whichever field names them", async () => {
    const detail = await a.get(`/api/tickets/${bTicketId}`).query({ requesterId: bId });
    expect(detail.status).toBe(404);
    expect(detail.body.summary).toBeUndefined();

    const meta = await a.get(`/api/attachments/${bAttachmentId}`).query({ requesterId: bId });
    expect(meta.status).toBe(404);
    expect(meta.body.originalFilename).toBeUndefined();

    const download = await a.get(`/api/attachments/${bAttachmentId}/download`).query({ requesterId: bId });
    expect(download.status).toBe(404);

    const upload = await a
      .post(`/api/tickets/${bTicketId}/attachments`)
      .field("requesterId", String(bId))
      .attach("files", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
    expect(upload.status).toBe(404);

    const removal = await a
      .delete(`/api/attachments/${bAttachmentId}`)
      .send({ requesterId: bId, reason: "A pretends to be B" });
    expect(removal.status).toBe(404);
    const untouched = await getPrisma().attachment.findUniqueOrThrow({ where: { id: bAttachmentId } });
    expect(untouched.isRemoved).toBe(false);
  });
});

describe("a Requester asking for another Requester's resources", () => {
  // API-14 / AC-15, BR-15.
  it("gets 404 in every case, never 403, and the answer matches a resource that does not exist", async () => {
    const cases: [string, () => Promise<{ status: number; body: unknown }>, () => Promise<{ status: number; body: unknown }>][] = [
      ["Ticket Detail", () => a.get(`/api/tickets/${bTicketId}`), () => a.get("/api/tickets/999999")],
      ["Attachment metadata", () => a.get(`/api/attachments/${bAttachmentId}`), () => a.get("/api/attachments/999999")],
      [
        "Attachment download",
        () => a.get(`/api/attachments/${bAttachmentId}/download`),
        () => a.get("/api/attachments/999999/download"),
      ],
      [
        "Attachment removal",
        () => a.delete(`/api/attachments/${bAttachmentId}`).send({ reason: "Not mine to remove" }),
        () => a.delete("/api/attachments/999999").send({ reason: "Not mine to remove" }),
      ],
      [
        "Attachment upload",
        () =>
          a
            .post(`/api/tickets/${bTicketId}/attachments`)
            .attach("files", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" }),
        () =>
          a
            .post("/api/tickets/999999/attachments")
            .attach("files", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" }),
      ],
      [
        "Public Comments read",
        () => a.get(`/api/tickets/${bTicketId}/comments`),
        () => a.get("/api/tickets/999999/comments"),
      ],
      [
        "Public Comment post",
        () => a.post(`/api/tickets/${bTicketId}/comments`).send({ body: "Not my Ticket to comment on" }),
        () => a.post("/api/tickets/999999/comments").send({ body: "Not my Ticket to comment on" }),
      ],
    ];

    for (const [label, foreign, missing] of cases) {
      const notMine = await foreign();
      const notThere = await missing();
      expect(notMine.status, `${label} of another Requester`).toBe(404);
      expect(notThere.status, `${label} that does not exist`).toBe(404);
      // Ownership and existence stay indistinguishable (L2-BR-35).
      expect(notMine.body, label).toEqual(notThere.body);
    }
  });
});

describe("a Requester asking for Internal Notes", () => {
  // API-11 / AC-04, BR-35: 403 even on their own Ticket, with no note content and no note count.
  it("gets 403 on their own Ticket, with nothing about the notes in the body, and writes none", async () => {
    const author = (await createUser({ role: "IT_STAFF" })).user;
    const secret = "SECRET-INTERNAL-NOTE-CONTENT";
    for (const body of [secret, "a second internal note"]) {
      await getPrisma().internalNote.create({ data: { ticketId: bTicketId, authorId: author.id, authorRole: "IT_STAFF", body } });
    }
    const notesBefore = await getPrisma().internalNote.count({ where: { ticketId: bTicketId } });

    const read = await b.get(`/api/tickets/${bTicketId}/notes`);
    const write = await b.post(`/api/tickets/${bTicketId}/notes`).send({ body: "A Requester writing a note" });
    for (const res of [read, write]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
      // No note content, no note count, nothing shaped like a list.
      expect(Array.isArray(res.body)).toBe(false);
      expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
      expect(JSON.stringify(res.body)).not.toContain(secret);
      expect(JSON.stringify(res.body)).not.toMatch(/\b2\b|count|notes?\b.*\[/i);
    }
    expect(await getPrisma().internalNote.count({ where: { ticketId: bTicketId } })).toBe(notesBefore);
  });

  it("gets the same 403 for a Ticket that is not theirs or does not exist, so the refusal discloses nothing about either", async () => {
    const own = await b.get(`/api/tickets/${bTicketId}/notes`);
    for (const url of [`/api/tickets/${bTicketId}/notes`, "/api/tickets/999999/notes", "/api/tickets/abc/notes"]) {
      const res = await a.get(url);
      expect(res.status, url).toBe(403);
      expect(res.body, url).toEqual(own.body);
    }
  });
});
