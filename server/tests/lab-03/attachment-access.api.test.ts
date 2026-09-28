import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { UPLOAD_DIR } from "../../src/attachmentStorage.js";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// BR-54, BR-55: reading an Attachment is separate from changing one. IT Staff and
// Administrators may read and download on any Ticket (API-41), and get 403 from the role
// alone, before any lookup and before multer touches the disk, when they try to add or
// remove one (API-42, API-43).
useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let requester: Session;
let staff: Session;
let admin: Session;
let ticketId: number;
let attachmentId: number;

// Test files run in parallel and share the upload directory, so counting its files
// is racy. The storage name keeps the original extension, so an upload given a
// unique extension can be recognised on disk whatever else is being written.
const leakedFiles = (extension: string) => readdirSync(UPLOAD_DIR).filter((f) => f.endsWith(`.${extension}`));

beforeAll(async () => {
  requester = await signedIn((await createUser()).user);
  staff = await signedIn((await createUser({ role: "IT_STAFF" })).user);
  admin = await signedIn((await createUser({ role: "ADMINISTRATOR" })).user);

  const created = await requester.post("/api/tickets").send({
    categoryId: 1,
    relatedSystemId: 1,
    summary: "A Ticket staff may look at but not change",
    description: "Its Attachments can be read by staff and never changed by them.",
    requestedPriority: "LOW",
  });
  ticketId = created.body.id;
  const upload = await requester
    .post(`/api/tickets/${ticketId}/attachments`)
    .attach("files", Buffer.from("evidence"), { filename: "evidence.jpg", contentType: "image/jpeg" });
  attachmentId = upload.body.uploaded[0].id;
});

describe.each<[string, () => Session]>([
  ["IT Staff", () => staff],
  ["an Administrator", () => admin],
])("%s adding and removing Attachments", (_who, session) => {
  // API-42 / AC-39, BR-55
  it("cannot upload: 403, no row created and no file written to disk", async () => {
    const extension = `leak${randomUUID().slice(0, 8)}`;
    const rowsBefore = await getPrisma().attachment.count({ where: { ticketId } });

    const res = await session()
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("smuggled"), { filename: `smuggled.${extension}`, contentType: "image/jpeg" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "FORBIDDEN", message: "You do not have permission to do that." });
    expect(await getPrisma().attachment.count({ where: { ticketId } })).toBe(rowsBefore);
    expect(leakedFiles(extension)).toEqual([]);
  });

  // API-43 / AC-39, BR-55
  it("cannot remove: 403 with an identical body whether or not the Attachment exists, and nothing changes", async () => {
    const existing = await session().delete(`/api/attachments/${attachmentId}`).send({ reason: "Staff must not do this" });
    const missing = await session().delete("/api/attachments/999999").send({ reason: "Staff must not do this" });

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(existing.body).toEqual(missing.body);
    const stored = await getPrisma().attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(stored.isRemoved).toBe(false);
  });

  it("is refused on the other Requester-only endpoints: creating a Ticket and listing one's own", async () => {
    for (const res of [await session().post("/api/tickets").send({}), await session().get("/api/tickets")]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    }
  });
});

// API-41 / AC-38, BR-54. Reading is open to both staff roles, on a Ticket that belongs to
// someone else, while a Requester is still held to their own.
describe.each<[string, () => Session]>([
  ["IT Staff", () => staff],
  ["an Administrator", () => admin],
])("%s reading Attachments", (_who, session) => {
  it("reads metadata and downloads the bytes of another Requester's Attachment, and sees it on the Ticket", async () => {
    const meta = await session().get(`/api/attachments/${attachmentId}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ id: attachmentId, originalFilename: "evidence.jpg", isRemoved: false });

    const download = await session().get(`/api/attachments/${attachmentId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("image/jpeg");
    expect(download.headers["content-disposition"]).toContain("evidence.jpg");
    expect(download.body.toString()).toBe("evidence");

    const detail = await session().get(`/api/tickets/${ticketId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.attachments.map((a: { id: number }) => a.id)).toContain(attachmentId);
  });

  it("still reads a removed Attachment's metadata and reason, while its download is 410 as for every role", async () => {
    const upload = await requester
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("to be removed"), { filename: "gone.jpg", contentType: "image/jpeg" });
    const goneId = upload.body.uploaded[0].id as number;
    await requester.delete(`/api/attachments/${goneId}`).send({ reason: "Uploaded by mistake, removed" });

    const meta = await session().get(`/api/attachments/${goneId}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ isRemoved: true, removalReason: "Uploaded by mistake, removed", originalFilename: "gone.jpg" });
    const download = await session().get(`/api/attachments/${goneId}/download`);
    expect(download.status).toBe(410);
    expect(download.body.error).toBe("ATTACHMENT_REMOVED");
  });

  it("gets a plain 404 for an Attachment that does not exist", async () => {
    expect((await session().get("/api/attachments/999999")).status).toBe(404);
    expect((await session().get("/api/attachments/999999/download")).status).toBe(404);
  });

  it("can read an Attachment on a Ticket whose Requester has been deactivated (BR-60)", async () => {
    const owner = await createUser();
    const ownerSession = await signedIn(owner.user);
    const t = await ownerSession.post("/api/tickets").send({
      categoryId: 1, relatedSystemId: 1, summary: "Requester later deactivated", description: "Owned by someone who is deactivated afterwards.", requestedPriority: "LOW",
    });
    const up = await ownerSession
      .post(`/api/tickets/${t.body.id}/attachments`)
      .attach("files", Buffer.from("kept"), { filename: "kept.jpg", contentType: "image/jpeg" });
    await getPrisma().user.update({ where: { id: owner.user.id }, data: { isActive: false } });

    expect((await session().get(`/api/attachments/${up.body.uploaded[0].id}`)).status).toBe(200);
    expect((await session().get(`/api/tickets/${t.body.id}`)).status).toBe(200);
    // The deactivated Requester, meanwhile, is locked out (BR-08).
    expect((await ownerSession.get(`/api/attachments/${up.body.uploaded[0].id}`)).status).toBe(401);
  });
});

describe("Attachment reads by Requesters", () => {
  it("still holds a Requester to their own Attachments", async () => {
    const stranger = await signedIn((await createUser()).user);
    expect((await stranger.get(`/api/attachments/${attachmentId}`)).status).toBe(404);
    expect((await stranger.get(`/api/attachments/${attachmentId}/download`)).status).toBe(404);
    expect((await requester.get(`/api/attachments/${attachmentId}`)).status).toBe(200);
  });

  it("answers 401 with no session", async () => {
    expect((await request(app).get(`/api/attachments/${attachmentId}`)).status).toBe(401);
  });
});

describe("the owning Requester", () => {
  it("is unaffected: uploading and removing still work", async () => {
    const upload = await requester
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("more"), { filename: "more.jpg", contentType: "image/jpeg" });
    expect(upload.status).toBe(201);
    const removal = await requester
      .delete(`/api/attachments/${upload.body.uploaded[0].id}`)
      .send({ reason: "Requester may remove their own" });
    expect(removal.status).toBe(200);
  });
});
