import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  Attachment,
  NotFoundError,
  TicketDetail as TicketDetailData,
  flagProblemResolved,
  getAttachmentDownloadUrl,
  getTicketComments,
  getTicketDetail,
  postTicketComment,
  removeAttachment,
  uploadAttachments,
} from "../api.js";
import { useAuth } from "../authContext.js";
import { TruncatedFilename, fileTypeLabel, formatDate, formatFileSize } from "../attachmentDisplay.js";
import { PriorityBadge, StatusBadge } from "../Badge.js";
import { ContentPanel } from "../ContentPanel.js";
import { TERMINAL_MESSAGE, useContentThread } from "../content.js";
import {
  ATTACHMENT_REJECT_MESSAGES,
  AttachmentRejectReason,
  validateAttachmentFile,
} from "../attachmentValidation.js";

type LoadState = "loading" | "ready" | "notfound" | "error";

interface PickerError {
  filename: string;
  message: string;
}

export default function TicketDetail() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [ticket, setTicket] = useState<TicketDetailData | null>(null);

  // "Problem appears resolved" (FR-09, BR-29): a confirmation step, then a request. It never
  // changes the status, which only IT Staff move.
  const [flagStep, setFlagStep] = useState<"idle" | "confirming" | "sending">("idle");
  const [flagError, setFlagError] = useState<string | null>(null);
  const [justFlagged, setJustFlagged] = useState(false);

  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [pickerErrors, setPickerErrors] = useState<PickerError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    if (!user) return;
    setLoadState("loading");
    getTicketDetail(ticketId)
      .then((data) => {
        setTicket(data);
        setLoadState("ready");
      })
      .catch((error) => {
        setLoadState(error instanceof NotFoundError ? "notfound" : "error");
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [ticketId, user?.id]);

  const isTerminal = ticket?.currentStatus === "CLOSED" || ticket?.currentStatus === "CANCELLED";
  const activeCount = ticket?.attachments.filter((a) => !a.isRemoved).length ?? 0;

  async function confirmFlag() {
    setFlagStep("sending");
    setFlagError(null);
    try {
      const result = await flagProblemResolved(ticketId);
      // Only the timestamp changes: the status shown above stays exactly as it was.
      setTicket((t) => (t ? { ...t, requesterResolutionFlaggedAt: result.requesterResolutionFlaggedAt } : t));
      setJustFlagged(true);
    } catch (e) {
      setFlagError(
        e instanceof ApiError && e.code === "TICKET_TERMINAL"
          ? "This Ticket is closed, so it can no longer be flagged."
          : "Unable to tell IT right now. Please try again.",
      );
    } finally {
      setFlagStep("idle");
    }
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!user || !ticket) return;

    const validFiles: File[] = [];
    const rejected: PickerError[] = [];
    let runningCount = activeCount;

    for (const file of chosen) {
      const reason: AttachmentRejectReason | null = validateAttachmentFile(file, runningCount);
      if (reason) {
        rejected.push({ filename: file.name, message: ATTACHMENT_REJECT_MESSAGES[reason] });
      } else {
        validFiles.push(file);
        runningCount += 1;
      }
    }

    setPickerErrors(rejected);
    if (validFiles.length === 0) return;

    setPendingUploads(validFiles);
    try {
      const result = await uploadAttachments(ticket.id, validFiles);
      setTicket((current) =>
        current ? { ...current, attachments: [...result.uploaded, ...current.attachments] } : current,
      );
      if (result.failed.length > 0) {
        setPickerErrors((prev) => [
          ...prev,
          ...result.failed.map((f) => ({ filename: f.originalFilename, message: f.message })),
        ]);
      }
    } catch {
      setPickerErrors((prev) => [
        ...prev,
        ...validFiles.map((file) => ({ filename: file.name, message: "Upload failed. Try again." })),
      ]);
    } finally {
      setPendingUploads([]);
    }
  }

  function startRemove(attachmentId: number) {
    setRemovingId(attachmentId);
    setRemoveReason("");
    setRemoveError(null);
  }

  function cancelRemove() {
    setRemovingId(null);
    setRemoveReason("");
    setRemoveError(null);
  }

  const trimmedReasonLength = removeReason.trim().length;
  const isReasonValid = trimmedReasonLength >= 5 && trimmedReasonLength <= 200;

  async function confirmRemove(attachment: Attachment) {
    if (!user || !isReasonValid) return;
    setRemoveSubmitting(true);
    setRemoveError(null);
    try {
      const updated = await removeAttachment(attachment.id, removeReason.trim());
      setTicket((current) =>
        current
          ? {
              ...current,
              attachments: current.attachments.map((a) => (a.id === updated.id ? updated : a)),
            }
          : current,
      );
      setRemovingId(null);
      setRemoveReason("");
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Unable to remove the attachment.");
    } finally {
      setRemoveSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return <p className="container py-4">Loading…</p>;
  }

  if (loadState === "notfound") {
    return (
      <div className="container py-4">
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Ticket not found.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={() => navigate("/tickets")}>
            Back to My Tickets
          </button>
        </div>
      </div>
    );
  }

  if (loadState === "error" || !ticket) {
    return (
      <div className="container py-4">
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load this Ticket.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: 1040 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted small mb-0">My Tickets &gt; Ticket Details</p>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigate("/tickets")}>
          ← Back to My Tickets
        </button>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <label htmlFor="detail-ticket-number" className="form-label fw-semibold">Ticket No.</label>
          <input id="detail-ticket-number" className="form-control" readOnly value={ticket.ticketNumber} />
        </div>
        <div className="col-md-3">
          <label htmlFor="detail-ticket-date" className="form-label fw-semibold">Ticket Date</label>
          <input id="detail-ticket-date" className="form-control" readOnly value={formatDate(ticket.createdAt)} />
        </div>
        <div className="col-md-3">
          <label htmlFor="detail-category" className="form-label fw-semibold">Category</label>
          <input id="detail-category" className="form-control" readOnly value={ticket.categoryName} />
        </div>
        <div className="col-md-3">
          <label htmlFor="detail-related-system" className="form-label fw-semibold">Related System</label>
          <input id="detail-related-system" className="form-control" readOnly value={ticket.relatedSystemName} />
        </div>
        <div className="col-md-3">
          <label htmlFor="detail-requester" className="form-label fw-semibold">Requester</label>
          <input id="detail-requester" className="form-control" readOnly value={ticket.requesterName} />
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Requested Priority</label>
          <div>
            <PriorityBadge value={ticket.requestedPriority} />
          </div>
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Current Status</label>
          <div>
            <StatusBadge value={ticket.currentStatus} />
          </div>
        </div>
        <div className="col-12">
          <label htmlFor="detail-summary" className="form-label fw-semibold">Summary</label>
          <input id="detail-summary" className="form-control" readOnly value={ticket.summary} />
        </div>
        <div className="col-12">
          <label htmlFor="detail-description" className="form-label fw-semibold">Description</label>
          <textarea
            id="detail-description"
            className="form-control"
            readOnly
            rows={4}
            value={ticket.description}
            style={{ whiteSpace: "pre-wrap" }}
          />
        </div>
        {ticket.resolutionSummary && (
          <div className="col-12">
            <label htmlFor="detail-resolution" className="form-label fw-semibold">Resolution Summary</label>
            <textarea
              id="detail-resolution"
              className="form-control"
              readOnly
              rows={3}
              value={ticket.resolutionSummary}
              style={{ whiteSpace: "pre-wrap" }}
            />
          </div>
        )}
      </div>

      {/* FR-09: the Requester tells IT the problem appears resolved. It is a signal, not a status
          change, so the status badge above visibly stays as it was. */}
      <div className="mb-4">
        {flagStep === "confirming" ? (
          <div className="border rounded p-3" role="group" aria-label="Confirm the problem appears resolved">
            <p className="mb-2">Tell IT the problem appears resolved? They will decide whether to resolve and close the Ticket.</p>
            <div className="d-flex gap-2">
              <button type="button" className="btn zg-btn-primary btn-sm zg-touch-target" onClick={() => void confirmFlag()}>
                Yes, tell IT
              </button>
              <button type="button" className="btn btn-outline-secondary btn-sm zg-touch-target" onClick={() => setFlagStep("idle")}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-outline-secondary zg-touch-target"
            disabled={flagStep === "sending" || isTerminal}
            title={isTerminal ? "This Ticket is closed, so it can no longer be flagged." : undefined}
            onClick={() => {
              setFlagError(null);
              setJustFlagged(false);
              setFlagStep("confirming");
            }}
          >
            {flagStep === "sending" ? "Sending…" : "Problem appears resolved"}
          </button>
        )}
        {justFlagged && ticket.requesterResolutionFlaggedAt && (
          <p className="text-success small mt-2 mb-0" role="status">
            IT has been told the problem appears resolved ({formatDate(ticket.requesterResolutionFlaggedAt)}). The status has not changed.
          </p>
        )}
        {!justFlagged && ticket.requesterResolutionFlaggedAt && (
          <p className="text-muted small mt-2 mb-0">You told IT the problem appears resolved on {formatDate(ticket.requesterResolutionFlaggedAt)}.</p>
        )}
        {flagError && (
          <p className="zg-field-error small mt-2 mb-0" role="alert">
            {flagError}
          </p>
        )}
      </div>

      <hr />

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="h5 mb-0">Attachments ({activeCount} active)</h2>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          + Add Attachment
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="d-none"
          onChange={handleFilesSelected}
          aria-label="Add Attachment"
        />
      </div>

      {pickerErrors.length > 0 && (
        <ul className="list-group mb-3">
          {pickerErrors.map((err, i) => (
            <li key={i} className="list-group-item d-flex justify-content-between align-items-start">
              <div>
                <div>{err.filename}</div>
                <div className="text-danger small">{err.message}</div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                aria-label={`Dismiss ${err.filename} error`}
                onClick={() => setPickerErrors((prev) => prev.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {ticket.attachments.length === 0 && pendingUploads.length === 0 && (
        <p className="text-muted">No attachments yet.</p>
      )}

      {(ticket.attachments.length > 0 || pendingUploads.length > 0) && (
        <ul className="list-group">
          {pendingUploads.map((file, i) => (
            <li key={`pending-${i}`} className="list-group-item d-flex justify-content-between align-items-center">
              <span>
                <span className="badge text-bg-light border me-1">{fileTypeLabel(file.type)}</span>
                <TruncatedFilename name={file.name} />
              </span>
              <span className="spinner-border spinner-border-sm text-secondary" role="status" aria-label="Uploading" />
            </li>
          ))}
          {ticket.attachments.map((attachment) => (
            <li key={attachment.id} className="list-group-item">
              <div className="d-flex justify-content-between align-items-start">
                <div className={attachment.isRemoved ? "text-muted" : ""}>
                  <div>
                    <span className="badge text-bg-light border me-1">
                      {fileTypeLabel(attachment.mimeType)}
                    </span>
                    <TruncatedFilename name={attachment.originalFilename} />{" "}
                    <span className="text-muted small">({formatFileSize(attachment.sizeBytes)})</span>
                    {attachment.isRemoved && <span className="badge text-bg-secondary ms-2">Removed</span>}
                  </div>
                  <div className="text-muted small">Uploaded {formatDate(attachment.uploadedAt)}</div>
                  {attachment.isRemoved && (
                    <div className="text-muted small">
                      Removed {formatDate(attachment.removedAt!)}: {attachment.removalReason}
                    </div>
                  )}
                </div>
                <div className="d-flex gap-2">
                  {attachment.isRemoved ? (
                    <span className="text-muted small align-self-center">Unavailable</span>
                  ) : (
                    <>
                      <a
                        className="btn btn-sm btn-outline-secondary"
                        href={getAttachmentDownloadUrl(attachment.id)}
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => startRemove(attachment.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              {removingId === attachment.id && (
                <div className="mt-2 p-2 border rounded">
                  <label htmlFor={`remove-reason-${attachment.id}`} className="form-label small fw-semibold">
                    Reason for removal *
                  </label>
                  <textarea
                    id={`remove-reason-${attachment.id}`}
                    className="form-control form-control-sm"
                    rows={2}
                    value={removeReason}
                    disabled={removeSubmitting}
                    onChange={(e) => setRemoveReason(e.target.value)}
                  />
                  <div className="d-flex justify-content-between">
                    <span className="text-muted small">{removeReason.trim().length}/200</span>
                    {removeError && <span className="text-danger small">{removeError}</span>}
                  </div>
                  <div className="d-flex gap-2 justify-content-end mt-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      disabled={removeSubmitting}
                      onClick={cancelRemove}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      disabled={!isReasonValid || removeSubmitting}
                      onClick={() => confirmRemove(attachment)}
                    >
                      {removeSubmitting ? "Removing…" : "Confirm"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <hr />

      <PublicComments ticketId={ticket.id} closed={isTerminal} />
    </div>
  );
}

// The Requester's view of the conversation (ui-spec.md section 6): Public Comments only. There is no
// Internal Notes tab, heading or request anywhere on this screen, and the notes endpoint refuses a
// Requester regardless (BR-35). A closed or cancelled Ticket can still be read but not added to (BR-34).
function PublicComments({ ticketId, closed }: { ticketId: number; closed: boolean }) {
  const thread = useContentThread(ticketId, getTicketComments, postTicketComment, "comment");
  return (
    <section aria-labelledby="ticket-comments-heading">
      <h2 id="ticket-comments-heading" className="h5 mb-3">
        Public Comments{thread.count !== null ? ` (${thread.count})` : ""}
      </h2>
      <ContentPanel kind="comments" thread={thread} blockedReason={closed ? TERMINAL_MESSAGE : undefined} />
    </section>
  );
}
