import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import * as prismaModule from "../../src/prisma.js";
import { app } from "../../src/app.js";
import { UNUSABLE_PASSWORD_HASH } from "../../src/auth/password.js";
import { DEV_INITIAL_PASSWORD, SEED_USERS, seedUsers } from "../../prisma/seedUsers.js";
import { buildLegacyDb, cookieFrom, createScratchDb, migrateDeploy, type ScratchDb } from "./helpers.js";

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
    await seedUsers(db.client);
    const first = await db.client.user.findMany({ orderBy: { id: "asc" } });
    await seedUsers(db.client);
    const second = await db.client.user.findMany({ orderBy: { id: "asc" } });

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
