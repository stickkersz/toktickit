# Lab 3 Sprint Engineering Specification

**Numbering scope:** `FR-nn`, `BR-nn`, and `AC-nn` in this document are Lab 3 identifiers and restart at 01. Where a Lab 2 rule is referenced it is cited as `L2-BR-nn` and lives in `docs/lab-02/specification.md`.

## 1. Sprint Goal

Replace the temporary Development Requester selector with real authentication and server-enforced role-based authorization, and deliver the first operational IT Staff workflow plus a minimalist Administrator user management screen, without losing or breaking any Lab 2 Requester capability.

## 2. Stakeholder Request Interpretation

The product now needs real users instead of a development convenience. Every person signs in with an email address and password, and the account they sign in as, not a value the client sends, decides what they may see and do. Anyone issued a temporary password must replace it before reaching the application.

Requesters keep everything Lab 2 gave them, now driven by their authenticated account, and gain the ability to talk to IT through Public Comments and to signal that their problem appears resolved. IT Staff get a professional queue where they find work, take ownership of a Ticket, set an internal priority, move the Ticket through a defined workflow, reply to the Requester in public, and record private Internal Notes. Only IT Staff formally resolve or close a Ticket. Administrators get one simple screen for managing accounts: view, create, edit, assign a single role, activate or deactivate, and issue a new initial password.

Authorization is a backend property. Hiding a button is feedback for the user, never a security control.

## 3. Scope

### Included

- Email and password authentication, session establishment, logout, and current-user retrieval.
- Mandatory password change for any account flagged as holding an initial password.
- Three roles, exactly one per user: Requester, IT Staff, Administrator.
- Server-side authorization and ownership checks on every protected endpoint.
- Migration of the Lab 2 `RequesterUser` records into the real `User` model with ownership preserved, including the ordered migrate-then-seed sequence that gives every migrated account a credential.
- The effect of deactivating a user or changing their role on the Tickets, Comments, Notes, and Attachments that user owns or authored.
- Removal of the Development Requester selector, its stored client state, and the `requesterId` request parameter.
- All Lab 2 Requester functions, re-driven by the authenticated identity.
- Public Comments and Internal Notes, append only.
- The Requester "problem appears resolved" indication.
- IT Staff Ticket Queue: search, filters, sorting, pagination.
- IT Staff Ticket Detail: ownership claim and reassignment, IT Priority, permitted status transitions.
- Administrator User Management: list, search, optional role filter, create, edit, activate and deactivate, set a new initial password.
- Role-aware application shell and navigation in the existing Zen Green design language.

### Excluded

Per handout section 4.2, and not implemented in this Sprint: password reset email, email invitations, multi-factor authentication, social login, single sign-on, self-registration, Requester-created accounts, Actions Taken (deferred to Lab 4), SLA calculation, escalation rules, notification services, dashboards and KPI analytics, multi-tenant organizations and departments, production deployment, multiple roles per user, user deletion, bulk user operations, user import and export, account history screens, profile photos, account unlocking, administrator approval workflows, and advanced user-list features such as mandatory pagination, multi-column sorting, or multiple simultaneous filters on the Administrator screen.

Editing and deleting a Public Comment or Internal Note are also excluded: both are append only in Lab 3.

## 4. Functional Requirements

### Authentication and session

- FR-01 A user signs in with an email address and a password and receives an authenticated session.
- FR-02 A user whose account is flagged as holding an initial password must set a new password before any other application screen becomes reachable.
- FR-03 A user can log out, which invalidates the session so the same credentials-free request can no longer be used.
- FR-04 The application can retrieve the current authenticated user, including name, email, and role, for shell display and navigation decisions.

### Authorization

- FR-05 Navigation presents only the destinations permitted to the authenticated role.
- FR-06 Every protected endpoint independently enforces role and ownership on the server, regardless of what the client sends or hides.

### Requester

- FR-07 A Requester performs all Lab 2 Ticket and Attachment functions (`L2-FR-02` through `L2-FR-08`) using the authenticated identity rather than a selected Development Requester.
- FR-08 A Requester posts a Public Comment on a Ticket they own.
- FR-09 A Requester indicates that the reported problem appears resolved, without changing the Ticket status.

### IT Staff

- FR-10 IT Staff view a shared Ticket Queue across all Requesters, with search, filters, sorting, and pagination.
- FR-11 IT Staff open the Ticket Detail of any Ticket in the queue.
- FR-12 IT Staff claim a Ticket that has no eligible Ticket Owner, or assign and reassign the Ticket Owner to another active IT Staff or Administrator.
- FR-13 IT Staff set the IT Priority of a Ticket independently of the Requested Priority.
- FR-14 IT Staff move a Ticket through the permitted status transitions defined in BR-25.
- FR-15 IT Staff post Public Comments and create Internal Notes on a Ticket.
- FR-21 IT Staff and Administrators read Attachment metadata and download Attachment files on any Ticket they can open. Adding and removing Attachments is not available to them.

### Administrator

- FR-16 An Administrator views the user list showing Name, Email, Role, Status, and an Edit action, searchable by name or email and optionally filtered by role.
- FR-17 An Administrator creates a user with a name, email address, exactly one role, an activation state, and an initial password.
- FR-18 An Administrator updates a user's name, email address, role, and activation state.
- FR-19 An Administrator activates or deactivates an account, subject to the safety rules in BR-42 and BR-43.
- FR-20 An Administrator sets a new initial password for a user, which that user must change at their next login.
- FR-22 Deactivating a user or changing their role leaves every Ticket, Comment, Note, and Attachment intact, and surfaces the open Tickets that no longer have an eligible Ticket Owner so staff can reassign them.

## 5. Business Rules

### Authentication and session

- BR-01 Only a user with `isActive = true` and valid credentials may authenticate.
- BR-02 A user whose `mustChangePassword` is true cannot reach any application screen or call any protected endpoint other than current-user retrieval, password change, and logout, until a valid new password is saved.
- BR-03 Passwords are never stored in plaintext and never returned by any endpoint. They are hashed with `scrypt` from `node:crypto` (N=16384, r=8, p=1, 64-byte derived key) using a per-user 16-byte random salt, serialised as `scrypt$N$r$p$salt$hash`, and compared with `timingSafeEqual`.
- BR-04 A session is an opaque 32-byte random token issued to the client in an `httpOnly` cookie. Only the SHA-256 digest of the token is stored in the `Session` row, so a leaked database dump does not yield usable session tokens.
- BR-05 The session cookie is named `toktickit_session` and is set `httpOnly`, `SameSite=Lax`, `Path=/`. The `Secure` attribute is omitted in the local development environment because the lab stack runs over plain HTTP, and is required in any deployed environment. This is recorded as a documented local-lab decision, not a production posture.
- BR-06 A session expires 8 hours after it is created. Expiry is absolute, not sliding. An expired session is treated exactly as an absent one.
- BR-07 Logout deletes the `Session` row and clears the cookie. A token presented after logout is rejected, whether or not it has expired.
- BR-08 Every authenticated request re-resolves the session to its `User` and re-checks `isActive` on that row. A user deactivated mid-session loses access on their next request without needing to be signed out explicitly.
- BR-09 Login failure messages do not reveal whether an email address exists. An unknown email and a wrong password both return the same generic failure. An account that is inactive is reported distinctly, but only after its password has been verified correctly, so account existence is never disclosed to someone who does not already hold the credentials.
- BR-10 A new password must be at least 8 characters and at most 128, contain an upper case letter, a lower case letter, a digit, and a special character, differ from the current password, and match its confirmation field. Saving a new password clears `mustChangePassword` and revokes every other session belonging to that user.

### Authorization

- BR-11 The authenticated user identity, never a `requesterId` supplied by the client, determines ownership for every Requester operation. The `requesterId` request parameter from Lab 2 is removed from every endpoint.
- BR-12 Each user holds exactly one role. Role is assigned by an Administrator and is never self-selected.
- BR-13 Administrator and IT Staff responsibilities stay conceptually separate. IT Staff manage Tickets, Administrators manage accounts. An Administrator is additionally permitted every IT Staff Ticket operation, because the authorization matrix in section 6 grants it explicitly, and for no other reason.
- BR-14 An unauthenticated request to a protected endpoint returns 401. An authenticated request whose role is not permitted returns 403, with no protected content in the body.
- BR-15 A Requester requesting a Ticket, Attachment, or Public Comment that belongs to another Requester receives 404, never 403, preserving `L2-BR-35`: existence and ownership remain indistinguishable.
- BR-16 Hiding or disabling a control in the client is presentation only. Every protected operation is independently enforced by the backend and is covered by a direct-API authorization test.

### Ticket ownership and priority

- BR-17 A Ticket has zero or one Ticket Owner. A Ticket created by a Requester starts unassigned.
- BR-18 A Ticket Owner must be a user who is currently active and holds the IT Staff or Administrator role. This is checked when the owner is set and stays true afterwards only while it remains true of that user: BR-56 to BR-58 define what happens when it stops being true.
- BR-19 Claiming assigns the acting IT Staff or Administrator as Ticket Owner. Claiming is permitted only while the Ticket has no eligible Ticket Owner: it is unassigned, or its owner is ineligible under BR-57.
- BR-20 Reassigning changes the Ticket Owner to any other eligible user under BR-18, and is permitted whether or not the Ticket is currently assigned. Unassigning a Ticket back to no owner is permitted.
- BR-21 Requested Priority is the value submitted by the Requester and is immutable after creation. No role may change it.
- BR-22 IT Priority is set to the Requested Priority at creation and may afterwards be changed only by IT Staff or an Administrator. A Requester never sees an editable IT Priority control and cannot set it through the API. Tickets that existed before Lab 3 have no IT Priority, because Lab 2 never set one, so a one-time data migration gives each of them the value of its Requested Priority. A value that is already set is never overwritten.

### Status workflow

- BR-23 The Ticket statuses are `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CLOSED`, `REOPENED`, and `CANCELLED`. A Ticket is created with `NEW` (`L2-BR-02`).
- BR-24 Only IT Staff and Administrators change Ticket status. A Requester has no status-changing operation at all.
- BR-25 Permitted transitions, and no others:

  | From | Permitted next status |
  |---|---|
  | `NEW` | `OPEN`, `CANCELLED` |
  | `OPEN` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `CANCELLED` |
  | `IN_PROGRESS` | `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` |
  | `WAITING_FOR_REQUESTER` | `IN_PROGRESS`, `RESOLVED` |
  | `RESOLVED` | `CLOSED`, `REOPENED` |
  | `REOPENED` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER` |
  | `CLOSED` | terminal |
  | `CANCELLED` | terminal |

- BR-26 A transition that is not in BR-25, including a transition to the Ticket's current status, is rejected with 409 and the Ticket is left unchanged.
- BR-27 Moving a Ticket to `RESOLVED` requires a Resolution Summary of 10 to 2000 characters, trimmed. It is stored on the Ticket and is visible to the Requester.
- BR-28 A Ticket must have an eligible Ticket Owner (BR-57) before it can move to `IN_PROGRESS`, `RESOLVED`, or `CLOSED`. Work that is formally in progress or complete is always attributable to a named owner who can still act on it.
- BR-29 A Requester may indicate that the problem appears resolved while the Ticket is in any non-terminal status. The indication records a timestamp on the Ticket and never changes `currentStatus`; formally resolving or closing remains an IT Staff action (handout section 3). Repeating the indication refreshes the timestamp and is not an error.

### Public Comments and Internal Notes

- BR-30 A Public Comment is visible to the owning Requester, all IT Staff, and all Administrators. An Internal Note is visible only to IT Staff and Administrators.
- BR-31 Both are append only. No edit and no delete operation exists in Lab 3.
- BR-32 Author and creation time are taken from the authenticated session and the server clock. A client-supplied author or timestamp is ignored.
- BR-33 Body content is trimmed and must be between 2 and 2000 characters. Empty or whitespace-only content is rejected with 400. The 2000 character ceiling matches the Lab 2 Ticket description limit (`L2-BR-14`) so a single input-length convention holds across the product.
- BR-34 A Requester may post a Public Comment only on a Ticket they own, and may not post one on a `CLOSED` or `CANCELLED` Ticket.
- BR-35 Only IT Staff and Administrators may create or read Internal Notes. A Requester requesting the Internal Notes of any Ticket, including their own, receives 403 and no note content whatsoever.
- BR-36 Comment and note bodies are rendered as plain text. React's default escaping is relied upon and `dangerouslySetInnerHTML` is never used for user-supplied content, so a body containing markup is displayed literally rather than interpreted.

### Administrator user management

- BR-37 Only an Administrator may call any user-management endpoint or reach the User Management screen.
- BR-38 A new user is created with a name, an email address, exactly one role, an activation state, and an initial password. Creation sets `mustChangePassword` to true.
- BR-39 Email addresses are unique, compared case-insensitively and stored lower-cased. A create or update that would duplicate an existing address is rejected with 409 and no row is written.
- BR-40 Name is trimmed and must be 2 to 120 characters. Email is trimmed and must match a basic address format and be at most 254 characters.
- BR-41 Setting a new initial password re-flags `mustChangePassword` and revokes every active session belonging to that user, so an already-signed-in holder of the old password is forced back to login.
- BR-42 An Administrator cannot deactivate their own account, and cannot change their own role.
- BR-43 The system must always retain at least one active Administrator. An operation that would deactivate, or change the role of, the last remaining active Administrator is rejected with 409.
- BR-44 Users are never deleted. Deactivation is the only removal mechanism.
- BR-45 Changing a user's role, or deactivating a user, revokes that user's active sessions immediately, so a privilege change cannot be outlived by an existing session.
- BR-46 A role value outside the three permitted values is rejected with 400, and no endpoint accepts more than one role for a user.

### Migration and seed

- BR-47 The Lab 2 `RequesterUser` table is renamed to `User` in place. Every primary key is preserved, so `Ticket.requesterId` continues to identify the same person and no existing Ticket ownership changes.
- BR-48 Every migrated record receives the `REQUESTER` role and `mustChangePassword = true` from the column defaults applied by the migration itself. It cannot receive a real password at that moment (BR-51), so its initial password is issued afterwards by the seed (BR-52). These are local development credentials only and are documented as such in the README; no real personal password or secret is committed.
- BR-49 The Development Requester selector, the `GET /api/requesters` endpoint, and the `toktickit.currentRequesterId` client storage key are removed rather than deprecated, completing `L2-BR-36`.
- BR-50 The seed remains idempotent, upserting on email, and produces at least: 4 active Requesters and 1 inactive Requester, 3 active IT Staff and 1 inactive IT Staff, 1 active Administrator, Tickets spread across Requesters, statuses, priorities, and both assigned and unassigned ownership, and example Public Comments and Internal Notes that contain no sensitive content.
- BR-51 SQL inside the migration cannot compute a `scrypt` hash, so the migration backfills `passwordHash` for every existing row with the fixed marker value `!`, which is not a well-formed `scrypt$N$r$p$salt$hash` string. `verifyPassword` returns false, without throwing, for any stored value that is not well formed, so a backfilled account cannot authenticate with any password, including the marker itself. The account is not deactivated: `isActive` is untouched, it simply holds no usable credential until BR-52 issues one.
- BR-52 Credentials are issued by the seed, which is a separate step that runs after the migration. For each user, including a migrated user the seed does not otherwise list, the seed sets `passwordHash` to a `scrypt` hash of the documented development initial password, and `mustChangePassword` to true, only when the row is being created or its stored hash is still the BR-51 marker. It never overwrites a well-formed hash, so re-running the seed cannot reset a password that a user has chosen or that an Administrator has issued. It continues to re-assert the fixture rows' `name`, `role`, and `isActive` by upserting on email.
- BR-53 For any database that already holds Lab 2 data the required order is migrate, then seed, and between the two no migrated account can sign in. The README states both commands in that order. Because the only Administrator account comes from the seed, running the seed is also the sole recovery from the between-steps state.

### Attachment access

- BR-54 Reading an Attachment is a separate permission from changing one. Reading covers listing Attachment metadata on a Ticket Detail, `GET /api/attachments/:id`, and the file download. It is permitted to a Requester on their own Tickets and to IT Staff and Administrators on any Ticket. A Removed Attachment's metadata stays readable by the same roles, and its download returns 410 to every role, unchanged from Lab 2.
- BR-55 Adding and removing Attachments are Requester-only operations on their own Tickets. IT Staff and Administrators calling `POST /api/tickets/:id/attachments` or `DELETE /api/attachments/:id` receive 403 `FORBIDDEN`. The decision uses the role alone and is made before any Ticket or Attachment lookup, so the response is the same whether or not the target exists (BR-14) and no file or row is touched. The rule follows the role, not the history: a user whose role changed from Requester to IT Staff or Administrator also loses these operations on the Tickets they once created.

### Account changes and Tickets

- BR-56 Deactivating a user, or changing their role, never modifies a Ticket, Public Comment, Internal Note, or Attachment. There is no automatic unassignment, reassignment, status change, or deletion. `ownerId`, `requesterId`, and `authorId` keep pointing at the same person, consistent with BR-44. The only side effect is the session revocation in BR-45. Deactivation is never blocked because the user still owns open Tickets: refusing to deactivate a leaver's account until their workload is cleared would leave that account able to sign in for as long as the workload exists.
- BR-57 A Ticket Owner is eligible only while their account is active and their role is IT Staff or Administrator. Eligibility is evaluated from the owner's current `User` row every time a Ticket is read or changed and is never stored on the Ticket, so reactivating the user or restoring their role makes them eligible again with no data repair.
- BR-58 A Ticket whose owner is ineligible is treated as having no owner for BR-19 and BR-28. Claiming it is permitted, and `ALREADY_ASSIGNED` is returned only when the current owner is eligible. A move to `IN_PROGRESS`, `RESOLVED`, or `CLOSED` is rejected with 409 `OWNER_REQUIRED` until an eligible owner is set. Changing IT Priority, moving to a status that BR-28 does not restrict, posting Public Comments, and adding Internal Notes all stay permitted, so work is never frozen by the owner's departure.
- BR-59 Every Ticket returned to IT Staff or an Administrator reports `ownerEligible` (`true`, `false`, or `null` when unassigned) and `requesterIsActive`. The client marks an ineligible owner and an inactive Requester by name. The queue Owner filter gains a `needs-owner` option that returns Tickets that are not `CLOSED` or `CANCELLED` and are either unassigned or have an ineligible owner. A `CLOSED` or `CANCELLED` Ticket keeps its marker but is excluded from that filter, because nothing further is expected of it.
- BR-60 A deactivated Requester's Tickets remain, unchanged, and stay fully visible to IT Staff and Administrators. The Requester cannot authenticate (BR-01), so cannot comment or signal resolution. IT Staff may still post Public Comments on those Tickets, since BR-34 restricts only Requesters, and the comments are waiting if the account is reactivated. A Requester whose role changes to IT Staff or Administrator keeps `requesterId` on every Ticket they created. They lose every Requester-only operation, receiving 403, and see those Tickets only as any staff member does.
- BR-61 `PublicComment` and `InternalNote` store `authorRole` when they are created, so the role badge shows the role the author held when writing and a later role change does not relabel history. An Internal Note by a user who is no longer IT Staff stays visible to current staff, and its former author can no longer read it, because BR-35 evaluates the reader's current role.

### Cross-origin browser access

- BR-62 A browser page served from another origin may call the API with the session cookie only through credentialed CORS against an exact allow-list. The API echoes an origin back, with `Access-Control-Allow-Credentials: true` and `Vary: Origin`, only when that origin is listed in `CORS_ORIGINS`; the default list is the Vite dev server (5173) and the Playwright client (5180) on both `localhost` and `127.0.0.1`. Every other origin receives no CORS headers, so the browser blocks it. A `*` entry is ignored, because browsers refuse a wildcard on a credentialed request and reflecting arbitrary origins would let any website use a signed-in user's cookie. Until the Vite proxy of Issue 03 exists the client calls the API cross-origin and depends on this rule; once the proxy is in place it becomes a fallback (section 12).

### Screen access in the client

- BR-63 The client renders a screen only for the roles the section 6 matrix permits. A signed-in user whose role is not permitted, opening that screen's URL directly, sees the forbidden state and none of the screen's data is requested; a signed-out visitor is sent to Login; an unknown URL goes to the signed-in user's own landing route, never to a Requester screen. The Development Requester selector no longer exists (BR-49), and a `toktickit.currentRequesterId` value left in browser storage by Lab 2 is inert: nothing reads it, so it cannot make IT Staff or an Administrator act as a Requester. This is presentation only (BR-16): the server enforces the same rules on every endpoint.

## 6. Authorization matrix

Every protected operation, against each role. `own` means the operation is additionally restricted to resources the authenticated user owns, enforced by folding the identity into the database query.

| Operation | Requester | IT Staff | Administrator |
|---|---|---|---|
| Log in, log out, retrieve current user | yes | yes | yes |
| Change own password | yes | yes | yes |
| Create Ticket | yes | no | no |
| List own Tickets | own | no | no |
| View Ticket Detail | own | any | any |
| Read Attachment metadata | own | any | any |
| Download Attachment file | own | any | any |
| Add Attachment | own | no | no |
| Remove Attachment | own | no | no |
| Indicate problem appears resolved | own | no | no |
| View IT Staff Ticket Queue | no | yes | yes |
| Claim, assign, reassign Ticket Owner | no | yes | yes |
| Set IT Priority | no | yes | yes |
| Change Ticket status | no | yes | yes |
| Read Public Comments | own | any | any |
| Post Public Comment | own | any | any |
| Read or create Internal Note | no | yes | yes |
| List, create, edit users, set activation or initial password | no | no | yes |

IT Staff and Administrators read Attachment metadata and download files on any Ticket they can open in the queue (BR-54). They cannot add or remove Attachments in Lab 3: Attachment mutation stays a Requester capability, unchanged from Lab 2, and a direct API call from either role returns 403 (BR-55).

## 7. UI Specification Summary

Full detail is in `docs/lab-03/ui-spec.md`. All new screens reuse the Zen Green tokens, field conventions, badges, buttons, validation placement, responsive rules, and accessibility expectations already fixed in `docs/lab-02/ui-spec.md`.

- **Login**: email and password fields, validation, busy state, safe failure feedback, distinct inactive-account response.
- **Change Password**: mandatory for an initial password, current and new and confirm fields, visible rule checklist, continuation into the application on success.
- **Application shell**: the Development Requester display and Change Requester action are replaced by the authenticated user's name and role plus a Logout action. Navigation is role-specific and never renders a destination the role may not use.
- **Requester screens**: My Tickets, Create Ticket, and Ticket Detail carry over from Lab 2 unchanged in layout. Ticket Detail gains a Public Comments panel and the "problem appears resolved" action.
- **IT Staff Ticket Queue**: search, filters, sorting, pagination, ownership and status information, an open-detail action, and loading, empty, no-results, forbidden, and failure feedback.
- **IT Staff Ticket Detail**: grouped read-only Ticket information with only the permitted operational fields editable, Ticket Owner, IT Priority, status control, Public Comments and Internal Notes as visually distinct panels, and the existing Attachments panel.
- **Administrator User Management**: user list with Name, Email, Role, Status, and Edit, a name or email search, an optional role filter, and a create and edit panel covering role, activation, and initial password, with the BR-42 and BR-43 safety rules surfaced as clear feedback.

## 8. Data Changes

`RequesterUser` is renamed to `User` in place and extended. New models cover sessions, comments, and notes. `Ticket` gains ownership, a resolution summary, and the Requester resolution indication.

```prisma
enum UserRole {
  REQUESTER
  IT_STAFF
  ADMINISTRATOR
}

model User {
  id                 Int      @id @default(autoincrement())
  name               String
  email              String   @unique
  passwordHash       String
  role               UserRole @default(REQUESTER)
  mustChangePassword Boolean  @default(true)
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  tickets       Ticket[]        @relation("TicketRequester")
  ownedTickets  Ticket[]        @relation("TicketOwner")
  sessions      Session[]
  publicComments PublicComment[]
  internalNotes  InternalNote[]

  @@index([role, isActive])
}

model Session {
  id        Int      @id @default(autoincrement())
  tokenHash String   @unique
  userId    Int
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())
  expiresAt DateTime

  @@index([userId])
  @@index([expiresAt])
}

model PublicComment {
  id        Int      @id @default(autoincrement())
  ticketId  Int
  ticket    Ticket   @relation(fields: [ticketId], references: [id])
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
  authorRole UserRole
  body      String
  createdAt DateTime @default(now())

  @@index([ticketId, createdAt])
}

model InternalNote {
  id        Int      @id @default(autoincrement())
  ticketId  Int
  ticket    Ticket   @relation(fields: [ticketId], references: [id])
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
  authorRole UserRole
  body      String
  createdAt DateTime @default(now())

  @@index([ticketId, createdAt])
}
```

`TicketStatus` grows from the single Lab 2 value to the eight values in BR-23. `Ticket` changes:

- `requester` now relates to `User` through the named relation `TicketRequester`. The column name `requesterId` is deliberately kept: it names the role the user plays in this relationship and remains accurate against a `User` table.
- `ownerId Int?` plus `owner User? @relation("TicketOwner", ...)`: the Ticket Owner, nullable per BR-17.
- `resolutionSummary String?`: required content when moving to `RESOLVED` per BR-27.
- `requesterResolutionFlaggedAt DateTime?`: the BR-29 indication.
- New indexes `@@index([currentStatus, createdAt])` and `@@index([ownerId, currentStatus])` to serve the queue's default ordering and the assigned-to-me filter.
- Existing indexes on `requesterId` are kept: the Requester's own list is unchanged.
- No eligibility column is added: `ownerEligible` in BR-59 is derived from the owner's `User` row at read time (BR-57).

**Justified decision, migration strategy.** Prisma renders a model rename as a drop and a create, which would destroy every Lab 2 row. The migration is therefore generated with `prisma migrate dev --create-only` and the generated SQL is hand-edited, as the same manual-SQL approach the Lab 2 migration used for `ticket_number_seq`. Inside the one migration file the statements run in this order, and the order is the point:

1. `CREATE TYPE "UserRole"`, so the role column can reference it.
2. `ALTER TABLE "RequesterUser" RENAME TO "User"`, followed by renames of the primary key index, the email unique index, and the id sequence to their `User_*` names, so Prisma sees the names it expects and `migrate dev` reports no drift.
3. `ADD COLUMN "passwordHash" TEXT` as **nullable**, `ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'REQUESTER'`, `ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true`, and `ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`. Postgres applies each default to every existing row, which is what gives each migrated Requester its role and its `mustChangePassword` flag (BR-48).
4. `UPDATE "User" SET "passwordHash" = '!' WHERE "passwordHash" IS NULL`, the marker backfill of BR-51.
5. `ALTER COLUMN "passwordHash" SET NOT NULL`, which now succeeds because step 4 left no NULL. Then `ALTER COLUMN "updatedAt" DROP DEFAULT`, because `@updatedAt` is maintained by Prisma and has no database default.
6. The additive changes for `Session`, `PublicComment`, `InternalNote`, the `Ticket` columns and indexes, and the new `TicketStatus` values.

The seed is not part of this file and runs afterwards (BR-52, BR-53). It cannot be a step in the sequence, because it only starts once the migration has finished, so a `SET NOT NULL` that depended on the seed having run first would fail on any database that already holds rows. Row counts, the marker count before seeding, and the Ticket-to-requester mapping are compared before and after as migration evidence.

## 9. API Contract

Full shapes, statuses, and error bodies are in `docs/lab-03/api-spec.md`. Every Lab 2 endpoint loses its `requesterId` parameter and derives identity from the session cookie instead.

| Method and path | Purpose | Authorization |
|---|---|---|
| POST `/api/auth/login` | establish a session | public |
| POST `/api/auth/logout` | invalidate the session | authenticated |
| GET `/api/auth/me` | current user, name, email, role, password-change flag | authenticated |
| POST `/api/auth/change-password` | set a new password | authenticated |
| GET `/api/tickets` | own Ticket list | Requester, own |
| POST `/api/tickets` | create a Ticket | Requester |
| GET `/api/tickets/:id` | Ticket Detail | Requester own, IT Staff and Administrator any |
| POST `/api/tickets/:id/attachments` | upload Attachments | Requester, own only (BR-55) |
| GET `/api/attachments/:id` and `/download` | Attachment metadata and bytes | Requester own, IT Staff and Administrator any (BR-54) |
| DELETE `/api/attachments/:id` | soft removal | Requester, own only (BR-55) |
| POST `/api/tickets/:id/resolution-indication` | Requester marks problem as appearing resolved | Requester, own |
| GET `/api/staff/tickets` | Ticket Queue, search, filter, sort, paginate | IT Staff, Administrator |
| GET `/api/staff/owners` | active IT Staff and Administrators, for the owner select | IT Staff, Administrator |
| PATCH `/api/staff/tickets/:id/owner` | claim, assign, reassign, unassign | IT Staff, Administrator |
| PATCH `/api/staff/tickets/:id/priority` | set IT Priority | IT Staff, Administrator |
| PATCH `/api/staff/tickets/:id/status` | permitted status transition | IT Staff, Administrator |
| GET, POST `/api/tickets/:id/comments` | Public Comments | Requester own, IT Staff and Administrator any |
| GET, POST `/api/tickets/:id/notes` | Internal Notes | IT Staff, Administrator |
| GET `/api/admin/users` | user list, search, optional role filter | Administrator |
| POST `/api/admin/users` | create a user | Administrator |
| PATCH `/api/admin/users/:id` | update name, email, role, activation | Administrator |
| POST `/api/admin/users/:id/initial-password` | set a new initial password | Administrator |

`GET /api/requesters` is deleted (BR-49).

## 10. Acceptance Criteria

- AC-01 Given an active user with valid credentials, when the user logs in, then the backend establishes authenticated access and returns the permitted user identity and role.
- AC-02 Given a user who must change the initial password, when login succeeds, then normal application screens remain unavailable until a valid new password is saved.
- AC-03 Given an authenticated Requester, when the client supplies another `requesterId`, then the backend still applies the authenticated identity and does not return another Requester's data.
- AC-04 Given a Requester account, when an Internal Note endpoint is requested, then the operation is rejected with 403 and no note content is returned.
- AC-05 Given an inactive account, when its correct credentials are submitted, then login is refused with a clear inactive-account response and no session is created.
- AC-06 Given an unknown email address or a wrong password, when login is attempted, then the response does not reveal which of the two was wrong.
- AC-07 Given a password that fails the BR-10 rules, when it is submitted as a new password, then it is rejected with the specific unmet rule shown and the old password remains in force.
- AC-08 Given a successful password change, when it completes, then `mustChangePassword` is cleared, other sessions for that user are revoked, and the application becomes reachable.
- AC-09 Given an authenticated session, when the user logs out, then a subsequent request with the same cookie returns 401.
- AC-10 Given a user who is deactivated while signed in, when their next request is made, then it returns 401 without requiring an explicit logout.
- AC-11 Given each role, when the shell renders, then only that role's permitted destinations appear in navigation.
- AC-12 Given a Requester session, when a staff or admin endpoint is called directly, then the response is 403 and no protected data is returned.
- AC-13 Given an unauthenticated client, when any protected endpoint is called, then the response is 401.
- AC-14 Given a Requester who owns a Ticket, when the Lab 2 Ticket and Attachment functions are exercised under the authenticated identity, then every one behaves as it did in Lab 2.
- AC-15 Given a Ticket owned by another Requester, when it is requested by id, then the response is 404, not 403.
- AC-16 Given an IT Staff session, when the Ticket Queue is opened, then Tickets from all Requesters are listed with ownership and status information.
- AC-17 Given queue search, filter, sort, and pagination inputs, when they are combined, then the returned set matches all of them and the pagination metadata is consistent.
- AC-18 Given an unassigned Ticket, when IT Staff claim it, then they become the Ticket Owner and the Ticket shows as assigned.
- AC-19 Given an assigned Ticket, when it is reassigned to another active IT Staff user, then the new owner is recorded.
- AC-20 Given a user who is inactive or holds the Requester role, when they are set as Ticket Owner, then the operation is rejected.
- AC-21 Given a Ticket, when IT Priority is changed, then Requested Priority is unchanged and both are displayed distinctly.
- AC-22 Given a Requester session, when an IT Priority or status change is attempted directly against the API, then it is rejected with 403.
- AC-23 Given a status transition that BR-25 does not permit, when it is attempted, then it is rejected with 409 and the Ticket status is unchanged.
- AC-24 Given a transition to `RESOLVED` without a Resolution Summary, when it is submitted, then it is rejected with 400 and the Ticket remains unresolved.
- AC-25 Given an unassigned Ticket, when a transition to `IN_PROGRESS` is attempted, then it is rejected under BR-28.
- AC-26 Given a Requester who owns a Ticket, when they indicate the problem appears resolved, then the indication is recorded and the Ticket status does not change.
- AC-27 Given a Public Comment posted by IT Staff, when the owning Requester opens the Ticket, then the comment is visible with its author and creation time.
- AC-28 Given empty or whitespace-only content, when a Public Comment or Internal Note is submitted, then it is rejected with 400 and nothing is stored.
- AC-29 Given an Administrator, when a user is created with a duplicate email address, then it is rejected with 409 and no user is created.
- AC-30 Given an Administrator, when a new initial password is set for a user, then that user must change it at next login and their existing sessions are revoked.
- AC-31 Given an Administrator, when they attempt to deactivate their own account, then the operation is rejected.
- AC-32 Given the last active Administrator, when an attempt is made to deactivate them or change their role, then it is rejected with 409.
- AC-33 Given a non-Administrator session, when any user-management endpoint is called, then the response is 403.
- AC-34 Given the migration is applied to a seeded Lab 2 database, when it completes, then the row count is unchanged and every existing Ticket still resolves to its original requester.
- AC-35 Given any Lab 3 screen at a mobile viewport below 768px, when rendered, then no horizontal page scrolling occurs and all controls remain reachable and legible.
- AC-36 Given a Lab 2 database after the migration and before the seed, when it is inspected and any migrated user tries to sign in with any password, then every row has role `REQUESTER`, `mustChangePassword` true, and a non-null `passwordHash` holding only the BR-51 marker, and sign-in fails with the generic failure and creates no session.
- AC-37 Given a migrated database after the seed, when a migrated Requester signs in with the documented initial password, then they are forced to change it, and when the seed is run again after they have changed it, then the new password still works and `mustChangePassword` stays false.
- AC-38 Given an IT Staff or Administrator session, when they list Attachment metadata or download a file on a Ticket owned by any Requester, then both succeed.
- AC-39 Given an IT Staff or Administrator session, when they call the Attachment upload or remove endpoint directly, then the response is 403 and no file is written and no row changes.
- AC-40 Given an IT Staff owner who is then deactivated or changed to the Requester role, when the queue is read, then every Ticket they owned still names them as owner with `ownerEligible` false and no Ticket field has changed.
- AC-41 Given a Ticket whose owner is ineligible, when IT Staff claim it it succeeds, when a move to `IN_PROGRESS`, `RESOLVED`, or `CLOSED` is attempted before an eligible owner is set it is rejected with 409 `OWNER_REQUIRED`, and when the queue is filtered to `needs-owner` it is listed.
- AC-42 Given a Requester who is deactivated, when IT Staff view the queue, then their Tickets remain and are marked as belonging to an inactive Requester, they cannot sign in, and after reactivation they see their Tickets and any staff comments posted meanwhile.
- AC-43 Given a Requester whose role is changed to IT Staff, when they use the application afterwards, then their Tickets keep them as requester, every Requester-only operation returns 403, and they can open those Tickets only as staff do.
- AC-44 Given a Public Comment written by IT Staff who is later changed to the Requester role, when the Ticket is read, then the comment still shows the `IT_STAFF` badge it was written with.
- AC-45 Given a browser page served from an allowed origin, when it makes a credentialed request, then the response echoes that exact origin with `Access-Control-Allow-Credentials: true`, and given any other origin, then no CORS headers are sent.
- AC-46 Given a signed-in user whose role does not permit a screen, when its URL is opened directly, then the forbidden state is shown and none of that screen's data is requested; and given a stale Development Requester value left in browser storage by Lab 2, then IT Staff and an Administrator still cannot reach a Requester screen, and it does not stand in for signing in.

## 11. Definition of Done

**Product:**

- Every FR, BR, and AC above is implemented and demonstrable from the final `main` branch.
- `server/tests/lab-03/*`, client `lab-03` component tests, and `e2e/lab-03/*` all pass, along with the full Lab 2 suites as regression evidence. No test is skipped or commented out.
- Every AC is linked to at least one planned test in `docs/lab-03/tests.md`.
- Every protected operation is enforced server-side and proven by a direct-API authorization test, not only by a hidden control.
- Login, Change Password, Ticket Queue, IT Staff Ticket Detail, and User Management conform to `docs/lab-03/ui-spec.md` and the Zen Green tokens at desktop, tablet, and mobile.
- The migration preserves all Lab 2 data, evidenced by before and after row counts and ownership checks.
- README documents Lab 3 setup, the seeded development credentials, and the test commands.

**Process:**

- Each Issue implemented on its own feature branch and merged into `lab3-staging` through a peer-reviewed Pull Request carrying a formal GitHub review verdict.
- One release Pull Request `lab3-staging` into `main` after integration testing.
- `docs/lab-03/reviewer.md` and `docs/lab-03/ai-use.md` completed.
- The GitHub Project Kanban shows every Lab 3 Issue in Done.

## 12. Assumptions and Decisions

- Sessions are server-side rows rather than stateless tokens, because the handout requires logout invalidation and blocked access after logout, which a self-contained token cannot provide without a revocation list that is itself server state.
- Password hashing uses `node:crypto` scrypt rather than bcrypt or argon2, so the project gains no native build step and `npm install` cannot fail on a reviewer's machine. The cost parameters are documented in BR-03 and are tunable in one module.
- From Issue 03 the client is served through a Vite dev proxy so the API is same-origin during development. This keeps the session cookie a first-party cookie and avoids `SameSite=None` with `Secure`, which plain-HTTP local development cannot satisfy. CSRF exposure is handled by `SameSite=Lax` together with the rule that no state-changing operation uses GET. Credentialed CORS (BR-62) exists for the case where a page is served from another origin; a `SameSite=Lax` cookie is carried by such a request only when both origins are the same site (`localhost:5173` to `localhost:3000`, but not `127.0.0.1` to `localhost`), which is why the proxy is the primary path once it exists. Until Issue 03 the Lab 2 client still calls the API directly at `VITE_API_URL`, cross-origin, so BR-62 is what makes the cookie usable in the meantime.
- No new runtime dependency is added for authentication. Cookie parsing is a small first-party helper rather than the `cookie-parser` package, keeping the Lab 2 dependency list unchanged apart from nothing at all.
- Public Comments and Internal Notes are two tables rather than one table with a visibility flag. A Requester-facing query physically cannot reach the Internal Note table, so the failure that AC-04 guards against is prevented structurally instead of relying on a `where` clause being remembered at every call site.
- Login attempt throttling and account lockout are not implemented: account unlocking is explicitly excluded by the handout, and a lockout without an unlock path would strand a user. Brute-force resistance rests on the scrypt work factor and the generic failure message in BR-09.
- Ticket ownership is left alone when an account changes, and eligibility is derived rather than the Ticket being unassigned automatically. Automatic unassignment would leave `IN_PROGRESS` Tickets with no owner, breaking the BR-28 invariant, and would silently rewrite history. Deactivation is not blocked by owned Tickets (BR-56), because a leaver's account has to be closable at once.
- Lab 3 adds no conflict-of-interest rule: a user promoted from Requester to IT Staff may work a Ticket they originally requested. The handout does not ask for one, and it is recorded here as a known limitation rather than left implicit.
- The Administrator role is granted the IT Staff Ticket operations through the section 6 matrix so that a single seeded Administrator can exercise and demonstrate the whole workflow. The two responsibilities remain conceptually separate as the handout requires, and no Ticket operation is available to an Administrator implicitly.
- Existing Lab 2 route handlers keep their current shape and only change identity source, so the 82 passing server tests move to session-based fixtures without their ownership assertions being rewritten.
