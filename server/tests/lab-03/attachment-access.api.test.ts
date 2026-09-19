import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { UPLOAD_DIR } from "../../src/attachmentStorage.js";
import { getPrisma } from "../../src/prisma.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// BR-55: adding and removing Attachments are Requester-only. IT Staff and
// Administrators get 403 from the role alone, before any lookup and before multer
// touches the disk. Reads for staff (API-41) arrive with the staff Issue.
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

  it("is refused on every other Requester-only endpoint too, for now", async () => {
    for (const res of [
      await session().post("/api/tickets").send({}),
      await session().get("/api/tickets"),
      await session().get(`/api/tickets/${ticketId}`),
      await session().get(`/api/attachments/${attachmentId}`),
      await session().get(`/api/attachments/${attachmentId}/download`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    }
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
