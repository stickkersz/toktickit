# Lab 2 REST API Contract

Companion to `docs/lab-02/specification.md`. Every endpoint below implements one or more FR/BR from that document; ownership rules (BR-11, BR-28, BR-35) apply uniformly even though Lab 2 has no session layer.

## Conventions

- Base path: `/api`.
- All request/response bodies are JSON except file upload (`multipart/form-data`) and file download (raw bytes).
- Since there is no authenticated session (BR-03), every endpoint that touches Ticket or Attachment data takes an explicit `requesterId` (query parameter on GET, body field on POST/DELETE) representing the currently selected Development Requester. The server always re-derives ownership from the database and rejects mismatches; it never trusts a client-asserted relationship beyond this id.
- Timestamps are ISO 8601 UTC strings.
- Enums are transmitted as their Prisma enum string values: `requestedPriority` ∈ `LOW | MEDIUM | HIGH`; `currentStatus` ∈ `NEW` (only value reachable in Lab 2).

### Error shape

All non-2xx responses share one envelope:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Summary must be between 5 and 120 characters.",
  "fields": { "summary": "Summary must be between 5 and 120 characters." }
}
```

`fields` is present only for 400 responses tied to a specific form field; other error kinds omit it.

### HTTP status codes used

| Status | Meaning | Used by |
|---|---|---|
| 200 OK | Successful read, or successful soft-remove | GET endpoints, DELETE attachment |
| 201 Created | Ticket or Attachment created | POST tickets, POST attachments |
| 400 Bad Request | Missing/invalid field, invalid reference id, malformed query param | all write endpoints, list endpoint |
| 404 Not Found | Resource does not exist, or exists but is not owned by `requesterId` (BR-35: same code either way, never 403) | GET/DELETE by id |
| 409 Conflict | Max 5 active attachments reached (BR-26), attachment already removed | POST attachments, DELETE attachment |
| 410 Gone | Attachment exists but is soft-removed (BR-30) | GET attachment download |
| 413 Payload Too Large | File exceeds 5 MB (BR-26) | POST attachments |
| 415 Unsupported Media Type | File extension/MIME not in JPG/JPEG/PNG/WEBP/PDF (BR-26) | POST attachments |
| 500 Internal Server Error | Unexpected failure; body never leaks stack traces or DB details | any endpoint |

## 1. GET /api/categories

Purpose: reference data for the Create Ticket category select.

Auth/ownership: none (not Requester-scoped).

Request: no parameters.

Response 200:

```json
[
  { "id": 1, "name": "Hardware" },
  { "id": 2, "name": "Software" }
]
```

Errors: 500 on database failure. Client shows the safe-failure state from BR-34.

## 2. GET /api/related-systems

Purpose: reference data for the Create Ticket related-system select.

Auth/ownership: none.

Response 200: same shape as categories, `[{ "id": number, "name": string }]`.

Errors: 500.

## 3. GET /api/requesters

Purpose: populate the Development Requester Selection dropdown.

Auth/ownership: none. Server filters to `isActive = true` (BR-04); inactive Requesters never appear in the payload.

Response 200:

```json
[
  { "id": 1, "name": "Jennifer Anderson", "email": "jennifer.anderson@example.edu" }
]
```

Errors: 500. Client shows BR-33's empty/failure state (an empty `[]` array is a valid success response, not an error, when zero active Requesters exist).

## 4. POST /api/tickets

Purpose: create one validated Ticket (FR-02, FR-03). Attachments are **not** part of this call. The client uploads them afterward via endpoint 7, once the Ticket id is known (BR-25).

Auth/ownership: `requesterId` in the body must reference an existing, active Requester.

Request body:

```json
{
  "requesterId": 1,
  "categoryId": 3,
  "relatedSystemId": 5,
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle.",
  "requestedPriority": "MEDIUM"
}
```

Response 201:

```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-000042",
  "requesterId": 1,
  "categoryId": 3,
  "relatedSystemId": 5,
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle.",
  "requestedPriority": "MEDIUM",
  "currentStatus": "NEW",
  "createdAt": "2026-08-22T09:14:00.000Z"
}
```

Errors:
- 400 `VALIDATION_ERROR`: missing/out-of-range `summary` (BR-13) or `description` (BR-14), missing/invalid `requestedPriority` (BR-16), unknown or inactive `categoryId`/`relatedSystemId` (BR-15), unknown or inactive `requesterId`. `fields` maps each failing field to its message; multiple fields may fail at once.
- 500: no partial Ticket is left queryable (BR-19).

## 5. GET /api/tickets

Purpose: paginated, searched, filtered, sorted list of the current Requester's own Tickets (FR-04).

Auth/ownership: `requesterId` (query, required) scopes every result (BR-11).

Query parameters:

| Param | Required | Type | Notes |
|---|---|---|---|
| `requesterId` | yes | number | 400 if missing or not a valid active Requester id |
| `search` | no | string | matches `ticketNumber` (partial) or `summary` (partial, case-insensitive; BR-20) |
| `category` | no | number | `categoryId` to filter by |
| `requestedPriority` | no | `LOW\|MEDIUM\|HIGH` | exact match |
| `currentStatus` | no | `NEW` | exact match (only value in Lab 2) |
| `sort` | no | string | one of `createdAt`, `-createdAt`, `ticketNumber`, `-ticketNumber`, `summary`, `-summary`; default `-createdAt` (BR-22); unrecognized value falls back to default rather than erroring |
| `page` | no | number ≥ 1 | default 1; non-numeric/out-of-range falls back to default (BR-23) |
| `pageSize` | no | number, 5–50 | default 10; out-of-range falls back to default (BR-23) |

All filters combine with AND and with `search` (BR-21).

Response 200:

```json
{
  "data": [
    {
      "id": 42,
      "ticketNumber": "TKT-2026-000042",
      "summary": "Laptop battery drains quickly",
      "categoryName": "Hardware",
      "requestedPriority": "MEDIUM",
      "currentStatus": "NEW",
      "createdAt": "2026-08-22T09:14:00.000Z",
      "updatedAt": "2026-08-22T09:14:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "total": 1, "totalPages": 1 }
}
```

A zero-match search/filter returns `"data": []` with valid `pagination` metadata (`total: 0`), not an error (BR-24). The client distinguishes "empty" from "no results" (BR-24a) purely from whether it sent any `search`/`category`/`requestedPriority`/`currentStatus` param; the API response shape is identical either way.

Errors: 400 if `requesterId` missing or does not resolve to an active Requester; 500.

## 6. GET /api/tickets/:id

Purpose: full Ticket detail for the Requester Ticket Detail screen (FR-05), including its attachments.

Auth/ownership: `requesterId` (query, required). If the Ticket does not exist, or exists but its `requesterId` does not match, respond 404 either way (BR-35: existence is never leaked).

Response 200:

```json
{
  "id": 42,
  "ticketNumber": "TKT-2026-000042",
  "requesterId": 1,
  "requesterName": "Jennifer Anderson",
  "categoryId": 3,
  "categoryName": "Hardware",
  "relatedSystemId": 5,
  "relatedSystemName": "Corporate Laptop",
  "summary": "Laptop battery drains quickly",
  "description": "My laptop battery is draining much faster than usual even when the system is idle.",
  "requestedPriority": "MEDIUM",
  "currentStatus": "NEW",
  "createdAt": "2026-08-22T09:14:00.000Z",
  "updatedAt": "2026-08-22T09:14:00.000Z",
  "attachments": [
    {
      "id": 7,
      "originalFilename": "battery-report.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": 204800,
      "uploadedAt": "2026-08-22T09:14:05.000Z",
      "isRemoved": false
    },
    {
      "id": 6,
      "originalFilename": "old-screenshot.png",
      "mimeType": "image/png",
      "sizeBytes": 51200,
      "uploadedAt": "2026-08-21T10:00:00.000Z",
      "isRemoved": true,
      "removedAt": "2026-08-22T08:00:00.000Z",
      "removalReason": "Wrong file attached by mistake"
    }
  ]
}
```

Removed attachments keep full metadata (BR-30) but the client disables their download control; the payload carries no download URL for a removed row's file bytes.

Errors: 400 if `requesterId` missing/invalid; 404 not found or not owned; 500.

## 7. POST /api/tickets/:id/attachments

Purpose: add one or more permitted attachments to an existing, owned Ticket (FR-06, BR-26).

Auth/ownership: `requesterId` (body field, required, `multipart/form-data`); Ticket must exist and belong to that Requester or 404.

Request: `multipart/form-data` with fields `requesterId` and one or more `files` parts.

Per-file validation, independent of the others in the same request (BR-31):
- extension/MIME must be JPG, JPEG, PNG, WEBP, or PDF, else 415 for that file;
- size ≤ 5 MB, else 413 for that file;
- rejected only if accepting it would exceed 5 **active** attachments on the Ticket (BR-26), counted against the Ticket's current active count plus files already accepted earlier in the same request, else 409 for that file.

Response 201 (at least one file accepted):

```json
{
  "uploaded": [
    { "id": 8, "originalFilename": "receipt.jpg", "mimeType": "image/jpeg", "sizeBytes": 102400, "uploadedAt": "2026-08-22T09:20:00.000Z", "isRemoved": false }
  ],
  "failed": [
    { "originalFilename": "notes.docx", "reason": "UNSUPPORTED_TYPE", "message": "Only JPG, JPEG, PNG, WEBP, and PDF files are allowed." }
  ]
}
```

Response 400 (all files rejected, or `requesterId`/Ticket ownership check failed before any file processing; see errors below): same `failed` array, empty `uploaded`.

Errors:
- 400 `VALIDATION_ERROR`: no files present in the request.
- 404: Ticket not found or not owned by `requesterId`.
- Per-file 413/415/409 are reported inside the response body's `failed` array (not as the HTTP status of the whole request) whenever at least one other file in the same batch succeeds, per BR-31; if **every** file in the batch fails, the endpoint returns 400 with the same `failed` array so a fully-failed batch is distinguishable from a partial one.
- 500.

## 8. GET /api/attachments/:id

Purpose: metadata for one attachment (used to refresh a single row without reloading the whole Ticket).

Auth/ownership: `requesterId` (query, required); attachment's parent Ticket must belong to that Requester or 404.

Response 200: single attachment object, same shape as an entry in endpoint 6's `attachments` array.

Errors: 400 missing `requesterId`; 404 not found or not owned; 500.

## 9. GET /api/attachments/:id/download

Purpose: stream the file bytes of an active attachment (FR-08).

Auth/ownership: `requesterId` (query, required); attachment's parent Ticket must belong to that Requester or 404.

Response 200: file bytes, `Content-Type` set to the stored `mimeType`, `Content-Disposition: attachment; filename="<originalFilename>"`.

Errors:
- 400 missing `requesterId`.
- 404 not found or not owned.
- 410 `ATTACHMENT_REMOVED`: attachment exists and is owned, but `isRemoved = true` (BR-30); no bytes are returned.
- 500.

## 10. DELETE /api/attachments/:id

Purpose: soft-remove an active attachment with a reason (FR-07, BR-29).

Auth/ownership: `requesterId` (body field, required); attachment's parent Ticket must belong to that Requester or 404.

Request body:

```json
{ "requesterId": 1, "reason": "Duplicate of another attachment" }
```

Response 200: the updated attachment object (`isRemoved: true`, `removedAt`, `removalReason` populated), same shape as endpoint 8's response.

Errors:
- 400 `VALIDATION_ERROR`: missing `requesterId`, or `reason` missing/out of the 5–200 character range (BR-29).
- 404: attachment not found or not owned.
- 409 `ALREADY_REMOVED`: attachment is already soft-removed.
- 500.
