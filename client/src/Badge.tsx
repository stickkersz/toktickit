import type { TicketPriority, UserRole } from "./api.js";
import { ROLE_LABEL } from "./roles.js";

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

const PRIORITY_CLASS: Record<TicketPriority, string> = {
  LOW: "zg-badge-low",
  MEDIUM: "zg-badge-medium",
  HIGH: "zg-badge-high",
};

// ui-spec.md §7 — Priority/Status badges pair color with text, never color alone.
export function PriorityBadge({ value }: { value: TicketPriority }) {
  return <span className={`zg-badge ${PRIORITY_CLASS[value]}`}>{PRIORITY_LABEL[value]}</span>;
}

// ui-spec.md section 2 (Lab 3): every one of the eight statuses carries its full text
// label, so a Requester and an IT Staff member reading the same Ticket see the same
// wording. Colour is only ever a second signal.
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  NEW: { label: "New", className: "zg-badge-new" },
  OPEN: { label: "Open", className: "zg-badge-open" },
  IN_PROGRESS: { label: "In Progress", className: "zg-badge-in-progress" },
  WAITING_FOR_REQUESTER: { label: "Waiting for Requester", className: "zg-badge-waiting" },
  RESOLVED: { label: "Resolved", className: "zg-badge-resolved" },
  CLOSED: { label: "Closed", className: "zg-badge-closed" },
  REOPENED: { label: "Reopened", className: "zg-badge-reopened" },
  CANCELLED: { label: "Cancelled", className: "zg-badge-cancelled" },
};

export function StatusBadge({ value }: { value: string }) {
  // An unknown value degrades to its raw text on the neutral style rather than crashing.
  const known = STATUS_BADGE[value];
  return <span className={`zg-badge ${known?.className ?? "zg-badge-low"}`}>{known?.label ?? value}</span>;
}

// A neutral outline, not a status colour: it labels who someone is, not how they are doing.
export function RoleBadge({ role }: { role: UserRole }) {
  return <span className="zg-badge zg-badge-role">{ROLE_LABEL[role]}</span>;
}
