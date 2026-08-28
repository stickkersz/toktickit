// Mirrors server/src/attachmentValidation.ts (BR-26) for immediate
// client-side feedback (AC-07/08/09); the server is still authoritative.
export type AttachmentRejectReason = "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE" | "MAX_ATTACHMENTS_EXCEEDED";

export const ATTACHMENT_REJECT_MESSAGES: Record<AttachmentRejectReason, string> = {
  UNSUPPORTED_TYPE: "Only JPG, JPEG, PNG, WEBP, and PDF files are allowed.",
  FILE_TOO_LARGE: "File exceeds the 5 MB limit.",
  MAX_ATTACHMENTS_EXCEEDED: "Maximum of 5 files.",
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ACTIVE_ATTACHMENTS = 5;

export function validateAttachmentFile(
  file: File,
  currentValidCount: number,
): AttachmentRejectReason | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(file.type)) {
    return "UNSUPPORTED_TYPE";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "FILE_TOO_LARGE";
  }
  if (currentValidCount >= MAX_ACTIVE_ATTACHMENTS) {
    return "MAX_ATTACHMENTS_EXCEEDED";
  }
  return null;
}
