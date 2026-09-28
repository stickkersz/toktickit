import { Attachment, getAttachmentDownloadUrl, getTicketComments, getTicketNotes, postTicketComment, postTicketNote } from "../api.js";
import { ContentPanel, LockIcon } from "../ContentPanel.js";
import { Tabs } from "../Tabs.js";
import { useContentThread } from "../content.js";
import { TruncatedFilename, fileTypeLabel, formatDate, formatFileSize } from "../attachmentDisplay.js";

// The panels under the handling controls on the IT Staff Ticket Detail (ui-spec.md section 8):
// Public Comments, Internal Notes and Attachments, as tabs with counts. They are a separate
// component so that the comments and notes are loaded and held apart from the controls above them,
// which reload and merge on their own schedule and must not be disturbed by a post, or the reverse.
export default function StaffTicketPanels({ ticketId, attachments }: { ticketId: number; attachments: Attachment[] }) {
  const comments = useContentThread(ticketId, getTicketComments, postTicketComment, "comment");
  const notes = useContentThread(ticketId, getTicketNotes, postTicketNote, "note");
  const activeAttachments = attachments.filter((a) => !a.isRemoved).length;

  return (
    <Tabs
      label="Ticket activity"
      idPrefix="staff-ticket"
      tabs={[
        // Staff may comment on a Ticket in any status, closed ones included (BR-34 limits only Requesters).
        { id: "comments", label: "Public Comments", count: comments.count, content: <ContentPanel kind="comments" thread={comments} /> },
        {
          id: "notes",
          label: "Internal Notes",
          count: notes.count,
          icon: <LockIcon />,
          // A tinted panel, a lock, and words: the two composers are never mistaken for each other.
          panelClassName: "zg-notes-panel",
          content: (
            <>
              <p className="zg-internal-label mb-3">
                <LockIcon />
                <strong>Internal only. Not visible to the Requester.</strong>
              </p>
              <ContentPanel kind="notes" thread={notes} />
            </>
          ),
        },
        // Read only for staff: a Requester adds and removes Attachments, staff only read them (BR-54,
        // BR-55). The upload and Remove controls are absent from the page, not merely disabled.
        { id: "attachments", label: "Attachments", count: activeAttachments, content: <AttachmentList attachments={attachments} /> },
      ]}
    />
  );
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return <p className="text-muted mb-0">No attachments.</p>;
  return (
    <ul className="list-group">
      {attachments.map((attachment) => (
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
  );
}
