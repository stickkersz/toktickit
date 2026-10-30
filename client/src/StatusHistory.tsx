import { useCallback, useEffect, useRef, useState } from "react";
import { StatusHistory as History, getTicketHistory } from "./api.js";
import { StatusBadge } from "./Badge.js";
import { formatBangkok } from "./ActionsTaken.js";

// Lab 4 ui-spec.md section 9: a read-only list, oldest first, for IT Staff and the owning Requester.
const LABEL: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

// `reloadKey` changes after a status move on the same screen, so the list follows it.
export function StatusHistory({ ticketId, reloadKey = 0 }: { ticketId: number; reloadKey?: number }) {
  const [history, setHistory] = useState<History | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const loadId = useRef(0);
  const load = useCallback(() => {
    const id = ++loadId.current;
    getTicketHistory(ticketId).then(
      (h) => {
        if (loadId.current !== id) return;
        setHistory(h);
        setState("ready");
      },
      () => {
        if (loadId.current === id) setState("error");
      },
    );
  }, [ticketId]);
  useEffect(load, [load, reloadKey]);

  if (state === "loading") return <p className="text-muted">Loading history...</p>;
  if (state === "error" || !history)
    return (
      <div className="zg-alert-error rounded p-2 d-flex justify-content-between align-items-center gap-2" role="alert">
        <span>Unable to load the status history.</span>
        <button type="button" className="btn btn-sm btn-outline-secondary zg-touch-target" onClick={load}>
          Retry
        </button>
      </div>
    );

  return (
    <ol className="list-unstyled mb-0">
      {history.entries.map((entry, index) => (
        <li key={entry.id} className="zg-history-entry">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <StatusBadge value={entry.toStatus} />
            {entry.fromStatus === null ? (
              <span>Created as New</span>
            ) : (
              <span className="text-muted small">from {LABEL[entry.fromStatus] ?? entry.fromStatus}</span>
            )}
          </div>
          <div className="small text-muted">
            {entry.changedBy.name}, {formatBangkok(entry.changedAt)}
          </div>
          {entry.toStatus === "RESOLVED" && entry.resolutionSummary && <div className="small mt-1 zg-action-description">Resolution Summary: {entry.resolutionSummary}</div>}
          {index === 0 && history.earlierChangesUnrecorded && <p className="small text-muted fst-italic mt-2 mb-0">Earlier status changes were not recorded.</p>}
        </li>
      ))}
    </ol>
  );
}
