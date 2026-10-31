import { describe, expect, it } from "vitest";
import { formatTicketNumber } from "../../src/ticketNumber.js";

// UNIT-01 / AC-01: the Ticket Number format (tag added in the Lab 4 pre-release audit)
describe("formatTicketNumber", () => {
  it("zero-pads the sequence value to 6 digits", () => {
    expect(formatTicketNumber(2026, 42)).toBe("TKT-2026-000042");
  });

  it("does not truncate a sequence value already 6+ digits", () => {
    expect(formatTicketNumber(2026, 1234567)).toBe("TKT-2026-1234567");
  });

  it("accepts a bigint sequence value (Postgres nextval() shape)", () => {
    expect(formatTicketNumber(2026, 7n)).toBe("TKT-2026-000007");
  });
});
