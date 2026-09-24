import { beforeAll, describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import { createUser, signedIn, useIsolatedDatabase } from "./helpers.js";

// What happens to a Ticket when its owner is deactivated or stops being IT Staff (BR-56 to
// BR-58): nothing is rewritten, the owner counts as ineligible, and the Ticket can be worked
// again once someone eligible owns it. The owner's account is changed directly in the database,
// which is what the Administrator screen will do later; only the effect on Tickets is tested.
const iso = useIsolatedDatabase({ referenceData: true });

type Session = Awaited<ReturnType<typeof signedIn>>;
let staff: Session;
let staffId: number;
let requesterId: number;
let n = 0;

// Two kinds of ineligible owner: an IT Staff member who is deactivated, and one changed to Requester.
let inactiveOwnerId: number;
let demotedOwnerId: number;

async function makeTicket(status: TicketStatus, ownerId: number | null) {
  n += 1;
  return iso.db.client.ticket.create({
    data: {
      ticketNumber: `TKT-2026-6${String(n).padStart(5, "0")}`,
      requesterId,
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
