import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// BR-03: scrypt from node:crypto, stored as `scrypt$N$r$p$salt$hash`. The cost
// parameters live here and nowhere else, so raising them is a one-line change:
// every stored hash carries its own parameters and keeps verifying.
const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Upper bounds on parameters read back out of a stored value, so a corrupted or
// hostile row cannot make verifyPassword allocate unbounded memory.
const MAX_N = 2 ** 17;
const MAX_R = 16;
const MAX_P = 4;
const MAX_MEM = 256 * 1024 * 1024;

// BR-51: the migration cannot compute scrypt in SQL, so it backfills this
// marker. It is not a well-formed hash, so verifyPassword never accepts it.
export const UNUSABLE_PASSWORD_HASH = "!";

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: MAX_MEM };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST.N, COST.r, COST.p);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const validParam = (v: number, max: number) => Number.isInteger(v) && v > 0 && v <= max;
  // scrypt requires N to be a power of two greater than one.
  if (!validParam(N, MAX_N) || N < 2 || (N & (N - 1)) !== 0) return null;
  if (!validParam(r, MAX_R) || !validParam(p, MAX_P)) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || key.length !== KEY_LENGTH) return null;
  return { N, r, p, salt, key };
}

// Resolves false, never throws, for any stored value that is not a well-formed
// hash, including the BR-51 marker, an empty string, and a truncated hash.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) {
    // Spend the same scrypt work as a real check, so a backfilled account is not
    // distinguishable from an unknown email by response time.
    await verifyAgainstDummy(password);
    return false;
  }
  try {
    const candidate = await derive(password, parsed.salt, parsed.N, parsed.r, parsed.p);
    return timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown, so an unknown email and a wrong
// password do the same scrypt work and the response time does not tell them
// apart (api-spec.md, POST /api/auth/login).
let dummyHash: Promise<string> | null = null;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash.then((h) => verifyPassword(password, h));
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// BR-10: one specific message per unmet rule, in a stable order.
export function unmetPasswordRules(password: string): string[] {
  const unmet: string[] = [];
  if (password.length < PASSWORD_MIN) unmet.push(`Password must be at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) unmet.push(`Password must be at most ${PASSWORD_MAX} characters.`);
  if (!/[A-Z]/.test(password)) unmet.push("Password must include at least one upper case letter.");
  if (!/[a-z]/.test(password)) unmet.push("Password must include at least one lower case letter.");
  if (!/[0-9]/.test(password)) unmet.push("Password must include at least one number.");
  if (!/[^A-Za-z0-9]/.test(password)) unmet.push("Password must include at least one special character.");
  return unmet;
}

// Field-keyed result for the change-password endpoint: `fields` is empty when
// the request is acceptable. `newPassword` reports the first unmet rule only, so
// each field carries one message; unmetPasswordRules has the full list for the
// client checklist.
export function validatePasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Record<string, string> {
  const fields: Record<string, string> = {};
  const [firstUnmet] = unmetPasswordRules(input.newPassword);
  if (firstUnmet) fields.newPassword = firstUnmet;
  else if (input.newPassword === input.currentPassword) {
    fields.newPassword = "New password must be different from the current password.";
  }
  if (input.confirmPassword !== input.newPassword) {
    fields.confirmPassword = "Password confirmation does not match.";
  }
  return fields;
}
