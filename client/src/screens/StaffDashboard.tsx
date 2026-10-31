import { Link } from "react-router-dom";
import { getStaffDashboard } from "../api.js";
import { STATUS_OPTIONS, StatusBadge } from "../Badge.js";
import { formatBangkok } from "../ActionsTaken.js";
import { DashboardFailure, DashboardHeader, MetricCard, MetricSkeleton, TicketList, When, tickets, useDashboard } from "../dashboard.js";

const QUEUE = "the Ticket Queue";
const CARDS = ["Unassigned", "My Tickets", "Urgent"];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS);

// Lab 4 ui-spec section 4: the IT Staff and Administrator landing page. Every number comes from the
// server (BR-28); this screen only lays them out.
export default function StaffDashboard() {
  const { state, heading, retry } = useDashboard(getStaffDashboard);

  return (
    <div aria-busy={state.kind === "loading"}>
      <DashboardHeader subheading="Your work and the queue at a glance" headingRef={heading} />

      {state.kind === "error" && <DashboardFailure forbidden={state.forbidden} onRetry={retry} />}

      {state.kind === "loading" && (
        <div className="zg-metric-grid" role="status" aria-label="Loading the dashboard">
          {CARDS.map((label) => (
            <MetricSkeleton key={label} label={label} />
          ))}
        </div>
      )}

      {state.kind === "ready" && (() => {
        const { metrics: m, myPlannedActions: planned, recentlyUpdated, accounts } = state.data;
        const now = Date.now();
        return (
          <>
            <div className="zg-metric-grid">
              <MetricCard label="Unassigned" {...m.unassigned} target={QUEUE} description="Tickets not yet closed or cancelled that have no active owner" empty="No tickets need an owner" />
              <MetricCard label="My Tickets" {...m.myTickets} target={QUEUE} description="Active tickets you own" empty="You own no active tickets" />
              <MetricCard label="Urgent" {...m.urgent} target={QUEUE} description="Active tickets with IT Priority High" empty="No active tickets with IT Priority High" />
            </div>

            <section className="mb-3" aria-label="By status">
              <h2 className="h6 mb-2">By status</h2>
              <ul className="zg-status-chips list-unstyled mb-0">
                {m.byStatus.map((s) => (
                  <li key={s.status}>
                    <Link to={s.link} className="zg-status-chip" aria-label={`${STATUS_LABEL[s.status] ?? s.status}: ${tickets(s.count)}. View in ${QUEUE}`}>
                      <StatusBadge value={s.status} />
                      <span className="fw-semibold">{s.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <div className="row g-3 mb-3">
              <div className="col-12 col-xl-6">
                <section className="zg-dashboard-panel" aria-label="My Planned Actions">
                  <h2 className="h6 mb-2">
                    My Planned Actions <span className="text-muted">({planned.count})</span>
                  </h2>
                  {planned.items.length === 0 ? (
                    <p className="text-muted mb-0">You have no planned actions.</p>
                  ) : (
                    <ul className="list-unstyled mb-0">
                      {planned.items.map((a) => {
                        const overdue = Date.parse(a.actionAt) < now;
                        return (
                          <li key={a.actionId}>
                            <Link to={a.link} className="zg-dashboard-row">
                              <span className="d-flex flex-wrap align-items-center gap-2">
                                <span className="fw-semibold">{a.ticketNumber}</span>
                                {overdue && <span className="zg-badge zg-badge-overdue">Overdue</span>}
                              </span>
                              <span className="zg-dashboard-row-text text-truncate">{a.description}</span>
                              <span className="text-muted small">{formatBangkok(a.actionAt)}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
              <div className="col-12 col-xl-6">
                <TicketList heading="Recently updated" items={recentlyUpdated} empty="No ticket activity yet." time={(t) => <When iso={t.updatedAt} prefix="Updated " />} />
              </div>
            </div>

            {accounts && (
              <Link
                to={accounts.link}
                className="zg-metric-card zg-accounts-card"
                aria-label={`Accounts: ${accounts.active.REQUESTER} active Requesters, ${accounts.active.IT_STAFF} active IT Staff, ${accounts.active.ADMINISTRATOR} active Administrators, ${accounts.inactive} inactive. View in User Management`}
              >
                <span className="zg-metric-label">Accounts</span>
                <span className="zg-accounts-figures">
                  {(
                    [
                      [accounts.active.REQUESTER, "Requesters"],
                      [accounts.active.IT_STAFF, "IT Staff"],
                      [accounts.active.ADMINISTRATOR, "Administrators"],
                      [accounts.inactive, "inactive"],
                    ] as const
                  ).map(([n, what]) => (
                    <span key={what}>
                      <strong>{n}</strong> {what}
                    </span>
                  ))}
                </span>
              </Link>
            )}
          </>
        );
      })()}
    </div>
  );
}
