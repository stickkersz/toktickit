import type { TicketPriority } from "./api.js";

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

export function StatusBadge({ value }: { value: string }) {
  const className = value === "NEW" ? "zg-badge-new" : "zg-badge-low";
  const label = value === "NEW" ? "New" : value;
  return <span className={`zg-badge ${className}`}>{label}</span>;
}
