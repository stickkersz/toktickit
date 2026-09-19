import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// API-15 / AC-14: the whole Lab 2 Requester journey under a session, with no
// `requesterId` anywhere. The endpoint-by-endpoint Lab 2 tests (tests/lab-02) were
// moved to the same session fixtures; this walks the journey end to end once.
useIsolatedDatabase({ referenceData: true });

let a: Awaited<ReturnType<typeof signedIn>>;
let aId: number;

beforeAll(async () => {
  const { user } = await createUser();
  aId = user.id;
  a = await signedIn(user);
});

describe("Lab 2 Requester endpoints under an authenticated session", () => {
  it("creates, lists, opens, uploads to, downloads from and soft-removes an attachment as Lab 2 did", async () => {
    // Create
    const created = await a.post("/api/tickets").send({
      categoryId: 2,
      relatedSystemId: 3,
      summary: "Regression walk-through",
      description: "One Requester goes through every Lab 2 operation in order.",
      requestedPriority: "HIGH",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      requesterId: aId,
      categoryId: 2,
      relatedSystemId: 3,
      requestedPriority: "HIGH",
      currentStatus: "NEW",
    });
    expect(created.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{6,}$/);
    const ticketId = created.body.id as number;

    // List, with search, filter and pagination metadata
    const listed = await a.get("/api/tickets").query({ search: "Regression walk", category: 2 });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ id: ticketId, summary: "Regression walk-through", categoryName: "Hardware" });
    expect(listed.body.pagination).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });

    // Detail, empty attachments
    const detail = await a.get(`/api/tickets/${ticketId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: ticketId, requesterId: aId, attachments: [] });
    expect(detail.body.categoryName).toBe("Hardware");
    expect(detail.body.relatedSystemName).toBe("Dormitory Wi-Fi");

    // Upload
    const uploaded = await a
      .post(`/api/tickets/${ticketId}/attachments`)
      .attach("files", Buffer.from("regression bytes"), { filename: "walk.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.failed).toEqual([]);
    const attachmentId = uploaded.body.uploaded[0].id as number;

    // Metadata and download
    const meta = await a.get(`/api/attachments/${attachmentId}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toMatchObject({ id: attachmentId, originalFilename: "walk.png", isRemoved: false });
    const download = await a.get(`/api/attachments/${attachmentId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("image/png");
    expect(download.body.toString()).toBe("regression bytes");

    // Soft removal: metadata stays, bytes go
    const removed = await a.delete(`/api/attachments/${attachmentId}`).send({ reason: "Regression walk is finished" });
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ isRemoved: true, removalReason: "Regression walk is finished", originalFilename: "walk.png" });
    expect((await a.get(`/api/attachments/${attachmentId}/download`)).status).toBe(410);
    expect((await a.delete(`/api/attachments/${attachmentId}`).send({ reason: "Second attempt at it" })).status).toBe(409);

    const after = await a.get(`/api/tickets/${ticketId}`);
    expect(after.body.attachments).toHaveLength(1);
    expect(after.body.attachments[0]).toMatchObject({ id: attachmentId, isRemoved: true });
  });

  it("answers every one of those endpoints 401 with no session", async () => {
    const calls = [
      request(app).post("/api/tickets").send({}),
      request(app).get("/api/tickets"),
      request(app).get("/api/tickets/1"),
      request(app).post("/api/tickets/1/attachments"),
      request(app).get("/api/attachments/1"),
      request(app).get("/api/attachments/1/download"),
      request(app).delete("/api/attachments/1").send({ reason: "no session at all" }),
    ];
    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("UNAUTHENTICATED");
    }
  });
});
