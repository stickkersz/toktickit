import type { ActionStatus } from "@prisma/client";
import type { FieldValidationResult } from "./validation.js";
import { isValidId } from "./ids.js";

// BR-03, BR-04, BR-10, BR-11: lengths after trimming.
export const ACTION_LIMITS = {
  description: [5, 2000],
  result: [5, 2000],
  followUpNote: [5, 1000],
  attachmentNotes: 1000,
  cancelReason: [5, 500],
} as const;

const DAY = 24 * 60 * 60 * 1000;
// BR-05: how far ahead a Planned Action may be dated, and the clock tolerance at completion.
const MAX_AHEAD = 365 * DAY;
const COMPLETION_TOLERANCE = 2 * 60_000;

function lengthCheck(raw: unknown, [min, max]: readonly [number, number], label: string): FieldValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < min || value.length > max) return { error: `${label} must be between ${min} and ${max} characters.` };
  return { value };
}

export const validateResult = (raw: unknown) => lengthCheck(raw, ACTION_LIMITS.result, "Result");
export const validateCancelReason = (raw: unknown) => lengthCheck(raw, ACTION_LIMITS.cancelReason, "Reason");

interface DateRules {
  ticketCreatedAt: Date;
  now: Date;
}

// BR-05: an ISO date string, not before the Ticket was created, at most 365 days ahead.
export function validateActionAt(raw: unknown, { ticketCreatedAt, now }: DateRules): { value?: Date; error?: string } {
  const value = typeof raw === "string" ? new Date(raw) : null;
  if (!value || Number.isNaN(value.getTime())) return { error: "Action date/time must be a valid date and time." };
  if (value < ticketCreatedAt) return { error: "Action date/time cannot be earlier than when the Ticket was created." };
  if (value.getTime() > now.getTime() + MAX_AHEAD) return { error: "Action date/time cannot be more than 365 days ahead." };
  return { value };
}

// BR-05: a Completed Action happened no later than the moment of completion, give or take the clocks.
export function validateCompletionAt(actionAt: Date, now: Date): boolean {
  return actionAt.getTime() <= now.getTime() + COMPLETION_TOLERANCE;
}

// BR-09: the only moves; Completed and Cancelled are final.
export function canMoveAction(from: ActionStatus, to: ActionStatus): boolean {
  return from === "PLANNED" && (to === "COMPLETED" || to === "CANCELLED");
}

export interface ActionFields {
  description?: string;
  actionAt?: Date;
  responsibleStaffId?: number;
  followUpRequired?: boolean;
  followUpNote?: string | null;
  attachmentNotes?: string | null;
}

// The fields of a create (every required one checked) or, with `partial` holding the stored follow-up
// pair, of an edit (only what was sent). The Follow-Up Note follows the flag in force after the change
// (BR-04): required while it is yes, cleared while it is no. Anything not listed is never read (BR-06, BR-12).
export function validateActionFields(
  body: Record<string, unknown> | undefined,
  rules: DateRules & { partial?: { followUpRequired: boolean; followUpNote: string | null } },
): { data: ActionFields; fields: Record<string, string> } {
  const b = body ?? {};
  const edit = rules.partial !== undefined;
  const data: ActionFields = {};
  const fields: Record<string, string> = {};
  const sent = (key: string) => b[key] !== undefined;

  if (!edit || sent("description")) {
    const r = lengthCheck(b.description, ACTION_LIMITS.description, "Description");
    if (r.error) fields.description = r.error;
    else data.description = r.value;
  }
  if (!edit || sent("actionAt")) {
    const r = validateActionAt(b.actionAt, rules);
    if (r.error) fields.actionAt = r.error;
    else data.actionAt = r.value;
  }
  if (sent("responsibleStaffId")) {
    if (isValidId(b.responsibleStaffId)) data.responsibleStaffId = b.responsibleStaffId;
    else fields.responsibleStaffId = "Responsible staff must be a user id.";
  }
  if (sent("attachmentNotes")) {
    const value = typeof b.attachmentNotes === "string" ? b.attachmentNotes.trim() : null;
    if (b.attachmentNotes !== null && value === null) fields.attachmentNotes = "Attachment notes must be text.";
    else if (value !== null && value.length > ACTION_LIMITS.attachmentNotes) fields.attachmentNotes = `Attachment notes must be at most ${ACTION_LIMITS.attachmentNotes} characters.`;
    else data.attachmentNotes = value === "" ? null : value;
  }

  let flag: boolean;
  if (sent("followUpRequired")) {
    if (typeof b.followUpRequired !== "boolean") {
      fields.followUpRequired = "Follow-up required must be yes or no.";
      return { data, fields };
    }
    flag = b.followUpRequired;
    data.followUpRequired = flag;
  } else {
    flag = rules.partial?.followUpRequired ?? false;
    if (!edit) data.followUpRequired = false;
  }
  if (flag) {
    if (sent("followUpNote") || rules.partial?.followUpNote == null) {
      const r = lengthCheck(b.followUpNote, ACTION_LIMITS.followUpNote, "Follow-up note");
      if (r.error) fields.followUpNote = r.error;
      else data.followUpNote = r.value;
    }
  } else if (!edit || sent("followUpRequired")) {
    // With the flag off a stored note is already null, so a note sent alone in an edit changes nothing.
    data.followUpNote = null;
  }
  return { data, fields };
}
