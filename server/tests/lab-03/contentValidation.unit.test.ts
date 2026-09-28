import { describe, expect, it } from "vitest";
import { CONTENT_MAX, CONTENT_MIN, validateContentBody } from "../../src/contentValidation.js";

// UNIT-06 / BR-33: the body of a Public Comment or an Internal Note is trimmed and must be 2 to
// 2000 characters.
describe("validateContentBody", () => {
  const ok = (raw: unknown) => validateContentBody(raw).value;
  const bad = (raw: unknown) => validateContentBody(raw).error;

  it("states the limits from the spec", () => {
    expect([CONTENT_MIN, CONTENT_MAX]).toEqual([2, 2000]);
  });

  it("rejects an empty body and a whitespace-only body", () => {
    expect(bad("")).toMatch(/between 2 and 2000/);
    expect(bad("     ")).toMatch(/between 2 and 2000/);
    expect(bad("\n\t \r\n")).toMatch(/between 2 and 2000/);
  });

  it("rejects one character, and one character with padding around it", () => {
    expect(bad("a")).toBeDefined();
    expect(bad("   a   ")).toBeDefined();
  });

  it("accepts exactly 2 characters and exactly 2000 characters", () => {
    expect(ok("ok")).toBe("ok");
    expect(ok("x".repeat(2000))).toBe("x".repeat(2000));
  });

  it("rejects 2001 characters", () => {
    expect(bad("x".repeat(2001))).toBeDefined();
  });

  it("counts the trimmed length: padding does not push a 2000 character body over the limit or a 1 character body over the minimum", () => {
    expect(ok(`  ${"x".repeat(2000)}  `)).toBe("x".repeat(2000));
    expect(bad(`  ${"x".repeat(2001)}  `)).toBeDefined();
  });

  it("returns the trimmed value and keeps line breaks inside the body", () => {
    expect(ok("  first line\nsecond line  ")).toBe("first line\nsecond line");
  });

  it("rejects anything that is not a string", () => {
    for (const raw of [undefined, null, 42, true, {}, ["hello"]]) expect(bad(raw)).toBeDefined();
  });
});
