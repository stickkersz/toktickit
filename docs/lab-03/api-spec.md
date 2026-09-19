# Lab 3 REST API Contract

Companion to `docs/lab-03/specification.md`. Every endpoint below implements one or more FR/BR from that document. Lab 2 endpoints are re-specified here only where Lab 3 changes them; their request and response bodies are otherwise unchanged and remain documented in `docs/lab-02/api-spec.md`.

## Conventions

- Base path: `/api`.
- All request and response bodies are JSON except file upload (`multipart/form-data`) and file download (raw bytes).
- **Identity comes from the session cookie, never from the request body or query string.** The `requesterId` parameter that every Lab 2 Ticket and Attachment endpoint required is removed (BR-11). A client that still sends it is not rejected for sending it; the value is ignored entirely, and the authenticated identity is used instead. AC-03 tests exactly this.
- Timestamps are ISO 8601 UTC strings.
- Enum values are transmitted as their Prisma enum strings: `role` is `REQUESTER | IT_STAFF | ADMINISTRATOR`; `requestedPriority` and `itPriority` are `LOW | MEDIUM | HIGH`; `currentStatus` is one of the eight values in BR-23.
- No state-changing operation uses GET. Together with `SameSite=Lax` this is the documented CSRF posture (BR-05).

### Public endpoints

Only three endpoints need no session: `GET /api/health`, and the two reference lists a Ticket form is built from, `GET /api/categories` and `GET /api/related-systems`. The lists hold no personal data and are unchanged from Lab 2. Every other endpoint in this document requires a session, and `GET /api/requesters` no longer exists (BR-49).

### Session cookie

- Name `toktickit_session`, value an opaque 32-byte random token, base64url encoded.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` matching the 8 hour absolute expiry. `Secure` is omitted in local development over plain HTTP and is required in any deployed environment (BR-05).
- The server stores only the SHA-256 digest of the token (BR-04). The raw token exists only in the cookie.
- Set by `POST /api/auth/login`, cleared by `POST /api/auth/logout`.

### Cross-origin access

From Issue 03 the client calls a relative `/api` through a Vite dev proxy, so the cookie is first-party and CORS is not involved. That proxy does not exist yet. Until Issue 03 lands, the Lab 2 client calls the API at `VITE_API_URL` (`http://localhost:3000`) from `http://localhost:5173`, which is cross-origin and does not yet send `credentials`, so credentialed CORS is what lets a page use the session cookie in the meantime, and it stays as the fallback afterwards. For a page served from another origin the API supports credentialed CORS (BR-62, AC-45):

- An `Origin` listed in `CORS_ORIGINS` (default: `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:5180`, `http://127.0.0.1:5180`) gets that exact origin in `Access-Control-Allow-Origin`, plus `Access-Control-Allow-Credentials: true` and `Vary: Origin`, on both the preflight `OPTIONS` and the real response. The client must send `credentials: "include"`.
- Any other origin gets no CORS headers, so the browser blocks it. A request with no `Origin` header, such as a same-origin call, is untouched.
- `Access-Control-Allow-Origin` is never `*`, and a `*` in `CORS_ORIGINS` is ignored.

### 401 vs 403 vs 404

One rule, applied identically at every endpoint:

- **401 `UNAUTHENTICATED`**: no session cookie, an unknown or expired token, a session whose user no longer exists, or a user whose `isActive` is now false (BR-08). The client's correct response is to return to Login.
- **403 `FORBIDDEN`**: the caller is authenticated but their role does not permit the operation (BR-14), or their `mustChangePassword` flag is still set and the endpoint is not one of the three permitted during that state (BR-02, returned as `PASSWORD_CHANGE_REQUIRED`). No protected content appears in the body.
- **404 `NOT_FOUND`**: a Requester asking for a Ticket, Attachment, or Public Comment that does not exist, or that exists but belongs to another Requester (BR-15, preserving `L2-BR-35`). Ownership and existence stay indistinguishable for a Requester.

The distinction between 403 and 404 is deliberate and narrow: 403 answers "your role may not do this at all", which leaks nothing about any specific record, while 404 answers "this specific record is not yours", which must stay indistinguishable from "it does not exist". IT Staff and Administrators can open any Ticket, so for them a missing Ticket is a plain 404 with no ambiguity to preserve.

### Error shape

All non-2xx responses share the Lab 2 envelope:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Password must include at least one number.",
  "fields": { "newPassword": "Password must include at least one number." }
}
```

`fields` appears only on a 400 tied to specific form fields. The two Lab 2 exceptions on the attachment upload endpoint (`ALL_FILES_REJECTED` and a mid-batch `INTERNAL_ERROR` carrying `uploaded` and `failed`) are unchanged.

### Status codes used

| Status | Meaning | Used by |
|---|---|---|
| 200 OK | successful read or successful mutation returning the updated resource | most endpoints |
| 201 Created | Ticket, Attachment, Comment, Note, or User created | POST creation endpoints |
| 400 Bad Request | missing or invalid field, malformed id, unpermitted enum value | all write endpoints |
| 401 Unauthorized | not authenticated, expired, logged out, or deactivated | every protected endpoint |
| 403 Forbidden | authenticated but role not permitted, or password change outstanding | role-restricted endpoints, including Attachment upload and removal for IT Staff and Administrators |
| 404 Not Found | resource absent, or a Requester's non-owned resource | Ticket, Attachment, Comment endpoints |
| 409 Conflict | duplicate email, unpermitted status transition, last-active-Administrator guard, attachment already removed | admin users, status, DELETE attachment |
| 410 Gone | attachment exists but is soft-removed | attachment download |
| 500 Internal Server Error | unexpected failure, never leaking stack traces or database detail | any endpoint |

## 1. POST /api/auth/login

Purpose: authenticate and establish a session (FR-01).

Authorization: public.

Request:

```json
{ "email": "jennifer.anderson@toktickit.local", "password": "ChangeMe!23" }
```

Response 200, plus a `Set-Cookie` header carrying the session:

```json
{
  "id": 1,
  "name": "Jennifer Anderson",
  "email": "jennifer.anderson@toktickit.local",
  "role": "REQUESTER",
  "mustChangePassword": true
}
```

`mustChangePassword: true` tells the client to route straight to the Change Password screen (BR-02).

Errors:

- 400 `VALIDATION_ERROR`: email or password missing or not a string.
- 401 `INVALID_CREDENTIALS`, message "Invalid email or password.": unknown email, or wrong password. Identical response for both (BR-09, AC-06).
- 401 `ACCOUNT_INACTIVE`, message "This account is inactive. Contact an administrator.": credentials are correct but `isActive` is false. Returned only after the password verifies, so it never discloses account existence to someone without the password (BR-09, AC-05). No session is created.
- 500 `INTERNAL_ERROR`.

A failed login runs the same password verification work as a successful one, including for an unknown email, so response timing does not distinguish the two cases.

## 2. POST /api/auth/logout

Purpose: invalidate the current session (FR-03).

Authorization: any authenticated user, including one with an outstanding password change.

Request body: none.

Response 200: `{ "ok": true }`, plus a `Set-Cookie` header expiring the cookie.

Errors: 401 if no valid session. Deleting an already-deleted session is not an error: logout is idempotent from the client's point of view.

After logout the same cookie value returns 401 on every endpoint (BR-07, AC-09).

## 3. GET /api/auth/me

Purpose: retrieve the current authenticated user for shell display and navigation (FR-04).

Authorization: any authenticated user, including one with an outstanding password change.

Response 200: the same object shape as login.

Errors: 401 when there is no valid session. This is the endpoint the client calls on mount to decide between the application and the Login screen, so a 401 here is an expected, non-exceptional result.

## 4. POST /api/auth/change-password

Purpose: set a new password, whether mandatory or voluntary (FR-02).

Authorization: any authenticated user. Permitted while `mustChangePassword` is set.

Request:

```json
{ "currentPassword": "ChangeMe!23", "newPassword": "Zen$Green7", "confirmPassword": "Zen$Green7" }
```

Response 200: the updated user object, with `mustChangePassword` now false.

Errors:

- 400 `VALIDATION_ERROR` with `fields`, one entry per unmet rule: `newPassword` shorter than 8 or longer than 128, missing an upper case letter, a lower case letter, a digit, or a special character; `newPassword` equal to `currentPassword`; `confirmPassword` not matching (BR-10, AC-07).
- 401 `INVALID_CREDENTIALS` when `currentPassword` is wrong. The old password stays in force.
- 500 `INTERNAL_ERROR`.

On success the acting session survives and every other session for that user is revoked (BR-10, AC-08).

## 5. Lab 2 Requester endpoints, as changed

These keep their Lab 2 request and response bodies exactly, with two changes: the `requesterId` query parameter or body field is gone, and access is decided from the session. Ticket and Attachment endpoints differ in who may call them, so the second change is set out per endpoint in the tables below.

| Endpoint | Change |
|---|---|
| GET `/api/tickets` | `requesterId` query parameter removed; the list is the authenticated Requester's own Tickets |
| POST `/api/tickets` | `requesterId` body field removed; the Ticket is created for the authenticated Requester |
| GET `/api/tickets/:id` | `requesterId` query parameter removed; a Requester sees only their own, IT Staff and Administrators see any (see endpoint 7) |
| POST `/api/tickets/:id/attachments` | `requesterId` body field removed |
| GET `/api/attachments/:id` and `/download` | `requesterId` query parameter removed |
| DELETE `/api/attachments/:id` | body narrows from `{ requesterId, reason }` to `{ reason }` |

Every one of them returns 401 when unauthenticated. The Lab 2 404-on-non-owned behaviour is unchanged for a Requester.

### GET /api/tickets/:id: what each role receives

The Lab 2 body is unchanged and gains two fields for every role: `resolutionSummary` (the summary IT wrote when resolving, or `null`; the Requester can read it, BR-27) and `requesterResolutionFlaggedAt` (the timestamp of the Requester's "problem appears resolved" signal, or `null`; BR-29).

IT Staff and Administrators also receive `itPriority`, `ownerId`, `ownerName`, `ownerIsActive`, `ownerEligible` and `requesterIsActive` with the meanings given under endpoint 7, and `permittedNextStatuses`: the statuses the Ticket may move to from where it is now, taken from the server's own BR-25 table, so a client never carries a second copy of the workflow. A Requester never receives any of those seven fields. A Requester is held to their own Ticket (404 otherwise); IT Staff and Administrators can open any Ticket, including one whose Requester is inactive (BR-60).

### Attachment permissions

Reading an Attachment and changing one are separate permissions (BR-54, BR-55, FR-21):

| Endpoint | Requester | IT Staff | Administrator |
|---|---|---|---|
| GET `/api/tickets/:id` (Attachment list inside the detail) | own, else 404 | any | any |
| GET `/api/attachments/:id` (metadata) | own, else 404 | any | any |
| GET `/api/attachments/:id/download` | own, else 404 | any | any |
| POST `/api/tickets/:id/attachments` | own, else 404 | 403 `FORBIDDEN` | 403 `FORBIDDEN` |
| DELETE `/api/attachments/:id` | own, else 404 | 403 `FORBIDDEN` | 403 `FORBIDDEN` |

- The 403 on the two mutating endpoints is decided from the role alone, before the Ticket or Attachment is looked up. An IT Staff or Administrator caller therefore gets the same 403 for an existing target and for one that does not exist, and no file is written and no row changes (BR-14, AC-39).
- A soft-removed Attachment's metadata is still readable by every role that may read Attachments. Its download returns 410 to all of them, unchanged from Lab 2 (BR-54).
- The rule follows the current role, not history: a user promoted from Requester to IT Staff or Administrator also receives 403 on both mutating endpoints for Tickets they created (BR-55, AC-43).

`GET /api/requesters` is **deleted** (BR-49). A request to it returns 404 from the router, as for any unknown path.

## 6. POST /api/tickets/:id/resolution-indication

Purpose: the Requester indicates that the reported problem appears resolved (FR-09, BR-29).

Authorization: Requester, own Ticket only.

Request body: none.

Response 200:

```json
{ "id": 42, "requesterResolutionFlaggedAt": "2026-09-16T04:12:00.000Z", "currentStatus": "IN_PROGRESS" }
```

`currentStatus` is echoed unchanged, making it explicit in the contract that this operation never moves the Ticket (AC-26).

Errors:

- 400 `VALIDATION_ERROR`: malformed Ticket id.
- 401, 403 for a non-Requester role.
- 404 when the Ticket does not exist or is not owned by the caller.
- 409 `TICKET_TERMINAL`: the Ticket is `CLOSED` or `CANCELLED`.

Repeating the call refreshes the timestamp and returns 200 (BR-29).

## 7. GET /api/staff/tickets

Purpose: the IT Staff Ticket Queue (FR-10).

Authorization: IT Staff, Administrator.

Query parameters:

| Parameter | Values | Default |
|---|---|---|
| `search` | matches `ticketNumber` exactly or partially, or `summary` partially, case-insensitive | none |
| `status` | one `TicketStatus` value | none |
| `itPriority` | `LOW \| MEDIUM \| HIGH` | none |
| `category` | Category id | none |
| `owner` | a User id, or `unassigned`, or `me`, or `needs-owner` | none |
| `sort` | `createdAt`, `-createdAt`, `updatedAt`, `-updatedAt`, `ticketNumber`, `-ticketNumber`, `itPriority`, `-itPriority`, `currentStatus`, `-currentStatus` | `-createdAt` |
| `page` | integer from 1 | 1 |
| `pageSize` | integer 5 to 50 | 10 |

`owner=needs-owner` returns Tickets whose `currentStatus` is not `CLOSED` or `CANCELLED` and that are either unassigned or have an ineligible owner (BR-59, AC-41). `owner=unassigned` keeps its plain meaning of `ownerId` null. `search` is matched as literal text: a typed `%`, `_` or `\` matches itself and is never a wildcard or an escape. Filters combine with AND, and with `search`. Following `L2-BR-23`, an unrecognised or out-of-range query value falls back to its default rather than returning an error, so a stale bookmark degrades to a sane queue instead of a failure. Ties on every sort break by `id` descending.

Response 200:

```json
{
  "tickets": [
    {
      "id": 42,
      "ticketNumber": "TKT-2026-000042",
      "summary": "Cannot connect to VPN",
      "categoryName": "Network",
      "requesterName": "Jennifer Anderson",
      "requestedPriority": "HIGH",
      "itPriority": "HIGH",
      "currentStatus": "OPEN",
      "ownerId": 7,
      "ownerName": "Michael Brown",
      "ownerIsActive": true,
      "ownerEligible": true,
      "requesterIsActive": true,
      "requesterResolutionFlaggedAt": null,
      "createdAt": "2026-09-12T09:14:00.000Z",
      "updatedAt": "2026-09-13T02:31:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 10, "total": 87, "totalPages": 9 }
}
```

`ownerId` and `ownerName` are `null` for an unassigned Ticket, and then `ownerIsActive` and `ownerEligible` are `null` too. `ownerIsActive` is the owner's current active flag, reported so the client can say "(inactive)" for a deactivated owner and "(not IT Staff)" for one whose role changed, when `ownerEligible` is `false`. `ownerEligible` is `false` when the owner is inactive or no longer holds the IT Staff or Administrator role, and `requesterIsActive` is `false` when the Requester's account is inactive. Both are derived from the current `User` rows on every read and are never stored (BR-57, BR-59). The Ticket is still returned with the same `ownerId` and `ownerName` it always had: deactivating or re-roling a user never changes a Ticket (BR-56, AC-40). The same two fields appear wherever a Ticket is returned to IT Staff or an Administrator, including `GET /api/tickets/:id`. A zero-match query returns an empty array with `total: 0`, not an error.

Errors: 401, 403 for a Requester (AC-12), 500.

## 8. PATCH /api/staff/tickets/:id/owner

Purpose: claim, assign, reassign, or unassign the Ticket Owner (FR-12).

Authorization: IT Staff, Administrator.

Request, one of:

```json
{ "ownerId": 7 }
{ "ownerId": null }
```

Claiming is `{ "ownerId": <the caller's own id> }`: the contract has one operation rather than separate claim and assign verbs, because they differ only in the value sent. A claim is a single conditional write: it succeeds while the Ticket has no owner, is already yours, or has an ineligible owner, so two people claiming at once cannot both win and the loser receives `ALREADY_ASSIGNED`. Claiming a Ticket you already own is a 200 no-op.

Response 200: the updated Ticket in the endpoint 7 item shape.

Errors:

- 400 `VALIDATION_ERROR`: `ownerId` absent, or not an integer and not null.
- 401, 403 for a Requester (AC-22).
- 404 when the Ticket does not exist, or its id in the path is not a positive integer.
- 409 `INVALID_OWNER`: the target user does not exist, is inactive, or holds the `REQUESTER` role (BR-18, AC-20).
- 409 `ALREADY_ASSIGNED`: an attempt to claim a Ticket that already has an eligible owner, meaning the caller sent their own id for a Ticket whose `ownerId` is set to somebody else who is still active and holds the IT Staff or Administrator role (BR-19). A Ticket whose owner is ineligible under BR-57 is claimable and never returns this error (BR-58, AC-41). Reassignment by explicitly naming a different user is permitted and does not hit this case.

## 9. PATCH /api/staff/tickets/:id/priority

Purpose: set IT Priority (FR-13).

Authorization: IT Staff, Administrator.

Request: `{ "itPriority": "MEDIUM" }`

Response 200: the updated Ticket. `requestedPriority` is returned unchanged alongside it, since BR-21 makes it immutable (AC-21).

Errors: 400 for a value outside `LOW | MEDIUM | HIGH`, 401, 403 for a Requester, 404, 500.

## 10. PATCH /api/staff/tickets/:id/status

Purpose: move a Ticket through the workflow (FR-14).

Authorization: IT Staff, Administrator.

Request:

```json
{ "currentStatus": "RESOLVED", "resolutionSummary": "Reissued the VPN profile and confirmed connectivity with the user." }
```

`resolutionSummary` is required only when the target status is `RESOLVED` (BR-27), is trimmed before it is stored, and is ignored for any other target. The checks run in this order: the request itself (400), then the Ticket (404), then the transition (409 `INVALID_TRANSITION`), then the owner (409 `OWNER_REQUIRED`), so a move that is not permitted is reported as such even when the Ticket also has no owner.

Response 200: the updated Ticket.

Errors:

- 400 `VALIDATION_ERROR`: unknown status value, or a transition to `RESOLVED` whose `resolutionSummary` is missing or outside 10 to 2000 characters after trimming (AC-24).
- 401, 403 for a Requester (AC-22).
- 404 when the Ticket does not exist.
- 409 `INVALID_TRANSITION`: the move is not permitted by the BR-25 matrix, including a move to the current status, or the Ticket changed status between the check and the write. The body is `{ "error", "message", "currentStatus", "permitted": [...] }`: it names the current status and lists the permitted next statuses, so the client can correct itself (AC-23). The write is conditional on the status that was checked, so of two conflicting moves exactly one succeeds.
- 409 `OWNER_REQUIRED`: a move to `IN_PROGRESS`, `RESOLVED`, or `CLOSED` on a Ticket that is unassigned, or whose owner is ineligible because they were deactivated or are no longer IT Staff or an Administrator (BR-28, BR-58, AC-25, AC-41). A move to a status that BR-28 does not restrict is unaffected.

## 11. GET and POST /api/tickets/:id/comments

Purpose: read and append Public Comments (FR-08, FR-15).

Authorization: a Requester for their own Ticket, IT Staff and Administrators for any Ticket.

GET response 200, oldest first:

```json
[
  {
    "id": 5,
    "body": "We are investigating the issue on your device.",
    "authorName": "Michael Brown",
    "authorRole": "IT_STAFF",
    "createdAt": "2026-09-13T03:30:00.000Z"
  }
]
```

`authorRole` is included so the client can badge the author, matching the handout's Ticket Detail mockup. It is the role the author held when the comment was written, stored on the row, so a later role change does not relabel it (BR-61, AC-44). No author email or id is exposed.

POST request: `{ "body": "Thank you for the update." }`

POST response 201: the created comment in the shape above.

Errors:

- 400 `VALIDATION_ERROR`: body missing, empty, whitespace-only, or outside 2 to 2000 characters after trimming (BR-33, AC-28).
- 401.
- 404 for a Requester whose Ticket this is not (BR-15).
- 409 `TICKET_TERMINAL`: a Requester posting on a `CLOSED` or `CANCELLED` Ticket (BR-34). IT Staff and Administrators may still comment on a terminal Ticket.

Author and creation time are always taken from the session and the server clock; supplying them in the body has no effect (BR-32).

## 12. GET and POST /api/tickets/:id/notes

Purpose: read and append Internal Notes (FR-15).

Authorization: IT Staff, Administrator only. **Never a Requester, including on their own Ticket** (BR-35).

Shapes are identical to endpoint 11.

Errors:

- 400 `VALIDATION_ERROR`: same body rules as endpoint 11.
- 401.
- 403 `FORBIDDEN` for any Requester, with no note content and no note count in the body (AC-04). This is the one place where a Requester receives 403 rather than 404 for a Ticket they own, because the refusal is about the whole capability and not about a particular record, so nothing is disclosed.
- 404 when the Ticket does not exist.

## 13. GET /api/admin/users

Purpose: the Administrator user list (FR-16).

Authorization: Administrator only.

Query parameters: `search` (matches name or email, partial, case-insensitive), `role` (one `UserRole` value). Pagination is deliberately not implemented: the handout excludes it for this screen.

Response 200:

```json
[
  {
    "id": 7,
    "name": "Michael Brown",
    "email": "michael.brown@toktickit.local",
    "role": "IT_STAFF",
    "isActive": true,
    "mustChangePassword": false
  }
]
```

No endpoint in this group ever returns `passwordHash` (BR-03).

Errors: 401, 403 for any non-Administrator (AC-33), 500.

## 14. POST /api/admin/users

Purpose: create a user (FR-17).

Authorization: Administrator only.

Request:

```json
{
  "name": "Alex Thompson",
  "email": "alex.thompson@toktickit.local",
  "role": "IT_STAFF",
  "isActive": true,
  "initialPassword": "Zen$Green7"
}
```

Response 201: the created user in the endpoint 13 shape, with `mustChangePassword` true (BR-38).

Errors:

- 400 `VALIDATION_ERROR` with `fields`: name outside 2 to 120 characters, email malformed or longer than 254, `role` not one of the three values (BR-46), `initialPassword` failing the BR-10 rules.
- 401, 403.
- 409 `EMAIL_TAKEN`: the address already exists, compared case-insensitively. No user is created (BR-39, AC-29).

## 15. PATCH /api/admin/users/:id

Purpose: update name, email, role, and activation state (FR-18, FR-19).

Authorization: Administrator only.

Request: any subset of `{ "name", "email", "role", "isActive" }`.

Response 200: the updated user.

Errors:

- 400 `VALIDATION_ERROR`: same field rules as endpoint 14.
- 401, 403.
- 404 when the user does not exist.
- 409 `EMAIL_TAKEN`: duplicate address (BR-39).
- 409 `SELF_DEACTIVATION`: the Administrator is deactivating their own account, or changing their own role (BR-42, AC-31).
- 409 `LAST_ADMINISTRATOR`: the change would leave zero active Administrators, whether by deactivating one or by changing their role away from `ADMINISTRATOR` (BR-43, AC-32).

Deactivating a user, or changing their role, revokes that user's active sessions as part of the same operation (BR-45). It writes to no Ticket, Comment, Note, or Attachment row: Tickets they owned keep their `ownerId` and are reported as `ownerEligible: false` until reassigned (BR-56, AC-40). It is never refused because the user still owns open Tickets.

## 16. POST /api/admin/users/:id/initial-password

Purpose: issue a new initial password (FR-20).

Authorization: Administrator only.

Request: `{ "initialPassword": "Zen$Green7" }`

Response 200: the updated user, with `mustChangePassword` true.

Errors:

- 400 `VALIDATION_ERROR`: the password fails the BR-10 rules.
- 401, 403.
- 404 when the user does not exist.

The target user's active sessions are revoked, so a holder of the previous password is returned to Login and is then forced through the mandatory change (BR-41, AC-30).

The endpoint returns the updated user only. It never echoes the password back, and the password is never written to a log.

## 17. GET /api/staff/owners

Purpose: the list a Ticket Owner select is filled from (FR-12, BR-18).

Authorization: IT Staff, Administrator.

Response 200, ordered by name:

```json
[
  { "id": 7, "name": "Michael Brown", "role": "IT_STAFF" },
  { "id": 9, "name": "Aekkarat Wongsa", "role": "ADMINISTRATOR" }
]
```

Only active users who hold the IT Staff or Administrator role appear. The body carries `id`, `name` and `role` and nothing else: no email, and never a password hash. Errors: 401, 403 for a Requester, 500.
