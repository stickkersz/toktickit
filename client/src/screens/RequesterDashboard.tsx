import { Link } from "react-router-dom";
import { getRequesterDashboard } from "../api.js";
import { formatBangkok } from "../ActionsTaken.js";
import { DashboardFailure, DashboardHeader, MetricCard, MetricSkeleton, TicketList, When, useDashboard } from "../dashboard.js";

const MINE = "My Tickets";
const CARDS = ["Open", "Waiting for you", "Recently updated", "Recently resolved"];

// Lab 4 ui-spec section 5: the Requester landing page, for the signed-in Requester's own Tickets only
// (BR-35). It never repeats the My Tickets table (handout section 8.2).
export default function RequesterDashboard() {
  const { state, heading, retry } = useDashboard(getRequesterDashboard);

  return (
    <div aria-busy={state.kind === "loading"}>
      <DashboardHeader subheading="Your tickets at a glance" headingRef={heading}>
        <Link to="/tickets/new" className="btn zg-btn-primary zg-touch-target">
          Create Ticket
        </Link>
      </DashboardHeader>

      {state.kind === "error" && <DashboardFailure forbidden={state.forbidden} onRetry={retry} />}

      {state.kind === "loading" && (
        <div className="zg-metric-grid zg-metric-grid-4" role="status" aria-label="Loading the dashboard">
          {CARDS.map((label) => (
            <MetricSkeleton key={label} label={label} />
          ))}
        </div>
      )}

      {state.kind === "ready" && (() => {
        const { metrics: m, recentlyUpdated, recentlyResolved } = state.data;
        return (
          <>
            <div className="zg-metric-grid zg-metric-grid-4">
              <MetricCard label="Open" {...m.open} target={MINE} description="Tickets IT is still working on" empty="You have no open tickets." />
              <MetricCard
                label="Waiting for you"
                {...m.waitingForYou}
                target={MINE}
                description="Tickets waiting for your reply"
                empty="Nothing is waiting for you."
                attention="Needs your attention"
              />
              <MetricCard label="Recently updated" {...m.recentlyUpdated} target={MINE} description="Updated in the last 7 days" empty="No updates in the last 7 days." />
              <MetricCard label="Recently resolved" {...m.recentlyResolved} target={MINE} description="Resolved in the last 30 days" empty="Nothing resolved in the last 30 days." />
            </div>
            <div className="row g-3">
              <div className="col-12 col-xl-6">
                <TicketList heading="Recently updated" items={recentlyUpdated} empty="No updates in the last 7 days." time={(t) => <When iso={t.updatedAt} prefix="Updated " />} />
              </div>
              <div className="col-12 col-xl-6">
                <TicketList heading="Recently resolved" items={recentlyResolved} empty="Nothing resolved in the last 30 days." time={(t) => <span className="text-muted small">Resolved {formatBangkok(t.resolvedAt)}</span>} />
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
