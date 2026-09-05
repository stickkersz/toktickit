import { describe, expect, it } from "vitest";
import {
  validateSummary,
  validateDescription,
  validateRequestedPriority,
} from "../../src/validation.js";

describe("validateSummary", () => {
  it("rejects a summary under 5 characters (after trim)", () => {
    expect(validateSummary("  hi  ").error).toBeDefined();
  });

  it("rejects a summary over 120 characters", () => {
    expect(validateSummary("a".repeat(121)).error).toBeDefined();
  });

  it("accepts the 5-character boundary", () => {
    expect(validateSummary("hello").value).toBe("hello");
  });

  it("accepts the 120-character boundary", () => {
    const summary = "a".repeat(120);
    expect(validateSummary(summary).value).toBe(summary);
  });

  it("trims before validating and returns the trimmed value", () => {
    expect(validateSummary("  hello world  ").value).toBe("hello world");
  });
});

describe("validateDescription", () => {
  it("rejects a description under 20 characters (after trim)", () => {
    expect(validateDescription("too short").error).toBeDefined();
  });

  it("rejects a description over 2000 characters", () => {
    expect(validateDescription("a".repeat(2001)).error).toBeDefined();
  });

  it("accepts the 20-character boundary", () => {
    const description = "a".repeat(20);
    expect(validateDescription(description).value).toBe(description);
  });

  it("accepts the 2000-character boundary", () => {
    const description = "a".repeat(2000);
    expect(validateDescription(description).value).toBe(description);
  });
});

describe("validateRequestedPriority", () => {
  it.each(["LOW", "MEDIUM", "HIGH"])("accepts %s", (priority) => {
    expect(validateRequestedPriority(priority).value).toBe(priority);
  });

  it("rejects an unknown value", () => {
    expect(validateRequestedPriority("URGENT").error).toBeDefined();
  });

  it("rejects a missing value", () => {
    expect(validateRequestedPriority(undefined).error).toBeDefined();
  });
});
