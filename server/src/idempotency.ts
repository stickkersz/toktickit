import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Request } from "express";

// BR-39, ADR 0003: a client sends one Idempotency-Key, a UUID of any version, per form submission.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_KEY_MESSAGE = "Idempotency-Key must be a UUID.";
export const IDEMPOTENCY_KEY_REUSED_MESSAGE = "This request was already submitted with different content. Refresh and try again.";

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// The fingerprint of a request (BR-39, api-spec "Idempotency-Key"): the path with its Ticket id and every
// body field the endpoint accepts, trimmed, keys sorted, absent ones left out. Fields the endpoint ignores
// are not part of it, so a replay is recognised by what the server would store, not by the exact bytes
// sent. No create endpoint carries files (Ticket create's Attachments are uploaded afterwards), but the
// hashed text keeps its `files: null`, so hashes already stored still match.
export function requestHash(path: string, body: Record<string, unknown> | undefined, accepted: readonly string[]): string {
  const fields: Record<string, unknown> = {};
  for (const key of [...accepted].sort()) {
    const value = body?.[key];
    if (value !== undefined) fields[key] = typeof value === "string" ? value.trim() : value;
  }
  const canonical = JSON.stringify({ path, fields, files: null });
  return createHash("sha256").update(canonical).digest("hex");
}

// The key and fingerprint hash of a create request (BR-39), or the 400 message for a malformed key. The
// key is stored lower-case, as on Action create, so case alone never makes two keys.
export function readKey(req: Request, path: string, accepted: readonly string[]): { key: string | null; hash: string | null; error?: string } {
  const raw = req.get("Idempotency-Key");
  if (raw === undefined) return { key: null, hash: null };
  if (!isIdempotencyKey(raw)) return { key: null, hash: null, error: IDEMPOTENCY_KEY_MESSAGE };
  return { key: raw.toLowerCase(), hash: requestHash(path, req.body, accepted) };
}

type Keyed<T, R> = { kind: "replay"; row: T } | { kind: "reused" } | { kind: "created"; value: R };

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// A create under BR-39 for Ticket, Public Comment and Internal Note (Action create runs the same steps in
// its own handler, inside the Ticket lock). A row already stored under the key is a replay when its hash matches and a reuse when it does
// not. Two sends of one key at the same moment both pass that check; the unique constraint lets one insert
// in, and the other is then answered from the winner's row.
export async function keyedCreate<T extends { requestHash: string | null }, R>(
  key: string | null,
  hash: string | null,
  find: () => Promise<T | null>,
  create: () => Promise<R>,
): Promise<Keyed<T, R>> {
  const settle = (row: T): Keyed<T, R> => (row.requestHash === hash ? { kind: "replay", row } : { kind: "reused" });
  if (key) {
    const prior = await find();
    if (prior) return settle(prior);
  }
  try {
    return { kind: "created", value: await create() };
  } catch (e) {
    if (key && isUniqueViolation(e)) {
      const winner = await find();
      if (winner) return settle(winner);
    }
    throw e;
  }
}
