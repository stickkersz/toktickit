import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "./api.js";
import { StatusBadge } from "./Badge.js";
import { formatBangkok } from "./ActionsTaken.js";

// Lab 4 ui-spec sections 4 to 6: the pieces both dashboards and their drill-downs share.

export type StatusGroup = "active" | "resolved";
export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = { active: "Active tickets only", resolved: "Resolved or closed only" };
// An unknown value falls back to no group, as on the server (api-spec section 11).
export const parseStatusGroup = (value: string | null): StatusGroup | undefined =>
  value === "active" || value === "resolved" ? value : undefined;

// A removable filter chip: the label stays visible, and the button names what it removes.
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="zg-filter-chip">
      {label}
      <button type="button" className="zg-filter-chip-remove" aria-label={`Remove filter: ${label}`} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

type DashboardState<T> = { kind: "loading" } | { kind: "error"; forbidden: boolean } | { kind: "ready"; data: T };

// One request at a time is shown: a slower earlier response never overwrites a newer one (Lab 2), and a
// failure clears the numbers so no stale figure is shown as current (ui-spec section 4).
export function useDashboard<T>(fetch: () => Promise<T>) {
  const [state, setState] = useState<DashboardState<T>>({ kind: "loading" });
  const seq = useRef(0);
  const load = useCallback(() => {
    const id = ++seq.current;
    setState({ kind: "loading" });
    fetch()
      .then((data) => seq.current === id && setState({ kind: "ready", data }))
      .catch((e) => seq.current === id && setState({ kind: "error", forbidden: e instanceof ApiError && e.status === 403 }));
  }, [fetch]);
  useEffect(load, [load]);
  // Retry moves focus to the heading first, so focus is never lost when the Retry button goes away.
  const heading = useRef<HTMLHeadingElement>(null);
  const retry = () => {
    heading.current?.focus();
    load();
  };
  return { state, heading, retry };
}

export function DashboardHeader({ subheading, headingRef, children }: { subheading: string; headingRef: RefObject<HTMLHeadingElement>; children?: ReactNode }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
      <div>
        <h1 className="h4 mb-0" tabIndex={-1} ref={headingRef}>
          Dashboard
        </h1>
        <p className="text-muted mb-0">{subheading}</p>
      </div>
      {children}
    </div>
  );
}

export function DashboardFailure({ forbidden, onRetry }: { forbidden: boolean; onRetry: () => void }) {
  if (forbidden)
    return (
      <div className="zg-alert-warning rounded p-3" role="alert">
        You do not have access to this dashboard.
      </div>
    );
  return (
    <div className="zg-alert-error rounded p-3" role="alert">
      <p className="mb-2">The dashboard could not be loaded.</p>
      <button type="button" className="btn zg-btn-primary btn-sm zg-touch-target" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export const tickets = (count: number) => `${count} ${count === 1 ? "ticket" : "tickets"}`;

export interface MetricCardProps {
  label: string;
  count: number;
  link: string;
  description: string;
  empty: string;
  target: string;
  attention?: string;
}

// The whole card is one link (ui-spec section 4). A zero keeps the card and swaps in the empty sentence
// (BR-34); `attention` tints the card and adds its text when the count is above 0 (section 5).
export function MetricCard({ label, count, link, description, empty, target, attention }: MetricCardProps) {
  const alert = Boolean(attention) && count > 0;
  return (
    <Link to={link} className={`zg-metric-card${alert ? " zg-metric-card-attention" : ""}`} aria-label={`${label}: ${tickets(count)}. View in ${target}`}>
      <span className="zg-metric-label">{label}</span>
      <span className="zg-metric-value">{count}</span>
      <span className="zg-metric-description">{count === 0 ? empty : description}</span>
      {alert && <span className="zg-metric-attention">{attention}</span>}
    </Link>
  );
}

// The loading state: labels stay visible and each value is a neutral bar (ui-spec section 4).
export function MetricSkeleton({ label }: { label: string }) {
  return (
    <div className="zg-metric-card zg-metric-card-loading">
      <span className="zg-metric-label">{label}</span>
      <span className="zg-metric-value placeholder-glow" aria-hidden="true">
        <span className="placeholder col-4" />
      </span>
      <span className="zg-metric-description placeholder-glow" aria-hidden="true">
        <span className="placeholder col-8" />
      </span>
    </div>
  );
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return RELATIVE.format(Math.round(diff / ms), unit);
  return "just now";
}

// "2 hours ago" with the full Asia/Bangkok date and time as the title and for screen readers (BR-29).
export function When({ iso, prefix = "" }: { iso: string; prefix?: string }) {
  const full = formatBangkok(iso);
  return (
    <span className="text-muted small" title={full}>
      <span aria-hidden="true">
        {prefix}
        {relativeTime(iso)}
      </span>
      <span className="visually-hidden">
        {prefix}
        {full}
      </span>
    </span>
  );
}

export interface ListedTicket {
  id: number;
  ticketNumber: string;
  summary: string;
  currentStatus: string;
  link: string;
}

// A dashboard list: number, summary, status badge, and time, each row opening its Ticket (BR-37).
export function TicketList<T extends ListedTicket>({ heading, items, empty, time }: { heading: string; items: T[]; empty: string; time: (t: T) => ReactNode }) {
  return (
    <section className="zg-dashboard-panel" aria-label={heading}>
      <h2 className="h6 mb-2">{heading}</h2>
      {items.length === 0 ? (
        <p className="text-muted mb-0">{empty}</p>
      ) : (
        <ul className="list-unstyled mb-0">
          {items.map((t) => (
            <li key={t.id}>
              <Link to={t.link} className="zg-dashboard-row">
                <span className="d-flex flex-wrap align-items-center gap-2">
                  <span className="fw-semibold">{t.ticketNumber}</span>
                  <StatusBadge value={t.currentStatus} />
                </span>
                <span className="zg-dashboard-row-text">{t.summary}</span>
                {time(t)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
