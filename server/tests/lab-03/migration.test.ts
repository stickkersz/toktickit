import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import * as prismaModule from "../../src/prisma.js";
import { app } from "../../src/app.js";
import { UNUSABLE_PASSWORD_HASH } from "../../src/auth/password.js";
import { DEV_INITIAL_PASSWORD, seedUsers } from "../../prisma/seedUsers.js";
import {
  LAB3_IT_PRIORITY_BACKFILL,
  LAB3_MIGRATION,
  LEGACY_REQUESTERS,
  buildLegacyDb,
  createScratchDb,
  migrateDeploy,
  migrationSql,
  runSql,
  schemaDiff,
  ticketOwnership,
  userIds,
  type ScratchDb,
} from "./helpers.js";

// Each describe builds a throwaway database in the exact Lab 2 state holding
// real rows, applies the Lab 3 migration, and inspects the result. Nothing here
// touches the shared development database.
const SETUP_TIMEOUT = 90_000;

describe("Lab 3 migration applied to a Lab 2 database that holds rows", () => {
  let db: ScratchDb;
  let idsBefore: number[];
  let ownershipBefore: { ticketNumber: string; email: string }[];
  let ticketCountBefore: number;

  beforeAll(async () => {
    db = await buildLegacyDb();
    idsBefore = await userIds(db.client, "RequesterUser");
    ownershipBefore = await ticketOwnership(db.client, "RequesterUser");
    ticketCountBefore = Number((await db.client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Ticket"`))[0].n);
    runSql(db.url, migrationSql(LAB3_MIGRATION));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-01 / AC-34, BR-47
  it("keeps the row count and every id", async () => {
    const idsAfter = await userIds(db.client, "User");
    expect(idsBefore).toEqual(LEGACY_REQUESTERS.map((r) => r.id).sort((a, b) => a - b));
    expect(idsAfter).toEqual(idsBefore);
    await expect(db.client.$queryRawUnsafe(`SELECT 1 FROM "RequesterUser"`)).rejects.toThrow();
  });

  // MIG-02 / AC-34, BR-47
  it("leaves every existing Ticket pointing at its original requester", async () => {
    const ownershipAfter = await ticketOwnership(db.client, "User");
    expect(ownershipBefore).toHaveLength(5);
    expect(ownershipAfter).toEqual(ownershipBefore);
    const ticketCountAfter = Number((await db.client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Ticket"`))[0].n);
    expect(ticketCountAfter).toBe(ticketCountBefore);
  });

  // MIG-06 / AC-36, BR-48, BR-51
  it("gives every migrated row the REQUESTER role, the change flag, and only the unusable marker", async () => {
    const rows = await db.client.user.findMany({ orderBy: { id: "asc" } });
    expect(rows).toHaveLength(LEGACY_REQUESTERS.length);
    for (const row of rows) {
      expect(row.role).toBe("REQUESTER");
      expect(row.mustChangePassword).toBe(true);
      expect(row.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
    // isActive is untouched: a migrated row without a credential is not deactivated.
    expect(rows.map((r) => r.isActive)).toEqual(LEGACY_REQUESTERS.map((r) => r.isActive));

    const cols = await db.client.$queryRawUnsafe<{ column_name: string; is_nullable: string; column_default: string | null }[]>(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'User' AND column_name IN ('passwordHash', 'updatedAt') ORDER BY column_name`,
    );
    expect(cols).toEqual([
      { column_name: "passwordHash", is_nullable: "NO", column_default: null },
      { column_name: "updatedAt", is_nullable: "NO", column_default: null },
    ]);
  });

  // MIG-07 / AC-36, BR-51
  it("refuses every sign-in to a backfilled account, indistinguishably from an unknown email, and creates no session", async () => {
    const spy = vi.spyOn(prismaModule, "getPrisma").mockReturnValue(db.client);
    try {
      const target = LEGACY_REQUESTERS[0];
      const attempts = [DEV_INITIAL_PASSWORD, "Some!Other1pass", UNUSABLE_PASSWORD_HASH];
      const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: DEV_INITIAL_PASSWORD });
      for (const password of attempts) {
        const res = await request(app).post("/api/auth/login").send({ email: target.email, password });
        expect(res.status).toBe(401);
        expect(res.body).toEqual(unknown.body);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
      // Even the inactive legacy row is reported generically: its password never verified.
      const inactive = LEGACY_REQUESTERS.find((r) => !r.isActive)!;
      const res = await request(app).post("/api/auth/login").send({ email: inactive.email, password: DEV_INITIAL_PASSWORD });
      expect(res.body.error).toBe("INVALID_CREDENTIALS");
      expect(await db.client.session.count()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  // MIG-10 / BR-22
  it("backfills IT Priority from the Requested Priority for every Ticket that has none, and keeps one already set", async () => {
    const before = await db.client.$queryRawUnsafe<{ id: number; itPriority: string | null; requestedPriority: string }[]>(
      `SELECT id, "itPriority", "requestedPriority" FROM "Ticket" ORDER BY id`,
    );
    expect(before.filter((t) => t.itPriority === null)).toHaveLength(4);
    expect(before.find((t) => t.id === 3)).toMatchObject({ itPriority: "HIGH", requestedPriority: "LOW" });

    runSql(db.url, migrationSql(LAB3_IT_PRIORITY_BACKFILL));

    const after = await db.client.$queryRawUnsafe<{ id: number; itPriority: string; requestedPriority: string }[]>(
      `SELECT id, "itPriority", "requestedPriority" FROM "Ticket" ORDER BY id`,
    );
    expect(after).toHaveLength(5);
    for (const t of after) {
      expect(t.itPriority, `ticket ${t.id}`).toBe(t.id === 3 ? "HIGH" : t.requestedPriority);
    }
    // Requested Priority is untouched (BR-21).
    expect(after.map((t) => t.requestedPriority)).toEqual(before.map((t) => t.requestedPriority));
    // Running it again changes nothing.
    runSql(db.url, migrationSql(LAB3_IT_PRIORITY_BACKFILL));
    expect(await db.client.$queryRawUnsafe(`SELECT id, "itPriority" FROM "Ticket" ORDER BY id`)).toEqual(
      after.map(({ id, itPriority }) => ({ id, itPriority })),
    );
  }, SETUP_TIMEOUT);

  // MIG-03 / BR-48, BR-52
  it("gives every migrated row a real hash once seeded, including rows the seed does not know", async () => {
    await seedUsers(db.client);
    const rows = await db.client.user.findMany({ where: { id: { in: LEGACY_REQUESTERS.map((r) => r.id) } } });
    expect(rows).toHaveLength(LEGACY_REQUESTERS.length);
    for (const row of rows) {
      expect(row.role).toBe("REQUESTER");
      expect(row.mustChangePassword).toBe(true);
      expect(row.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
      expect(row.passwordHash).not.toBe(UNUSABLE_PASSWORD_HASH);
      expect(row.passwordHash).not.toContain(DEV_INITIAL_PASSWORD);
    }
    expect(await db.client.user.count({ where: { passwordHash: UNUSABLE_PASSWORD_HASH } })).toBe(0);
  }, SETUP_TIMEOUT);
});

describe("Lab 3 migration on an empty database", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await createScratchDb();
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-09 / AC-34, BR-47
  it("applies every migration from scratch and leaves no drift against schema.prisma", async () => {
    migrateDeploy(db.url);
    const tables = await db.client.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = tables.map((t) => t.tablename);
    expect(names).toEqual(expect.arrayContaining(["User", "Session", "PublicComment", "InternalNote", "Ticket"]));
    expect(names).not.toContain("RequesterUser");

    const diff = schemaDiff(db.url);
    expect(diff.output).toContain("This is an empty migration");
    expect(diff.exitCode).toBe(0);
  }, SETUP_TIMEOUT);
});

describe("the Development Requester endpoint", () => {
  // MIG-04 / BR-49
  it("is gone: GET /api/requesters is a 404 from the router, with or without a session", async () => {
    const anonymous = await request(app).get("/api/requesters");
    expect(anonymous.status).toBe(404);
    expect(anonymous.body).toEqual({});
  });
});
