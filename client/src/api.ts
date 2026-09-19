// Empty by default: requests are relative (`/api/...`) and travel through the Vite
// dev proxy, so the API is same-origin and the session cookie is first-party
// (vite.config.ts, ADR 0001). VITE_API_URL is an optional escape hatch for an API
// on another origin, which then relies on the server's credentialed CORS
// allow-list (BR-62).
const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

// Every request carries the session cookie.
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });
}

export interface Category {
  id: number;
  name: string;
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

// No requesterId: the Ticket belongs to whoever is signed in (BR-11).
export interface CreateTicketInput {
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: TicketPriority;
}

// The first three are per-file validation outcomes and are mirrored by the
// client-side check in attachmentValidation.ts. UPLOAD_FAILED is server-only:
// it names a file the server never reached a decision on because the batch
// failed part-way through (api-spec.md §7), so it has no client-side
// equivalent and is never produced by validateAttachmentFile.
export type AttachmentRejectReason =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "MAX_ATTACHMENTS_EXCEEDED"
  | "UPLOAD_FAILED";

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
  search?: string;
  category?: number;
  requestedPriority?: TicketPriority;
  currentStatus?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

// Carries the HTTP status (0 when the API could not be reached) and the API's
// error code, so a screen can tell a credential failure from an outage.
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// BR-18: thrown on a 400 VALIDATION_ERROR so the form can show per-field
// errors and keep the entered values, per the API's { fields } shape.
export class ValidationError extends ApiError {
  fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string>) {
    super(message, 400, "VALIDATION_ERROR");
    this.fields = fields;
  }
}

// BR-35: a 404 (not found / not owned / requester unresolved) is never
// distinguishable from the other two, so Ticket Detail treats all three as
// one "not found" screen state, never a generic retryable error.
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

// Lab 2 — Create Ticket reference data (api-spec.md §1).
export async function getCategories(): Promise<Category[]> {
  const res = await apiFetch(`/api/categories`);
  if (!res.ok) {
    throw new ApiError("Unable to load Categories.", res.status);
  }
  return res.json();
}

// Lab 2 — Create Ticket reference data (api-spec.md §2).
export async function getRelatedSystems(): Promise<RelatedSystem[]> {
  const res = await apiFetch(`/api/related-systems`);
  if (!res.ok) {
    throw new ApiError("Unable to load Related Systems.", res.status);
  }
  return res.json();
}

// Lab 2 — Create Ticket (api-spec.md §4).
//
// Create Ticket is the one screen that renders a thrown error's own message to
// the Requester, so the two failure modes below have to produce something
// readable rather than whatever the browser or a non-JSON response happens to
// say. BR-34 asks for a safe failure state; "Failed to fetch" is the raw
// TypeError text from fetch and means nothing to a Requester, so the technical
// detail goes to the console and the UI gets a stable, documented message.
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  let res: Response;
  try {
    res = await apiFetch(`/api/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    console.error("createTicket: request did not reach the API", cause);
    throw new Error("Unable to reach the TokTickIT API. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    // A non-JSON body means the request failed before any route handler ran,
    // so there is no documented error envelope to read.
    console.error("createTicket: response body was not JSON", cause);
    throw new Error("The server returned an unexpected response. Please try again.");
  }

  const payload = body as { error?: string; message?: string; fields?: Record<string, string> };
  if (!res.ok) {
    if (payload?.error === "VALIDATION_ERROR") {
      throw new ValidationError(payload.message ?? "Validation failed.", payload.fields ?? {});
    }
    throw new ApiError(payload?.message ?? "Unable to create the Ticket.", res.status, payload?.error);
  }
  return body as Ticket;
}

// Lab 2 — My Tickets (api-spec.md §5, FR-04).
export async function getTickets(params: TicketListParams): Promise<TicketListResult> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", String(params.category));
  if (params.requestedPriority) query.set("requestedPriority", params.requestedPriority);
  if (params.currentStatus) query.set("currentStatus", params.currentStatus);
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));

  const res = await apiFetch(`/api/tickets?${query.toString()}`);
  if (!res.ok) {
    throw new ApiError("Unable to load tickets.", res.status);
  }
  return res.json();
}

// Lab 2 — Attachment upload during/after creation (api-spec.md §7, BR-25).
// A 400 ALL_FILES_REJECTED is not thrown: it carries the same
// { uploaded, failed } shape as a 201, so the caller handles both uniformly.
export async function uploadAttachments(ticketId: number, files: File[]): Promise<UploadAttachmentsResult> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await apiFetch(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: formData,
  });
  const body = await res.json();
  // A mid-batch 500 still carries whatever was committed before the failure
  // (api-spec.md §7). Throwing it away would report files as failed that are
  // already attached to the Ticket, so the Requester would re-upload them.
  const carriesBatchResult =
    body?.error === "ALL_FILES_REJECTED" || Array.isArray(body?.uploaded);
  if (!res.ok && !carriesBatchResult) {
    throw new ApiError(body?.message ?? "Unable to upload attachments.", res.status, body?.error);
  }
  return { uploaded: body.uploaded ?? [], failed: body.failed ?? [] };
}

// Lab 2 — Requester Ticket Detail (api-spec.md §6, FR-05).
export async function getTicketDetail(ticketId: number): Promise<TicketDetail> {
  const res = await apiFetch(`/api/tickets/${ticketId}`);
  if (res.status === 404) {
    throw new NotFoundError("Ticket not found.");
  }
  if (!res.ok) {
    throw new ApiError("Unable to load the Ticket.", res.status);
  }
  return res.json();
}

// Lab 2 — Attachment removal (api-spec.md §10, FR-07, BR-29).
export async function removeAttachment(attachmentId: number, reason: string): Promise<Attachment> {
  const res = await apiFetch(`/api/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(body?.message ?? "Unable to remove the attachment.", res.status, body?.error);
  }
  return body;
}

// Lab 2 — Attachment download (api-spec.md §9, FR-08). A plain URL, not a
// fetch: the server sets Content-Disposition so the browser handles the
// save itself.
export function getAttachmentDownloadUrl(attachmentId: number): string {
  return `${API_BASE}/api/attachments/${attachmentId}/download`;
}

// ---------------------------------------------------------------------------
// Lab 3 authentication (api-spec.md endpoints 1 to 4).
// ---------------------------------------------------------------------------

export type UserRole = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

async function authRequest(path: string, init?: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch (cause) {
    // The raw TypeError text means nothing to a user; the technical detail goes
    // to the console and the screen gets a stable message.
    console.error(`${path}: request did not reach the API`, cause);
    throw new ApiError("Unable to reach the TokTickIT API. Check your connection and try again.", 0, "NETWORK_ERROR");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body means the request failed before any route handler ran.
  }
  return { res, body };
}

function errorFromResponse(status: number, body: unknown, fallback: string): ApiError {
  const payload = (body ?? {}) as { error?: string; message?: string; fields?: Record<string, string> };
  if (payload.error === "VALIDATION_ERROR") {
    return new ValidationError(payload.message ?? "Validation failed.", payload.fields ?? {});
  }
  return new ApiError(payload.message ?? fallback, status, payload.error);
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// POST /api/auth/login. 401 INVALID_CREDENTIALS and 401 ACCOUNT_INACTIVE are
// thrown as an ApiError whose `code` tells the two apart (BR-09).
export async function login(email: string, password: string): Promise<AuthUser> {
  const { res, body } = await authRequest("/api/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw errorFromResponse(res.status, body, "Unable to sign in.");
  return body as AuthUser;
}

// GET /api/auth/me. A 401 is the expected "not signed in" answer, not an error.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const { res, body } = await authRequest("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) throw errorFromResponse(res.status, body, "Unable to load the current user.");
  return body as AuthUser;
}

// POST /api/auth/logout. Best effort: the client forgets the user either way.
export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch (cause) {
    console.error("logout: request did not reach the API", cause);
  }
}

// POST /api/auth/change-password. A 400 is a ValidationError carrying `fields`;
// a 401 INVALID_CREDENTIALS means the current password was wrong.
export async function changePassword(input: ChangePasswordInput): Promise<AuthUser> {
  const { res, body } = await authRequest("/api/auth/change-password", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw errorFromResponse(res.status, body, "Unable to change the password.");
  return body as AuthUser;
}
