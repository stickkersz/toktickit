import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { TicketStatus } from "@prisma/client";
import { app } from "../../src/app.js";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// Public Comments and Internal Notes (api-spec.md endpoints 11 and 12), against a throwaway
// database. Every Ticket is created fresh by the test that needs it.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let staff: Session;
let staffId: number;
let staffName: string;
let admin: Session;
let requester: Session;
let requesterId: number;
let other: Session; // a different Requester
let n = 0;

async function makeTicket(o: { status?: TicketStatus; requesterId?: number; ownerId?: number | null } = {}) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-6${String(n).padStart(5, "0")}`,
      requesterId: o.requesterId ?? requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Content fixture ${n}`,
      description: "A fixture for the comments and notes tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: o.status ?? "OPEN",
      ownerId: o.ownerId === undefined ? null : o.ownerId,
    },
  });
}

beforeAll(async () => {
  const s = await createUser({ role: "IT_STAFF" });
  await iso.db.client.user.update({ where: { id: s.user.id }, data: { name: "Somchai Staff" } });
  [staff, staffId, staffName] = [await signedIn(s.user), s.user.id, "Somchai Staff"];
  admin = await signedIn((await createUser({ role: "ADMINISTRATOR" })).user);
  const r = await createUser();
  await iso.db.client.user.update({ where: { id: r.user.id }, data: { name: "Rattana Requester" } });
  [requester, requesterId] = [await signedIn(r.user), r.user.id];
  other = await signedIn((await createUser()).user);
});

const kinds = [
  { kind: "Public Comment", path: "comments" },
  { kind: "Internal Note", path: "notes" },
] as const;

describe("Public Comments", () => {
  // API-28 / AC-27, AC-15, BR-30
  it("shows a Public Comment written by IT Staff to the owning Requester with its author, role and server time, and hides it from a different Requester with 404", async () => {
    const t = await makeTicket();
    const before = Date.now();
    const posted = await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "We are investigating the issue on your device." });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({ body: "We are investigating the issue on your device.", authorName: staffName, authorRole: "IT_STAFF" });
    expect(Object.keys(posted.body).sort()).toEqual(["authorName", "authorRole", "body", "createdAt", "id"]);
    expect(new Date(posted.body.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const read = await requester.get(`/api/tickets/${t.id}/comments`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual([posted.body]);

    const foreign = await other.get(`/api/tickets/${t.id}/comments`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("NOT_FOUND");
    expect(JSON.stringify(foreign.body)).not.toContain("investigating");
  });

  it("lists comments oldest first, whoever wrote them, and exposes neither an author email nor an author id", async () => {
    const t = await makeTicket();
    await requester.post(`/api/tickets/${t.id}/comments`).send({ body: "first from the Requester" });
    await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "second from staff" });
    await admin.post(`/api/tickets/${t.id}/comments`).send({ body: "third from the administrator" });
    const res = await staff.get(`/api/tickets/${t.id}/comments`);
    expect(res.body.map((c: { body: string }) => c.body)).toEqual(["first from the Requester", "second from staff", "third from the administrator"]);
    expect(res.body.map((c: { authorRole: string }) => c.authorRole)).toEqual(["REQUESTER", "IT_STAFF", "ADMINISTRATOR"]);
    for (const c of res.body) {
      expect(c).not.toHaveProperty("authorId");
      expect(c).not.toHaveProperty("email");
      expect(c).not.toHaveProperty("authorEmail");
    }
    expect(JSON.stringify(res.body)).not.toContain("@toktickit.test");
  });

  it("keeps each Ticket's comments to that Ticket", async () => {
    const a = await makeTicket();
    const b = await makeTicket();
    await staff.post(`/api/tickets/${a.id}/comments`).send({ body: "only on ticket A" });
    expect((await staff.get(`/api/tickets/${b.id}/comments`)).body).toEqual([]);
  });

  it("lets the owning Requester post, and stops a different Requester with 404 and nothing stored", async () => {
    const t = await makeTicket();
    const ok = await requester.post(`/api/tickets/${t.id}/comments`).send({ body: "Thank you for the update." });
    expect(ok.status).toBe(201);
    expect(ok.body.authorRole).toBe("REQUESTER");
    const foreign = await other.post(`/api/tickets/${t.id}/comments`).send({ body: "I should not be able to write here" });
    expect(foreign.status).toBe(404);
    expect(await iso.db.client.publicComment.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it("answers 404 for a Ticket that does not exist, or an id that is not a positive integer", async () => {
    for (const id of ["999999", "0", "-3", "abc", "1.5"]) {
      expect((await staff.get(`/api/tickets/${id}/comments`)).status, `GET ${id}`).toBe(404);
      expect((await staff.post(`/api/tickets/${id}/comments`).send({ body: "hello there" })).status, `POST ${id}`).toBe(404);
    }
  });

  it("refuses an anonymous caller with 401 on both operations", async () => {
    const t = await makeTicket();
    expect((await request(app).get(`/api/tickets/${t.id}/comments`)).status).toBe(401);
    expect((await request(app).post(`/api/tickets/${t.id}/comments`).send({ body: "hello there" })).status).toBe(401);
  });

  it("stops a Requester whose account is inactive from reaching their own Ticket's comments, and lets staff still read and write them (BR-38, BR-60)", async () => {
    const gone = await createUser({ isActive: true });
    const goneSession = await signedIn(gone.user);
    const t = await makeTicket({ requesterId: gone.user.id });
    await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "waiting for you" });
    await iso.db.client.user.update({ where: { id: gone.user.id }, data: { isActive: false } });
    expect((await goneSession.get(`/api/tickets/${t.id}/comments`)).status).toBe(401);
    expect((await goneSession.post(`/api/tickets/${t.id}/comments`).send({ body: "let me in" })).status).toBe(401);
    // Staff carry on regardless: the comments are waiting if the account is reactivated.
    const more = await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "still here for you" });
    expect(more.status).toBe(201);
    expect((await staff.get(`/api/tickets/${t.id}/comments`)).body).toHaveLength(2);
  });
});

describe("validation", () => {
  // API-29 / AC-28, BR-33
  it.each(kinds)("rejects an empty or whitespace-only $kind with 400 and stores nothing", async ({ path }) => {
    const t = await makeTicket();
    for (const body of ["", "   ", "\n\t  \n", undefined, null, 42]) {
      const res = await staff.post(`/api/tickets/${t.id}/${path}`).send({ body });
      expect(res.status, String(JSON.stringify(body))).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.fields?.body).toMatch(/between 2 and 2000/);
    }
    expect((await staff.post(`/api/tickets/${t.id}/${path}`).send({})).status).toBe(400);
    expect((await staff.post(`/api/tickets/${t.id}/${path}`).send("not json object")).status).toBe(400);
    expect(await iso.db.client.publicComment.count({ where: { ticketId: t.id } })).toBe(0);
    expect(await iso.db.client.internalNote.count({ where: { ticketId: t.id } })).toBe(0);
  });

  it.each(kinds)("accepts 2 and 2000 characters and rejects 1 and 2001 for a $kind, storing the trimmed value", async ({ path }) => {
    const t = await makeTicket();
    const post = (body: string) => staff.post(`/api/tickets/${t.id}/${path}`).send({ body });
    expect((await post("a")).status).toBe(400);
    expect((await post(`  ${"x".repeat(2001)}  `)).status).toBe(400);
    const two = await post("  ok  ");
    expect(two.status).toBe(201);
    expect(two.body.body).toBe("ok");
    expect((await post("y".repeat(2000))).status).toBe(201);
  });

  it("checks the request before the Ticket, as endpoint 10 does: a bad body is a 400 even for a Ticket that does not exist", async () => {
    for (const path of ["comments", "notes"]) {
      const bad = await staff.post(`/api/tickets/999999/${path}`).send({ body: "" });
      expect(bad.status, path).toBe(400);
      expect(bad.body.error).toBe("VALIDATION_ERROR");
      expect((await staff.post(`/api/tickets/999999/${path}`).send({ body: "a fine body" })).status, path).toBe(404);
    }
  });

  it("keeps markup as the literal text it was typed as, so the client can render it as text (BR-36)", async () => {
    const t = await makeTicket();
    const body = `<img src=x onerror="alert(1)"> & <script>alert(2)</script>`;
    const posted = await staff.post(`/api/tickets/${t.id}/comments`).send({ body });
    expect(posted.status).toBe(201);
    expect((await staff.get(`/api/tickets/${t.id}/comments`)).body[0].body).toBe(body);
  });
});

describe("what the server decides", () => {
  // API-30 / BR-32
  it.each(kinds)("ignores a client-supplied author, role and createdAt on a $kind and uses the session and the server clock", async ({ path }) => {
    const t = await makeTicket();
    const res = await staff.post(`/api/tickets/${t.id}/${path}`).send({
      body: "trying to forge the author",
      authorId: requesterId, // a real user who is not the caller
      authorName: "Someone Else",
      authorRole: "ADMINISTRATOR",
      createdAt: "2001-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(201);
    expect(res.body.authorName).toBe(staffName);
    expect(res.body.authorRole).toBe("IT_STAFF");
    expect(new Date(res.body.createdAt).getFullYear()).toBeGreaterThan(2020);
    const row = path === "comments" ? await iso.db.client.publicComment.findFirstOrThrow({ where: { ticketId: t.id } }) : await iso.db.client.internalNote.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(row.authorId).toBe(staffId);
    expect(row.authorRole).toBe("IT_STAFF");
  });

  // API-31 / BR-34
  it("refuses a Requester's comment on a CLOSED or CANCELLED Ticket with 409 TICKET_TERMINAL and lets IT Staff comment on it", async () => {
    for (const status of ["CLOSED", "CANCELLED"] as const) {
      const t = await makeTicket({ status });
      const refused = await requester.post(`/api/tickets/${t.id}/comments`).send({ body: "one more thing" });
      expect(refused.status, status).toBe(409);
      expect(refused.body.error).toBe("TICKET_TERMINAL");
      expect(await iso.db.client.publicComment.count({ where: { ticketId: t.id } })).toBe(0);
      const allowed = await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "closing note for the record" });
      expect(allowed.status, status).toBe(201);
      // The Requester can still read what is there.
      expect((await requester.get(`/api/tickets/${t.id}/comments`)).body).toHaveLength(1);
    }
  });

  it("allows a Requester's comment on every status that is not terminal", async () => {
    for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "REOPENED"] as const) {
      const t = await makeTicket({ status });
      expect((await requester.post(`/api/tickets/${t.id}/comments`).send({ body: "a reply" })).status, status).toBe(201);
    }
  });

  it("does not let a Requester's comment slip in after the Ticket has been closed, even when the two happen at the same moment", async () => {
    const t = await makeTicket({ status: "IN_PROGRESS" });
    let commentResult: request.Response | undefined;
    let pending: Promise<void> | undefined;
    // Hold the Ticket row the way a status change in flight does, start the comment, then commit the close.
    await iso.db.client.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: t.id }, data: { currentStatus: "CLOSED" } });
      pending = requester
        .post(`/api/tickets/${t.id}/comments`)
        .send({ body: "racing the close" })
        .then((r) => {
          commentResult = r;
        });
      await new Promise((r) => setTimeout(r, 400));
      expect(commentResult, "the comment must wait for the close to finish, not decide on the old status").toBeUndefined();
    });
    await pending;
    expect(commentResult!.status).toBe(409);
    expect(commentResult!.body.error).toBe("TICKET_TERMINAL");
    expect(await iso.db.client.publicComment.count({ where: { ticketId: t.id } })).toBe(0);
  });

  // API-32 / BR-31
  it.each(kinds)("has no edit or delete route for a $kind: the router answers 404", async ({ path }) => {
    const t = await makeTicket();
    const made = await staff.post(`/api/tickets/${t.id}/${path}`).send({ body: "cannot be changed later" });
    for (const url of [`/api/tickets/${t.id}/${path}/${made.body.id}`, `/api/${path}/${made.body.id}`]) {
      for (const method of ["patch", "put", "delete"] as const) {
        const res = await request(app)[method](url).set("Cookie", staff.cookie).send({ body: "edited" });
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
      }
    }
    // And the collection route takes only GET and POST.
    for (const method of ["patch", "put", "delete"] as const) {
      const res = await request(app)[method](`/api/tickets/${t.id}/${path}`).set("Cookie", staff.cookie).send({ body: "edited" });
      expect(res.status, method).toBe(404);
    }
    expect((await staff.get(`/api/tickets/${t.id}/${path}`)).body[0].body).toBe("cannot be changed later");
  });
});

describe("Internal Notes", () => {
  it("lets IT Staff and Administrators write and read notes on any Ticket, oldest first, with author and role", async () => {
    const t = await makeTicket();
    const a = await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "Checked the switch port, looks fine." });
    const b = await admin.post(`/api/tickets/${t.id}/notes`).send({ body: "Escalating to the network team." });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body).toMatchObject({ authorName: staffName, authorRole: "IT_STAFF" });
    expect(b.body.authorRole).toBe("ADMINISTRATOR");
    const read = await staff.get(`/api/tickets/${t.id}/notes`);
    expect(read.status).toBe(200);
    expect(read.body.map((x: { body: string }) => x.body)).toEqual(["Checked the switch port, looks fine.", "Escalating to the network team."]);
  });

  it("keeps notes and comments in separate lists: a note never appears among the comments the Requester reads", async () => {
    const t = await makeTicket();
    await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "SECRET internal remark" });
    await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "a public remark" });
    const asRequester = await requester.get(`/api/tickets/${t.id}/comments`);
    expect(asRequester.body.map((c: { body: string }) => c.body)).toEqual(["a public remark"]);
    expect(JSON.stringify(asRequester.body)).not.toContain("SECRET");
    const asStaff = await staff.get(`/api/tickets/${t.id}/notes`);
    expect(asStaff.body.map((c: { body: string }) => c.body)).toEqual(["SECRET internal remark"]);
  });

  it("does not leak a note through the Ticket Detail a Requester reads", async () => {
    const t = await makeTicket();
    await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "SECRET internal remark" });
    const detail = await requester.get(`/api/tickets/${t.id}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain("SECRET");
  });

  it("refuses a Requester with 403 on both operations, on their own Ticket, from the role alone and before anything is looked up", async () => {
    const t = await makeTicket();
    await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "SECRET internal remark" });
    for (const id of [t.id, 999999, "abc"]) {
      const get = await requester.get(`/api/tickets/${id}/notes`);
      const post = await requester.post(`/api/tickets/${id}/notes`).send({ body: "I am trying to write a note" });
      for (const res of [get, post]) {
        expect(res.status, String(id)).toBe(403);
        expect(res.body.error).toBe("FORBIDDEN");
      }
    }
    expect(await iso.db.client.internalNote.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it("refuses an anonymous caller with 401", async () => {
    const t = await makeTicket();
    expect((await request(app).get(`/api/tickets/${t.id}/notes`)).status).toBe(401);
    expect((await request(app).post(`/api/tickets/${t.id}/notes`).send({ body: "hello there" })).status).toBe(401);
  });

  it("answers 404 for a Ticket that does not exist", async () => {
    expect((await staff.get("/api/tickets/999999/notes")).status).toBe(404);
    expect((await staff.post("/api/tickets/999999/notes").send({ body: "hello there" })).status).toBe(404);
  });

  it("lets staff write a note on a closed Ticket", async () => {
    const t = await makeTicket({ status: "CLOSED" });
    expect((await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "post-mortem remark" })).status).toBe(201);
  });
});

describe("a Ticket whose owner has gone", () => {
  // API-56 / AC-41, BR-58
  it("still takes a Public Comment and an Internal Note when its owner is inactive or no longer IT Staff", async () => {
    const gone = await createUser({ role: "IT_STAFF", isActive: false });
    const demoted = await createUser({ role: "REQUESTER" });
    for (const ownerId of [gone.user.id, demoted.user.id]) {
      const t = await makeTicket({ status: "IN_PROGRESS", ownerId });
      const comment = await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "Following up on this Ticket." });
      const note = await staff.post(`/api/tickets/${t.id}/notes`).send({ body: "Owner left, reassigning next." });
      expect([comment.status, note.status]).toEqual([201, 201]);
    }
  });
});
