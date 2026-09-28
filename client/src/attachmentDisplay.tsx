// Shared by the Requester and the IT Staff Ticket Detail, so an Attachment reads the same to both.

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ui-spec.md §8: each attachment row shows a file-type icon.
export function fileTypeLabel(mimeType: string): string {
  switch (mimeType) {
    case "application/pdf":
      return "PDF";
    case "image/jpeg":
      return "JPG";
    case "image/png":
      return "PNG";
    case "image/webp":
      return "WEBP";
    default:
      return "FILE";
  }
}

// Long filenames are truncated with an ellipsis; the full name stays
// available via the native `title` tooltip rather than being lost.
export function TruncatedFilename({ name }: { name: string }) {
  return (
    <span className="text-truncate d-inline-block align-bottom" style={{ maxWidth: 320 }} title={name}>
      {name}
    </span>
  );
}

