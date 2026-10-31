import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isIdempotencyKey, requestHash } from "../../src/idempotency.js";

describe("Idempotency-Key and the request fingerprint (BR-39)", () => {
  // UNIT-06 / BR-39
  it("accepts a UUID of any version and case, and nothing else", () => {
    for (const key of [
      "6f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44",
      "6F1C2A7E-3B0D-4E55-9A51-2B8F0C1D7E44",
      "6f1c2a7e-3b0d-1e55-9a51-2b8f0c1d7e44",
      "018f2b5e-7c1a-7d3e-8b4f-2a9c6d1e0f37",
    ]) expect(isIdempotencyKey(key), key).toBe(true);
    for (const key of ["", "abc", "6f1c2a7e3b0d4e559a512b8f0c1d7e44", "6f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e4", " 6f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44", "g f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44", 42, null])
      expect(isIdempotencyKey(key), String(key)).toBe(false);
  });

  // UNIT-06 / BR-39, AC-40
  it("hashes to 64 lower-case hex characters, equal only for the same request", () => {
    const accepted = ["description", "actionAt", "followUpRequired"];
    const base = requestHash("/api/tickets/42/actions", { description: "Swap the cable", actionAt: "2026-10-03T02:00:00.000Z", followUpRequired: false }, accepted);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // Surrounding whitespace, key order, and fields the endpoint ignores do not change it.
    expect(requestHash("/api/tickets/42/actions", { followUpRequired: false, actionAt: " 2026-10-03T02:00:00.000Z", description: "  Swap the cable " }, accepted)).toBe(base);
    expect(requestHash("/api/tickets/42/actions", { description: "Swap the cable", actionAt: "2026-10-03T02:00:00.000Z", followUpRequired: false, recordedById: 3 }, accepted)).toBe(base);
    // Any accepted field, or the Ticket in the path, does.
    expect(requestHash("/api/tickets/42/actions", { description: "Swap the cables", actionAt: "2026-10-03T02:00:00.000Z", followUpRequired: false }, accepted)).not.toBe(base);
    expect(requestHash("/api/tickets/42/actions", { description: "Swap the cable", actionAt: "2026-10-03T02:00:00.000Z", followUpRequired: true }, accepted)).not.toBe(base);
    expect(requestHash("/api/tickets/43/actions", { description: "Swap the cable", actionAt: "2026-10-03T02:00:00.000Z", followUpRequired: false }, accepted)).not.toBe(base);
    // An absent optional field is left out, so leaving one out differs from sending it.
    expect(requestHash("/api/tickets/42/actions", { description: "Swap the cable", actionAt: "2026-10-03T02:00:00.000Z" }, accepted)).not.toBe(base);
  });

  // UNIT-06 / BR-39: the hashed text is unchanged from Issue 03, so hashes already stored still match
  it("hashes the same text as before Issue 08", () => {
    const canonical = JSON.stringify({ path: "/api/tickets", fields: { summary: "VPN fails" }, files: null });
    expect(requestHash("/api/tickets", { summary: " VPN fails " }, ["summary"])).toBe(createHash("sha256").update(canonical).digest("hex"));
  });
});
