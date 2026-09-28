import type { FieldValidationResult } from "./validation.js";

// BR-33: the body of a Public Comment or an Internal Note is trimmed and must be 2 to 2000
// characters. The ceiling matches the Lab 2 Ticket description limit (L2-BR-14).
export const CONTENT_MIN = 2;
export const CONTENT_MAX = 2000;

export function validateContentBody(raw: unknown): FieldValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < CONTENT_MIN || value.length > CONTENT_MAX) {
    return { error: `Content must be between ${CONTENT_MIN} and ${CONTENT_MAX} characters.` };
  }
  return { value };
}
