import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Router } from "express";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { SESSION_COOKIE } from "../../src/auth/session.js";
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

// ---------------------------------------------------------------------------
// The authorization sweep (API-09, API-10, API-12): every protected endpoint, by role.
// ---------------------------------------------------------------------------

type Method = "get" | "post" | "patch" | "delete";
type Ids = { ticket: number; attachment: number; user: number };
type Endpoint = { method: Method; path: string; url: (ids: Ids) => string; body?: object | ((ids: Ids) => object); file?: boolean };

const endpoint = (method: Method, path: string, extra: Partial<Endpoint> = {}): Endpoint => ({
  method,
  path,
  url: (ids) =>
    path
      .replace(/^\/api\/tickets\/:id/, `/api/tickets/${ids.ticket}`)
      .replace(/^\/api\/staff\/tickets\/:id/, `/api/staff/tickets/${ids.ticket}`)
      .replace(/^\/api\/attachments\/:id/, `/api/attachments/${ids.attachment}`)
      .replace(/^\/api\/admin\/users\/:id/, `/api/admin/users/${ids.user}`),
  ...extra,
});

// api-spec "Public endpoints": the only four routes that answer without a session.
const PUBLIC = ["GET /api/health", "GET /api/categories", "GET /api/related-systems", "POST /api/auth/login"];

// Bodies are valid, so a missing guard would show up as a success or a write, not as a 400.
const STAFF: Endpoint[] = [
  endpoint("get", "/api/staff/tickets"),
  endpoint("get", "/api/staff/owners"),
  endpoint("patch", "/api/staff/tickets/:id/owner", { body: (ids) => ({ ownerId: ids.user }) }),
  endpoint("patch", "/api/staff/tickets/:id/priority", { body: { itPriority: "HIGH" } }),
  endpoint("patch", "/api/staff/tickets/:id/status", { body: { currentStatus: "OPEN" } }),
  endpoint("get", "/api/tickets/:id/notes"),
  endpoint("post", "/api/tickets/:id/notes", { body: { body: "A note nobody may write" } }),
];

const ADMIN: Endpoint[] = [
  endpoint("get", "/api/admin/users"),
  endpoint("post", "/api/admin/users", {
    body: { name: "Should Not Exist", email: "should.not.exist@toktickit.test", role: "ADMINISTRATOR", initialPassword: "Str0ng!Pass" },
  }),
  endpoint("patch", "/api/admin/users/:id", { body: { role: "ADMINISTRATOR", isActive: false } }),
  endpoint("post", "/api/admin/users/:id/initial-password", { body: { initialPassword: "N3w!Initial" } }),
];

const OTHER_PROTECTED: Endpoint[] = [
  endpoint("post", "/api/auth/logout"),
  endpoint("get", "/api/auth/me"),
  endpoint("post", "/api/auth/change-password", { body: { currentPassword: "Str0ng!Pass", newPassword: "An0ther!Pass", confirmPassword: "An0ther!Pass" } }),
  endpoint("get", "/api/tickets"),
  endpoint("post", "/api/tickets", {
    body: { categoryId: 1, relatedSystemId: 1, summary: "Should not exist", description: "Nobody signed in may create this.", requestedPriority: "LOW" },
  }),
  endpoint("get", "/api/tickets/:id"),
  endpoint("post", "/api/tickets/:id/attachments", { file: true }),
  endpoint("post", "/api/tickets/:id/resolution-indication"),
  endpoint("get", "/api/attachments/:id"),
  endpoint("get", "/api/attachments/:id/download"),
  endpoint("delete", "/api/attachments/:id", { body: { reason: "Nobody may remove this" } }),
  endpoint("get", "/api/tickets/:id/comments"),
  endpoint("post", "/api/tickets/:id/comments", { body: { body: "A comment nobody may write" } }),
];

const PROTECTED = [...OTHER_PROTECTED, ...STAFF, ...ADMIN];
const key = (e: Endpoint) => `${e.method.toUpperCase()} ${e.path}`;

// Every route the running app registers, read from Express's own router stack.
function registeredRoutes(): string[] {
  const found: string[] = [];
  const walk = (stack: Router["stack"]) => {
    for (const layer of stack) {
      if (layer.route) {
        const methods = Object.keys((layer.route as unknown as { methods: Record<string, boolean> }).methods);
        for (const m of methods) found.push(`${m.toUpperCase()} ${layer.route.path}`);
      } else if ((layer.handle as unknown as { stack?: Router["stack"] }).stack) {
        walk((layer.handle as unknown as { stack: Router["stack"] }).stack);
      }
    }
  };
  walk((app as unknown as { _router: Router })._router.stack);
  return found;
}

function send(e: Endpoint, ids: Ids, cookie?: string) {
  let req = request(app)[e.method](e.url(ids));
  if (cookie) req = req.set("Cookie", cookie);
  if (e.file) return req.attach("files", Buffer.from("sweep"), { filename: "sweep.jpg", contentType: "image/jpeg" });
  if (!e.body) return req;
  return req.send(typeof e.body === "function" ? e.body(ids) : e.body);
}

// Everything a refused request could have changed, so a guard that answers correctly
// but only after writing still fails.
async function snapshot(ids: Ids) {
  const db = getPrisma();
  return {
    tickets: await db.ticket.count(),
    attachments: await db.attachment.count({ where: { isRemoved: false } }),
    comments: await db.publicComment.count(),
    notes: await db.internalNote.count(),
    users: await db.user.count(),
    ticket: await db.ticket.findUniqueOrThrow({
      where: { id: ids.ticket },
      select: { currentStatus: true, itPriority: true, ownerId: true, requesterResolutionFlaggedAt: true },
    }),
    user: await db.user.findUniqueOrThrow({
      where: { id: ids.user },
      select: { role: true, isActive: true, passwordHash: true, mustChangePassword: true },
    }),
  };
}

function expectRefusal(res: { status: number; body: Record<string, unknown> }, status: number, error: string, label: string) {
  expect(res.status, label).toBe(status);
  expect(res.body.error, label).toBe(error);
  // Only the envelope: no record, list, count, or field of any protected resource.
  expect(Object.keys(res.body).sort(), label).toEqual(["error", "message"]);
}

describe("the authorization sweep", () => {
  let ids: Ids;
  let requesterCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    const owner = (await createUser()).user;
    const staff = (await createUser({ role: "IT_STAFF" })).user;
    const target = (await createUser({ role: "IT_STAFF" })).user;
    const requester = await signedIn(owner);
    const ticket = await requester.post("/api/tickets").send({
      categoryId: 1,
      relatedSystemId: 1,
      summary: "The sweep's own Ticket",
      description: "Owned by the Requester who is then refused every staff and admin endpoint.",
      requestedPriority: "LOW",
    });
    const upload = await requester
      .post(`/api/tickets/${ticket.body.id}/attachments`)
      .attach("files", Buffer.from("sweep file"), { filename: "s.jpg", contentType: "image/jpeg" });
    ids = { ticket: ticket.body.id, attachment: upload.body.uploaded[0].id, user: target.id };
    requesterCookie = requester.cookie;
    staffCookie = (await signedIn(staff)).cookie;
  });

  it("covers every route the app registers, and nothing is public beyond the four documented ones", () => {
    const routes = registeredRoutes();
    expect(new Set(routes).size, "a route is registered twice").toBe(routes.length);
    expect([...routes].sort()).toEqual([...PUBLIC, ...PROTECTED.map(key)].sort());
  });

  // API-09 / AC-13, BR-14
  it("answers 401 on every protected endpoint with no cookie, or with a forged one, and changes nothing", async () => {
    const before = await snapshot(ids);
    for (const e of PROTECTED) {
      expectRefusal(await send(e, ids), 401, "UNAUTHENTICATED", `${key(e)} with no cookie`);
      expectRefusal(await send(e, ids, `${SESSION_COOKIE}=forged-token`), 401, "UNAUTHENTICATED", `${key(e)} with a forged cookie`);
    }
    expect(await snapshot(ids)).toEqual(before);
  });

  // API-10 / AC-12, AC-22, BR-14
  it("answers 403 to a Requester on every staff and admin endpoint, even for their own Ticket, and changes nothing", async () => {
    const before = await snapshot(ids);
    for (const e of [...STAFF, ...ADMIN]) {
      expectRefusal(await send(e, ids, requesterCookie), 403, "FORBIDDEN", `${key(e)} as a Requester`);
      // The role decides, not the record: a Ticket or user that does not exist gets the same answer.
      const missing = await send(e, { ticket: 999999, attachment: 999999, user: 999999 }, requesterCookie);
      expectRefusal(missing, 403, "FORBIDDEN", `${key(e)} as a Requester, missing record`);
    }
    expect(await snapshot(ids)).toEqual(before);
  });

  // API-12 / AC-33, BR-14
  it("answers 403 to IT Staff on every admin user endpoint, and changes nothing", async () => {
    const before = await snapshot(ids);
    for (const e of ADMIN) {
      expectRefusal(await send(e, ids, staffCookie), 403, "FORBIDDEN", `${key(e)} as IT Staff`);
      const missing = await send(e, { ...ids, user: 999999 }, staffCookie);
      expectRefusal(missing, 403, "FORBIDDEN", `${key(e)} as IT Staff, missing user`);
    }
    expect(await snapshot(ids)).toEqual(before);
  });
});
