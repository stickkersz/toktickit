import { describe, expect, it } from "vitest";
import {
  ACTION_LIMITS,
  canMoveAction,
  validateActionAt,
  validateActionFields,
  validateCancelReason,
  validateCompletionAt,
  validateResult,
} from "../../src/actionValidation.js";

const ticketCreatedAt = new Date("2026-10-01T00:00:00.000Z");
const now = new Date("2026-10-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const text = (n: number) => "x".repeat(n);
const valid = { description: "Replace the LAN cable.", actionAt: "2026-10-05T02:00:00.000Z" };

describe("Action fields (BR-03, BR-04)", () => {
  // UNIT-01 / BR-03, BR-04, AC-05, AC-06
  it("accepts every text field exactly at its limits and rejects one beyond", () => {
    const at = (fields: Record<string, unknown>) => validateActionFields({ ...valid, ...fields }, { ticketCreatedAt, now });
    expect(at({ description: text(5) }).fields).toEqual({});
    expect(at({ description: text(2000) }).fields).toEqual({});
    expect(at({ description: text(4) }).fields).toHaveProperty("description");
    expect(at({ description: text(2001) }).fields).toHaveProperty("description");
    expect(at({ followUpRequired: true, followUpNote: text(5) }).fields).toEqual({});
    expect(at({ followUpRequired: true, followUpNote: text(1000) }).fields).toEqual({});
    expect(at({ followUpRequired: true, followUpNote: text(4) }).fields).toHaveProperty("followUpNote");
    expect(at({ followUpRequired: true, followUpNote: text(1001) }).fields).toHaveProperty("followUpNote");
    expect(at({ attachmentNotes: text(1000) }).fields).toEqual({});
    expect(at({ attachmentNotes: text(1001) }).fields).toHaveProperty("attachmentNotes");
    expect(validateResult(text(5)).error).toBeUndefined();
    expect(validateResult(text(2000)).error).toBeUndefined();
    expect(validateResult(text(4)).error).toBeDefined();
    expect(validateResult(text(2001)).error).toBeDefined();
    expect(validateCancelReason(text(5)).error).toBeUndefined();
    expect(validateCancelReason(text(500)).error).toBeUndefined();
    expect(validateCancelReason(text(4)).error).toBeDefined();
    expect(validateCancelReason(text(501)).error).toBeDefined();
    expect(ACTION_LIMITS).toMatchObject({ description: [5, 2000], result: [5, 2000], followUpNote: [5, 1000], attachmentNotes: 1000, cancelReason: [5, 500] });
  });

  // UNIT-01 / BR-03, BR-04, AC-05
  it("trims text, needs the Follow-Up Note only when flagged, and clears it otherwise", () => {
    const r = validateActionFields(
      { ...valid, description: "   Replace the cable.  ", attachmentNotes: "   ", followUpNote: "Ignored without the flag" },
      { ticketCreatedAt, now },
    );
    expect(r.fields).toEqual({});
    expect(r.data).toMatchObject({ description: "Replace the cable.", attachmentNotes: null, followUpRequired: false, followUpNote: null });
    // Trimming happens before the length check.
    expect(validateActionFields({ ...valid, description: "  abcd  " }, { ticketCreatedAt, now }).fields).toHaveProperty("description");
    expect(validateActionFields({ ...valid, followUpRequired: true }, { ticketCreatedAt, now }).fields).toHaveProperty("followUpNote");
    expect(validateActionFields({ ...valid, followUpRequired: "yes" }, { ticketCreatedAt, now }).fields).toHaveProperty("followUpRequired");
    expect(validateActionFields({ ...valid, responsibleStaffId: "8" }, { ticketCreatedAt, now }).fields).toHaveProperty("responsibleStaffId");
    expect(validateActionFields({ ...valid, description: undefined }, { ticketCreatedAt, now }).fields).toHaveProperty("description");
  });

  // UNIT-01 / BR-12
  it("in edit mode checks only what was sent, and the note against the stored flag", () => {
    const stored = { followUpRequired: true, followUpNote: "Check the switch port." };
    expect(validateActionFields({ attachmentNotes: "See photo." }, { ticketCreatedAt, now, partial: stored }).fields).toEqual({});
    expect(validateActionFields({ attachmentNotes: "See photo." }, { ticketCreatedAt, now, partial: stored }).data).toEqual({ attachmentNotes: "See photo." });
    // Turning the flag off clears the stored note.
    expect(validateActionFields({ followUpRequired: false }, { ticketCreatedAt, now, partial: stored }).data).toEqual({ followUpRequired: false, followUpNote: null });
    // Turning it on with no note stored or sent is refused.
    const off = { followUpRequired: false, followUpNote: null };
    expect(validateActionFields({ followUpRequired: true }, { ticketCreatedAt, now, partial: off }).fields).toHaveProperty("followUpNote");
    // A note sent while the stored flag is off is cleared, not stored.
    expect(validateActionFields({ followUpNote: "A note." }, { ticketCreatedAt, now, partial: off }).data).toEqual({ followUpNote: null });
  });
});

describe("Action Date/Time (BR-05)", () => {
  // UNIT-02 / BR-05, AC-07
  it("is not before the Ticket's creation and at most 365 days ahead", () => {
    expect(validateActionAt("2026-10-01T00:00:00.000Z", { ticketCreatedAt, now }).error).toBeUndefined();
    expect(validateActionAt("2026-09-30T23:59:59.999Z", { ticketCreatedAt, now }).error).toBeDefined();
    expect(validateActionAt(new Date(now.getTime() + 365 * DAY).toISOString(), { ticketCreatedAt, now }).error).toBeUndefined();
    expect(validateActionAt(new Date(now.getTime() + 366 * DAY).toISOString(), { ticketCreatedAt, now }).error).toBeDefined();
    expect(validateActionAt("not a date", { ticketCreatedAt, now }).error).toBeDefined();
    expect(validateActionAt(undefined, { ticketCreatedAt, now }).error).toBeDefined();
    expect(validateActionAt(1_760_000_000_000, { ticketCreatedAt, now }).error).toBeDefined();
  });

  // UNIT-02 / BR-05, AC-07
  it("may not be more than 2 minutes after the moment of completion", () => {
    expect(validateCompletionAt(new Date(now.getTime() + 2 * 60_000), now)).toBe(true);
    expect(validateCompletionAt(new Date(now.getTime() + 2 * 60_000 + 1), now)).toBe(false);
    expect(validateCompletionAt(new Date(now.getTime() - DAY), now)).toBe(true);
  });
});

describe("Action Status moves (BR-09)", () => {
  // UNIT-03 / BR-09
  it("allows only Planned to Completed and Planned to Cancelled; nothing leaves a final status", () => {
    const all = ["PLANNED", "COMPLETED", "CANCELLED"] as const;
    const allowed = all.flatMap((from) => all.filter((to) => canMoveAction(from, to)).map((to) => `${from}>${to}`));
    expect(allowed.sort()).toEqual(["PLANNED>CANCELLED", "PLANNED>COMPLETED"]);
  });
});
