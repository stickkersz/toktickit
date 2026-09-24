import { beforeAll, describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import request from "supertest";
import { app } from "../../src/app.js";
import { createUser, loginAs, signedIn, useIsolatedDatabase, TEST_PASSWORD } from "./helpers.js";

// What happens to a Ticket when its owner is deactivated or stops being IT Staff (BR-56 to
// BR-58): nothing is rewritten, the owner counts as ineligible, and the Ticket can be worked
// again once someone eligible owns it. Most tests here change the account directly in the database
// and test only the effect on Tickets; the last group changes it through the Administrator endpoints
// (API-44, API-45, API-50, API-51), which is the path a real change takes.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let staff: Session;
let staffId: number;
let requesterId: number;
let n = 0;

// Two kinds of ineligible owner: an IT Staff member who is deactivated, and one changed to Requester.
let inactiveOwnerId: number;
let demotedOwnerId: number;

async function makeTicket(status: TicketStatus, ownerId: number | null, requesterOf?: number) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-6${String(n).padStart(5, "0")}`,
      requesterId: requesterOf ?? requesterId,
      categoryId: 1,
      relatedSystemId: 1,
      summary: `Ineligible owner fixture ${n}`,
      description: "A fixture for the ineligible owner tests, long enough to be valid.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: status,
      ownerId,
    },
  });
}
const stored = (id: number) => iso.db.client.ticket.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const s = await createUser({ role: "IT_STAFF" });
  [staff, staffId] = [await signedIn(s.user), s.user.id];
  requesterId = (await createUser()).user.id;
  const a = (await createUser({ role: "IT_STAFF" })).user;
  const b = (await createUser({ role: "IT_STAFF" })).user;
  // Each was IT Staff and owned Tickets; then one was deactivated and the other re-roled.
  await iso.db.client.user.update({ where: { id: a.id }, data: { isActive: false } });
  await iso.db.client.user.update({ where: { id: b.id }, data: { role: "REQUESTER" } });
  [inactiveOwnerId, demotedOwnerId] = [a.id, b.id];
});

// The ids are only known after beforeAll has run, so each test resolves its owner lazily.
const KINDS = [
  ["a deactivated owner", "inactive"],
  ["an owner who is no longer IT Staff", "demoted"],
] as const;
const move = (id: number, body: object) => staff.patch(`/api/staff/tickets/${id}/status`).send(body);

describe.each(KINDS)("a Ticket whose owner is %s", (_label, kind) => {
  const ineligibleOwner = () => (kind === "inactive" ? inactiveOwnerId : demotedOwnerId);

  // API-46 / AC-41, BR-28, BR-58
  it("cannot move to IN_PROGRESS, RESOLVED or CLOSED until an eligible owner is set, and the status stays put", async () => {
    const ownerId = ineligibleOwner();
    for (const [from, to] of [
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "RESOLVED"],
      ["RESOLVED", "CLOSED"],
      ["REOPENED", "IN_PROGRESS"],
    ] as const) {
      const t = await makeTicket(from, ownerId);
      const res = await move(t.id, { currentStatus: to, resolutionSummary: "A valid summary for this move." });
      expect(res.status, `${from} to ${to}`).toBe(409);
      expect(res.body.error).toBe("OWNER_REQUIRED");
      expect((await stored(t.id)).currentStatus).toBe(from);
      // The owner is still recorded: nothing rewrote the Ticket (BR-56).
      expect((await stored(t.id)).ownerId).toBe(ownerId);
    }
    // A move that needs no owner is fine.
    const t = await makeTicket("IN_PROGRESS", ownerId);
    expect((await move(t.id, { currentStatus: "WAITING_FOR_REQUESTER" })).status).toBe(200);
  });

  // API-47 (this Issue's part) / AC-41, BR-58: work is never frozen by the owner's departure.
  it("still lets IT Staff change its IT Priority and make moves that need no owner", async () => {
    const ownerId = ineligibleOwner();
    const t = await makeTicket("OPEN", ownerId);
    const priority = await staff.patch(`/api/staff/tickets/${t.id}/priority`).send({ itPriority: "HIGH" });
    expect(priority.status).toBe(200);
    expect(priority.body).toMatchObject({ itPriority: "HIGH", ownerId, ownerEligible: false });

    const wait = await move(t.id, { currentStatus: "WAITING_FOR_REQUESTER" });
    expect(wait.status).toBe(200);
    expect(wait.body).toMatchObject({ currentStatus: "WAITING_FOR_REQUESTER", ownerId, ownerEligible: false });

    const cancel = await makeTicket("NEW", ownerId);
    expect((await move(cancel.id, { currentStatus: "CANCELLED" })).status).toBe(200);
  });

  // API-48 / AC-41, BR-19, BR-58
  it("can be claimed, after which it can be worked again", async () => {
    const ownerId = ineligibleOwner();
    const t = await makeTicket("OPEN", ownerId);
    const claim = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staffId });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ ownerId: staffId, ownerEligible: true });
    expect((await move(t.id, { currentStatus: "IN_PROGRESS" })).status).toBe(200);
  });

  it("can be handed to another eligible owner or unassigned", async () => {
    const ownerId = ineligibleOwner();
    const other = (await createUser({ role: "IT_STAFF" })).user.id;
    const a = await makeTicket("OPEN", ownerId);
    expect((await staff.patch(`/api/staff/tickets/${a.id}/owner`).send({ ownerId: other })).body.ownerId).toBe(other);
    const b = await makeTicket("OPEN", ownerId);
    expect((await staff.patch(`/api/staff/tickets/${b.id}/owner`).send({ ownerId: null })).body.ownerId).toBeNull();
  });
});

describe("claiming a Ticket that already has an eligible owner", () => {
  // API-48 / AC-41, BR-19
  it("is refused with ALREADY_ASSIGNED and leaves the owner alone", async () => {
    const other = (await createUser({ role: "IT_STAFF" })).user.id;
    const t = await makeTicket("OPEN", other);
    const res = await staff.patch(`/api/staff/tickets/${t.id}/owner`).send({ ownerId: staffId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_ASSIGNED");
    expect((await stored(t.id)).ownerId).toBe(other);
  });

  it("treats the same owner as eligible again once their account is reactivated, with no Ticket write", async () => {
    const back = (await createUser({ role: "IT_STAFF", isActive: false })).user.id;
    const t = await makeTicket("OPEN", back);
    expect((await move(t.id, { currentStatus: "IN_PROGRESS" })).body.error).toBe("OWNER_REQUIRED");

    await iso.db.client.user.update({ where: { id: back }, data: { isActive: true } });
    const res = await move(t.id, { currentStatus: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ownerId: back, ownerEligible: true });
  });
});

describe("an author whose role changes after writing", () => {
  // API-52 / AC-44, BR-61, BR-35: the role stored when a comment was written is the one shown,
  // and a note stays readable to current staff while its former author, now a Requester, is shut out.
  it("keeps the IT_STAFF badge on the Public Comment for the owning Requester, and shuts the former author out of the notes while other staff still read the note", async () => {
    const owner = await createUser();
    const ownerSession = await signedIn(owner.user);
    const author = await createUser({ role: "IT_STAFF" });
    const authorSession = await signedIn(author.user);
    const other = await createUser({ role: "IT_STAFF" });
    const otherSession = await signedIn(other.user);
    n += 1;
    const ticket = await iso.db.client.ticket.create({
      data: {
        ticketNumber: `TKT-2026-6${String(n).padStart(5, "0")}`,
        requesterId: owner.user.id,
        categoryId: 1,
        relatedSystemId: 1,
        summary: `Role change fixture ${n}`,
        description: "A fixture for the role change tests, long enough to be valid.",
        requestedPriority: "MEDIUM",
        itPriority: "MEDIUM",
        currentStatus: "OPEN",
      },
    });

    const comment = await authorSession.post(`/api/tickets/${ticket.id}/comments`).send({ body: "Written while I was IT Staff." });
    const note = await authorSession.post(`/api/tickets/${ticket.id}/notes`).send({ body: "Internal remark from when I was IT Staff." });
    expect([comment.status, note.status]).toEqual([201, 201]);

    // The author is now a Requester: the Administrator screen will do this, here it is done directly.
    await iso.db.client.user.update({ where: { id: author.user.id }, data: { role: "REQUESTER" } });

    const seen = await ownerSession.get(`/api/tickets/${ticket.id}/comments`);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].authorRole).toBe("IT_STAFF");
    expect(seen.body[0].body).toBe("Written while I was IT Staff.");

    // Reader's current role decides (BR-35): the former author is refused, current staff still read it.
    expect((await authorSession.get(`/api/tickets/${ticket.id}/notes`)).status).toBe(403);
    const stillThere = await otherSession.get(`/api/tickets/${ticket.id}/notes`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body).toHaveLength(1);
    expect(stillThere.body[0]).toMatchObject({ body: "Internal remark from when I was IT Staff.", authorRole: "IT_STAFF" });

    // A new comment by the same person now carries the role they hold now.
    // (They are a Requester on someone else's Ticket, so it is refused rather than mislabelled.)
    expect((await authorSession.post(`/api/tickets/${ticket.id}/comments`).send({ body: "Now I am a Requester." })).status).toBe(404);
  });
});

describe("account changes made through the Administrator endpoints", () => {
  let admin: Session;
  const setUser = (id: number, body: object) => admin.patch(`/api/admin/users/${id}`).send(body);
  const ticketRow = (id: number) => iso.db.client.ticket.findUniqueOrThrow({ where: { id } });
  const inQueue = async (id: number) => {
    const t = await ticketRow(id);
    const res = await staff.get("/api/staff/tickets").query({ search: t.summary, pageSize: 50 });
    return (res.body.tickets as { id: number }[]).find((r) => r.id === id) as Record<string, unknown> | undefined;
  };

  beforeAll(async () => {
    admin = await signedIn((await createUser({ role: "ADMINISTRATOR" })).user);
  });

  // API-44 / AC-40, BR-56, BR-57, BR-45
  it("leaves every Ticket of a deactivated owner and of a demoted owner exactly as it was, reports them ineligible, and ends both users' sessions", async () => {
    const gone = await createUser({ role: "IT_STAFF" });
    const demoted = await createUser({ role: "IT_STAFF" });
    const goneSession = await signedIn(gone.user);
    const demotedSession = await signedIn(demoted.user);
    const tickets = [
      await makeTicket("OPEN", gone.user.id),
      await makeTicket("IN_PROGRESS", gone.user.id),
      await makeTicket("WAITING_FOR_REQUESTER", demoted.user.id),
      await makeTicket("RESOLVED", demoted.user.id),
    ];
    const before = await Promise.all(tickets.map((t) => ticketRow(t.id)));
    expect((await goneSession.get("/api/staff/owners")).status).toBe(200);
    expect((await demotedSession.get("/api/staff/owners")).status).toBe(200);

    expect((await setUser(gone.user.id, { isActive: false })).status).toBe(200);
    expect((await setUser(demoted.user.id, { role: "REQUESTER" })).status).toBe(200);

    const after = await Promise.all(tickets.map((t) => ticketRow(t.id)));
    expect(after).toEqual(before); // every column, including updatedAt: not one Ticket row was written
    for (const [i, t] of tickets.entries()) {
      const row = await inQueue(t.id);
      expect(row, `Ticket ${i}`).toMatchObject({
        ownerId: before[i].ownerId,
        currentStatus: before[i].currentStatus,
        ownerEligible: false,
        ownerName: expect.any(String),
      });
      expect(row!.updatedAt).toBe(before[i].updatedAt.toISOString());
    }
    expect((await inQueue(tickets[0].id))!.ownerIsActive).toBe(false);
    expect((await inQueue(tickets[2].id))!.ownerIsActive).toBe(true);
    // Their sessions ended at once, without a logout.
    expect((await goneSession.get("/api/staff/owners")).status).toBe(401);
    expect((await demotedSession.get("/api/staff/owners")).status).toBe(401);
  });

  it("is not refused because the user still owns open Tickets", async () => {
    const owner = await createUser({ role: "IT_STAFF" });
    await makeTicket("IN_PROGRESS", owner.user.id);
    await makeTicket("OPEN", owner.user.id);
    expect((await setUser(owner.user.id, { isActive: false })).status).toBe(200);
    expect((await stored((await iso.db.client.ticket.findFirstOrThrow({ where: { ownerId: owner.user.id } })).id)).ownerId).toBe(owner.user.id);
  });

  // API-45 / AC-40, BR-57
  it("makes the same Tickets eligible again when the owner is reactivated and the other owner's role restored, with no Ticket written", async () => {
    const gone = await createUser({ role: "IT_STAFF" });
    const demoted = await createUser({ role: "IT_STAFF" });
    const tickets = [await makeTicket("OPEN", gone.user.id), await makeTicket("IN_PROGRESS", demoted.user.id)];
    await setUser(gone.user.id, { isActive: false });
    await setUser(demoted.user.id, { role: "REQUESTER" });
    const during = await Promise.all(tickets.map((t) => ticketRow(t.id)));
    expect((await inQueue(tickets[0].id))!.ownerEligible).toBe(false);
    expect((await inQueue(tickets[1].id))!.ownerEligible).toBe(false);

    expect((await setUser(gone.user.id, { isActive: true })).status).toBe(200);
    expect((await setUser(demoted.user.id, { role: "IT_STAFF" })).status).toBe(200);

    expect((await inQueue(tickets[0].id))!.ownerEligible).toBe(true);
    expect((await inQueue(tickets[1].id))!.ownerEligible).toBe(true);
    expect(await Promise.all(tickets.map((t) => ticketRow(t.id)))).toEqual(during);
    // And they can work the Ticket again straight away.
    const back = await signedIn(gone.user);
    expect((await back.patch(`/api/staff/tickets/${tickets[0].id}/status`).send({ currentStatus: "IN_PROGRESS" })).status).toBe(200);
  });

  // API-50 / AC-42, BR-60
  it("keeps a deactivated Requester's Tickets visible to staff, refuses their sign in, lets staff comment, and shows the Requester the Ticket and that comment after reactivation", async () => {
    const owner = await createUser();
    const ownerSession = await signedIn(owner.user);
    const t = await makeTicket("OPEN", null, owner.user.id);

    expect((await setUser(owner.user.id, { isActive: false })).status).toBe(200);
    expect((await ownerSession.get("/api/tickets")).status).toBe(401);

    expect(await inQueue(t.id)).toMatchObject({ requesterIsActive: false, requesterName: expect.any(String) });
    expect((await staff.get(`/api/tickets/${t.id}`)).body.requesterIsActive).toBe(false);
    const login = await request(app).post("/api/auth/login").send({ email: owner.email, password: TEST_PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error).toBe("ACCOUNT_INACTIVE");
    const posted = await staff.post(`/api/tickets/${t.id}/comments`).send({ body: "Waiting here for you." });
    expect(posted.status).toBe(201);

    expect((await setUser(owner.user.id, { isActive: true })).status).toBe(200);
    const cookie = await loginAs(owner.email, TEST_PASSWORD);
    const detail = await request(app).get(`/api/tickets/${t.id}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    const comments = await request(app).get(`/api/tickets/${t.id}/comments`).set("Cookie", cookie);
    expect(comments.body.map((c: { body: string }) => c.body)).toEqual(["Waiting here for you."]);
    expect((await inQueue(t.id))!.requesterIsActive).toBe(true);
  });

  // API-51 / AC-43, BR-55, BR-60
  it("keeps a Requester who becomes IT Staff as the requester of their Tickets, refuses them every Requester-only operation, and lets them open those Tickets as staff", async () => {
    const person = await createUser();
    const personSession = await signedIn(person.user);
    const t = await makeTicket("OPEN", null, person.user.id);
    const other = await makeTicket("OPEN", null);
    const upload = await personSession.post(`/api/tickets/${t.id}/attachments`).attach("files", Buffer.from("my file"), { filename: "mine.jpg", contentType: "image/jpeg" });
    expect(upload.status).toBe(201);
    const attachmentId = upload.body.uploaded[0].id;
    const before = await ticketRow(t.id);

    expect((await setUser(person.user.id, { role: "IT_STAFF" })).status).toBe(200);
    expect((await personSession.get("/api/tickets")).status).toBe(401); // the old session is gone
    const cookie = await loginAs(person.email, TEST_PASSWORD);
    const as = (method: "get" | "post" | "delete", url: string) => request(app)[method](url).set("Cookie", cookie);

    expect((await ticketRow(t.id)).requesterId).toBe(person.user.id);
    expect(await ticketRow(t.id)).toEqual(before);
    expect((await iso.db.client.ticket.findFirstOrThrow({ where: { ticketNumber: t.ticketNumber } })).requesterId).toBe(person.user.id);

    const refused = [
      ["own list", await as("get", "/api/tickets")],
      ["create", await as("post", "/api/tickets").send({ categoryId: 1, relatedSystemId: 1, summary: "Trying to create", description: "A description that is long enough to pass.", requestedPriority: "LOW" })],
      ["resolution indication", await as("post", `/api/tickets/${t.id}/resolution-indication`)],
      ["attachment upload", await as("post", `/api/tickets/${t.id}/attachments`).attach("files", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" })],
      ["attachment remove", await as("delete", `/api/attachments/${attachmentId}`).send({ reason: "No longer mine to remove" })],
    ] as const;
    for (const [label, res] of refused) {
      expect(res.status, label).toBe(403);
      expect(res.body.error, label).toBe("FORBIDDEN");
    }
    expect((await iso.db.client.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).isRemoved).toBe(false);

    // As staff they read any Ticket, their old ones included, and are shown as its requester.
    const own = await as("get", `/api/tickets/${t.id}`);
    expect(own.status).toBe(200);
    expect(own.body.requesterId).toBe(person.user.id);
    expect(own.body).toHaveProperty("permittedNextStatuses");
    expect((await as("get", `/api/tickets/${other.id}`)).status).toBe(200);
  });
});
