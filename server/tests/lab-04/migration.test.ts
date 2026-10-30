import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  LAB2_MIGRATIONS,
  LAB3_IT_PRIORITY_BACKFILL,
  LAB3_MIGRATION,
  SERVER_DIR,
  createScratchDb,
  migrationSql,
  runSql,
  type ScratchDb,
} from "../lab-03/helpers.js";

// Each describe builds a throwaway database in the exact Lab 3 state holding real rows,
// applies the Lab 4 migration (and the down script), and inspects the result. Nothing here
// touches the shared development database.
const SETUP_TIMEOUT = 90_000;

export const LAB4_MIGRATION = "20261030090000_lab4_actions_status_history";
const DOWN_SCRIPT = path.join(SERVER_DIR, "prisma/rollback/lab-04-down.sql");

const LAB3_TABLES = ["Category", "RelatedSystem", "User", "Session", "Ticket", "Attachment", "PublicComment", "InternalNote"];
const KEYED_TABLES = ["Ticket", "PublicComment", "InternalNote"];

// Lab 3 rows in every status, with and without an owner, with Attachments (one removed),
// Public Comments, Internal Notes, and a Session. Times are fixed so a backfilled Status
// Change can be compared with the exact creation time.
async function buildLab3Db(): Promise<ScratchDb> {
  const db = await createScratchDb();
  for (const dir of [...LAB2_MIGRATIONS, LAB3_MIGRATION, LAB3_IT_PRIORITY_BACKFILL]) runSql(db.url, migrationSql(dir));
  const statuses = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
  const tickets = statuses
    .map((status, i) => {
      const id = i + 1;
      const requester = id % 2 === 0 ? 2 : 1;
      const owner = status === "NEW" || status === "CANCELLED" ? "NULL" : "3";
      const summary = status === "RESOLVED" || status === "CLOSED" ? "'Replaced the part and confirmed it works.'" : "NULL";
      const created = `'2026-09-${String(10 + id).padStart(2, "0")}T0${id}:15:00.000Z'`;
      return `(${id}, 'TKT-2026-00000${id}', ${requester}, 1, 1, 'Lab 3 ticket ${id}', 'A Lab 3 description long enough to be valid ${id}', 'LOW', 'MEDIUM', '${status}', ${owner}, ${summary}, ${created}, now())`;
    })
    .join(",\n");
  runSql(
    db.url,
    `INSERT INTO "Category" (id, name, "isActive", "createdAt") VALUES (1, 'Network', true, now());
INSERT INTO "RelatedSystem" (id, name, "isActive", "createdAt") VALUES (1, 'Staff VPN', true, now());
INSERT INTO "User" (id, name, email, "passwordHash", role, "mustChangePassword", "isActive", "createdAt", "updatedAt") VALUES
  (1, 'Requester One', 'r1@toktickit.test', 'scrypt$16384$8$1$a$b', 'REQUESTER', false, true, now(), now()),
  (2, 'Requester Two', 'r2@toktickit.test', 'scrypt$16384$8$1$a$b', 'REQUESTER', false, false, now(), now()),
  (3, 'Staff One', 's1@toktickit.test', 'scrypt$16384$8$1$a$b', 'IT_STAFF', false, true, now(), now()),
  (4, 'Admin One', 'a1@toktickit.test', 'scrypt$16384$8$1$a$b', 'ADMINISTRATOR', false, true, now(), now());
SELECT setval(pg_get_serial_sequence('"User"', 'id'), 4);
INSERT INTO "Session" (id, "tokenHash", "userId", "createdAt", "expiresAt") VALUES (1, 'hash-1', 3, now(), now() + interval '1 day');
INSERT INTO "Ticket" (id, "ticketNumber", "requesterId", "categoryId", "relatedSystemId", summary, description, "requestedPriority", "itPriority", "currentStatus", "ownerId", "resolutionSummary", "createdAt", "updatedAt") VALUES ${tickets};
SELECT setval(pg_get_serial_sequence('"Ticket"', 'id'), 8);
INSERT INTO "Attachment" (id, "ticketId", "originalFilename", "storedFilename", "mimeType", "sizeBytes", "uploadedAt", "isRemoved", "removedAt", "removalReason") VALUES
  (1, 1, 'screen.png', 'stored-1.png', 'image/png', 2048, now(), false, NULL, NULL),
  (2, 2, 'log.txt', 'stored-2.txt', 'text/plain', 512, now(), true, now(), 'Uploaded by mistake');
INSERT INTO "PublicComment" (id, "ticketId", "authorId", "authorRole", body, "createdAt") VALUES
  (1, 3, 1, 'REQUESTER', 'It still fails after a restart.', now()),
  (2, 3, 3, 'IT_STAFF', 'Looking at it now.', now());
INSERT INTO "InternalNote" (id, "ticketId", "authorId", "authorRole", body, "createdAt") VALUES (1, 3, 3, 'IT_STAFF', 'Check the proxy logs.', now());
-- The rows above use explicit ids, so each sequence is advanced past them, as it is in any database whose rows were created normally.
SELECT setval(pg_get_serial_sequence('"Session"', 'id'), 1);
SELECT setval(pg_get_serial_sequence('"Attachment"', 'id'), 2);
SELECT setval(pg_get_serial_sequence('"PublicComment"', 'id'), 2);
SELECT setval(pg_get_serial_sequence('"InternalNote"', 'id'), 1);
SELECT setval(pg_get_serial_sequence('"Category"', 'id'), 1);
SELECT setval(pg_get_serial_sequence('"RelatedSystem"', 'id'), 1);`,
  );
  return db;
}

async function snapshot(client: PrismaClient, table: string, drop: string[] = []): Promise<unknown[]> {
  const rows = await client.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(`SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY id`);
  return rows.map(({ row }) => Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k))));
}

async function snapshotAll(client: PrismaClient, drop: string[] = []): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of LAB3_TABLES) out[table] = await snapshot(client, table, drop);
  return out;
}

// Columns, indexes, constraints, and enum types of the public schema: the shape the down
// script must restore exactly.
async function catalog(client: PrismaClient) {
  return {
    tables: await client.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`),
    columns: await client.$queryRawUnsafe(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, column_name`,
    ),
    indexes: await client.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    constraints: await client.$queryRawUnsafe(
      `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
    ),
    enums: await client.$queryRawUnsafe(
      `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid ORDER BY 1, e.enumsortorder`,
    ),
  };
}

const count = async (client: PrismaClient, table: string) =>
  Number((await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`))[0].n);

describe("Lab 4 migration applied to a Lab 3 database that holds rows", () => {
  let db: ScratchDb;
  let before: Record<string, unknown[]>;
  let catalogBefore: Awaited<ReturnType<typeof catalog>>;

  beforeAll(async () => {
    db = await buildLab3Db();
    before = await snapshotAll(db.client);
    catalogBefore = await catalog(db.client);
    runSql(db.url, migrationSql(LAB4_MIGRATION));
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-01 / AC-45, BR-44
  it("keeps every Lab 3 row exactly, apart from the new nullable key columns, which are null", async () => {
    const after = await snapshotAll(db.client, ["idempotencyKey", "requestHash"]);
    for (const table of LAB3_TABLES) {
      expect(after[table], table).toHaveLength(before[table].length);
      expect(after[table], table).toEqual(before[table]);
    }
    for (const table of KEYED_TABLES) {
      const cols = await db.client.$queryRawUnsafe<{ column_name: string; is_nullable: string; column_default: string | null }[]>(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = '${table}' AND column_name IN ('idempotencyKey', 'requestHash') ORDER BY 1`,
      );
      expect(cols, table).toEqual([
        { column_name: "idempotencyKey", is_nullable: "YES", column_default: null },
        { column_name: "requestHash", is_nullable: "YES", column_default: null },
      ]);
      const filled = await db.client.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "${table}" WHERE "idempotencyKey" IS NOT NULL OR "requestHash" IS NOT NULL`,
      );
      expect(Number(filled[0].n), table).toBe(0);
    }
    expect(await count(db.client, "ActionTaken")).toBe(0);
  });

  // MIG-01 / AC-45, BR-25; MIG-03 (backfill half) / AC-24
  it("gives every Ticket exactly one Status Change: its creation as New, at its creation time, by its Requester", async () => {
    expect(await count(db.client, "StatusChange")).toBe(await count(db.client, "Ticket"));
    const rows = await db.client.$queryRawUnsafe<
      { ticketId: number; fromStatus: string | null; toStatus: string; changedById: number; resolutionSummary: string | null; same: boolean }[]
    >(
      `SELECT s."ticketId", s."fromStatus", s."toStatus", s."changedById", s."resolutionSummary",
              s."changedAt" = t."createdAt" AND s."changedById" = t."requesterId" AS same
       FROM "StatusChange" s JOIN "Ticket" t ON t.id = s."ticketId" ORDER BY s."ticketId"`,
    );
    expect(rows.map((r) => r.ticketId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of rows) {
      expect(r, `ticket ${r.ticketId}`).toMatchObject({ fromStatus: null, toStatus: "NEW", resolutionSummary: null, same: true });
    }
    // Later Lab 3 moves were never recorded and are not invented: a Ticket that is no longer New
    // has only its creation row, so its history shows the gap (BR-25).
  });

  // MIG-02 / AC-45, BR-45
  it("is undone by the down script: Lab 4 objects gone, every Lab 3 row and the schema identical to before", async () => {
    // Lab 4 rows written after the migration must not stop the down script.
    runSql(
      db.url,
      `INSERT INTO "ActionTaken" ("ticketId", "actionAt", description, "recordedById", "responsibleStaffId", "idempotencyKey", "requestHash", "updatedAt")
         VALUES (3, now(), 'Swap the LAN cable', 3, 3, '6f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44', '${"a".repeat(64)}', now());
       INSERT INTO "StatusChange" ("ticketId", "fromStatus", "toStatus", "changedById") VALUES (1, 'NEW', 'OPEN', 3);
       UPDATE "PublicComment" SET "idempotencyKey" = '7f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44', "requestHash" = '${"b".repeat(64)}' WHERE id = 1;`,
    );
    runSql(db.url, readFileSync(DOWN_SCRIPT, "utf8"));
    expect(await snapshotAll(db.client)).toEqual(before);
    expect(await catalog(db.client)).toEqual(catalogBefore);

    // The recovery path is repeatable: the migration applies again after the down script.
    runSql(db.url, migrationSql(LAB4_MIGRATION));
    expect(await count(db.client, "StatusChange")).toBe(8);
    expect(await snapshotAll(db.client, ["idempotencyKey", "requestHash"])).toEqual(before);
  }, SETUP_TIMEOUT);
});

describe("Lab 4 migration constraints", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await buildLab3Db();
    runSql(db.url, migrationSql(LAB4_MIGRATION));
  }, SETUP_TIMEOUT);
  afterAll(async () => {
    await db?.destroy();
  }, SETUP_TIMEOUT);

  // MIG-01 / BR-39, BR-44
  it("makes a key unique per creating user, lets two users hold the same key, and allows many keyless rows", async () => {
    const key = "8f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44";
    const insert = (author: number) =>
      db.client.$executeRawUnsafe(
        `INSERT INTO "PublicComment" ("ticketId", "authorId", "authorRole", body, "createdAt", "idempotencyKey", "requestHash")
         VALUES (3, ${author}, 'IT_STAFF', 'Keyed comment', now(), '${key}', '${"c".repeat(64)}')`,
      );
    await insert(3);
    await expect(insert(3)).rejects.toThrow(/23505/);
    await expect(insert(4)).resolves.toBe(1);
    await db.client.$executeRawUnsafe(
      `INSERT INTO "PublicComment" ("ticketId", "authorId", "authorRole", body, "createdAt") VALUES (3, 3, 'IT_STAFF', 'No key one', now()), (3, 3, 'IT_STAFF', 'No key two', now())`,
    );
  });
});
