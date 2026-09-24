import type { UserRole } from "@prisma/client";
import { unmetPasswordRules } from "./auth/password.js";

// What an Administrator may enter for a user (api-spec.md endpoints 14 to 16). Each validator
// returns either the cleaned value or one message for the field.
export interface Checked<T> {
  value?: T;
  error?: string;
}

export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const ROLES: readonly UserRole[] = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"];

// BR-40: trimmed, 2 to 120 characters.
export function validateName(raw: unknown): Checked<string> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < NAME_MIN || value.length > NAME_MAX) {
    return { error: `Name must be between ${NAME_MIN} and ${NAME_MAX} characters.` };
  }
  return { value };
}

// BR-39, BR-40: trimmed, a basic address shape, at most 254 characters, and stored lower-cased so the
// unique index compares one form. One "@", something on each side, and a dot inside the domain.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validateEmail(raw: unknown): Checked<string> {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value.length > EMAIL_MAX || !EMAIL_SHAPE.test(value)) return { error: "Enter a valid email address." };
  return { value };
}

// BR-46: exactly one of the three roles.
export function validateRole(raw: unknown): Checked<UserRole> {
  if (typeof raw === "string" && (ROLES as readonly string[]).includes(raw)) return { value: raw as UserRole };
  return { error: `Role must be one of ${ROLES.join(", ")}.` };
}

export function validateIsActive(raw: unknown): Checked<boolean> {
  if (typeof raw === "boolean") return { value: raw };
  return { error: "Active must be true or false." };
}

// BR-10: the same rules as any password. Not trimmed: it is exactly what was typed.
export function validateInitialPassword(raw: unknown): Checked<string> {
  if (typeof raw !== "string") return { error: "Initial password is required." };
  const [firstUnmet] = unmetPasswordRules(raw);
  return firstUnmet ? { error: firstUnmet } : { value: raw };
}
