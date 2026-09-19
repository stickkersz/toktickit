import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  NotFoundError,
  StaffOwner,
  StaffTicketDetail as StaffTicketDetailData,
  StaffTicketItem,
  TicketPriority,
  changeTicketStatus,
  getAttachmentDownloadUrl,
  getStaffOwners,
  getStaffTicketDetail,
  setTicketOwner,
  setTicketPriority,
} from "../api.js";
import { useAuth } from "../authContext.js";
import { PriorityBadge, StatusBadge } from "../Badge.js";
import { TruncatedFilename, fileTypeLabel, formatDate, formatFileSize } from "../attachmentDisplay.js";

type LoadState = "loading" | "ready" | "notfound" | "error";
type Control = "owner" | "priority" | "status";

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};
const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

// BR-27: 10 to 2000 characters after trimming.
const SUMMARY_MIN = 10;
const SUMMARY_MAX = 2000;

// Each control owns a group of fields. A response, from a save or from a reload, may only ever change
// the fields of the control it was for: a mutation returns a snapshot of the whole Ticket taken when
// the server answered, so a slow response can carry older values for the OTHER controls than what is
// already on screen, and applying it whole would overwrite another control's successful save.
const SAVE_FIELDS: Record<Control, (keyof StaffTicketItem)[]> = {
  owner: ["ownerId", "ownerName", "ownerIsActive", "ownerEligible"],
  priority: ["itPriority"],
  // A status save's response carries the new status only; what the Ticket may move to next, and its
  // Resolution Summary, come from the reload that follows it.
  status: ["currentStatus"],
};
const RELOAD_FIELDS: Record<Control, (keyof StaffTicketDetailData)[]> = {
  owner: ["ownerId", "ownerName", "ownerIsActive", "ownerEligible"],
  priority: ["itPriority"],
  status: ["currentStatus", "permittedNextStatuses", "resolutionSummary"],
};

function pick<T extends object>(source: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

interface Problem {
  control: Control;
  message: string;
  // A refusal the user did not cause by a typo: something changed underneath them.
  conflict: boolean;
}

// ui-spec.md section 8: the IT Staff Ticket Detail. Every change saves on its own, next to its
// own control, and only that control is busy while it saves.
// Remounted for each Ticket, so nothing in flight for one Ticket can ever be applied to another.
export default function StaffTicketDetailRoute() {
  const { id } = useParams();
  return <StaffTicketDetail key={id} />;
}

function StaffTicketDetail() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [ticket, setTicket] = useState<StaffTicketDetailData | null>(null);
  const [owners, setOwners] = useState<StaffOwner[]>([]);
  const [busy, setBusy] = useState<Record<Control, boolean>>({ owner: false, priority: false, status: false });
  // A control whose latest values could not be reloaded is locked: its options may be out of date, so
  // nothing more is changed through it until a Reload succeeds.
  const [stale, setStale] = useState<Record<Control, boolean>>({ owner: false, priority: false, status: false });
  const [saved, setSaved] = useState<Control | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [resolving, setResolving] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadIdRef = useRef(0);

  // Reads the whole Ticket, for opening the screen and for Retry.
  async function load() {
    const loadId = ++loadIdRef.current;
    setLoadState("loading");
    try {
      const [detail, list] = await Promise.all([
        getStaffTicketDetail(ticketId),
        // The owner list is a convenience: without it the Ticket can still be read and its other
        // fields changed, so a failure here is not a failure to load the Ticket.
        getStaffOwners().catch(() => null),
      ]);
      if (loadIdRef.current !== loadId) return;
      setTicket(detail);
      if (list) setOwners(list);
      setLoadState("ready");
    } catch (e) {
      if (loadIdRef.current !== loadId) return;
      setLoadState(e instanceof NotFoundError ? "notfound" : "error");
    }
  }

  // Re-reads one control's fields from the server, in place, and touches nothing else. It fetches the
  // complete detail, and takes only what that control owns from it. Two operations for the same control
  // can never overlap, because a control is disabled while its own operation and reload are running, so
  // the only ordering that matters is between different controls, and field scoping settles that.
  // Says whether it worked. When it did not, nothing was applied and the caller must lock the control:
  // what is on screen may be out of date (the permitted next statuses, the Resolution Summary, the
  // owner list), and must not be presented as current.
  async function refresh(control: Control): Promise<boolean> {
    try {
      const [detail, list] = await Promise.all([
        getStaffTicketDetail(ticketId),
        control === "owner" ? getStaffOwners() : Promise.resolve(null),
      ]);
      setTicket((t) => t && { ...t, ...pick(detail, RELOAD_FIELDS[control]) });
      if (list) setOwners(list);
      setStale((st) => (st[control] ? { ...st, [control]: false } : st));
      return true;
    } catch {
      setStale((st) => ({ ...st, [control]: true }));
      return false;
    }
  }

  // The Reload button of a locked control.
  async function reload(control: Control) {
    setBusyFor(control, true);
    setSaved(null);
    setProblem(null);
    await refresh(control);
    setBusyFor(control, false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [ticketId]);

  function setBusyFor(control: Control, value: boolean) {
    setBusy((b) => ({ ...b, [control]: value }));
  }

  function fail(control: Control, e: unknown, generic: string) {
    if (e instanceof ApiError && e.code === "ALREADY_ASSIGNED") {
      setProblem({ control, conflict: true, message: "Someone else has claimed this Ticket. It now shows its current owner." });
    } else if (e instanceof ApiError && e.code === "INVALID_OWNER") {
      setProblem({ control, conflict: true, message: "That person can no longer be a Ticket Owner. The list has been refreshed." });
    } else if (e instanceof ApiError && e.code === "INVALID_TRANSITION") {
      const permitted = e.permitted ?? [];
      setProblem({
        control,
        conflict: true,
        message:
          permitted.length > 0
            ? `That move is not allowed from here. This Ticket can move to: ${permitted.map(statusLabel).join(", ")}.`
            : "This Ticket cannot move to any other status.",
      });
    } else if (e instanceof ApiError && e.code === "OWNER_REQUIRED") {
      setProblem({
        control,
        conflict: true,
        message: "This Ticket needs an active IT Staff owner before it can move to that status. Claim it or assign an owner, then try again.",
      });
    } else {
      // Nothing was changed, and the control still shows what is really stored.
      setProblem({ control, conflict: false, message: generic });
    }
  }

  async function run(control: Control, work: () => Promise<StaffTicketItem>, generic: string, after?: () => Promise<boolean>) {
    setBusyFor(control, true);
    setSaved(null);
    setProblem(null);
    try {
      const item = await work();
      // Only this control's own fields: the response is a snapshot of the whole Ticket, and the other
      // controls' values in it may be older than what is on screen.
      setTicket((t) => t && { ...t, ...pick(item, SAVE_FIELDS[control]) });
      // The change is stored. Whether the screen can be called up to date depends on the reload.
      const current = after ? await after() : true;
      if (current) setSaved(control);
    } catch (e) {
      fail(control, e, generic);
      // A refusal means this control was out of date: show what is stored now, for this control only.
      if (e instanceof ApiError && e.code && e.code !== "VALIDATION_ERROR" && e.status === 409 && !(await refresh(control))) {
        setProblem({
          control,
          conflict: true,
          message: "The Ticket changed, so this change was not made, and its latest values could not be loaded.",
        });
      }
    } finally {
      setBusyFor(control, false);
    }
  }

  function changeOwner(next: number | null) {
    if (!ticket || next === ticket.ownerId) return;
    return run("owner", () => setTicketOwner(ticketId, next), "Unable to change the owner. Nothing was changed.");
  }

  function changePriority(next: TicketPriority) {
    if (!ticket || next === ticket.itPriority) return;
    return run("priority", () => setTicketPriority(ticketId, next), "Unable to change the IT Priority. Nothing was changed.");
  }

  function chooseStatus(next: string) {
    if (!ticket || next === ticket.currentStatus) {
      setResolving(false);
      return;
    }
    setProblem(null);
    setSaved(null);
    if (next === "RESOLVED") {
      // Resolving needs a summary and a confirmation, so nothing is sent yet.
      setResolving(true);
      return;
    }
    setResolving(false);
    return run("status", () => changeTicketStatus(ticketId, next), "Unable to change the status. Nothing was changed.", () => refresh("status"));
  }

  function confirmResolve() {
    const trimmed = summary.trim();
    if (trimmed.length < SUMMARY_MIN || trimmed.length > SUMMARY_MAX) {
      setSummaryError(`Resolution Summary must be between ${SUMMARY_MIN} and ${SUMMARY_MAX} characters.`);
      return;
    }
    setSummaryError(null);
    return run("status", () => changeTicketStatus(ticketId, "RESOLVED", trimmed), "Unable to resolve the Ticket. Nothing was changed.", async () => {
      setResolving(false);
      setSummary("");
      return refresh("status");
    });
  }

  function goBack() {
    // Back to the queue exactly as it was left, with its search, filters, sort and page, when we
    // arrived from it; otherwise to the queue's default view.
    if (location.key !== "default") navigate(-1);
    else navigate("/staff/tickets");
  }

  if (loadState === "loading") {
    return (
      <div className="container py-4">
        <p role="status">Loading…</p>
      </div>
    );
  }

  if (loadState === "notfound") {
    return (
      <div className="container py-4">
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Ticket not found.</p>
          <Link to="/staff/tickets" className="btn zg-btn-primary btn-sm">
            Back to Queue
          </Link>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !ticket) {
    return (
      <div className="container py-4">
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load this Ticket.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeCount = ticket.attachments.filter((a) => !a.isRemoved).length;
  const ownerMissingFromList = ticket.ownerId !== null && !owners.some((o) => o.id === ticket.ownerId);
  const canClaim = ticket.ownerId === null || ticket.ownerEligible === false;
  // Options come from the last reload: while that is missing, offer nothing but the current status.
  // (A locked control is never one that looked terminal: a terminal Ticket has no move to make stale.)
  const terminal = ticket.permittedNextStatuses.length === 0;
  const statusOptions = stale.status ? [ticket.currentStatus] : [ticket.currentStatus, ...ticket.permittedNextStatuses];
  const locked = { owner: busy.owner || stale.owner, priority: busy.priority || stale.priority, status: busy.status || stale.status };
  const problemFor = (control: Control) => (problem && problem.control === control ? problem : null);

  const feedback = (control: Control) => (
    <div className="zg-field-feedback small" aria-live="polite">
      {busy[control] && !stale[control] && <span className="text-muted">Saving…</span>}
      {!busy[control] && saved === control && <span className="text-success">Saved</span>}
    </div>
  );

  const staleNote = (control: Control) =>
    stale[control] && (
      <div className="zg-alert-warning rounded p-2 small mb-2" role="alert">
        <span>The latest values could not be loaded, so this control is locked until they are.</span>{" "}
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy[control]} onClick={() => void reload(control)}>
          {busy[control] ? "Reloading…" : "Reload"}
        </button>
      </div>
    );

  const problemNote = (control: Control) => {
    const p = problemFor(control);
    if (!p) return null;
    return (
      <div className={`${p.conflict ? "zg-alert-warning" : "zg-alert-error"} rounded p-2 small mb-2`} role="alert">
        {p.message}
      </div>
    );
  };

  return (
    <div className="py-2" style={{ maxWidth: 1040 }}>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumb mb-0 small">
            <li className="breadcrumb-item">
              <Link to="/staff/tickets">Ticket Queue</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Ticket Detail
            </li>
          </ol>
        </nav>
        <button type="button" className="btn btn-outline-secondary btn-sm zg-touch-target" onClick={goBack}>
          ← Back to Queue
        </button>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h1 className="h4 mb-0">{ticket.ticketNumber}</h1>
        <StatusBadge value={ticket.currentStatus} />
      </div>

      {ticket.requesterResolutionFlaggedAt && (
        <div className="zg-banner-pale rounded p-3 mb-3" role="status">
          The Requester says the problem appears resolved ({formatDate(ticket.requesterResolutionFlaggedAt)}). This is a signal only: the
          status has not changed.
        </div>
      )}

      <h2 className="h6 text-muted text-uppercase mb-2">Ticket information</h2>
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <label htmlFor="staff-ticket-number" className="form-label fw-semibold">Ticket No.</label>
          <input id="staff-ticket-number" className="form-control" readOnly value={ticket.ticketNumber} />
        </div>
        <div className="col-md-3">
          <label htmlFor="staff-category" className="form-label fw-semibold">Category</label>
          <input id="staff-category" className="form-control" readOnly value={ticket.categoryName} />
        </div>
        <div className="col-md-3">
          <label htmlFor="staff-related-system" className="form-label fw-semibold">Related System</label>
          <input id="staff-related-system" className="form-control" readOnly value={ticket.relatedSystemName} />
        </div>
        <div className="col-md-3">
          <label htmlFor="staff-requester" className="form-label fw-semibold">Requester</label>
          <input
            id="staff-requester"
            className="form-control"
            readOnly
            value={ticket.requesterIsActive ? ticket.requesterName : `${ticket.requesterName} (inactive)`}
          />
        </div>
        <div className="col-md-3">
          <span className="form-label fw-semibold d-block">Requested Priority</span>
          <PriorityBadge value={ticket.requestedPriority} />
        </div>
        <div className="col-md-3">
          <label htmlFor="staff-created" className="form-label fw-semibold">Created Date</label>
          <input id="staff-created" className="form-control" readOnly value={formatDate(ticket.createdAt)} />
        </div>
        <div className="col-12">
          <label htmlFor="staff-summary" className="form-label fw-semibold">Summary</label>
          <input id="staff-summary" className="form-control" readOnly value={ticket.summary} />
        </div>
        <div className="col-12">
          <label htmlFor="staff-description" className="form-label fw-semibold">Description</label>
          <textarea id="staff-description" className="form-control" readOnly rows={4} value={ticket.description} style={{ whiteSpace: "pre-wrap" }} />
        </div>
        {ticket.resolutionSummary && (
          <div className="col-12">
            <label htmlFor="staff-resolution" className="form-label fw-semibold">Resolution Summary</label>
            <textarea id="staff-resolution" className="form-control" readOnly rows={3} value={ticket.resolutionSummary} style={{ whiteSpace: "pre-wrap" }} />
          </div>
        )}
      </div>

      <h2 className="h6 text-muted text-uppercase mb-2">Handling</h2>
      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <label htmlFor="staff-owner" className="form-label fw-semibold">Ticket Owner</label>
          <div className="d-flex gap-2">
            <select
              id="staff-owner"
              className="form-select zg-editable"
              value={ticket.ownerId ?? ""}
              disabled={locked.owner}
              aria-busy={busy.owner}
              onChange={(e) => void changeOwner(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Unassigned</option>
              {ownerMissingFromList && (
                <option value={ticket.ownerId!} disabled>
                  {ticket.ownerName} {ticket.ownerIsActive === false ? "(inactive)" : "(not IT Staff)"}
                </option>
              )}
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === user?.id ? " (you)" : ""}
                </option>
              ))}
            </select>
            {canClaim && user && (
              <button type="button" className="btn zg-btn-primary zg-touch-target" disabled={locked.owner} onClick={() => void changeOwner(user.id)}>
                Claim
              </button>
            )}
          </div>
          {ticket.ownerEligible === false && (
            <div className="small mt-1">
              <span className="text-muted">{ticket.ownerIsActive === false ? "Owner is inactive" : "Owner is no longer IT Staff"}</span>{" "}
              <span className="zg-badge zg-badge-needs-owner">Needs new owner</span>
            </div>
          )}
          {feedback("owner")}
          {staleNote("owner")}
          {problemNote("owner")}
        </div>

        <div className="col-md-4">
          <label htmlFor="staff-it-priority" className="form-label fw-semibold">IT Priority</label>
          <select
            id="staff-it-priority"
            className="form-select zg-editable"
            value={ticket.itPriority}
            disabled={locked.priority}
            aria-busy={busy.priority}
            onChange={(e) => void changePriority(e.target.value as TicketPriority)}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
          {feedback("priority")}
          {staleNote("priority")}
          {problemNote("priority")}
        </div>

        <div className="col-md-4">
          <label htmlFor="staff-status" className="form-label fw-semibold">Current Status</label>
          <select
            id="staff-status"
            className="form-select zg-editable"
            value={resolving ? "RESOLVED" : ticket.currentStatus}
            disabled={locked.status || terminal}
            aria-busy={busy.status}
            onChange={(e) => void chooseStatus(e.target.value)}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
          {terminal && <div className="text-muted small mt-1">This Ticket is {statusLabel(ticket.currentStatus)}, so its status cannot change.</div>}
          {feedback("status")}
          {staleNote("status")}
          {problemNote("status")}
        </div>

        {resolving && (
          <div className="col-12">
            <div className="border rounded p-3">
              <label htmlFor="staff-resolution-summary" className="form-label fw-semibold">
                Resolution Summary *
              </label>
              <textarea
                id="staff-resolution-summary"
                className={`form-control${summaryError ? " is-invalid" : ""}`}
                rows={3}
                value={summary}
                disabled={locked.status}
                aria-invalid={summaryError ? true : undefined}
                aria-describedby={summaryError ? "staff-resolution-summary-error" : undefined}
                onChange={(e) => setSummary(e.target.value)}
              />
              <div className="d-flex justify-content-between small mt-1">
                <span id="staff-resolution-summary-error" className="zg-field-error">
                  {summaryError}
                </span>
                <span className="text-muted">
                  {summary.trim().length}/{SUMMARY_MAX}
                </span>
              </div>
              <p className="small text-muted mb-2">The Requester can read this. Resolving is a step towards closing the Ticket, so please check it before you confirm.</p>
              <div className="d-flex gap-2 justify-content-end">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm zg-touch-target"
                  disabled={locked.status}
                  onClick={() => {
                    setResolving(false);
                    setSummaryError(null);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn zg-btn-primary btn-sm zg-touch-target" disabled={locked.status} onClick={() => void confirmResolve()}>
                  {busy.status ? "Resolving…" : "Confirm and resolve"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <hr />

      {/* Read only for staff: a Requester adds and removes Attachments, staff only read them (BR-54,
          BR-55). The upload and Remove controls are absent from the page, not merely disabled. */}
      <section aria-labelledby="staff-attachments-heading">
        <h2 id="staff-attachments-heading" className="h5 mb-3">
          Attachments ({activeCount} active)
        </h2>
        {ticket.attachments.length === 0 ? (
          <p className="text-muted">No attachments.</p>
        ) : (
          <ul className="list-group">
            {ticket.attachments.map((attachment) => (
              <li key={attachment.id} className="list-group-item d-flex justify-content-between align-items-start gap-2">
                <div className={attachment.isRemoved ? "text-muted" : ""}>
                  <div>
                    <span className="badge text-bg-light border me-1">{fileTypeLabel(attachment.mimeType)}</span>
                    <TruncatedFilename name={attachment.originalFilename} />{" "}
                    <span className="text-muted small">({formatFileSize(attachment.sizeBytes)})</span>
                    {attachment.isRemoved && <span className="badge text-bg-secondary ms-2">Removed</span>}
                  </div>
                  <div className="text-muted small">Uploaded {formatDate(attachment.uploadedAt)}</div>
                  {attachment.isRemoved && (
                    <div className="text-muted small">
                      Removed {attachment.removedAt ? formatDate(attachment.removedAt) : ""}: {attachment.removalReason}
                    </div>
                  )}
                </div>
                {attachment.isRemoved ? (
                  <span className="text-muted small align-self-center">Unavailable</span>
                ) : (
                  <a className="btn btn-sm btn-outline-secondary zg-touch-target" href={getAttachmentDownloadUrl(attachment.id)}>
                    Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
