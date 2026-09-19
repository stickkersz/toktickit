import type { TicketStatus } from "@prisma/client";

// BR-25: the permitted status transitions, and no others. This is the single source of
// truth: the API enforces it, and the API also reports the permitted next statuses to the
// client, so the client never carries a second copy of the matrix.
export const TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER"],
  CLOSED: [],
  CANCELLED: [],
};

export const ALL_STATUSES = Object.keys(TRANSITIONS) as TicketStatus[];

// BR-28: work that is formally in progress or complete is always attributable to an owner
// who can still act on it.
export const OWNER_REQUIRED_STATUSES: readonly TicketStatus[] = ["IN_PROGRESS", "RESOLVED", "CLOSED"];

// BR-29, BR-34: a Ticket in one of these can go nowhere and takes no further Requester input.
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["CLOSED", "CANCELLED"];

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && (ALL_STATUSES as string[]).includes(value);
}

export function permittedNext(from: TicketStatus): readonly TicketStatus[] {
  return TRANSITIONS[from];
}

// BR-26: a transition that is not listed, including one to the current status, is refused.
export function isTransitionPermitted(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requiresOwner(to: TicketStatus): boolean {
  return OWNER_REQUIRED_STATUSES.includes(to);
}

// BR-27: 10 to 2000 characters after trimming.
export function validateResolutionSummary(raw: unknown): { value?: string; error?: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 10 || value.length > 2000) {
    return { error: "Resolution Summary must be between 10 and 2000 characters." };
  }
  return { value };
}
