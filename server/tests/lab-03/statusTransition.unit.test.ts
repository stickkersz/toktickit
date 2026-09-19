import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  TERMINAL_STATUSES,
  isTicketStatus,
  isTransitionPermitted,
  permittedNext,
  requiresOwner,
  validateResolutionSummary,
} from "../../src/ticketStatus.js";

// BR-25, written out independently of the implementation's own table.
const EXPECTED: Record<string, string[]> = {
  NEW: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER"],
  CLOSED: [],
  CANCELLED: [],
};

describe("isTransitionPermitted", () => {
  // UNIT-04 / BR-25, AC-23
  it("allows exactly the BR-25 pairs across every from and to status, and refuses all others", () => {
    expect(ALL_STATUSES).toHaveLength(8);
    let allowed = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = EXPECTED[from].includes(to);
        expect(isTransitionPermitted(from, to), `${from} to ${to}`).toBe(expected);
        if (expected) allowed++;
      }
    }
    // 2 + 3 + 3 + 2 + 2 + 2 permitted moves in the matrix.
    expect(allowed).toBe(14);
  });

  it("refuses a move to the current status, whatever the status", () => {
    for (const status of ALL_STATUSES) {
      expect(isTransitionPermitted(status, status), status).toBe(false);
    }
  });

  it("reports the permitted next statuses for a status", () => {
    for (const from of ALL_STATUSES) expect([...permittedNext(from)].sort()).toEqual([...EXPECTED[from]].sort());
  });

  // UNIT-05 / BR-26
  it("lets nothing leave CLOSED or CANCELLED", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["CANCELLED", "CLOSED"]);
    for (const terminal of TERMINAL_STATUSES) {
      expect(permittedNext(terminal)).toEqual([]);
      for (const to of ALL_STATUSES) expect(isTransitionPermitted(terminal, to), `${terminal} to ${to}`).toBe(false);
    }
  });

  it("never permits a way back to NEW", () => {
    for (const from of ALL_STATUSES) expect(isTransitionPermitted(from, "NEW")).toBe(false);
  });
});

describe("the owner requirement and status values", () => {
  it("requires an owner for IN_PROGRESS, RESOLVED and CLOSED and for no other status (BR-28)", () => {
    const required = ALL_STATUSES.filter(requiresOwner).sort();
    expect(required).toEqual(["CLOSED", "IN_PROGRESS", "RESOLVED"]);
  });

  it("recognises only the eight status names", () => {
    for (const status of ALL_STATUSES) expect(isTicketStatus(status)).toBe(true);
    for (const bad of ["new", "Open", "DONE", "", null, undefined, 3, {}, ["OPEN"]]) {
      expect(isTicketStatus(bad), String(bad)).toBe(false);
    }
  });
});

describe("validateResolutionSummary", () => {
  it("accepts 10 to 2000 characters after trimming, and rejects 9, whitespace and 2001", () => {
    expect(validateResolutionSummary("x".repeat(9)).error).toBeDefined();
    expect(validateResolutionSummary(" ".repeat(20)).error).toBeDefined();
    expect(validateResolutionSummary("  " + "x".repeat(9) + "  ").error).toBeDefined();
    expect(validateResolutionSummary("x".repeat(10))).toEqual({ value: "x".repeat(10) });
    expect(validateResolutionSummary("  " + "x".repeat(10) + "  ").value).toBe("x".repeat(10));
    expect(validateResolutionSummary("x".repeat(2000)).value).toHaveLength(2000);
    expect(validateResolutionSummary("x".repeat(2001)).error).toBeDefined();
    for (const bad of [undefined, null, 42, {}, []]) expect(validateResolutionSummary(bad).error).toBeDefined();
  });
});
