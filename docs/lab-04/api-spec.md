# Lab 4 REST API Contract

Companion to `docs/lab-04/specification.md`. Every endpoint below implements one or more FR or BR from that document. Lab 2 and Lab 3 endpoints are re-specified here only where Lab 4 changes them; everything else is unchanged and documented in `docs/lab-02/api-spec.md` and `docs/lab-03/api-spec.md`.

## Conventions

All Lab 3 conventions continue: base path `/api`; JSON bodies; identity from the `toktickit_session` cookie only; ISO 8601 UTC timestamps; enum values as their Prisma strings; no state-changing GET; the 401, 403, and 404 rule of Lab 3; the `{ error, message, fields? }` error envelope; and no stack trace, SQL, path, hash, or token in any error.

New enum values: `ActionStatus` is `PLANNED | COMPLETED | CANCELLED`.

### Idempotency-Key

`POST /api/tickets`, `POST /api/tickets/:id/comments`, `POST /api/tickets/:id/notes`, and `POST /api/tickets/:id/actions` accept an optional header (BR-39, ADR 0003):

```
Idempotency-Key: 6f1c2a7e-3b0d-4e55-9a51-2b8f0c1d7e44
```

- The value must be a UUID (any version, case-insensitive). Anything else gets 400 `VALIDATION_ERROR` with message "Idempotency-Key must be a UUID." and nothing is created.
- The key is stored on the created record, unique for (creating user, endpoint). It is checked after authentication and authorization, and after the Ticket is found and the body is valid, so a key never reveals anything a caller could not already see.
- First request: the normal response (201) and the record is created.
- Repeat with the same key and the same request: 200, the same body as the first response describes the record already created, header `Idempotent-Replayed: true`, nothing new is created. "The same request" means the same path and the same body fields after trimming; for Ticket create with files, the same field values and the same file names and sizes.
- Repeat with the same key and a different request: 409 `IDEMPOTENCY_KEY_REUSED`, message "This request was already submitted with different content. Refresh and try again.", nothing is created.
- Two requests with the same key arriving at the same moment: the database unique constraint lets exactly one insert succeed; the other is answered as a repeat.
- No header: behaviour exactly as in Lab 3.

### Optimistic concurrency on Actions

Every Action write (`PATCH /api/actions/:id`, `POST /api/actions/:id/complete`, `POST /api/actions/:id/cancel`) carries the `version` the client loaded (BR-13, ADR 0004). The server applies the change with `WHERE id = :id AND version = :version AND status = 'PLANNED'` and increments `version`. When no row matches:

- the Action is final: 409 `ACTION_FINAL`;
- otherwise the version is stale: 409 `STALE_ACTION`, body `{ error, message, action }` where `action` is the current Action in the endpoint 1 item shape, so the client can show what changed without losing the user's input.

### Status codes added in Lab 4

| Status | Code | Used by |
|---|---|---|
| 200 | replay with `Idempotent-Replayed: true` | the four create endpoints |
| 409 | `INVALID_RESPONSIBLE` | Action create and edit |
| 409 | `ACTION_FINAL` | Action edit, complete, cancel |
| 409 | `STALE_ACTION` | Action edit, complete, cancel |
| 409 | `TICKET_NOT_WORKABLE` | Action create, edit, complete, cancel |
| 409 | `ACTIONS_INCOMPLETE`, `NO_COMPLETED_ACTION` | status move to `RESOLVED` |
| 409 | `STATUS_CHANGED` | status move |
| 409 | `IDEMPOTENCY_KEY_REUSED` | the four create endpoints |

### Action item shape

Every endpoint that returns an Action uses this shape:

```json
{
  "id": 31,
  "ticketId": 42,
  "status": "PLANNED",
  "actionAt": "2026-10-03T02:00:00.000Z",
  "description": "Replace the LAN cable at desk 4B and retest the link.",
  "result": null,
  "followUpRequired": true,
  "followUpNote": "Check the switch port if the link drops again.",
  "attachmentNotes": "See photo desk-4b-port.jpg in Attachments.",
  "recordedBy": { "id": 7, "name": "Michael Brown" },
  "recordedAt": "2026-10-02T09:15:00.000Z",
  "responsibleStaff": { "id": 8, "name": "Sarah Chen", "eligible": true },
  "performedBy": null,
  "completedAt": null,
  "cancelledBy": null,
  "cancelledAt": null,
  "cancelReason": null,
  "lastEditedBy": null,
  "version": 1,
  "updatedAt": "2026-10-02T09:15:00.000Z"
}
```

`responsibleStaff.eligible` is derived on every read from the user's current row: `false` when they are inactive or no longer IT Staff or an Administrator (BR-08). No email, password data, or role history is returned for any person. A Requester receives the same shape, so they see every field (BR-17).

## 1. GET /api/tickets/:id/actions

Purpose: list a Ticket's Actions Taken (FR-02).

Authorization: a Requester for their own Ticket; IT Staff and Administrators for any Ticket.

Response 200: an array of Action items ordered by `actionAt` ascending, then `id` ascending (BR-16). A Ticket with no Actions returns `[]`.

Errors: 401; 404 when the id is malformed, the Ticket does not exist, or, for a Requester, it is not theirs (`L3-BR-15`); 500. A malformed id is a 404 for every role, as for the Lab 3 staff operations.

## 2. POST /api/tickets/:id/actions

Purpose: create an Action Taken (FR-01).

Authorization: IT Staff, Administrator. A Requester gets 403 `FORBIDDEN` decided from the role alone, before the Ticket is looked up (BR-17).

Headers: optional `Idempotency-Key`.

Request:

```json
{
  "actionAt": "2026-10-03T02:00:00.000Z",
  "description": "Replace the LAN cable at desk 4B and retest the link.",
  "responsibleStaffId": 8,
  "followUpRequired": true,
  "followUpNote": "Check the switch port if the link drops again.",
  "attachmentNotes": "See photo desk-4b-port.jpg in Attachments."
}
```

`responsibleStaffId` is optional and defaults to the caller. `followUpRequired` defaults to `false`; when it is `false`, any `followUpNote` is discarded (BR-04). `attachmentNotes` is optional. Fields such as `recordedById`, `performedById`, `status`, `result`, `version`, and any timestamp other than `actionAt` are ignored (BR-06).

Response 201: the created Action item, `status: "PLANNED"`, `version: 1`.

Errors, checked in this order:

- 401; 403 for a Requester.
- 404 when the Ticket does not exist (a malformed id included).
- 400 `VALIDATION_ERROR` with `fields`: `description` missing or outside 5 to 2000 after trimming; `actionAt` missing, not a valid date, earlier than the Ticket's `createdAt`, or more than 365 days ahead (BR-05); `followUpNote` missing or outside 5 to 1000 when `followUpRequired` is true; `attachmentNotes` over 1000; `responsibleStaffId` not an integer; `followUpRequired` not a boolean; malformed `Idempotency-Key`.
- 409 `INVALID_RESPONSIBLE`: the Responsible Staff user does not exist, is inactive, or holds the Requester role (BR-07, AC-04).
- 409 `TICKET_NOT_WORKABLE`: the Ticket is `RESOLVED`, `CLOSED`, or `CANCELLED` (BR-14).
- 409 `IDEMPOTENCY_KEY_REUSED`.
- 500.

The insert and the Ticket's status check run in one transaction holding a share lock on the Ticket row, so an Action cannot be added to a Ticket at the moment it is being resolved or cancelled (BR-21). The Ticket's `updatedAt` is touched (BR-19).

## 3. PATCH /api/actions/:id

Purpose: edit a Planned Action, including assigning or reassigning its Responsible Staff (FR-03, FR-04).

Authorization: IT Staff, Administrator. A Requester gets 403 from the role alone.

Request: `version` plus any subset of `description`, `actionAt`, `responsibleStaffId`, `followUpRequired`, `followUpNote`, `attachmentNotes`.

```json
{ "version": 1, "responsibleStaffId": 9 }
```

Response 200: the updated Action item, `version` increased by one.

Errors, checked in this order: 401; 403; 404 when the Action does not exist; 400 `VALIDATION_ERROR` (same field rules as endpoint 2, `version` missing or not a positive integer, or no editable field sent); 409 `TICKET_NOT_WORKABLE`; 409 `ACTION_FINAL`; 409 `STALE_ACTION`; 409 `INVALID_RESPONSIBLE`; 500. Fields outside the editable list are ignored (BR-12).

## 4. POST /api/actions/:id/complete

Purpose: complete a Planned Action (FR-05).

Authorization: IT Staff, Administrator.

Request:

```json
{ "version": 2, "result": "Cable replaced; link stable at 1 Gbps for 30 minutes.", "actionAt": "2026-10-03T02:40:00.000Z" }
```

`actionAt` is optional and corrects the Action Date/Time; the stored or corrected value must not be later than the server time plus 2 minutes (BR-05).

Response 200: the Action item with `status: "COMPLETED"`, `performedBy` the caller, `completedAt` the server time.

Errors, in order: 401; 403; 404; 400 (`result` missing or outside 5 to 2000, `actionAt` invalid or in the future, `version` missing); 409 `TICKET_NOT_WORKABLE`; 409 `ACTION_FINAL`; 409 `STALE_ACTION`; 500.

## 5. POST /api/actions/:id/cancel

Purpose: cancel a Planned Action (FR-06).

Authorization: IT Staff, Administrator.

Request: `{ "version": 2, "reason": "Duplicate of the cable replacement action." }`

Response 200: the Action item with `status: "CANCELLED"`, `cancelledBy`, `cancelledAt`, and `cancelReason`.

Errors, in order: 401; 403; 404; 400 (`reason` missing or outside 5 to 500, `version` missing); 409 `TICKET_NOT_WORKABLE`; 409 `ACTION_FINAL`; 409 `STALE_ACTION`; 500.

No endpoint deletes an Action (BR-18).

## 6. GET /api/tickets/:id/history

Purpose: the Ticket's Status History (FR-10).

Authorization: a Requester for their own Ticket; IT Staff and Administrators for any Ticket.

Response 200:

```json
{
  "entries": [
    { "id": 1, "fromStatus": null, "toStatus": "NEW", "changedBy": { "id": 3, "name": "Jennifer Anderson" }, "changedAt": "2026-09-12T09:14:00.000Z", "resolutionSummary": null },
    { "id": 88, "fromStatus": "IN_PROGRESS", "toStatus": "RESOLVED", "changedBy": { "id": 7, "name": "Michael Brown" }, "changedAt": "2026-10-03T03:00:00.000Z", "resolutionSummary": "Replaced the LAN cable; link stable." }
  ],
  "earlierChangesUnrecorded": false
}
```

Ordered by `changedAt`, then `id`, ascending (BR-26). `earlierChangesUnrecorded` is `true` when the Ticket's current status differs from the last entry's `toStatus`, which happens only for Tickets moved before Lab 4 (BR-25).

Errors: 401; 404 when the Ticket does not exist or, for a Requester, is not theirs; 500. No endpoint creates, edits, or deletes a Status Change directly (BR-24).

## 7. PATCH /api/staff/tickets/:id/status (changed)

Purpose: move a Ticket (FR-07, FR-08, FR-09). Lab 3 endpoint 10, with three changes.

Request:

```json
{ "fromStatus": "IN_PROGRESS", "currentStatus": "RESOLVED", "resolutionSummary": "Replaced the LAN cable; link stable." }
```

- `fromStatus` is now **required**: the status the user saw. Missing or not a `TicketStatus` value: 400 (BR-23).
- Checks run in this order: request (400); Ticket (404); `fromStatus` differs from the current status: 409 `STATUS_CHANGED`; move not permitted: 409 `INVALID_TRANSITION`; owner: 409 `OWNER_REQUIRED`; for `RESOLVED`, the gate: 409 `ACTIONS_INCOMPLETE`, then 409 `NO_COMPLETED_ACTION` (BR-21, BR-22).
- The move, the gate check, the Status Change insert (BR-24), and for `CANCELLED` the cancellation of Planned Actions (BR-15) run in one transaction holding an update lock on the Ticket row.

`STATUS_CHANGED` body: `{ "error": "STATUS_CHANGED", "message": "This Ticket moved to In Progress while you were viewing it. Check the current status and try again.", "currentStatus": "IN_PROGRESS", "permitted": ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"] }`.

`ACTIONS_INCOMPLETE` body adds `"plannedActions": 2`; `NO_COMPLETED_ACTION` body adds `"completedActions": 0`.

Response 200: the updated Ticket, as in Lab 3.

## 8. GET /api/tickets/:id (changed)

For IT Staff and Administrators the body adds:

```json
"resolutionGate": { "plannedActions": 1, "completedActions": 2, "canResolve": false }
```

`canResolve` is `plannedActions === 0 && completedActions > 0`. It lets the status control explain the gate before the user tries; the server still enforces it on the move (BR-21). A Requester never receives `resolutionGate`.

## 9. GET /api/dashboard/staff

Purpose: the IT Staff Dashboard (FR-12, FR-13).

Authorization: IT Staff, Administrator. A Requester gets 403.

Response 200:

```json
{
  "generatedAt": "2026-10-03T03:05:00.000Z",
  "timeZone": "Asia/Bangkok",
  "metrics": {
    "unassigned": { "count": 4, "link": "/staff/tickets?owner=needs-owner" },
    "myTickets": { "count": 6, "link": "/staff/tickets?owner=me&statusGroup=active" },
    "urgent": { "count": 3, "link": "/staff/tickets?itPriority=HIGH&statusGroup=active" },
    "byStatus": [
      { "status": "NEW", "count": 5, "link": "/staff/tickets?status=NEW" }
    ]
  },
  "myPlannedActions": {
    "count": 2,
    "items": [
      { "actionId": 31, "ticketId": 42, "ticketNumber": "TKT-2026-000042", "description": "Replace the LAN cable at desk 4B and retest the link.", "actionAt": "2026-10-03T02:00:00.000Z", "link": "/staff/tickets/42?tab=actions" }
    ]
  },
  "recentlyUpdated": [
    { "id": 42, "ticketNumber": "TKT-2026-000042", "summary": "Cannot connect to VPN", "currentStatus": "IN_PROGRESS", "updatedAt": "2026-10-03T03:00:00.000Z", "link": "/staff/tickets/42" }
  ],
  "accounts": {
    "active": { "REQUESTER": 4, "IT_STAFF": 3, "ADMINISTRATOR": 1 },
    "inactive": 2,
    "link": "/admin/users"
  }
}
```

- `byStatus` always holds all eight statuses in BR-20 order, zeros included.
- `myPlannedActions.items` and `recentlyUpdated` hold at most 5 entries; `description` is cut to 120 characters with an ellipsis.
- `accounts` is present only for an Administrator; for IT Staff the key is absent (BR-32, AC-33).
- Definitions are BR-31; each `link` is a client route that shows exactly the counted records (BR-36).

Errors: 401; 403 for a Requester; 500.

## 10. GET /api/dashboard/requester

Purpose: the Requester Dashboard (FR-11).

Authorization: Requester only; IT Staff and Administrators get 403 (BR-35). No query parameter is read.

Response 200:

```json
{
  "generatedAt": "2026-10-03T03:05:00.000Z",
  "timeZone": "Asia/Bangkok",
  "metrics": {
    "open": { "count": 3, "link": "/tickets?statusGroup=active" },
    "waitingForYou": { "count": 1, "link": "/tickets?status=WAITING_FOR_REQUESTER" },
    "recentlyUpdated": { "count": 2, "windowDays": 7, "link": "/tickets?updatedWithinDays=7&sort=-updatedAt" },
    "recentlyResolved": { "count": 1, "windowDays": 30, "link": "/tickets?resolvedWithinDays=30&sort=-updatedAt" }
  },
  "recentlyUpdated": [
    { "id": 42, "ticketNumber": "TKT-2026-000042", "summary": "Cannot connect to VPN", "currentStatus": "WAITING_FOR_REQUESTER", "updatedAt": "2026-10-03T03:00:00.000Z", "link": "/tickets/42" }
  ],
  "recentlyResolved": [
    { "id": 40, "ticketNumber": "TKT-2026-000040", "summary": "Printer jam on floor 3", "currentStatus": "RESOLVED", "resolvedAt": "2026-10-01T08:00:00.000Z", "link": "/tickets/40" }
  ]
}
```

Definitions are BR-33 with the BR-29 windows. Both lists hold at most 5 entries, latest first. Every figure is restricted to `requesterId = session user` inside the query (AC-02).

Errors: 401; 403 for IT Staff and Administrators; 500.

## 11. List filters (changed)

`GET /api/tickets` (My Tickets) and `GET /api/staff/tickets` (Ticket Queue) gain, so dashboard links work (BR-36):

| Parameter | Values | Meaning |
|---|---|---|
| `statusGroup` | `active` | status not `RESOLVED`, `CLOSED`, or `CANCELLED` |
| `statusGroup` | `resolved` | status `RESOLVED` or `CLOSED` |
| `status` (queue) and `currentStatus` (My Tickets) | any one `TicketStatus` | unchanged; now accepts all eight values on My Tickets |
| `sort` | adds `updatedAt` and `-updatedAt` on My Tickets | the queue already had them |
| `updatedWithinDays` (My Tickets only) | integer 1 to 90 | last activity inside the BR-29 window of that many days |
| `resolvedWithinDays` (My Tickets only) | integer 1 to 90 | status `RESOLVED` or `CLOSED` and the latest Status Change to `RESOLVED` inside the BR-29 window |

The single-status parameter is `status` on the queue and keeps its Lab 2 name `currentStatus` on My Tickets; the client routes use `status` for both and translate. `statusGroup` and the window parameters combine with every other filter by AND, and an out-of-range window falls back to none. When both `statusGroup` and a single status are sent, the single status wins. An unknown `statusGroup` value falls back to no group (`L2-BR-23`).

## 12. Create endpoints (changed)

`POST /api/tickets`, `POST /api/tickets/:id/comments`, and `POST /api/tickets/:id/notes` keep their Lab 3 bodies and responses and add the `Idempotency-Key` behaviour above. `POST /api/tickets` also writes the creation Status Change (BR-24) in the same transaction as the Ticket.

## 13. Endpoints unchanged from Lab 3

Authentication, Attachments (including Preview), the resolution indication (it writes no Status Change, BR-27), owner and IT Priority changes, Public Comment and Internal Note reads, `GET /api/staff/owners` (also the Responsible Staff list), and every Administrator user endpoint behave exactly as in `docs/lab-03/api-spec.md`. `GET /api/health` answers 200 `{ "status": "ok", "service": "TokTickIT API" }` (FR-20).
