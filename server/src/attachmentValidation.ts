export type AttachmentRejectReason = "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE" | "MAX_ATTACHMENTS_EXCEEDED";

export const ATTACHMENT_REJECT_MESSAGES: Record<AttachmentRejectReason, string> = {
  UNSUPPORTED_TYPE: "Only JPG, JPEG, PNG, WEBP, and PDF files are allowed.",
  FILE_TOO_LARGE: "File exceeds the 5 MB limit.",
  MAX_ATTACHMENTS_EXCEEDED: "This ticket already has 5 active attachments.",
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ACTIVE_ATTACHMENTS = 5;

export interface AttachmentCandidate {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

// BR-26/BR-31: type, size, and active-count are independent checks; the
// caller passes the running count (existing active + already accepted
// earlier in the same request) so the count check is batch-aware.
export function validateAttachment(
  file: AttachmentCandidate,
  currentActiveCount: number,
): AttachmentRejectReason | null {
  const extension = file.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(file.mimeType)) {
    return "UNSUPPORTED_TYPE";
  }
  if (file.sizeBytes > MAX_FILE_BYTES) {
    return "FILE_TOO_LARGE";
  }
  if (currentActiveCount >= MAX_ACTIVE_ATTACHMENTS) {
    return "MAX_ATTACHMENTS_EXCEEDED";
  }
  return null;
}
