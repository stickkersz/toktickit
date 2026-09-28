import { RoleBadge } from "./Badge.js";
import { formatDate } from "./attachmentDisplay.js";
import { CONTENT_MAX, ContentThread } from "./content.js";

export type ContentKind = "comments" | "notes";

const COPY: Record<ContentKind, { composer: string; post: string; empty: string; loadFailed: string }> = {
  comments: { composer: "Add Public Comment", post: "Post Comment", empty: "No comments yet.", loadFailed: "Unable to load the comments." },
  notes: { composer: "Add Internal Note", post: "Add Note", empty: "No notes yet.", loadFailed: "Unable to load the notes." },
};

export function LockIcon() {
  return (
    <svg className="zg-lock" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 0 1 3 0v2h-3V4Z" />
    </svg>
  );
}

// A chronological list, oldest first, and the composer that adds to it (ui-spec.md sections 6 and 8).
// Bodies are rendered as plain text: React escapes them, and no markup in them is ever interpreted (BR-36).
// `blockedReason` replaces the composer with an explanation, for a Requester on a closed Ticket (BR-34).
export function ContentPanel({ kind, thread, blockedReason }: { kind: ContentKind; thread: ContentThread; blockedReason?: string }) {
  const copy = COPY[kind];
  const composerId = `content-composer-${kind}`;
  const trimmedLength = thread.draft.trim().length;

  if (thread.state === "loading") return <p role="status">Loading…</p>;

  if (thread.state === "error") {
    return (
      <div className="zg-alert-error rounded p-3" role="alert">
        <p className="mb-2">{copy.loadFailed}</p>
        <button type="button" className="btn zg-btn-primary btn-sm" onClick={thread.retry}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {thread.items.length === 0 ? (
        <p className="text-muted">{copy.empty}</p>
      ) : (
        <ol className="list-unstyled mb-3">
          {thread.items.map((entry) => (
            <li key={entry.id} className="zg-content-entry">
              <div className="d-flex flex-wrap align-items-center gap-2 small mb-1">
                <strong>{entry.authorName}</strong>
                <RoleBadge role={entry.authorRole} />
                <time className="text-muted" dateTime={entry.createdAt}>
                  {formatDate(entry.createdAt)}
                </time>
              </div>
              <div className="zg-content-body">{entry.body}</div>
            </li>
          ))}
        </ol>
      )}

      {blockedReason ? (
        <p className="text-muted small mb-0">{blockedReason}</p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void thread.post();
          }}
        >
          <label htmlFor={composerId} className="form-label fw-semibold">
            {copy.composer}
          </label>
          <textarea
            id={composerId}
            className={`form-control zg-editable${thread.problem ? " is-invalid" : ""}`}
            rows={3}
            value={thread.draft}
            disabled={thread.posting}
            aria-invalid={thread.problem ? true : undefined}
            aria-describedby={`${composerId}-help`}
            onChange={(e) => thread.setDraft(e.target.value)}
          />
          <div id={`${composerId}-help`} className="d-flex justify-content-between align-items-start gap-2 small mt-1">
            <span className="zg-field-error" role={thread.problem ? "alert" : undefined}>
              {thread.problem}
            </span>
            <span className="text-muted text-nowrap">
              {trimmedLength}/{CONTENT_MAX}
            </span>
          </div>
          <div className="d-flex justify-content-end mt-2">
            <button type="submit" className="btn zg-btn-primary zg-touch-target" disabled={thread.posting}>
              {thread.posting ? "Posting…" : copy.post}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
