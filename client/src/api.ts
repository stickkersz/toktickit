const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface Requester {
  id: number;
  name: string;
  email: string;
}

export interface RelatedSystem {
  id: number;
  name: string;
}

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH";

export interface Ticket {
  id: number;
  ticketNumber: string;
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: TicketPriority;
  currentStatus: string;
  createdAt: string;
}

export interface CreateTicketInput {
  requesterId: number;
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: TicketPriority;
}

export type AttachmentRejectReason = "UNSUPPORTED_TYPE" | "FILE_TOO_LARGE" | "MAX_ATTACHMENTS_EXCEEDED";

export interface UploadedAttachment {
  id: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  isRemoved: boolean;
}

export interface FailedAttachment {
  originalFilename: string;
  reason: AttachmentRejectReason;
  message: string;
}

export interface UploadAttachmentsResult {
  uploaded: UploadedAttachment[];
  failed: FailedAttachment[];
}

export interface Attachment {
  id: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  isRemoved: boolean;
  removedAt?: string;
  removalReason?: string;
}

export interface TicketDetail {
  id: number;
  ticketNumber: string;
  requesterId: number;
  requesterName: string;
  categoryId: number;
  categoryName: string;
  relatedSystemId: number;
  relatedSystemName: string;
  summary: string;
  description: string;
  requestedPriority: TicketPriority;
  currentStatus: string;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
}

export interface TicketListItem {
  id: number;
  ticketNumber: string;
  summary: string;
  categoryName: string;
  requestedPriority: TicketPriority;
  currentStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketListPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TicketListResult {
  data: TicketListItem[];
  pagination: TicketListPagination;
}

export interface TicketListParams {
  requesterId: number;
  search?: string;
  category?: number;
  requestedPriority?: TicketPriority;
  currentStatus?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

// BR-18: thrown on a 400 VALIDATION_ERROR so the form can show per-field
// errors and keep the entered values, per the API's { fields } shape.
export class ValidationError extends Error {
  fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string>) {
    super(message);
    this.fields = fields;
  }
}

// BR-35: a 404 (not found / not owned / requester unresolved) is never
// distinguishable from the other two, so Ticket Detail treats all three as
// one "not found" screen state, never a generic retryable error.
export class NotFoundError extends Error {}

// Lab 2 — Development Requester Selection (api-spec.md §3).
export async function getRequesters(): Promise<Requester[]> {
  const res = await fetch(`${API_URL}/api/requesters`);
  if (!res.ok) {
    throw new Error("Unable to load Development Requesters.");
  }
  return res.json();
}

// Lab 2 — Create Ticket reference data (api-spec.md §1).
export async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${API_URL}/api/categories`);
  if (!res.ok) {
    throw new Error("Unable to load Categories.");
  }
  return res.json();
}

// Lab 2 — Create Ticket reference data (api-spec.md §2).
export async function getRelatedSystems(): Promise<RelatedSystem[]> {
  const res = await fetch(`${API_URL}/api/related-systems`);
  if (!res.ok) {
    throw new Error("Unable to load Related Systems.");
  }
  return res.json();
}

// Lab 2 — Create Ticket (api-spec.md §4).
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const res = await fetch(`${API_URL}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) {
    if (body?.error === "VALIDATION_ERROR") {
      throw new ValidationError(body.message ?? "Validation failed.", body.fields ?? {});
    }
    throw new Error(body?.message ?? "Unable to create the Ticket.");
  }
  return body;
}

// Lab 2 — My Tickets (api-spec.md §5, FR-04).
export async function getTickets(params: TicketListParams): Promise<TicketListResult> {
  const query = new URLSearchParams();
  query.set("requesterId", String(params.requesterId));
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", String(params.category));
  if (params.requestedPriority) query.set("requestedPriority", params.requestedPriority);
  if (params.currentStatus) query.set("currentStatus", params.currentStatus);
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));

  const res = await fetch(`${API_URL}/api/tickets?${query.toString()}`);
  if (!res.ok) {
    throw new Error("Unable to load tickets.");
  }
  return res.json();
}

// Lab 2 — Attachment upload during/after creation (api-spec.md §7, BR-25).
// A 400 ALL_FILES_REJECTED is not thrown: it carries the same
// { uploaded, failed } shape as a 201, so the caller handles both uniformly.
export async function uploadAttachments(
  ticketId: number,
  requesterId: number,
  files: File[],
): Promise<UploadAttachmentsResult> {
  const formData = new FormData();
  formData.append("requesterId", String(requesterId));
  files.forEach((file) => formData.append("files", file));

  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: formData,
  });
  const body = await res.json();
  if (!res.ok && body?.error !== "ALL_FILES_REJECTED") {
    throw new Error(body?.message ?? "Unable to upload attachments.");
  }
  return { uploaded: body.uploaded ?? [], failed: body.failed ?? [] };
}

// Lab 2 — Requester Ticket Detail (api-spec.md §6, FR-05).
export async function getTicketDetail(ticketId: number, requesterId: number): Promise<TicketDetail> {
  const res = await fetch(`${API_URL}/api/tickets/${ticketId}?requesterId=${requesterId}`);
  if (res.status === 404) {
    throw new NotFoundError("Ticket not found.");
  }
  if (!res.ok) {
    throw new Error("Unable to load the Ticket.");
  }
  return res.json();
}

// Lab 2 — Attachment removal (api-spec.md §10, FR-07, BR-29).
export async function removeAttachment(
  attachmentId: number,
  requesterId: number,
  reason: string,
): Promise<Attachment> {
  const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requesterId, reason }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.message ?? "Unable to remove the attachment.");
  }
  return body;
}

// Lab 2 — Attachment download (api-spec.md §9, FR-08). A plain URL, not a
// fetch: the server sets Content-Disposition so the browser handles the
// save itself.
export function getAttachmentDownloadUrl(attachmentId: number, requesterId: number): string {
  return `${API_URL}/api/attachments/${attachmentId}/download?requesterId=${requesterId}`;
}

