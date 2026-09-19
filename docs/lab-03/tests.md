# Lab 3 Test Plan and Results

Companion to `docs/lab-03/specification.md`. This plan is written **before** implementation, as handout section 10 requires, and is not reconstructed afterwards from whatever tests happened to exist. Every row starts as `Planned` and is flipped to `Pass` only when that exact test runs green from the branch.

## 1. How to run

```bash
cd server && npm test      # Vitest and Supertest: unit validators plus every Lab 2 and Lab 3 endpoint
cd client && npm test      # Vitest and Testing Library: every Lab 2 and Lab 3 screen and state
npx playwright test        # from the repo root: Lab 2 and Lab 3 end-to-end, responsive, and visual
```

The database must be running, migrated, and seeded first. Playwright's `testDir` is `./e2e`, not `./e2e/lab-03`, so the Lab 2 suites keep running as the regression evidence the handout grades.

## 2. Planned tests

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | BR-03 | `hashPassword` then `verifyPassword` round trip, and a wrong password | Correct password verifies, wrong one does not, hash is never the plaintext | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-02 | Unit | BR-03 | Two hashes of the same password | Different salts produce different stored values, both verify | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-03 | Unit | BR-10, AC-07 | `validateNewPassword` against each unmet rule and the boundaries 7, 8, 128, 129 | One specific message per unmet rule; 8 and 128 accepted, 7 and 129 rejected | `server/tests/lab-03/password.unit.test.ts` | Pass |
| UNIT-04 | Unit | BR-25, AC-23 | `isTransitionPermitted` across every from/to pair in the matrix | Exactly the BR-25 pairs allowed, all others refused, including same-status | `server/tests/lab-03/statusTransition.unit.test.ts` | Planned |
| UNIT-05 | Unit | BR-26 | Terminal statuses `CLOSED` and `CANCELLED` | No transition out of either is permitted | `server/tests/lab-03/statusTransition.unit.test.ts` | Planned |
| UNIT-06 | Unit | BR-33 | Comment and note body validation: empty, whitespace-only, 1, 2, 2000, 2001 characters | Whitespace-only and 1 rejected, 2 and 2000 accepted, 2001 rejected, value trimmed | `server/tests/lab-03/contentValidation.unit.test.ts` | Planned |
| UNIT-07 | Unit | BR-40, BR-46 | User field validation: name bounds, email format and length, role enum | Out-of-bounds and malformed values rejected with a per-field message | `server/tests/lab-03/userValidation.unit.test.ts` | Planned |
| UNIT-08 | Unit | BR-23, L2-BR-23 | `parseStaffQueueQuery` with unknown sort, out-of-range page and pageSize, unknown filter values | Every unrecognised input falls back to its default, never throws | `server/tests/lab-03/staffQueueQuery.unit.test.ts` | Planned |
| UNIT-09 | Unit | BR-51, AC-36 | `verifyPassword` against the `!` marker, an empty string, and a truncated `scrypt$` string | Returns false for each without throwing, so a backfilled account can never authenticate | `server/tests/lab-03/password.unit.test.ts` | Pass |
| API-01 | API | AC-01 | Valid login | 200, session cookie set, safe user body with role, no password field | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-02 | API | AC-06 | Login with an unknown email, and with a wrong password | Both 401 with the identical generic message | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-03 | API | AC-05 | Login to an inactive account with correct credentials | 401 `ACCOUNT_INACTIVE`, no session created | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-04 | API | AC-02, BR-02 | A `mustChangePassword` user calling a protected endpoint | 403 `PASSWORD_CHANGE_REQUIRED`; `/auth/me`, change-password, and logout still work | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-05 | API | AC-07 | Change password with each BR-10 rule unmet, and with a mismatched confirmation | 400 with the specific field message, old password still valid | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-06 | API | AC-08 | Successful password change | 200, `mustChangePassword` false, other sessions revoked, acting session survives | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-07 | API | AC-09 | Logout, then reuse the same cookie | 200 on logout, 401 on the next request | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-08 | API | AC-10, BR-08 | Deactivate a user holding a live session, then use it; and use a session past its 8 hour expiry | 401 without an explicit logout in both cases, and the expired row is removed | `server/tests/lab-03/auth.api.test.ts` | Pass |
| API-09 | API | AC-13 | Every protected endpoint with no cookie | 401 on each, no data in any body | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-10 | API | AC-12, AC-22 | A Requester session against every staff and admin endpoint | 403 on each, no protected data | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-11 | API | AC-04, BR-35 | A Requester requesting Internal Notes on a Ticket they own | 403, body contains no note content and no note count | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-12 | API | AC-33 | An IT Staff session against every admin user endpoint | 403 on each | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-13 | API | AC-03, BR-11 | A Requester sending another user's `requesterId` in body and query | The authenticated identity is used; the other Requester's data is never returned | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-14 | API | AC-15 | A Requester requesting another Requester's Ticket, Attachment, and Public Comments | 404 in every case, never 403 | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-15 | API | AC-14 | Every Lab 2 Requester endpoint under a session, with `requesterId` removed | Same behaviour as Lab 2: create, list, detail, upload, download, soft remove | `server/tests/lab-03/requester-regression.api.test.ts` | Planned |
| API-16 | API | AC-16, AC-17 | Queue listing with search, each filter, each sort, and pagination | Returned set matches all criteria; pagination metadata consistent; no duplicates or gaps across pages | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-17 | API | AC-16 | Queue `owner` filter with `unassigned`, `me`, and a specific id | Each returns exactly the matching Tickets | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-18 | API | L2-BR-24 | Queue query matching zero Tickets | Empty array with `total` 0, not an error | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-19 | API | AC-18 | Claiming an unassigned Ticket | 200, caller becomes Ticket Owner | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-20 | API | AC-19 | Reassigning to another active IT Staff user, and unassigning | 200, new owner recorded; unassign leaves `ownerId` null | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-21 | API | AC-20, BR-18 | Setting an inactive user, and a Requester, as Ticket Owner | 409 `INVALID_OWNER` in both cases, owner unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-22 | API | AC-21, BR-21 | Changing IT Priority | 200, `itPriority` changed, `requestedPriority` untouched | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-23 | API | AC-23, BR-26 | Each unpermitted transition, including to the current status | 409 `INVALID_TRANSITION`, status unchanged, permitted set named | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-24 | API | AC-24, BR-27 | Moving to `RESOLVED` with a missing, too-short, and valid Resolution Summary | 400 for the first two, 200 and stored summary for the third | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-25 | API | AC-25, BR-28 | Moving an unassigned Ticket to `IN_PROGRESS`, `RESOLVED`, `CLOSED` | 409 `OWNER_REQUIRED` in each case | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-26 | API | AC-26, BR-29 | Requester resolution indication, then repeating it | 200 both times, timestamp set then refreshed, `currentStatus` unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-27 | API | BR-29 | Resolution indication on a `CLOSED` Ticket | 409 `TICKET_TERMINAL` | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Planned |
| API-28 | API | AC-27, BR-30 | IT Staff posts a Public Comment, owning Requester reads the Ticket | Comment visible with author name, role, and server timestamp | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-29 | API | AC-28, BR-33 | Empty and whitespace-only Public Comment and Internal Note bodies | 400 in every case, nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-30 | API | BR-32 | Posting a comment with a client-supplied author and createdAt | Both ignored; session user and server clock are used | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-31 | API | BR-34 | A Requester commenting on a `CLOSED` Ticket, and IT Staff doing the same | 409 for the Requester, 201 for IT Staff | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-32 | API | BR-31 | Any edit or delete route for a comment or note | No such route exists: 404 from the router | `server/tests/lab-03/comments-notes.api.test.ts` | Planned |
| API-33 | API | AC-29, BR-39 | Creating a user with a duplicate email, including a different letter case | 409 `EMAIL_TAKEN` both times, no user created | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-34 | API | FR-16 | User list with a name search, an email search, and a role filter | Only matching users returned; `passwordHash` never present | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-35 | API | FR-17, FR-18, BR-38 | Create a user, then update name, email, role, and activation | 201 then 200; `mustChangePassword` true on creation | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-36 | API | AC-30, BR-41 | Setting a new initial password for a user with a live session | `mustChangePassword` true, their sessions revoked, new password works | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-37 | API | AC-31, BR-42 | An Administrator deactivating their own account, and changing their own role | 409 `SELF_DEACTIVATION` both times | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-38 | API | AC-32, BR-43 | Deactivating, and demoting, the last active Administrator | 409 `LAST_ADMINISTRATOR`, no change written | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-39 | API | BR-45 | Changing a user's role while they hold a live session | Their sessions are revoked immediately | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-40 | API | BR-46 | Creating a user with an unknown role, and with two roles | 400 in both cases | `server/tests/lab-03/users-admin.api.test.ts` | Planned |
| API-41 | API | AC-38, BR-54 | IT Staff and Administrator read Attachment metadata (`GET /api/attachments/:id` and the list inside `GET /api/tickets/:id`) and download on a Ticket owned by another Requester, including a removed Attachment | 200 with metadata and matching bytes; the removed Attachment's metadata reads 200 and its download is 410 | `server/tests/lab-03/attachment-access.api.test.ts` | Planned |
| API-42 | API | AC-39, BR-55 | IT Staff and Administrator `POST /api/tickets/:id/attachments` against an existing Ticket | 403 `FORBIDDEN`, no Attachment row created, no file written to the upload directory | `server/tests/lab-03/attachment-access.api.test.ts` | Planned |
| API-43 | API | AC-39, BR-55 | IT Staff and Administrator `DELETE /api/attachments/:id` against an active Attachment, and against an id that does not exist | 403 `FORBIDDEN` with an identical body in both cases, `isRemoved` still false | `server/tests/lab-03/attachment-access.api.test.ts` | Planned |
| API-44 | API | AC-40, BR-56, BR-57 | Deactivate an IT Staff user who owns several Tickets, then change another owner's role to Requester, and read the queue | Every Ticket keeps its `ownerId`, `ownerName`, `currentStatus`, and `updatedAt`; `ownerEligible` is false; each user's live session now returns 401 | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-45 | API | AC-40, BR-57 | Reactivate the deactivated owner and restore the other owner's role | The same Tickets report `ownerEligible` true again, with no Ticket row written | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-46 | API | AC-41, BR-58 | One Ticket per case with an ineligible owner: `OPEN` to `IN_PROGRESS`, `IN_PROGRESS` to `RESOLVED` with a valid summary, `RESOLVED` to `CLOSED`, and `IN_PROGRESS` to `WAITING_FOR_REQUESTER` | The first three return 409 `OWNER_REQUIRED` with the status unchanged; the fourth returns 200 | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-47 | API | AC-41, BR-58 | Change IT Priority, post a Public Comment, and add an Internal Note on a Ticket with an ineligible owner | 200, 201, and 201: work is not frozen by the owner's departure | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-48 | API | AC-41, BR-19, BR-58 | Claim a Ticket whose owner is ineligible, then claim a Ticket whose owner is an active IT Staff user | 200 with the caller as owner for the first; 409 `ALREADY_ASSIGNED` for the second | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-49 | API | AC-41, BR-59 | Queue with `owner=needs-owner` over four fixtures: open and unassigned, open with an ineligible owner, `CLOSED` with an ineligible owner, open with an eligible owner | Exactly the first two are returned; `owner=unassigned` still returns only Tickets with a null `ownerId` | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-50 | API | AC-42, BR-60 | Deactivate a Requester who has Tickets: read the queue, attempt login, post a Public Comment as IT Staff, then reactivate and read as the Requester | Tickets remain with `requesterIsActive` false; login 401 `ACCOUNT_INACTIVE`; comment 201; after reactivation the Requester sees the Ticket and that comment | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-51 | API | AC-43, BR-55, BR-60 | Change a Requester who created Tickets to IT Staff, sign in again, and exercise every Requester-only operation | Each Ticket still resolves to the same requester by ticket number; own-list, create, resolution indication, Attachment upload, and Attachment remove all return 403; `GET /api/tickets/:id` returns 200 as for any staff | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-52 | API | AC-44, BR-61, BR-35 | An IT Staff user writes a Public Comment and an Internal Note and is then changed to Requester | The comment still reads `authorRole` `IT_STAFF` for the owning Requester; the former author now gets 403 on the notes endpoint while another IT Staff user still reads the note | `server/tests/lab-03/account-change-tickets.api.test.ts` | Planned |
| API-53 | API | AC-45, BR-62 | A preflight and a real request from an allowed origin, from an unlisted origin, and with no `Origin`; and `CORS_ORIGINS` parsing including a `*` entry | The allowed origin is echoed exactly with `Access-Control-Allow-Credentials: true` and `Vary: Origin`, never `*`; any other origin gets no CORS headers; a wildcard entry is dropped | `server/tests/lab-03/cors.api.test.ts` | Pass |
| UI-01 | UI | AC-01 | Login screen: valid submission | Calls the API once, stores nothing in `localStorage`, navigates to the role landing screen | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-02 | UI | FR-01 | Login: missing email, malformed email, missing password | Per-field messages shown, no API call made | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-03 | UI | AC-06 | Login: credential failure response | Generic callout, email preserved, password cleared | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-04 | UI | AC-05 | Login: inactive-account response | Distinct inactive message, visually different from a credential failure | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-05 | UI | FR-01 | Login: double submit while in flight | Button disabled and busy, exactly one request issued | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-06 | UI | AC-02 | A `mustChangePassword` user attempting any other route | Redirected to Change Password, no nav items rendered | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-07 | UI | AC-07 | Change Password: live rule checklist as the user types | Each rule flips met state; submission blocked while any is unmet | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-08 | UI | AC-08 | Change Password: success | Navigates into the application, nav items appear | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-09 | UI | AC-11 | Shell rendered for each of the three roles | Only that role's nav items appear; no hidden markup for the others | `client/tests/lab-03/Shell.role.test.tsx` | Planned |
| UI-10 | UI | AC-09 | Logout from the shell | Session cleared, redirected to Login, back-navigation does not restore the app | `client/tests/lab-03/Shell.role.test.tsx` | Planned |
| UI-11 | UI | AC-16 | Ticket Queue: loaded with rows | Ticket number, status, IT priority, and owner rendered; unassigned shown explicitly | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-12 | UI | AC-17 | Ticket Queue: search, each filter, sort toggle, and page change | Correct query issued per interaction; `aria-sort` reflects state | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-13 | UI | L2 race defect | Ticket Queue: an older request resolving after a newer one | The stale result never renders | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-14 | UI | FR-10 | Ticket Queue: loading, empty, no-results, and failure states | Four visually distinct states; toolbar stays mounted after first load | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-15 | UI | AC-18, AC-19 | Staff Ticket Detail: claim, then reassign | Owner updates in place without a reload; Claim hidden once assigned to an eligible owner | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-16 | UI | AC-23, BR-25 | Staff Ticket Detail: the status select | Only permitted next statuses are offered from the current status | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-17 | UI | AC-24 | Staff Ticket Detail: choosing Resolved | Resolution Summary appears and is required before saving | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-18 | UI | AC-23 | Staff Ticket Detail: a 409 from the status endpoint | Conflict callout naming the permitted statuses; prior value restored | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-19 | UI | BR-30, BR-35 | Staff Ticket Detail: the Public Comments and Internal Notes tabs | Only the active tab's composer is rendered; the internal-only warning is present on the notes tab | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-20 | UI | AC-26 | Requester Ticket Detail: the problem-appears-resolved action | Confirmation shown, status badge unchanged | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Planned |
| UI-21 | UI | AC-27 | Requester Ticket Detail: Public Comments panel | Comments listed with author and role; posting appends without a reload | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Planned |
| UI-22 | UI | AC-04 | Requester Ticket Detail: no Internal Notes affordance anywhere | No notes tab, no notes request issued | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Planned |
| UI-23 | UI | FR-16 | User Management: list, name and email search, role filter | Correct rows and badges; Edit action present on each row | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-24 | UI | AC-29 | User Management: duplicate email on create | Inline field error; the panel stays open with values preserved | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-25 | UI | AC-31 | User Management: the Administrator's own row | Active toggle disabled with an explanatory tooltip | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-26 | UI | AC-32 | User Management: last-active-Administrator rejection | Clear error callout, no row change | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-27 | UI | AC-30 | User Management: set a new initial password | Success feedback stating the user must change it at next login | `client/tests/lab-03/UserManagement.test.tsx` | Planned |
| UI-28 | UI | AC-38, AC-39 | Staff Ticket Detail Attachments tab as IT Staff and as Administrator, with one active and one removed Attachment | Metadata and a Download action shown; the removed one shows its reason and no Download; no upload control and no Remove control exist in the DOM | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| UI-29 | UI | AC-40, AC-41 | Ticket Queue with a Ticket whose owner is inactive and another whose owner is no longer IT Staff, and the Owner filter | Owner name kept with "(inactive)" or "(not IT Staff)" and a "Needs new owner" badge; choosing "Needs an owner" issues `owner=needs-owner` | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-30 | UI | AC-41, AC-42 | Staff Ticket Detail for a Ticket with an ineligible owner and an inactive Requester | Claim shown; the ineligible owner is the displayed value but not offered for other Tickets; the Requester carries an "(inactive)" marker | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
| MIG-01 | Migration | AC-34 | Row count and ids in `User` after the rename, against `RequesterUser` before | Identical count, identical ids, no row lost or added | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-02 | Migration | AC-34, BR-47 | Every pre-existing Ticket's requester after migration | Each Ticket still resolves to its original person by ticket number | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-03 | Migration | BR-48, BR-52 | Migrated Requesters after seeding, including migrated rows the seed does not list | Role `REQUESTER`, `mustChangePassword` true, a well-formed `scrypt$` hash that is neither the `!` marker nor plaintext, and no row left holding the marker | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-04 | Migration | BR-49 | `GET /api/requesters` after removal | 404 from the router | `server/tests/lab-03/migration.test.ts` | Planned |
| MIG-05 | Migration | BR-50 | Seed run twice | Idempotent: same counts, no duplicates, required active and inactive fixtures present for all three roles | `server/tests/lab-03/seed.test.ts` | Pass |
| MIG-06 | Migration | AC-36, BR-48, BR-51 | Apply the migration to a Lab 2 database that holds rows, and inspect `User` before any seeding | Every row has role `REQUESTER`, `mustChangePassword` true, and `passwordHash` equal to `!`; `passwordHash` and `updatedAt` are `NOT NULL`; `updatedAt` has no default | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-07 | Migration | AC-36, BR-51 | Sign in as a migrated, unseeded user with the documented initial password, with an arbitrary password, and with the marker `!` | 401 with the generic failure body each time, identical to an unknown email, and no `Session` row created | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-08 | Migration | AC-37, BR-52 | Run the seed on the migrated database, sign in as a migrated Requester with the documented initial password, change it, then run the seed again | After the first seed the hash is a well-formed `scrypt$` string; sign-in forces the change; after the second seed the new password still works, `mustChangePassword` is false, and the hash is unchanged | `server/tests/lab-03/seed.test.ts` | Pass |
| MIG-09 | Migration | AC-34, BR-47 | Apply every migration from scratch to an empty database, then compare the migrations against `schema.prisma` with `prisma migrate diff` | Applies without error, and the diff reports no difference, so the hand-edited rename leaves no drift | `server/tests/lab-03/migration.test.ts` | Pass |
| E2E-01 | E2E | AC-01, AC-02, AC-09 | Sign in with an initial password, change it, reach the application, log out, attempt direct access | Normal screens open only after the change; access blocked after logout | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-02 | E2E | AC-11, AC-12 | Sign in as each role and inspect navigation and a forbidden route | Each role sees only its destinations; a forbidden route shows the forbidden state | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-03 | E2E | AC-16 to AC-27 | Full staff flow: find in queue, open, claim, set IT Priority, move status, comment publicly, add an internal note, resolve with a summary | Every step succeeds and persists; the Requester sees the comment and the resolution but never the note | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-04 | E2E | AC-14 | Requester regression: create a Ticket with an attachment, list, filter, open detail, remove the attachment | Identical behaviour to Lab 2 under the authenticated identity | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-05 | E2E | AC-29 to AC-32 | Administrator flow: create a user, hit a duplicate email, edit, set an initial password, sign in as that user and be forced to change it, attempt self-deactivation and last-admin removal | Every safety rule refuses clearly; the new user is forced through the password change | `e2e/lab-03/user-administration.spec.ts` | Planned |
| E2E-06 | E2E | AC-40, AC-41 | An Administrator deactivates an IT Staff user who owns an open Ticket; another IT Staff user finds it under "Needs an owner", claims it, and moves it to In Progress; the deactivated user then tries to sign in | The Ticket shows the marker and badge until claimed; the claim and the move succeed; the deactivated user sees the inactive-account response | `e2e/lab-03/user-administration.spec.ts` | Planned |
| RESP-01 | Responsive | AC-35 | Every Lab 3 screen at 375, 768, and 1280 | No horizontal page scroll; queue is a table at 1280 and cards at 375; all controls reachable | `e2e/lab-03/responsive-visual.spec.ts` | Planned |
| RESP-02 | Visual | ui-spec section 13 | Screenshot capture for every state in the ui-spec section 14 tree | All files written under `artifacts/lab-03/screenshots/` | `e2e/lab-03/responsive-visual.spec.ts` | Planned |

## 3. Acceptance-Criterion traceability

| AC | Covered by |
|---|---|
| AC-01 | API-01, UI-01, E2E-01 |
| AC-02 | API-04, UI-06, E2E-01 |
| AC-03 | API-13 |
| AC-04 | API-11, UI-22 |
| AC-05 | API-03, UI-04 |
| AC-06 | API-02, UI-03 |
| AC-07 | UNIT-03, API-05, UI-07 |
| AC-08 | API-06, UI-08 |
| AC-09 | API-07, UI-10, E2E-01 |
| AC-10 | API-08 |
| AC-11 | UI-09, E2E-02 |
| AC-12 | API-10, E2E-02 |
| AC-13 | API-09 |
| AC-14 | API-15, E2E-04 |
| AC-15 | API-14 |
| AC-16 | API-16, API-17, UI-11, E2E-03 |
| AC-17 | API-16, UI-12 |
| AC-18 | API-19, UI-15, E2E-03 |
| AC-19 | API-20, UI-15 |
| AC-20 | API-21 |
| AC-21 | API-22, E2E-03 |
| AC-22 | API-10 |
| AC-23 | UNIT-04, API-23, UI-16, UI-18 |
| AC-24 | API-24, UI-17 |
| AC-25 | API-25 |
| AC-26 | API-26, UI-20 |
| AC-27 | API-28, UI-21, E2E-03 |
| AC-28 | UNIT-06, API-29 |
| AC-29 | API-33, UI-24, E2E-05 |
| AC-30 | API-36, UI-27, E2E-05 |
| AC-31 | API-37, UI-25, E2E-05 |
| AC-32 | API-38, UI-26, E2E-05 |
| AC-33 | API-12 |
| AC-34 | MIG-01, MIG-02, MIG-09 |
| AC-35 | RESP-01 |
| AC-36 | UNIT-09, MIG-06, MIG-07 |
| AC-37 | MIG-08 |
| AC-38 | API-41, UI-28 |
| AC-39 | API-42, API-43, UI-28 |
| AC-40 | API-44, API-45, UI-29, E2E-06 |
| AC-41 | API-46, API-47, API-48, API-49, UI-29, UI-30, E2E-06 |
| AC-42 | API-50, UI-30 |
| AC-43 | API-51 |
| AC-44 | API-52 |
| AC-45 | API-53 |

Every AC-01 through AC-45 appears above, and every test row names a real file path that must exist before its row may be marked Pass.

## 4. Migration and regression evidence

Captured once, when the Issue 02 migration is applied to a database already holding Lab 2 data:

- `SELECT count(*) FROM "RequesterUser"` recorded before, `SELECT count(*) FROM "User"` after.
- The full `ticketNumber` to requester email mapping, compared before and after.
- `SELECT count(*) FROM "User" WHERE "passwordHash" = '!'` immediately after the migration, expected to equal the row count, and the same query after the seed, expected to return 0 (BR-51, BR-52).
- The `is_nullable` and `column_default` values of `User.passwordHash` and `User.updatedAt` from `information_schema.columns`, expected `NO` with no default.
- The complete Lab 2 suites (`server/tests/lab-01`, `server/tests/lab-02`, `client/tests/lab-02`, `e2e/lab-02`) passing from the Lab 3 branch, proving the increment was evolved rather than replaced.

## 5. Manual verification

Automated tests did not catch the two worst Lab 2 defects: a stale-response race and design tokens that were defined but never applied. Both were found by running the app and looking at it. So each UI Issue also gets a manual pass against seeded data at 375, 768, and 1280, exercising the real flow rather than a mock, before its Pull Request is opened.

## 6. Results

To be completed as each Issue lands. Final counts from `main`, with the `Final` column above flipped from `Planned` to `Pass` per row, go here before submission.

### Issue 02: auth foundation

Twenty-one rows moved from `Planned` to `Pass` (UNIT-01, UNIT-02, UNIT-03, UNIT-09, API-01 to API-08, API-53, MIG-01 to MIG-03, MIG-05 to MIG-09), each only after that row's test ran green.

| Suite | Result |
|---|---|
| `cd server && npm test` | 17 files, 114 tests passed: the 82 Lab 2 tests plus 32 new Lab 3 tests. Five consecutive full runs all passed. |
| `cd client && npm test` | 8 files, 44 tests passed, unchanged |
| `npx playwright test` | 8 of 9 passed. `e2e/lab-02/submission-evidence.spec.ts:132` fails because it asserts exactly 3 Network Tickets for requester index 2, who already holds 9 from earlier runs of this shared development database. It predates Lab 3, is not in the graded traceability table, and is rewritten in Issue 04 together with the removal of `GET /api/requesters`. |

Migration evidence, from the migration applied to the development database that holds real Lab 2 data (`prisma migrate deploy`):

| Check | Before (`RequesterUser`) | After (`User`) |
|---|---|---|
| Row count | 65 | 65 |
| Ticket count | 139 | 139 |
| MD5 of the `ticketNumber:requester email` mapping, ordered by ticket number | `89bbb4d1963d27718755bec5948b7769` | `89bbb4d1963d27718755bec5948b7769` |
| Rows holding the `!` marker, before seeding | n/a | 65 |
| Rows holding the `!` marker, after `prisma db seed` | n/a | 0 |

The same migration was first run on a copy of that database, and `prisma migrate diff` against `schema.prisma` reported no difference. The migration tests run the same steps on throwaway databases, so they never touch shared data. A first run of the seed left 60 migrated rows without a credential because it only handled its own fixture emails; the seed now credentials every row still holding the marker, and MIG-03 asserts it.

Test isolation: every Lab 3 API test file that creates users calls `useIsolatedDatabase()`, which builds a throwaway migrated database and points `getPrisma()` at it, and `createUser` throws if a file forgot to. Vitest runs files in parallel, and `server/tests/lab-02/requesters.api.test.ts` asserts the exact list of active Requesters in the shared development database, so the Lab 3 tests must never write there. After the change the shared database was byte-for-byte unchanged by a run of the auth tests (78 users, highest id 194, 0 sessions before and after), and no `toktickit_scratch_*` database remained.

### Issue 03: login and Change Password screens

Eight rows moved from `Planned` to `Pass` (UI-01 to UI-08), each only after its test ran green.

| Suite | Result |
|---|---|
| `cd client && npm test` | 10 files, 65 tests passed: the 44 Lab 2 tests, unmodified, plus 21 new Lab 3 tests (10 in `Login.test.tsx`, 11 in `ChangePassword.test.tsx`) |
| `cd server && npm test` | 17 files, 114 tests passed, unchanged |
| `npx playwright test` | 8 of 9 passed, now through the Vite proxy. The failing spec is the same known `submission-evidence.spec.ts:132` described under Issue 02. |

Mutation check: removing the in-flight guard, the password clearing on a credential failure, the forced redirect to Change Password, and the client-side validation gate each turned at least one of the new tests red.

Manual pass in real Chromium against the real API through the Vite proxy, at 375, 768 and 1280 (22 checks): no horizontal scroll on Login or Change Password at any width; validation, credential failure, inactive account and API-failure states each look different; the session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/` and unreadable by script; nothing identity related is in `localStorage`; a direct visit to `/tickets` with an initial password is pushed back to Change Password; the session survives a reload; all 19 auth requests were same-origin with no CORS preflight. The pass found one defect the component tests could not: on an empty form, the first click on Sign In blurred the email field, its error appeared, the button moved down, and the mouse-up landed off the button, so the click was lost and the password error never showed. Space for field feedback is now always reserved so nothing shifts.
