import { describe, expect, it } from "vitest";
import { windowStart } from "../../src/dashboardWindow.js";

// BR-29: times are stored in UTC and shown in Asia/Bangkok (UTC+7, no daylight saving). "In the last N
// days" runs from 00:00 Bangkok on the calendar day N-1 days before today, up to now.
describe("windowStart (BR-29)", () => {
  // UNIT-05 / BR-29, AC-35
  it("starts at Bangkok midnight N-1 days before today", () => {
    // 2026-10-10 12:00 Bangkok is 05:00 UTC.
    const now = new Date("2026-10-10T05:00:00.000Z");
    // Last 7 days: 2026-10-04 00:00 Bangkok, which is 2026-10-03 17:00 UTC.
    expect(windowStart(7, now).toISOString()).toBe("2026-10-03T17:00:00.000Z");
    // Last 30 days: 2026-09-11 00:00 Bangkok.
    expect(windowStart(30, now).toISOString()).toBe("2026-09-10T17:00:00.000Z");
    // Last 1 day is today only.
    expect(windowStart(1, now).toISOString()).toBe("2026-10-09T17:00:00.000Z");
  });

  // UNIT-05 / BR-29
  it("uses the Bangkok calendar day, not the UTC one, just before and just after Bangkok midnight", () => {
    // 2026-10-10 23:59 Bangkok is still 10 October there (16:59 UTC).
    expect(windowStart(7, new Date("2026-10-10T16:59:00.000Z")).toISOString()).toBe("2026-10-03T17:00:00.000Z");
    // 2026-10-11 00:01 Bangkok is already 11 October there, though UTC still says 10 October (17:01 UTC).
    expect(windowStart(7, new Date("2026-10-10T17:01:00.000Z")).toISOString()).toBe("2026-10-04T17:00:00.000Z");
    // Exactly midnight belongs to the new day.
    expect(windowStart(1, new Date("2026-10-10T17:00:00.000Z")).toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });

  // UNIT-05 / BR-29
  it("crosses month and year ends correctly", () => {
    // 2026-11-02 09:00 Bangkok: the last 7 days start on 27 October.
    expect(windowStart(7, new Date("2026-11-02T02:00:00.000Z")).toISOString()).toBe("2026-10-26T17:00:00.000Z");
    // 2027-01-03 10:00 Bangkok: the last 30 days start on 5 December 2026.
    expect(windowStart(30, new Date("2027-01-03T03:00:00.000Z")).toISOString()).toBe("2026-12-04T17:00:00.000Z");
    // 2028-03-01 Bangkok in a leap year: the last 2 days include 29 February.
    expect(windowStart(2, new Date("2028-03-01T05:00:00.000Z")).toISOString()).toBe("2028-02-28T17:00:00.000Z");
  });
});
