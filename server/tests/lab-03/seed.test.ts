import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import * as prismaModule from "../../src/prisma.js";
import { app } from "../../src/app.js";
import { UNUSABLE_PASSWORD_HASH } from "../../src/auth/password.js";
import { seedReferenceData } from "../../prisma/seedReference.js";
import { SEED_CONTENT_COUNT, seedContent } from "../../prisma/seedContent.js";
import { SEED_TICKET_NUMBERS, seedTickets } from "../../prisma/seedTickets.js";
import { DEV_INITIAL_PASSWORD, SEED_USERS, seedUsers } from "../../prisma/seedUsers.js";
import { buildLegacyDb, cookieFrom, createScratchDb, migrateDeploy, signedIn, type ScratchDb } from "./helpers.js";

const SETUP_TIMEOUT = 90_000;

describe("seed on a fresh database", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await createScratchDb();
    migrateDeploy(db.url);
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-05 / BR-50
  it("is idempotent and produces the required active and inactive fixtures for all three roles", async () => {
    await seedReferenceData(db.client);
    await seedUsers(db.client);
    await seedTickets(db.client);
    const first = await db.client.user.findMany({ orderBy: { id: "asc" } });
    const firstTickets = await db.client.ticket.findMany({ orderBy: { id: "asc" } });
    await seedReferenceData(db.client);
    await seedUsers(db.client);
    await seedTickets(db.client);
    const second = await db.client.user.findMany({ orderBy: { id: "asc" } });
    const secondTickets = await db.client.ticket.findMany({ orderBy: { id: "asc" } });

    expect(second).toHaveLength(first.length);
    expect(second.map((u) => u.id)).toEqual(first.map((u) => u.id));
    expect(new Set(second.map((u) => u.email)).size).toBe(second.length);
    // A second run must not re-hash credentials it already issued.
    expect(second.map((u) => u.passwordHash)).toEqual(first.map((u) => u.passwordHash));

    const count = (role: string, isActive: boolean) => second.filter((u) => u.role === role && u.isActive === isActive).length;
    expect(count("REQUESTER", true)).toBe(4);
    expect(count("REQUESTER", false)).toBe(1);
    expect(count("IT_STAFF", true)).toBe(3);
    expect(count("IT_STAFF", false)).toBe(1);
    expect(count("ADMINISTRATOR", true)).toBe(1);
    expect(second).toHaveLength(SEED_USERS.length);
    // The five Requesters keep ids 1 to 5 on a fresh database (Lab 2 tests rely on it).
    expect(second.slice(0, 5).map((u) => u.id)).toEqual([1, 2, 3, 4, 5]);
    expect(second.slice(0, 5).every((u) => u.role === "REQUESTER")).toBe(true);

    // BR-50: Tickets spread across Requesters, statuses, priorities, and both assigned and
    // unassigned ownership, and a second run adds and changes nothing.
    expect(secondTickets).toHaveLength(SEED_TICKET_NUMBERS.length);
    expect(secondTickets.map((t) => t.id)).toEqual(firstTickets.map((t) => t.id));
    expect(secondTickets.map((t) => t.updatedAt)).toEqual(firstTickets.map((t) => t.updatedAt));
    expect(new Set(secondTickets.map((t) => t.ticketNumber)).size).toBe(secondTickets.length);
    expect(new Set(secondTickets.map((t) => t.requesterId)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(secondTickets.map((t) => t.currentStatus)).size).toBe(8);
    expect(new Set(secondTickets.map((t) => t.itPriority)).size).toBe(3);
    expect(secondTickets.some((t) => t.ownerId === null)).toBe(true);
    expect(secondTickets.some((t) => t.ownerId !== null)).toBe(true);
    expect(secondTickets.every((t) => t.itPriority !== null)).toBe(true);
    // The queue's markers have real rows: an inactive owner, and an inactive Requester.
    const inactive = new Set(second.filter((u) => !u.isActive).map((u) => u.id));
    expect(secondTickets.some((t) => t.ownerId !== null && inactive.has(t.ownerId))).toBe(true);
    expect(secondTickets.some((t) => inactive.has(t.requesterId))).toBe(true);
    expect(secondTickets.some((t) => t.requesterResolutionFlaggedAt !== null)).toBe(true);
  }, SETUP_TIMEOUT);

  it("never overwrites work done through the application when it runs again", async () => {
    const target = await db.client.ticket.findFirstOrThrow({ where: { ticketNumber: SEED_TICKET_NUMBERS[0] } });
    await db.client.ticket.update({ where: { id: target.id }, data: { currentStatus: "CLOSED", itPriority: "LOW" } });
    await seedTickets(db.client);
    const after = await db.client.ticket.findUniqueOrThrow({ where: { id: target.id } });
    expect(after).toMatchObject({ currentStatus: "CLOSED", itPriority: "LOW" });
  }, SETUP_TIMEOUT);
});

describe("example Public Comments and Internal Notes in the seed", () => {
  let db: ScratchDb;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    db = await createScratchDb();
    migrateDeploy(db.url);
    await seedReferenceData(db.client);
    await seedUsers(db.client);
    await seedTickets(db.client);
    await seedContent(db.client);
    spy = vi.spyOn(prismaModule, "getPrisma").mockReturnValue(db.client);
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    spy?.mockRestore();
    await db?.destroy();
  }, SETUP_TIMEOUT);

  const comments = () => db.client.publicComment.findMany({ orderBy: { id: "asc" } });
  const notes = () => db.client.internalNote.findMany({ orderBy: { id: "asc" } });

  // MIG-05 / BR-50
  it("produces example Public Comments and Internal Notes on seeded Tickets, from every role, spread over several statuses", async () => {
    const [c, n] = [await comments(), await notes()];
    expect(c.length).toBeGreaterThanOrEqual(8);
    expect(n.length).toBeGreaterThanOrEqual(6);
    expect(c.length + n.length).toBe(SEED_CONTENT_COUNT);

    const tickets = await db.client.ticket.findMany({ include: { requester: true } });
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const onTickets = new Set([...c, ...n].map((x) => x.ticketId));
    expect(onTickets.size).toBeGreaterThanOrEqual(6);
    expect(new Set([...onTickets].map((id) => byId.get(id)!.currentStatus)).size).toBeGreaterThanOrEqual(5);
    // Every role writes comments, and only staff write notes.
    expect(new Set(c.map((x) => x.authorRole))).toEqual(new Set(["REQUESTER", "IT_STAFF", "ADMINISTRATOR"]));
    expect(new Set(n.map((x) => x.authorRole))).toEqual(new Set(["IT_STAFF", "ADMINISTRATOR"]));
    // Some seeded Tickets have neither, so the empty states have rows to show.
    expect(tickets.filter((t) => t.ticketNumber.startsWith("TKT-2026-9") && !onTickets.has(t.id)).length).toBeGreaterThanOrEqual(2);
  }, SETUP_TIMEOUT);

  it("obeys the rules the application enforces: own Ticket, never after a close, 2 to 2000 characters, stored role, no future dates", async () => {
    const users = new Map((await db.client.user.findMany()).map((u) => [u.id, u]));
    const tickets = new Map((await db.client.ticket.findMany()).map((t) => [t.id, t]));
    const now = Date.now();
    for (const row of [...(await comments()), ...(await notes())]) {
      const author = users.get(row.authorId)!;
      const ticket = tickets.get(row.ticketId)!;
      expect(row.authorRole, `role of ${author.email}`).toBe(author.role);
      expect(row.body.trim(), "trimmed").toBe(row.body);
      expect(row.body.length).toBeGreaterThanOrEqual(2);
      expect(row.body.length).toBeLessThanOrEqual(2000);
      expect(row.createdAt.getTime()).toBeGreaterThan(ticket.createdAt.getTime());
      expect(row.createdAt.getTime()).toBeLessThan(now);
      // BR-34: a Requester writes only on their own Ticket, and never on a closed or cancelled one.
      if (author.role === "REQUESTER") {
        expect(ticket.requesterId, "a Requester comments on their own Ticket").toBe(author.id);
        expect(["CLOSED", "CANCELLED"]).not.toContain(ticket.currentStatus);
      }
    }
    // BR-35: notes are staff only.
    for (const note of await notes()) expect(users.get(note.authorId)!.role).not.toBe("REQUESTER");
  }, SETUP_TIMEOUT);

  it("contains nothing sensitive: no addresses, no credentials, no personal identifiers", async () => {
    for (const { body } of [...(await comments()), ...(await notes())]) {
      expect(body).not.toMatch(/@|https?:|www\./i);
      expect(body).not.toMatch(/passw|secret|token|credential|api[ -]?key/i);
      expect(body).not.toMatch(/\d{6,}/);
    }
  }, SETUP_TIMEOUT);

  it("shows the examples through the API with the right visibility: the Requester reads the comments and is refused the notes, staff read both", async () => {
    const ticket = await db.client.ticket.findFirstOrThrow({ where: { ticketNumber: "TKT-2026-900005" }, include: { requester: true } });
    await db.client.user.updateMany({ data: { mustChangePassword: false } }); // past the first-sign-in gate
    const requester = await signedIn(ticket.requester);
    const staff = await signedIn(await db.client.user.findFirstOrThrow({ where: { email: "pimchanok.somboon@toktickit.test" } }));

    const seen = await requester.get(`/api/tickets/${ticket.id}/comments`);
    expect(seen.status).toBe(200);
    expect(seen.body.map((c: { authorRole: string }) => c.authorRole)).toEqual(["IT_STAFF", "REQUESTER"]);
    expect(JSON.stringify(seen.body)).not.toContain("failing power supply");
    expect((await requester.get(`/api/tickets/${ticket.id}/notes`)).status).toBe(403);
    const internal = await staff.get(`/api/tickets/${ticket.id}/notes`);
    expect(internal.status).toBe(200);
    expect(internal.body).toHaveLength(1);
    expect((await staff.get(`/api/tickets/${ticket.id}/comments`)).body).toHaveLength(2);
  }, SETUP_TIMEOUT);

  it("adds nothing and changes nothing when the seed runs again", async () => {
    const [c, n] = [await comments(), await notes()];
    await seedContent(db.client);
    await seedContent(db.client);
    expect(await comments()).toEqual(c);
    expect(await notes()).toEqual(n);
  }, SETUP_TIMEOUT);

  it("adds each example once when several seeds start at the same moment on an empty database", async () => {
    // The race only exists while the rows are missing: each run would find them absent and add them.
    const fresh = await createScratchDb();
    try {
      migrateDeploy(fresh.url);
      await seedReferenceData(fresh.client);
      await seedUsers(fresh.client);
      await seedTickets(fresh.client);
      await Promise.all([seedContent(fresh.client), seedContent(fresh.client), seedContent(fresh.client), seedContent(fresh.client)]);
      expect((await fresh.client.publicComment.count()) + (await fresh.client.internalNote.count())).toBe(SEED_CONTENT_COUNT);
    } finally {
      await fresh.destroy();
    }
  }, SETUP_TIMEOUT);

  it("fills in only what is missing when a fresh database is seeded in two halves", async () => {
    const fresh = await createScratchDb();
    try {
      migrateDeploy(fresh.url);
      await seedReferenceData(fresh.client);
      await seedUsers(fresh.client);
      await seedTickets(fresh.client);
      await seedContent(fresh.client);
      const first = await fresh.client.publicComment.findMany({ orderBy: { id: "asc" } });
      // A row removed by hand comes back, and the rest are not duplicated.
      await fresh.client.publicComment.delete({ where: { id: first[0].id } });
      await seedContent(fresh.client);
      expect(await fresh.client.publicComment.count()).toBe(first.length);
    } finally {
      await fresh.destroy();
    }
  }, SETUP_TIMEOUT);

  it("never overwrites: an edited body stays edited, and comments and notes added through the application are left alone", async () => {
    const target = (await comments())[0];
    const note = (await notes())[0];
    await db.client.publicComment.update({ where: { id: target.id }, data: { body: "Edited after the seed ran." } });
    await db.client.internalNote.update({ where: { id: note.id }, data: { body: "Also edited after the seed ran." } });
    const ticket = await db.client.ticket.findFirstOrThrow({ where: { ticketNumber: "TKT-2026-900002" } });
    const staffUser = await db.client.user.findFirstOrThrow({ where: { email: "pimchanok.somboon@toktickit.test" } });
    const mine = await db.client.publicComment.create({ data: { ticketId: ticket.id, authorId: staffUser.id, authorRole: "IT_STAFF", body: "Added through the app." } });
    const [countC, countN] = [(await comments()).length, (await notes()).length];

    await seedContent(db.client);

    expect((await comments()).length).toBe(countC);
    expect((await notes()).length).toBe(countN);
    expect((await db.client.publicComment.findUniqueOrThrow({ where: { id: target.id } })).body).toBe("Edited after the seed ran.");
    expect((await db.client.internalNote.findUniqueOrThrow({ where: { id: note.id } })).body).toBe("Also edited after the seed ran.");
    expect(await db.client.publicComment.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ body: "Added through the app.", authorRole: "IT_STAFF" });
  }, SETUP_TIMEOUT);

  it("refuses to run before the Tickets are seeded, and says what to seed first", async () => {
    const empty = await createScratchDb();
    try {
      migrateDeploy(empty.url);
      await seedReferenceData(empty.client);
      await seedUsers(empty.client);
      await expect(seedContent(empty.client)).rejects.toThrow(/seed the Tickets first/);
      expect(await empty.client.publicComment.count()).toBe(0);
    } finally {
      await empty.destroy();
    }
  }, SETUP_TIMEOUT);
});

describe("seed after the migration of a Lab 2 database", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await buildLegacyDb();
    const { LAB3_MIGRATION, migrationSql, runSql } = await import("./helpers.js");
    runSql(db.url, migrationSql(LAB3_MIGRATION));
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-08 / AC-37, BR-52
  it("issues a working initial credential, and a later re-seed never resets a chosen password", async () => {
    const email = "kanokwan.srisuwan@toktickit.test";
    const before = await db.client.user.findUniqueOrThrow({ where: { email } });
    expect(before.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);

    await seedUsers(db.client);
    const seeded = await db.client.user.findUniqueOrThrow({ where: { email } });
    expect(seeded.id).toBe(before.id);
    expect(seeded.passwordHash).toMatch(/^scrypt\$/);

    const spy = vi.spyOn(prismaModule, "getPrisma").mockReturnValue(db.client);
    try {
      const login = await request(app).post("/api/auth/login").send({ email, password: DEV_INITIAL_PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.mustChangePassword).toBe(true);

      const changed = await request(app)
        .post("/api/auth/change-password")
        .set("Cookie", cookieFrom(login))
        .send({ currentPassword: DEV_INITIAL_PASSWORD, newPassword: "Chosen!Pass77", confirmPassword: "Chosen!Pass77" });
      expect(changed.status).toBe(200);
      const afterChange = await db.client.user.findUniqueOrThrow({ where: { email } });

      await seedUsers(db.client);
      const reseeded = await db.client.user.findUniqueOrThrow({ where: { email } });
      expect(reseeded.passwordHash).toBe(afterChange.passwordHash);
      expect(reseeded.mustChangePassword).toBe(false);

      expect((await request(app).post("/api/auth/login").send({ email, password: "Chosen!Pass77" })).status).toBe(200);
      expect((await request(app).post("/api/auth/login").send({ email, password: DEV_INITIAL_PASSWORD })).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  }, SETUP_TIMEOUT);
});
