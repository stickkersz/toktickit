export interface FieldValidationResult {
  value?: string;
  error?: string;
}

// BR-13: required, trimmed, 5-120 characters.
export function validateSummary(raw: unknown): FieldValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 5 || value.length > 120) {
    return { error: "Summary must be between 5 and 120 characters." };
  }
  return { value };
}

// BR-14: required, trimmed, 20-2000 characters.
export function validateDescription(raw: unknown): FieldValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 20 || value.length > 2000) {
    return { error: "Description must be between 20 and 2000 characters." };
  }
  return { value };
}

// BR-16: one of LOW, MEDIUM, HIGH.
export const REQUESTED_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type RequestedPriority = (typeof REQUESTED_PRIORITIES)[number];

export interface PriorityValidationResult {
  value?: RequestedPriority;
  error?: string;
}

export function validateRequestedPriority(raw: unknown): PriorityValidationResult {
  if (typeof raw === "string" && (REQUESTED_PRIORITIES as readonly string[]).includes(raw)) {
    return { value: raw as RequestedPriority };
  }
  return { error: "Requested priority must be one of LOW, MEDIUM, HIGH." };
}

// BR-29: required, trimmed, 5-200 characters.
export function validateRemovalReason(raw: unknown): FieldValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 5 || value.length > 200) {
    return { error: "Reason must be between 5 and 200 characters." };
  }
  return { value };
}
