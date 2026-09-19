import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, vi } from "vitest";
import request from "supertest";
import { PrismaClient, type UserRole } from "@prisma/client";
import { app } from "../../src/app.js";
import * as prismaModule from "../../src/prisma.js";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword } from "../../src/auth/password.js";
import { requireAuth } from "../../src/middleware/requireAuth.js";
import { requireRole } from "../../src/middleware/requireRole.js";

export const SERVER_DIR = path.resolve(__dirname, "../..");
export const TEST_PASSWORD = "Str0ng!Pass";

// Unique per call, so tests never collide on the shared database and never rely
// on global row counts.
export function uniqueEmail(label = "user"): string {
  return `${label}-${randomUUID()}@toktickit.test`;
}

// Lab 3 API tests create users, and the Lab 2 suite asserts the exact list of
// active Requesters in the shared development database. Vitest runs test files in
// parallel, so cleaning up afterwards is not enough: a Lab 3 user would still be
// visible to that Lab 2 test while it runs. The rule is therefore structural:
// createUser refuses to run unless the file called useIsolatedDatabase(), which
// points every getPrisma() call at a throwaway migrated database. The shared
// database never sees a Lab 3 test user.
let isolated = false;

export interface IsolatedDatabase {
  readonly db: ScratchDb;
  // Runs the seed against the isolated database, for tests that need the fixtures.
  seed: () => Promise<void>;
}

export function useIsolatedDatabase(): IsolatedDatabase {
  let scratch: ScratchDb | undefined;
  let spy: ReturnType<typeof vi.spyOn> | undefined;

  beforeAll(async () => {
    scratch = await createScratchDb();
    migrateDeploy(scratch.url);
    spy = vi.spyOn(prismaModule, "getPrisma").mockReturnValue(scratch.client);
    isolated = true;
  }, 90_000);

  afterAll(async () => {
    isolated = false;
    spy?.mockRestore();
    await scratch?.destroy();
  }, 90_000);

  return {
    get db() {
      if (!scratch) throw new Error("useIsolatedDatabase: the database is not ready yet");
      return scratch;
    },
    seed: async () => {
      const { seedUsers } = await import("../../prisma/seedUsers.js");
      await seedUsers(scratch!.client);
    },
  };
}

export async function createUser(
  opts: {
    role?: UserRole;
    isActive?: boolean;
    mustChangePassword?: boolean;
    password?: string;
    prisma?: PrismaClient;
  } = {},
) {
  if (!opts.prisma && !isolated) {
    throw new Error("createUser needs useIsolatedDatabase() in this test file: it must never write to the shared database");
  }
  const email = uniqueEmail(opts.role?.toLowerCase() ?? "requester");
  const password = opts.password ?? TEST_PASSWORD;
  const user = await (opts.prisma ?? getPrisma()).user.create({
    data: {
      name: "Test User",
      email,
      role: opts.role ?? "REQUESTER",
      isActive: opts.isActive ?? true,
      mustChangePassword: opts.mustChangePassword ?? false,
      passwordHash: await hashPassword(password),
    },
  });
  return { user, email, password };
}

// Signs in through the real endpoint and returns the Cookie header to replay.
export async function loginAs(email: string, password: string): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return cookieFrom(res);
}

export function cookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  if (!raw?.length) throw new Error("no Set-Cookie header");
  return raw[0].split(";")[0];
}

// A tiny app that mounts the real guards on probe routes, so the middleware can
// be tested before any Lab 3 feature route exists.
export function buildProbeApp() {
  const probe = express();
  probe.use(express.json());
  probe.get("/probe/any", requireAuth, (req, res) => res.json({ id: req.user!.id }));
  probe.get("/probe/staff", requireAuth, requireRole("IT_STAFF", "ADMINISTRATOR"), (_req, res) =>
    res.json({ ok: true }),
  );
  probe.get("/probe/admin", requireAuth, requireRole("ADMINISTRATOR"), (_req, res) => res.json({ ok: true }));
  return probe;
}

// ---------------------------------------------------------------------------
// Scratch databases for the migration and seed tests. Each test file gets its
// own throwaway database, so nothing here touches the shared development data.
// ---------------------------------------------------------------------------

function baseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(SERVER_DIR, ".env");
  const match = existsSync(envFile) && readFileSync(envFile, "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!match) throw new Error("DATABASE_URL is not set and server/.env has none");
  return match[1];
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export interface ScratchDb {
  name: string;
  url: string;
  client: PrismaClient;
  destroy: () => Promise<void>;
}

export async function createScratchDb(): Promise<ScratchDb> {
  const name = `toktickit_scratch_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await getPrisma().$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = withDatabase(baseDatabaseUrl(), name);
  const client = new PrismaClient({ datasources: { db: { url } } });
  return {
    name,
    url,
    client,
    destroy: async () => {
      await client.$disconnect();
      await getPrisma().$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

function prisma(args: string[], url: string): string {
  return execFileSync("npx", ["prisma", ...args], {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function migrationSql(dir: string): string {
  return readFileSync(path.join(SERVER_DIR, "prisma/migrations", dir, "migration.sql"), "utf8");
}

export const LAB2_MIGRATIONS = ["20260809090130_init", "20260828162803_lab2_models"];
export const LAB3_MIGRATION = "20260919090000_lab3_auth_foundation";

// Runs a (possibly multi-statement) SQL script against a database.
export function runSql(url: string, sql: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), "toktickit-sql-"));
  try {
    const file = path.join(dir, "script.sql");
    writeFileSync(file, sql);
    prisma(["db", "execute", "--url", url, "--file", file], url);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Applies every migration from scratch with the real `migrate deploy`.
export function migrateDeploy(url: string): void {
  prisma(["migrate", "deploy"], url);
}

// Empty when the database matches prisma/schema.prisma exactly.
export function schemaDiff(url: string): { exitCode: number; output: string } {
  try {
    const output = prisma(
      ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code", "--script"],
      url,
    );
    return { exitCode: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { exitCode: err.status ?? 1, output: err.stdout ?? "" };
  }
}

// Legacy Lab 2 data used to prove the migration keeps identity and ownership:
// four Requesters (one inactive, two of them the fixture emails the seed knows,
// two it does not) and tickets spread across them.
export const LEGACY_REQUESTERS = [
  { id: 1, name: "Kanokwan Srisuwan", email: "kanokwan.srisuwan@toktickit.test", isActive: true },
  { id: 2, name: "Thanapon Wattana", email: "thanapon.wattana@toktickit.test", isActive: true },
  { id: 7, name: "Legacy Only Person", email: "legacy.only@example.com", isActive: true },
  { id: 9, name: "Legacy Inactive", email: "legacy.inactive@example.com", isActive: false },
];

// Builds a database in the exact Lab 2 state, holding rows, and returns it before
// the Lab 3 migration has been applied. The id sequence is advanced past the
// explicit ids, as it is in any database whose rows were created normally.
export async function buildLegacyDb(): Promise<ScratchDb> {
  const db = await createScratchDb();
  for (const dir of LAB2_MIGRATIONS) runSql(db.url, migrationSql(dir));
  const users = LEGACY_REQUESTERS.map(
    (r) => `(${r.id}, '${r.name}', '${r.email}', ${r.isActive}, now())`,
  ).join(",\n");
  const tickets = [
    [1, "TKT-2026-000001", 1],
    [2, "TKT-2026-000002", 1],
    [3, "TKT-2026-000003", 2],
    [4, "TKT-2026-000004", 7],
    [5, "TKT-2026-000005", 9],
  ]
    .map(
      ([id, no, req]) =>
        `(${id}, '${no}', ${req}, 1, 1, 'Legacy ticket ${id}', 'Legacy description long enough to be valid ${id}', 'LOW', 'NEW', now(), now())`,
    )
    .join(",\n");
  runSql(
    db.url,
    `INSERT INTO "Category" (id, name, "isActive", "createdAt") VALUES (1, 'Legacy Category', true, now());
INSERT INTO "RelatedSystem" (id, name, "isActive", "createdAt") VALUES (1, 'Legacy System', true, now());
INSERT INTO "RequesterUser" (id, name, email, "isActive", "createdAt") VALUES ${users};
SELECT setval(pg_get_serial_sequence('"RequesterUser"', 'id'), (SELECT max(id) FROM "RequesterUser"));
INSERT INTO "Ticket" (id, "ticketNumber", "requesterId", "categoryId", "relatedSystemId", summary, description, "requestedPriority", "currentStatus", "createdAt", "updatedAt") VALUES ${tickets};`,
  );
  return db;
}

export async function ticketOwnership(client: PrismaClient, table: "RequesterUser" | "User") {
  return client.$queryRawUnsafe<{ ticketNumber: string; email: string }[]>(
    `SELECT t."ticketNumber", r.email FROM "Ticket" t JOIN "${table}" r ON r.id = t."requesterId" ORDER BY t."ticketNumber"`,
  );
}

export async function userIds(client: PrismaClient, table: "RequesterUser" | "User") {
  const rows = await client.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM "${table}" ORDER BY id`);
  return rows.map((r) => r.id);
}
