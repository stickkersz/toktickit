import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX,
  NAME_MAX,
  NAME_MIN,
  validateEmail,
  validateInitialPassword,
  validateIsActive,
  validateName,
  validateRole,
} from "../../src/userValidation.js";

// UNIT-07 / BR-40, BR-46, BR-10: what an Administrator may enter for a user.
describe("validateName", () => {
  it("states the limits from the spec", () => {
    expect([NAME_MIN, NAME_MAX]).toEqual([2, 120]);
  });
  it("accepts 2 and 120 characters, trimmed", () => {
    expect(validateName("Al").value).toBe("Al");
    expect(validateName("x".repeat(120)).value).toBe("x".repeat(120));
    expect(validateName("  Alex Thompson  ").value).toBe("Alex Thompson");
  });
  it("rejects empty, whitespace only, 1 character and 121 characters with a message about the range", () => {
    for (const raw of ["", "   ", "A", "  A  ", "x".repeat(121)]) expect(validateName(raw).error, JSON.stringify(raw)).toMatch(/between 2 and 120/);
  });
  it("counts the trimmed length", () => {
    expect(validateName(`  ${"x".repeat(120)}  `).value).toBe("x".repeat(120));
    expect(validateName(`  ${"x".repeat(121)}  `).error).toBeDefined();
  });
  it("rejects anything that is not a string", () => {
    for (const raw of [undefined, null, 42, true, {}, ["Alex"]]) expect(validateName(raw).error).toBeDefined();
  });
});

describe("validateEmail", () => {
  it("states the ceiling from the spec", () => expect(EMAIL_MAX).toBe(254));
  it("accepts an ordinary address, trimmed and lower-cased so it is stored and compared in one form", () => {
    expect(validateEmail("  Alex.Thompson@ToktickIT.Local ").value).toBe("alex.thompson@toktickit.local");
    expect(validateEmail("a+tag@sub.example.co.th").value).toBe("a+tag@sub.example.co.th");
  });
  it("rejects a malformed address", () => {
    for (const raw of ["", "   ", "plain", "@nolocal.com", "nodomain@", "no-dot@domain", "two@@example.com", "spa ce@example.com", "a@b c.com", "a@.com", "a@example."]) {
      expect(validateEmail(raw).error, JSON.stringify(raw)).toMatch(/valid email/i);
    }
  });
  it("accepts an address of exactly 254 characters and rejects 255", () => {
    const at = (n: number) => `${"a".repeat(n - "@example.com".length)}@example.com`;
    expect(validateEmail(at(254)).value).toBe(at(254));
    expect(validateEmail(at(255)).error).toBeDefined();
  });
  it("rejects anything that is not a string", () => {
    for (const raw of [undefined, null, 42, {}]) expect(validateEmail(raw).error).toBeDefined();
  });
});

describe("validateRole", () => {
  it("accepts each of the three roles", () => {
    for (const role of ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"]) expect(validateRole(role).value).toBe(role);
  });
  it("rejects an unknown role, a wrong case, an empty value, more than one role and a non-string", () => {
    for (const raw of ["SUPERUSER", "requester", "IT STAFF", "", ["IT_STAFF", "ADMINISTRATOR"], "IT_STAFF,ADMINISTRATOR", null, undefined, 1]) {
      expect(validateRole(raw).error, JSON.stringify(raw)).toMatch(/one of/);
    }
  });
});

describe("validateIsActive", () => {
  it("accepts true and false only", () => {
    expect(validateIsActive(true).value).toBe(true);
    expect(validateIsActive(false).value).toBe(false);
    for (const raw of ["true", 1, 0, null, undefined, {}]) expect(validateIsActive(raw).error, JSON.stringify(raw)).toBeDefined();
  });
});

describe("validateInitialPassword", () => {
  it("accepts a password that meets every BR-10 rule", () => expect(validateInitialPassword("Zen$Green7").value).toBe("Zen$Green7"));
  it("names the first unmet rule", () => {
    expect(validateInitialPassword("Sh0rt!").error).toMatch(/at least 8/);
    expect(validateInitialPassword("alllowercase1!").error).toMatch(/upper case/);
    expect(validateInitialPassword("ALLUPPERCASE1!").error).toMatch(/lower case/);
    expect(validateInitialPassword("NoNumbers!!").error).toMatch(/number/);
    expect(validateInitialPassword("NoSpecial123").error).toMatch(/special/);
    expect(validateInitialPassword(`Aa1!${"x".repeat(125)}`).error).toMatch(/at most 128/);
  });
  it("is not trimmed: the password is exactly what was typed", () => {
    expect(validateInitialPassword("  Zen$Green7  ").value).toBe("  Zen$Green7  ");
  });
  it("rejects anything that is not a string", () => {
    for (const raw of [undefined, null, 12345678, {}]) expect(validateInitialPassword(raw).error).toBeDefined();
  });
});
