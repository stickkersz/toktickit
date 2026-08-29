import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Attachment,
  NotFoundError,
  TicketDetail as TicketDetailData,
  getAttachmentDownloadUrl,
  getTicketDetail,
  removeAttachment,
  uploadAttachments,
} from "../api.js";
import { useRequester } from "../requesterContext.js";
import { PriorityBadge, StatusBadge } from "../Badge.js";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketDetail() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { requester } = useRequester();
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [ticket, setTicket] = useState<TicketDetailData | null>(null);

  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [pickerErrors, setPickerErrors] = useState<PickerError[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeSubmitting, setRemoveSubmitting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    if (!requester) return;
    setLoadState("loading");
    getTicketDetail(ticketId, requester.id)
      .then((data) => {
        setTicket(data);
        setLoadState("ready");
      })
      .catch((error) => {
        setLoadState(error instanceof NotFoundError ? "notfound" : "error");
      });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [ticketId, requester]);

  const activeCount = ticket?.attachments.filter((a) => !a.isRemoved).length ?? 0;

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!requester || !ticket) return;

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
      const result = await uploadAttachments(ticket.id, requester.id, validFiles);
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
    if (!requester || !isReasonValid) return;
    setRemoveSubmitting(true);
    setRemoveError(null);
    try {
      const updated = await removeAttachment(attachment.id, requester.id, removeReason.trim());
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
          <label className="form-label fw-semibold">Ticket No.</label>
          <input className="form-control" disabled value={ticket.ticketNumber} />
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Ticket Date</label>
          <input className="form-control" disabled value={formatDate(ticket.createdAt)} />
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Category</label>
          <input className="form-control" disabled value={ticket.categoryName} />
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Related System</label>
          <input className="form-control" disabled value={ticket.relatedSystemName} />
        </div>
        <div className="col-md-3">
          <label className="form-label fw-semibold">Requester</label>
          <input className="form-control" disabled value={ticket.requesterName} />
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
          <label className="form-label fw-semibold">Summary</label>
          <input className="form-control" disabled value={ticket.summary} />
        </div>
        <div className="col-12">
          <label className="form-label fw-semibold">Description</label>
          <textarea
            className="form-control"
            disabled
            rows={4}
            value={ticket.description}
            style={{ whiteSpace: "pre-wrap" }}
          />
        </div>
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
              <span>{file.name}</span>
              <span className="spinner-border spinner-border-sm text-secondary" role="status" aria-label="Uploading" />
            </li>
          ))}
          {ticket.attachments.map((attachment) => (
            <li key={attachment.id} className="list-group-item">
              <div className="d-flex justify-content-between align-items-start">
                <div className={attachment.isRemoved ? "text-muted" : ""}>
                  <div>
                    {attachment.originalFilename}{" "}
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
                        href={getAttachmentDownloadUrl(attachment.id, requester!.id)}
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
    </div>
  );
}
