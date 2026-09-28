import { describe, expect, it } from "vitest";
import {
  UNUSABLE_PASSWORD_HASH,
  hashPassword,
  unmetPasswordRules,
  validatePasswordChange,
  verifyPassword,
} from "../../src/auth/password.js";

describe("password hashing", () => {
  // UNIT-01 / BR-03
  it("verifies the right password, rejects a wrong one, and never stores plaintext", async () => {
    const hash = await hashPassword("Correct!Horse9");
    expect(hash).not.toContain("Correct!Horse9");
    expect(hash.split("$")).toHaveLength(6);
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("Correct!Horse9", hash)).toBe(true);
    expect(await verifyPassword("Correct!Horse8", hash)).toBe(false);
  });

  // UNIT-02 / BR-03
  it("uses a fresh salt for every hash, and both hashes still verify", async () => {
    const [a, b] = await Promise.all([hashPassword("Same!Password1"), hashPassword("Same!Password1")]);
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
    expect(await verifyPassword("Same!Password1", a)).toBe(true);
    expect(await verifyPassword("Same!Password1", b)).toBe(true);
  });

  // UNIT-09 / BR-51, AC-36
  it("returns false without throwing for the marker and for malformed stored values", async () => {
    const good = await hashPassword("Correct!Horse9");
    const [prefix, N, r, p, salt] = good.split("$");
    const malformed = [
      UNUSABLE_PASSWORD_HASH,
      "",
      "scrypt$16384$8$1",
      `${prefix}$${N}$${r}$${p}$${salt}$AAAA`,
      `scrypt$99999999$8$1$${salt}$${good.split("$")[5]}`,
      `scrypt$16383$8$1$${salt}$${good.split("$")[5]}`,
      "bcrypt$10$abc$def$ghi$jkl",
    ];
    for (const stored of malformed) {
      await expect(verifyPassword("Correct!Horse9", stored)).resolves.toBe(false);
    }
    // The marker cannot be satisfied even by presenting the marker itself.
    await expect(verifyPassword(UNUSABLE_PASSWORD_HASH, UNUSABLE_PASSWORD_HASH)).resolves.toBe(false);
  });
});

describe("password rules", () => {
  const valid = "Aa1!aaaa";

  // UNIT-03 / BR-10, AC-07
  it("enforces the length boundaries 7, 8, 128 and 129", () => {
    expect(unmetPasswordRules("Aa1!aaa")).toEqual(["Password must be at least 8 characters."]);
    expect(unmetPasswordRules(valid)).toEqual([]);
    expect(unmetPasswordRules("Aa1!" + "a".repeat(124))).toEqual([]);
    expect(unmetPasswordRules("Aa1!" + "a".repeat(125))).toEqual(["Password must be at most 128 characters."]);
  });

  it("reports one specific message for each unmet character rule", () => {
    expect(unmetPasswordRules("aa1!aaaa")).toEqual(["Password must include at least one upper case letter."]);
    expect(unmetPasswordRules("AA1!AAAA")).toEqual(["Password must include at least one lower case letter."]);
    expect(unmetPasswordRules("Aaa!aaaa")).toEqual(["Password must include at least one number."]);
    expect(unmetPasswordRules("Aa1aaaaa")).toEqual(["Password must include at least one special character."]);
    expect(unmetPasswordRules("aaaaaaaa")).toHaveLength(3);
  });

  it("rejects a new password equal to the current one and a mismatched confirmation", () => {
    expect(validatePasswordChange({ currentPassword: valid, newPassword: valid, confirmPassword: valid })).toEqual({
      newPassword: "New password must be different from the current password.",
    });
    expect(
      validatePasswordChange({ currentPassword: "Old!Pass123", newPassword: valid, confirmPassword: "Aa1!aaab" }),
    ).toEqual({ confirmPassword: "Password confirmation does not match." });
    expect(
      validatePasswordChange({ currentPassword: "Old!Pass123", newPassword: valid, confirmPassword: valid }),
    ).toEqual({});
  });
});
