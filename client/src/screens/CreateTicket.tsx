import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Category,
  RelatedSystem,
  Ticket,
  TicketPriority,
  ValidationError,
  createTicket,
  getCategories,
  getRelatedSystems,
  uploadAttachments,
  FailedAttachment,
} from "../api.js";
import { useRequester } from "../requesterContext.js";
import {
  ATTACHMENT_REJECT_MESSAGES,
  AttachmentRejectReason,
  validateAttachmentFile,
} from "../attachmentValidation.js";

type RefState = "loading" | "ready" | "error";

interface AttachmentRow {
  file: File;
  reason?: AttachmentRejectReason;
  error?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PRIORITIES: TicketPriority[] = ["LOW", "MEDIUM", "HIGH"];

function validCount(rows: AttachmentRow[]): number {
  return rows.filter((row) => !row.error).length;
}

export default function CreateTicket() {
  const { requester } = useRequester();
  const navigate = useNavigate();

  const [refState, setRefState] = useState<RefState>("loading");
  const [categories, setCategories] = useState<Category[]>([]);
  const [relatedSystems, setRelatedSystems] = useState<RelatedSystem[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [relatedSystemId, setRelatedSystemId] = useState("");
  const [requestedPriority, setRequestedPriority] = useState<TicketPriority | "">("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [attachmentWarnings, setAttachmentWarnings] = useState<FailedAttachment[]>([]);

  function loadReferenceData() {
    setRefState("loading");
    Promise.all([getCategories(), getRelatedSystems()])
      .then(([categoryList, relatedSystemList]) => {
        setCategories(categoryList);
        setRelatedSystems(relatedSystemList);
        setRefState("ready");
      })
      .catch(() => setRefState("error"));
  }

  useEffect(loadReferenceData, []);

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);

    setAttachments((prev) => {
      const rows = [...prev];
      for (const file of chosen) {
        const reason = validateAttachmentFile(file, validCount(rows));
        rows.push({
          file,
          reason: reason ?? undefined,
          error: reason ? ATTACHMENT_REJECT_MESSAGES[reason] : undefined,
        });
      }
      return rows;
    });
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setCategoryId("");
    setRelatedSystemId("");
    setRequestedPriority("");
    setSummary("");
    setDescription("");
    setAttachments([]);
    setFieldErrors({});
    setApiError(null);
    setCreatedTicket(null);
    setAttachmentWarnings([]);
  }

  // AC-04 asks for a field-level message near the offending field, while
  // ui-spec.md §6 keeps Submit disabled until the form is valid. Those two
  // only reconcile if the message can appear without a submit attempt, so
  // each required field validates when the Requester leaves it and clears
  // its own message as soon as the value becomes valid.
  function handleFieldBlur(field: "summary" | "description" | "categoryId" | "relatedSystemId" | "requestedPriority") {
    const errors = validateClientSide();
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (errors[field]) {
        next[field] = errors[field];
      } else {
        delete next[field];
      }
      return next;
    });
  }

  function validateClientSide(): Record<string, string> {
    const errors: Record<string, string> = {};
    const trimmedSummary = summary.trim();
    const trimmedDescription = description.trim();

    if (trimmedSummary.length < 5 || trimmedSummary.length > 120) {
      errors.summary = "Summary must be between 5 and 120 characters.";
    }
    if (trimmedDescription.length < 20 || trimmedDescription.length > 2000) {
      errors.description = "Description must be between 20 and 2000 characters.";
    }
    if (!categoryId) errors.categoryId = "Category is required.";
    if (!relatedSystemId) errors.relatedSystemId = "Related System is required.";
    if (!requestedPriority) errors.requestedPriority = "Requested Priority is required.";

    return errors;
  }

  const trimmedSummaryLength = summary.trim().length;
  const trimmedDescriptionLength = description.trim().length;
  // ui-spec.md §6: Submit is enabled only once required fields are valid
  // client-side, not just validated at click time.
  const isFormValid =
    trimmedSummaryLength >= 5 &&
    trimmedSummaryLength <= 120 &&
    trimmedDescriptionLength >= 20 &&
    trimmedDescriptionLength <= 2000 &&
    categoryId !== "" &&
    relatedSystemId !== "" &&
    requestedPriority !== "";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!requester) return;

    const clientErrors = validateClientSide();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setFieldErrors({});
    setApiError(null);
    setSubmitting(true);

    try {
      const ticket = await createTicket({
        requesterId: requester.id,
        categoryId: Number(categoryId),
        relatedSystemId: Number(relatedSystemId),
        summary: summary.trim(),
        description: description.trim(),
        requestedPriority: requestedPriority as TicketPriority,
      });

      setCreatedTicket(ticket);

      // Files rejected client-side never reach uploadAttachments, but they
      // still need to be reported so the user knows to retry them too,
      // rather than silently vanishing once the ticket is created.
      const clientRejected: FailedAttachment[] = attachments
        .filter((row) => row.error)
        .map((row) => ({
          originalFilename: row.file.name,
          reason: row.reason ?? "UNSUPPORTED_TYPE",
          message: row.error!,
        }));

      const validFiles = attachments.filter((row) => !row.error).map((row) => row.file);
      if (validFiles.length > 0) {
        try {
          const result = await uploadAttachments(ticket.id, requester.id, validFiles);
          setAttachmentWarnings([...clientRejected, ...result.failed]);
        } catch {
          setAttachmentWarnings([
            ...clientRejected,
            ...validFiles.map((file) => ({
              originalFilename: file.name,
              reason: "UNSUPPORTED_TYPE" as const,
              message: "Upload failed. Retry from Ticket Detail.",
            })),
          ]);
        }
      } else if (clientRejected.length > 0) {
        setAttachmentWarnings(clientRejected);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        setFieldErrors(error.fields);
      } else {
        setApiError(error instanceof Error ? error.message : "Unable to create the Ticket.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (refState === "loading") {
    return <p className="container py-4">Loading…</p>;
  }

  if (refState === "error") {
    return (
      <div className="container py-4">
        <div className="zg-alert-error rounded p-3" role="alert">
          <p className="mb-2">Unable to load ticket form data.</p>
          <button type="button" className="btn zg-btn-primary btn-sm" onClick={loadReferenceData}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (createdTicket) {
    return (
      <div className="container py-4" style={{ maxWidth: 640 }}>
        <div className="rounded p-4 mb-3" style={{ backgroundColor: "var(--color-pale)" }}>
          <p className="fw-semibold mb-0">✓ Ticket {createdTicket.ticketNumber} created.</p>
        </div>

        {attachmentWarnings.length > 0 && (
          <div className="alert alert-warning">
            <p className="mb-1 fw-semibold">Some attachments could not be added:</p>
            <ul className="mb-0">
              {attachmentWarnings.map((failure, i) => (
                <li key={i}>
                  {failure.originalFilename}: {failure.message}
                </li>
              ))}
            </ul>
            <p className="mb-0 small">Retry from Ticket Detail.</p>
          </div>
        )}

        <div className="d-flex gap-2">
          <button
            type="button"
            className="btn zg-btn-primary"
            onClick={() => navigate(`/tickets/${createdTicket.id}`)}
          >
            View Ticket
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={resetForm}>
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="container py-4" style={{ maxWidth: 720 }} onSubmit={handleSubmit}>
      <h1 className="h4 mb-4">Create Ticket</h1>

      {apiError && (
        <div className="zg-alert-error rounded p-3 mb-3" role="alert">
          {apiError}
        </div>
      )}

      <div className="row mb-4">
        <div className="col-md-4">
          <label className="form-label fw-semibold">Ticket Number</label>
          <input className="form-control" disabled value="Assigned after submission" />
        </div>
        <div className="col-md-4">
          <label className="form-label fw-semibold">Ticket Date</label>
          <input className="form-control" disabled value="Today" />
        </div>
        <div className="col-md-4">
          <label className="form-label fw-semibold">Requester</label>
          <input className="form-control" disabled value={requester?.name ?? ""} />
        </div>
      </div>

      <div className="row mb-3">
        <div className="col-md-4">
          <label htmlFor="category" className="form-label fw-semibold">
            Category *
          </label>
          <select
            id="category"
            className="form-select"
            value={categoryId}
            disabled={submitting}
            onBlur={() => handleFieldBlur("categoryId")}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.categoryId && <p className="text-danger small mb-0">{fieldErrors.categoryId}</p>}
        </div>
        <div className="col-md-4">
          <label htmlFor="related-system" className="form-label fw-semibold">
            Related System *
          </label>
          <select
            id="related-system"
            className="form-select"
            value={relatedSystemId}
            disabled={submitting}
            onBlur={() => handleFieldBlur("relatedSystemId")}
            onChange={(e) => setRelatedSystemId(e.target.value)}
          >
            <option value="">Select…</option>
            {relatedSystems.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {fieldErrors.relatedSystemId && (
            <p className="text-danger small mb-0">{fieldErrors.relatedSystemId}</p>
          )}
        </div>
        <div className="col-md-4">
          <label htmlFor="priority" className="form-label fw-semibold">
            Requested Priority *
          </label>
          <select
            id="priority"
            className="form-select"
            value={requestedPriority}
            disabled={submitting}
            onBlur={() => handleFieldBlur("requestedPriority")}
            onChange={(e) => setRequestedPriority(e.target.value as TicketPriority)}
          >
            <option value="">Select…</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {fieldErrors.requestedPriority && (
            <p className="text-danger small mb-0">{fieldErrors.requestedPriority}</p>
          )}
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="summary" className="form-label fw-semibold">
          Summary *
        </label>
        <input
          id="summary"
          className="form-control"
          value={summary}
          disabled={submitting}
          onBlur={() => handleFieldBlur("summary")}
          onChange={(e) => setSummary(e.target.value)}
        />
        <div className="d-flex justify-content-between">
          {fieldErrors.summary ? (
            <p className="text-danger small mb-0">{fieldErrors.summary}</p>
          ) : (
            <span />
          )}
          <span className="text-muted small">{summary.length}/120</span>
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="description" className="form-label fw-semibold">
          Description *
        </label>
        <textarea
          id="description"
          className="form-control"
          rows={6}
          value={description}
          disabled={submitting}
          onBlur={() => handleFieldBlur("description")}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="d-flex justify-content-between">
          {fieldErrors.description ? (
            <p className="text-danger small mb-0">{fieldErrors.description}</p>
          ) : (
            <span />
          )}
          <span className="text-muted small">{description.length}/2000</span>
        </div>
      </div>

      <div className="mb-4">
        <label htmlFor="attachments" className="form-label fw-semibold">
          Attachments
        </label>
        <input
          id="attachments"
          type="file"
          multiple
          className="form-control"
          disabled={submitting}
          onChange={handleFilesSelected}
        />
        <p className="text-muted small mb-2">
          JPG, JPEG, PNG, WEBP, PDF, up to 5 MB, 5 files max.
        </p>
        {attachments.length > 0 && (
          <ul className="list-group">
            {attachments.map((row, i) => (
              <li key={i} className="list-group-item d-flex justify-content-between align-items-start">
                <div>
                  <div>
                    {row.file.name}{" "}
                    <span className="text-muted small">({formatFileSize(row.file.size)})</span>
                  </div>
                  {row.error && <div className="text-danger small">{row.error}</div>}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${row.file.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="d-flex justify-content-end gap-2">
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={submitting}
          onClick={() => navigate("/tickets")}
        >
          Cancel
        </button>
        <button type="submit" className="btn zg-btn-primary" disabled={submitting || !isFormValid}>
          {submitting ? "Submitting…" : "Submit Ticket"}
        </button>
      </div>
    </form>
  );
}
