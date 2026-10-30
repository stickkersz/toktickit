import { createHash } from "node:crypto";

// BR-39, ADR 0003: a client sends one Idempotency-Key, a UUID of any version, per form submission.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_KEY_MESSAGE = "Idempotency-Key must be a UUID.";
export const IDEMPOTENCY_KEY_REUSED_MESSAGE = "This request was already submitted with different content. Refresh and try again.";

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// The fingerprint of a request (BR-39, api-spec "Idempotency-Key"): the path with its Ticket id, every
// body field the endpoint accepts, trimmed, keys sorted, absent ones left out, and for Ticket create
// each file's original name and size in upload order. Fields the endpoint ignores are not part of it,
// so a replay is recognised by what the server would store, not by the exact bytes sent.
export function requestHash(
  path: string,
  body: Record<string, unknown> | undefined,
  accepted: readonly string[],
  files?: readonly { originalname: string; size: number }[],
): string {
  const fields: Record<string, unknown> = {};
  for (const key of [...accepted].sort()) {
    const value = body?.[key];
    if (value !== undefined) fields[key] = typeof value === "string" ? value.trim() : value;
  }
  const canonical = JSON.stringify({ path, fields, files: files?.map((f) => [f.originalname, f.size]) ?? null });
  return createHash("sha256").update(canonical).digest("hex");
}
