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
| UNIT-04 | Unit | BR-25, AC-23 | `isTransitionPermitted` across every from/to pair in the matrix | Exactly the BR-25 pairs allowed, all others refused, including same-status | `server/tests/lab-03/statusTransition.unit.test.ts` | Pass |
| UNIT-05 | Unit | BR-26 | Terminal statuses `CLOSED` and `CANCELLED` | No transition out of either is permitted | `server/tests/lab-03/statusTransition.unit.test.ts` | Pass |
| UNIT-06 | Unit | BR-33 | Comment and note body validation: empty, whitespace-only, 1, 2, 2000, 2001 characters | Whitespace-only and 1 rejected, 2 and 2000 accepted, 2001 rejected, value trimmed | `server/tests/lab-03/contentValidation.unit.test.ts` | Pass |
| UNIT-07 | Unit | BR-40, BR-46 | User field validation: name bounds, email format and length, role enum | Out-of-bounds and malformed values rejected with a per-field message | `server/tests/lab-03/userValidation.unit.test.ts` | Pass |
| UNIT-08 | Unit | BR-23, L2-BR-23 | `parseStaffQueueQuery` with unknown sort, out-of-range page and pageSize, unknown filter values; and `escapeLike` on the three LIKE-special characters | Every unrecognised input falls back to its default, never throws; `%`, `_` and `\` are escaped and nothing else is | `server/tests/lab-03/staffQueueQuery.unit.test.ts` | Pass |
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
| API-11 | API | AC-04, BR-35 | A Requester requesting Internal Notes on a Ticket they own | 403, body contains no note content and no note count | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-12 | API | AC-33 | An IT Staff session against every admin user endpoint | 403 on each | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-13 | API | AC-03, BR-11 | A Requester sending another user's `requesterId` in body and query | The authenticated identity is used; the other Requester's data is never returned | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-14 | API | AC-15, BR-15 | A Requester requesting another Requester's Ticket Detail, Attachment (metadata, download, removal, upload) and Public Comments (read and post), each compared with an id that does not exist | 404 in every case, never 403, with a body identical to the not-found one | `server/tests/lab-03/authorization.api.test.ts` | Pass |
| API-15 | API | AC-14 | Every Lab 2 Requester endpoint under a session, with `requesterId` removed | Same behaviour as Lab 2: create, list, detail, upload, download, soft remove | `server/tests/lab-03/requester-regression.api.test.ts` | Pass |
| API-16 | API | AC-16, AC-17 | Queue listing with search (matched as literal text, including `%`, `_` and `\`), each filter, each sort, and pagination | Returned set matches all criteria; pagination metadata consistent; no duplicates or gaps across pages | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-17 | API | AC-16 | Queue `owner` filter with `unassigned`, `me`, and a specific id | Each returns exactly the matching Tickets | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-18 | API | L2-BR-24 | Queue query matching zero Tickets | Empty array with `total` 0, not an error | `server/tests/lab-03/staff-queue.api.test.ts` | Pass |
| API-19 | API | AC-18 | Claiming an unassigned Ticket | 200, caller becomes Ticket Owner | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-20 | API | AC-19 | Reassigning to another active IT Staff user, and unassigning | 200, new owner recorded; unassign leaves `ownerId` null | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-21 | API | AC-20, BR-18 | Setting an inactive user, and a Requester, as Ticket Owner | 409 `INVALID_OWNER` in both cases, owner unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-22 | API | AC-21, BR-21 | Changing IT Priority | 200, `itPriority` changed, `requestedPriority` untouched | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-23 | API | AC-23, BR-26 | Each unpermitted transition, including to the current status | 409 `INVALID_TRANSITION`, status unchanged, permitted set named | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-24 | API | AC-24, BR-27 | Moving to `RESOLVED` with a missing, too-short, and valid Resolution Summary | 400 for the first two, 200 and stored summary for the third | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-25 | API | AC-25, BR-28 | Moving an unassigned Ticket to `IN_PROGRESS`, `RESOLVED`, `CLOSED` | 409 `OWNER_REQUIRED` in each case | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-26 | API | AC-26, BR-29 | Requester resolution indication, then repeating it | 200 both times, timestamp set then refreshed, `currentStatus` unchanged | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-27 | API | BR-29 | Resolution indication on a `CLOSED` Ticket | 409 `TICKET_TERMINAL` | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-28 | API | AC-27, AC-15, BR-30 | IT Staff posts a Public Comment, owning Requester reads the Ticket; and a different Requester requests that Ticket's Public Comments | Comment visible with author name, role, and server timestamp; the other Requester gets 404, never 403 | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-29 | API | AC-28, BR-33 | Empty and whitespace-only Public Comment and Internal Note bodies | 400 in every case, nothing stored | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-30 | API | BR-32 | Posting a comment with a client-supplied author and createdAt | Both ignored; session user and server clock are used | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-31 | API | BR-34 | A Requester commenting on a `CLOSED` Ticket, and IT Staff doing the same | 409 for the Requester, 201 for IT Staff | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-32 | API | BR-31 | Any edit or delete route for a comment or note | No such route exists: 404 from the router | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-33 | API | AC-29, BR-39 | Creating a user with a duplicate email, including a different letter case | 409 `EMAIL_TAKEN` both times, no user created | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-34 | API | FR-16 | User list with a name search, an email search, and a role filter | Only matching users returned; `passwordHash` never present | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-35 | API | FR-17, FR-18, BR-38 | Create a user, then update name, email, role, and activation | 201 then 200; `mustChangePassword` true on creation | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-36 | API | AC-30, BR-41 | Setting a new initial password for a user with a live session | `mustChangePassword` true, their sessions revoked, new password works | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-37 | API | AC-31, BR-42 | An Administrator deactivating their own account, and changing their own role | 409 `SELF_DEACTIVATION` both times | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-38 | API | AC-32, BR-43 | Deactivating, and demoting, the last active Administrator | 409 `LAST_ADMINISTRATOR`, no change written | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-39 | API | BR-45 | Changing a user's role while they hold a live session | Their sessions are revoked immediately | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-40 | API | BR-46 | Creating a user with an unknown role, and with two roles | 400 in both cases | `server/tests/lab-03/users-admin.api.test.ts` | Pass |
| API-41 | API | AC-38, BR-54 | IT Staff and Administrator read Attachment metadata (`GET /api/attachments/:id` and the list inside `GET /api/tickets/:id`) and download on a Ticket owned by another Requester, including a removed Attachment | 200 with metadata and matching bytes; the removed Attachment's metadata reads 200 and its download is 410 | `server/tests/lab-03/attachment-access.api.test.ts` | Pass |
| API-42 | API | AC-39, BR-55 | IT Staff and Administrator `POST /api/tickets/:id/attachments` against an existing Ticket | 403 `FORBIDDEN`, no Attachment row created, no file written to the upload directory | `server/tests/lab-03/attachment-access.api.test.ts` | Pass |
| API-43 | API | AC-39, BR-55 | IT Staff and Administrator `DELETE /api/attachments/:id` against an active Attachment, and against an id that does not exist | 403 `FORBIDDEN` with an identical body in both cases, `isRemoved` still false | `server/tests/lab-03/attachment-access.api.test.ts` | Pass |
| API-44 | API | AC-40, BR-56, BR-57 | Deactivate an IT Staff user who owns several Tickets, then change another owner's role to Requester, and read the queue | Every Ticket keeps its `ownerId`, `ownerName`, `currentStatus`, and `updatedAt`; `ownerEligible` is false; each user's live session now returns 401 | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-45 | API | AC-40, BR-57 | Reactivate the deactivated owner and restore the other owner's role | The same Tickets report `ownerEligible` true again, with no Ticket row written | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-46 | API | AC-41, BR-58 | One Ticket per case with an ineligible owner: `OPEN` to `IN_PROGRESS`, `IN_PROGRESS` to `RESOLVED` with a valid summary, `RESOLVED` to `CLOSED`, and `IN_PROGRESS` to `WAITING_FOR_REQUESTER` | The first three return 409 `OWNER_REQUIRED` with the status unchanged; the fourth returns 200 | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-47 | API | AC-41, BR-58 | Change IT Priority, and make the moves that need no owner (`WAITING_FOR_REQUESTER`, `CANCELLED`), on a Ticket whose owner is deactivated and on one whose owner is no longer IT Staff | 200 in every case: work is not frozen by the owner's departure | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-48 | API | AC-41, BR-19, BR-58 | Claim a Ticket whose owner is ineligible, then claim a Ticket whose owner is an active IT Staff user | 200 with the caller as owner for the first; 409 `ALREADY_ASSIGNED` for the second | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-49 | API | AC-41, BR-59 | Queue with `owner=needs-owner` over four fixtures: open and unassigned, open with an ineligible owner, `CLOSED` with an ineligible owner, open with an eligible owner | Exactly the first two are returned; `owner=unassigned` still returns only Tickets with a null `ownerId` | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-50 | API | AC-42, BR-60 | Deactivate a Requester who has Tickets: read the queue, attempt login, post a Public Comment as IT Staff, then reactivate and read as the Requester | Tickets remain with `requesterIsActive` false; login 401 `ACCOUNT_INACTIVE`; comment 201; after reactivation the Requester sees the Ticket and that comment | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-51 | API | AC-43, BR-55, BR-60 | Change a Requester who created Tickets to IT Staff, sign in again, and exercise every Requester-only operation | Each Ticket still resolves to the same requester by ticket number; own-list, create, resolution indication, Attachment upload, and Attachment remove all return 403; `GET /api/tickets/:id` returns 200 as for any staff | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-52 | API | AC-44, BR-61, BR-35 | An IT Staff user writes a Public Comment and an Internal Note and is then changed to Requester | The comment still reads `authorRole` `IT_STAFF` for the owning Requester; the former author now gets 403 on the notes endpoint while another IT Staff user still reads the note | `server/tests/lab-03/account-change-tickets.api.test.ts` | Pass |
| API-53 | API | AC-45, BR-62 | A preflight and a real request from an allowed origin, from an unlisted origin, and with no `Origin`; and `CORS_ORIGINS` parsing including a `*` entry | The allowed origin is echoed exactly with `Access-Control-Allow-Credentials: true` and `Vary: Origin`, never `*`; any other origin gets no CORS headers; a wildcard entry is dropped | `server/tests/lab-03/cors.api.test.ts` | Pass |
| API-54 | API | BR-22, BR-21 | A Requester creates a Ticket at each Requested Priority, and sends an `itPriority` of their own | IT Priority is stored as a copy of the Requested Priority, and a client-supplied `itPriority` has no effect | `server/tests/lab-03/it-priority.api.test.ts` | Pass |
| API-55 | API | BR-18, FR-12 | IT Staff request the list of Ticket Owners | Only active IT Staff and Administrators, ordered by name, each with `id`, `name` and `role` and nothing else; a Requester gets 403 and no session gets 401 | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| API-56 | API | AC-41, BR-58 | Post a Public Comment and add an Internal Note on a Ticket whose owner is ineligible | 201 and 201: neither is blocked by the owner's departure | `server/tests/lab-03/comments-notes.api.test.ts` | Pass |
| API-57 | API | AC-23, BR-25, BR-26, BR-28 | A Ticket is changed by someone else in the gap between a status move being checked and being written: closed or cancelled after the check, changed to another status, or its owner deactivated | Nothing is applied on the strength of the earlier check: a move out of a terminal state is refused, a move that was valid from the old status is refused as changed, an owner who became ineligible blocks a move that needs one, and the status the other party set is what remains | `server/tests/lab-03/staff-ticket-detail.api.test.ts` | Pass |
| UI-01 | UI | AC-01 | Login screen: valid submission | Calls the API once, stores nothing in `localStorage`, navigates to the role landing screen | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-02 | UI | FR-01 | Login: missing email, malformed email, missing password | Per-field messages shown, no API call made | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-03 | UI | AC-06 | Login: credential failure response | Generic callout, email preserved, password cleared | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-04 | UI | AC-05 | Login: inactive-account response | Distinct inactive message, visually different from a credential failure | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-05 | UI | FR-01 | Login: double submit while in flight | Button disabled and busy, exactly one request issued | `client/tests/lab-03/Login.test.tsx` | Pass |
| UI-06 | UI | AC-02 | A `mustChangePassword` user attempting any other route | Redirected to Change Password, no nav items rendered | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-07 | UI | AC-07 | Change Password: live rule checklist as the user types | Each rule flips met state; submission blocked while any is unmet | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-08 | UI | AC-08 | Change Password: success | Navigates into the application, nav items appear | `client/tests/lab-03/ChangePassword.test.tsx` | Pass |
| UI-09 | UI | AC-11 | Shell rendered for each of the three roles | Only that role's nav items appear; no hidden markup for the others | `client/tests/lab-03/Shell.role.test.tsx` | Pass |
| UI-10 | UI | AC-09 | Logout from the shell | Session cleared, redirected to Login, back-navigation does not restore the app | `client/tests/lab-03/Shell.role.test.tsx` | Pass |
| UI-11 | UI | AC-16 | Ticket Queue: loaded with rows | Ticket number, status, IT priority, and owner rendered; unassigned shown explicitly | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-12 | UI | AC-17 | Ticket Queue: search, each filter, sort toggle, and page change | Correct query issued per interaction; `aria-sort` reflects state | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-13 | UI | L2 race defect | Ticket Queue: an older request resolving after a newer one | The stale result never renders | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-14 | UI | FR-10 | Ticket Queue: loading, empty, no-results, and failure states | Four visually distinct states; toolbar stays mounted after first load | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-15 | UI | AC-18, AC-19 | Staff Ticket Detail: claim, then reassign | Owner updates in place without a reload; Claim hidden once assigned to an eligible owner | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-16 | UI | AC-23, BR-25 | Staff Ticket Detail: the status select | Only permitted next statuses are offered from the current status | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-17 | UI | AC-24 | Staff Ticket Detail: choosing Resolved | Resolution Summary appears and is required before saving | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-18 | UI | AC-23 | Staff Ticket Detail: a 409 from the status endpoint | Conflict callout naming the permitted statuses; prior value restored | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-19 | UI | BR-30, BR-35 | Staff Ticket Detail: the Public Comments and Internal Notes tabs | Only the active tab's composer is rendered; the internal-only warning is present on the notes tab | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-20 | UI | AC-26 | Requester Ticket Detail: the problem-appears-resolved action | Confirmation shown, status badge unchanged | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Pass |
| UI-21 | UI | AC-27 | Requester Ticket Detail: Public Comments panel | Comments listed with author and role; posting appends without a reload | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Pass |
| UI-22 | UI | AC-04 | Requester Ticket Detail: no Internal Notes affordance anywhere | No notes tab, no notes request issued | `client/tests/lab-03/RequesterTicketDetail.lab03.test.tsx` | Pass |
| UI-23 | UI | FR-16 | User Management: list, name and email search, role filter | Correct rows and badges; Edit action present on each row | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-24 | UI | AC-29 | User Management: duplicate email on create | Inline field error; the panel stays open with values preserved | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-25 | UI | AC-31 | User Management: the Administrator's own row | Active toggle disabled with an explanatory tooltip | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-26 | UI | AC-32 | User Management: last-active-Administrator rejection | Clear error callout, no row change | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-27 | UI | AC-30 | User Management: set a new initial password | Success feedback stating the user must change it at next login | `client/tests/lab-03/UserManagement.test.tsx` | Pass |
| UI-28 | UI | AC-38, AC-39 | Staff Ticket Detail Attachments tab as IT Staff and as Administrator, with one active and one removed Attachment | Metadata and a Download action shown; the removed one shows its reason and no Download; no upload control and no Remove control exist in the DOM | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-29 | UI | AC-40, AC-41 | Ticket Queue with a Ticket whose owner is inactive and another whose owner is no longer IT Staff, and the Owner filter | Owner name kept with "(inactive)" or "(not IT Staff)" and a "Needs new owner" badge; choosing "Needs an owner" issues `owner=needs-owner` | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Pass |
| UI-30 | UI | AC-41, AC-42 | Staff Ticket Detail for a Ticket with an ineligible owner and an inactive Requester | Claim shown; the ineligible owner is the displayed value but not offered for other Tickets; the Requester carries an "(inactive)" marker | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| UI-31 | UI | AC-46, BR-63, BR-16 | Each role opening, by direct URL, screens its role may not use (Requester on the staff and admin routes, IT Staff on the admin and Requester routes, Administrator on the Requester routes), plus signed-out visitors and unknown URLs | The forbidden state with the exact message and a link home; the screen never renders and none of its API requests are made; the allowed roles still get in; signed-out goes to Login; an unknown URL goes to the user's own landing route | `client/tests/lab-03/RoleRoutes.test.tsx` | Pass |
| UI-32 | UI | AC-46, BR-63, BR-49 | A stale `toktickit.currentRequesterId` left in browser storage by Lab 2 while IT Staff, an Administrator, a Requester, or nobody is signed in, and a visit to the deleted `/select-requester` | Inert: IT Staff and Administrators cannot reach a Requester screen through it and no protected request is made; it does not stand in for signing in; `/select-requester` is an unknown URL for every role; a signed-in Requester acts as themselves | `client/tests/lab-03/RoleRoutes.test.tsx` | Pass |
| UI-33 | UI | AC-18, AC-19, AC-23 | Staff Ticket Detail saves for owner, IT Priority and status whose responses arrive out of order, a reload that was read before a later save, and a save still in flight when another Ticket is opened | A response changes only the fields of the control it was for, so an older snapshot never overwrites a newer save of another control; the status reload supplies the permitted next statuses and Resolution Summary; the status control stays busy until its reload lands; nothing in flight for one Ticket touches the next; a reload that fails locks the control, offers only its current value, does not say Saved, and unlocks on a successful Reload | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Pass |
| MIG-01 | Migration | AC-34 | Row count and ids in `User` after the rename, against `RequesterUser` before | Identical count, identical ids, no row lost or added | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-02 | Migration | AC-34, BR-47 | Every pre-existing Ticket's requester after migration | Each Ticket still resolves to its original person by ticket number | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-03 | Migration | BR-48, BR-52 | Migrated Requesters after seeding, including migrated rows the seed does not list | Role `REQUESTER`, `mustChangePassword` true, a well-formed `scrypt$` hash that is neither the `!` marker nor plaintext, and no row left holding the marker | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-04 | Migration | BR-49 | `GET /api/requesters` after removal | 404 from the router | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-05 | Migration | BR-50 | Seed run twice, users, Tickets, and example Public Comments and Internal Notes | Idempotent: same counts, no duplicates, required active and inactive fixtures present for all three roles, seeded Tickets spread over all eight statuses, three IT Priorities, several Requesters, assigned and unassigned ownership, an inactive owner and an inactive Requester, example comments and notes on several seeded Tickets that follow the application's own rules and contain nothing sensitive, and a re-run never duplicates or overwrites anything, including work done through the application | `server/tests/lab-03/seed.test.ts` | Pass |
| MIG-06 | Migration | AC-36, BR-48, BR-51 | Apply the migration to a Lab 2 database that holds rows, and inspect `User` before any seeding | Every row has role `REQUESTER`, `mustChangePassword` true, and `passwordHash` equal to `!`; `passwordHash` and `updatedAt` are `NOT NULL`; `updatedAt` has no default | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-07 | Migration | AC-36, BR-51 | Sign in as a migrated, unseeded user with the documented initial password, with an arbitrary password, and with the marker `!` | 401 with the generic failure body each time, identical to an unknown email, and no `Session` row created | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-08 | Migration | AC-37, BR-52 | Run the seed on the migrated database, sign in as a migrated Requester with the documented initial password, change it, then run the seed again | After the first seed the hash is a well-formed `scrypt$` string; sign-in forces the change; after the second seed the new password still works, `mustChangePassword` is false, and the hash is unchanged | `server/tests/lab-03/seed.test.ts` | Pass |
| MIG-09 | Migration | AC-34, BR-47 | Apply every migration from scratch to an empty database, then compare the migrations against `schema.prisma` with `prisma migrate diff` | Applies without error, and the diff reports no difference, so the hand-edited rename leaves no drift | `server/tests/lab-03/migration.test.ts` | Pass |
| MIG-10 | Migration | BR-22, BR-21 | Apply the IT Priority backfill migration to a Lab 2 database whose Tickets have no IT Priority, one of them already holding a different value | Every Ticket with none receives its Requested Priority, the one already set is kept, Requested Priority is untouched, and running it again changes nothing | `server/tests/lab-03/migration.test.ts` | Pass |
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
| AC-15 | API-14, API-28 |
| AC-16 | API-16, API-17, UI-11, E2E-03 |
| AC-17 | API-16, UI-12 |
| AC-18 | API-19, UI-15, UI-33, E2E-03 |
| AC-19 | API-20, UI-15, UI-33 |
| AC-20 | API-21 |
| AC-21 | API-22, E2E-03 |
| AC-22 | API-10 |
| AC-23 | UNIT-04, API-23, UI-16, UI-18, API-57, UI-33 |
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
| AC-41 | API-46, API-47, API-48, API-49, API-56, UI-29, UI-30, E2E-06 |
| AC-42 | API-50, UI-30 |
| AC-43 | API-51 |
| AC-44 | API-52 |
| AC-45 | API-53 |
| AC-46 | UI-31, UI-32 |

Every AC-01 through AC-46 appears above, and every test row names a real file path that must exist before its row may be marked Pass.

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

Ten rows moved from `Planned` to `Pass` (UI-01 to UI-08, plus UI-31 and UI-32 added in review round 1), each only after its test ran green.

| Suite | Result |
|---|---|
| `cd client && npm test` | 11 files, 92 tests passed: the 44 Lab 2 tests, unmodified, plus 48 new Lab 3 tests (10 in `Login.test.tsx`, 11 in `ChangePassword.test.tsx`, 27 in `RoleRoutes.test.tsx`) |
| `cd server && npm test` | 17 files, 114 tests passed, unchanged |
| `npx playwright test` | 8 of 9 passed, now through the Vite proxy. The failing spec is the same known `submission-evidence.spec.ts:132` described under Issue 02. |

Review round 1 (songt888): role route protection was incomplete. A Requester could open `/staff/tickets` and `/admin/users` by URL, because both only required a session, and IT Staff or an Administrator could act as a Requester through a Development Requester selection left in browser storage. Both are fixed and covered by UI-31 and UI-32. The new tests were written first and failed against the old code (13 red); each part of the fix was then mutation-checked (reverting the context change, letting every role through, dropping the Requester-route role check, and sending unknown URLs to `/tickets` each turned tests red), and reverting the context change alone showed the route check had been masking it, so the provider is now tested directly. A real-Chromium pass repeated the cases with real logins and a real stored selection: every forbidden URL was blocked, no `/api/tickets` request was made behind a forbidden screen, `/select-requester` bounced IT Staff to their own landing, and the allowed routes still worked.

Mutation check: removing the in-flight guard, the password clearing on a credential failure, the forced redirect to Change Password, and the client-side validation gate each turned at least one of the new tests red.

Manual pass in real Chromium against the real API through the Vite proxy, at 375, 768 and 1280 (22 checks): no horizontal scroll on Login or Change Password at any width; validation, credential failure, inactive account and API-failure states each look different; the session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/` and unreadable by script; nothing identity related is in `localStorage`; a direct visit to `/tickets` with an initial password is pushed back to Change Password; the session survives a reload; all 19 auth requests were same-origin with no CORS preflight. The pass found one defect the component tests could not: on an empty form, the first click on Sign In blurred the email field, its error appeared, the button moved down, and the mouse-up landed off the button, so the click was lost and the password error never showed. Space for field feedback is now always reserved so nothing shifts.

### Issue 04: role navigation, selector removal, Lab 2 repointed to the session

Eight rows moved from `Planned` to `Pass`: API-13, API-14, API-15, UI-09, UI-10, MIG-04, and API-42 and API-43, which were planned for Issue 06 but describe behaviour that exists as soon as the Lab 2 endpoints sit behind `requireRole("REQUESTER")`, so they are proved here instead. API-14 no longer names Public Comments, which do not exist yet: its Public Comments leg is now part of API-28. Each row moved only after its test ran green.

| Suite | Result |
|---|---|
| `cd server && npm test` | 19 files, 126 tests passed: 3 Lab 1, 77 Lab 2, 46 Lab 3. Five consecutive parallel runs of the affected files were all green. |
| `cd client && npm test` | 12 files, 104 tests passed: 35 Lab 2, 69 Lab 3 |
| `npx playwright test` | **8 of 8 passed, three consecutive runs**, from the whole `e2e` folder |

What changed in the Lab 2 suites, so nothing is silently lost:

- **Server, 82 to 80 Lab 1 and 2 tests.** All Lab 2 API tests now sign in as a Requester on a throwaway database and send no `requesterId`; their ownership assertions are unchanged. Two tests went: the two `GET /api/requesters` tests, because the endpoint is deleted (MIG-04). Tests of inputs that no longer exist were replaced, not dropped: "an unknown or inactive requesterId is a 400" became "a deactivated Requester gets 401 and creates nothing", each "missing requesterId is a 400" became "no session is a 401", and each "deactivated Requester gets 404" now expects 401, because a deactivated user's session stops working first (BR-08).
- **Client, 44 to 35 Lab 2 tests.** The 9 tests of the deleted Requester Selection screen went. Its "no ticket screen without a current Requester" guarantee now lives in `RoleRoutes.test.tsx` as a signed-out redirect to Login for the three Requester routes, and its "switching Requester clears the previous rows" test became a sign out and sign in as someone else.
- **Playwright, 9 to 8.** The Requester Selection evidence test was retired with the screen. The other specs sign in through the real Login screen (`e2e/lab-02/helpers.ts`), and `testDir` is now `./e2e`. The "My Tickets" evidence spec that failed on every rerun (it asserted exact counts against a database that accumulates Tickets, and hard-coded a Category id) tags everything it creates with a per-run token and looks Categories up by name, so it is repeatable.

Mutation check, server: opening the Requester endpoints to every role, trusting a `requesterId` in the body, and putting the auth guard after multer each turned tests red. The last one is what proves an unauthorized upload writes nothing to disk. The disk assertion uses a unique file extension per attempt, because a first version that counted files in the shared upload directory was racy under parallel test files. Mutation check, client: giving every role every nav item, keeping the user in memory after sign out, and letting a signed-out user through `RequireAuth` each turned tests red.

Manual pass in real Chromium against the real API through the Vite proxy (17 checks): each role sees exactly its own navigation with the current section marked, no horizontal scroll at 375, 768 or 1280, the mobile menu holds the identity and Logout, a voluntary Change password has no mandatory subheading, Back after Logout lands on Login, a signed-out `/tickets` goes to Login, and IT Staff opening a Requester screen sees Access denied inside their own shell.

### Issue 05: IT Staff Ticket Queue

Twelve rows are Pass: UNIT-08, API-16, API-17, API-18, API-49, UI-11 to UI-14 and UI-29 from the plan, plus two rows added because the queue depends on them, API-54 (IT Priority starts as a copy of the Requested Priority, BR-22) and MIG-10 (the one-time backfill of Lab 2 Tickets that have none). MIG-05 now also covers the seeded Tickets. Each row moved only after its test ran green.

| Suite | Result |
|---|---|
| `cd server && npm test` | 22 files, 158 tests passed: 3 Lab 1, 78 Lab 2, 77 Lab 3. Three consecutive full runs, with the shared development database unchanged by them. |
| `cd client && npm test` | 13 files, 128 tests passed: 35 Lab 2, 93 Lab 3 |
| `npx playwright test` | 8 of 8 passed, two consecutive runs |

Mutation checks. Server: removing the terminal-status exclusion from `needs-owner`, ignoring the role in owner eligibility, making `owner=me` mean "anyone assigned", dropping the id tie-break, removing `itPriority` from ticket creation, and removing the LIKE escape from either list each turned tests red. Client: removing the stale-response guard, the page reset on a filter change, the ineligible-owner marker, the row-retention during a reload, and `aria-sort` each turned tests red.

Defects found while building it, all now fixed and covered:

- **Search treated `%` and `_` as wildcards.** Prisma's `contains` builds a LIKE pattern without escaping it, so searching "50%" matched "50" followed by anything. It was in Lab 2's My Tickets search as well, so both are fixed (`escapeLike`) and both have a regression test that fails without it.
- **Sorting from the keyboard lost focus.** The first version unmounted the table and pager during every reload, so a keyboard user who pressed Enter on a header found their next key press going nowhere. Rows now stay on screen, marked `aria-busy`, while the newest request is in flight. The stale-response guard still decides what finally renders.
- **Lab 2 Tickets had no IT Priority.** Lab 2 never set it, but the queue shows, filters and sorts by it. Creation now sets it and a data migration backfills existing rows (checked on the real development data: zero NULL afterwards).
- **The client could not tell "(inactive)" from "(not IT Staff)"** from `ownerEligible` alone, so the item shape gained `ownerIsActive`.
- **Two visual defects only a browser showed:** pagination and the Clear filters link used Bootstrap's default blue instead of the Zen Green tokens, and at tablet width the filter selects were so narrow their labels truncated.

Manual pass in real Chromium against the real API through the Vite proxy, on the seeded data (17 checks): 8 columns on desktop, 6 on tablet, a card list on mobile, no horizontal scroll at any width, the view held in the URL and restored by the browser's Back button, keyboard sorting keeping focus, Needs an owner listing the two Tickets owned by an inactive account and excluding the closed and cancelled ones, and page 2 requested from the API.

### Issue 06: IT Staff Ticket operations and Ticket Detail

Twenty-five rows are Pass: API-57 and UI-33 (added in review round 1, below), UNIT-04, UNIT-05, API-19 to API-27, API-41, API-46, API-47, API-48, UI-15 to UI-18, UI-20, UI-28 and UI-30 from the plan, plus API-55 (the list a Ticket Owner select is filled from), which the plan had no row for. API-42 and API-43 were already Pass from Issue 04. Two rows changed shape because part of what they describe cannot exist yet: API-47 now covers IT Priority and the moves that need no owner, and its Public Comments and Internal Notes leg moved to a new row, API-56, planned for the comments Issue. Each row moved only after its test ran green.

| Suite | Result |
|---|---|
| `cd server && npm test` | 25 files, 220 tests passed: 3 Lab 1, 78 Lab 2, 139 Lab 3. Three consecutive full runs. |
| `cd client && npm test` | 15 files, 195 tests passed: 35 Lab 2, 160 Lab 3 |
| `npx playwright test` | 8 of 8 passed, two consecutive runs |

Mutation checks. Server: removing the transition check, the owner requirement, the claim condition, the from-status guard on the status write, making the priority change also rewrite Requested Priority, making the Requester's signal change the status, and holding staff to their own Tickets on the detail each turned tests red. Client: offering every status in the select, always showing Claim, sending Resolved with no summary or confirmation, not refreshing after a refused move, adding a Remove button for staff, not disabling the resolved action on a closed Ticket, and disabling the owner control while another control saves each turned tests red. The last one was not caught at first: the busy tests only checked the other controls while the owner saved, so I added the reverse direction.

What the tests establish about the two races the design worries about: two staff members claiming the same unassigned Ticket at once give exactly one 200 and one `ALREADY_ASSIGNED`, and two conflicting moves from `RESOLVED` (`CLOSED` against `REOPENED`) give exactly one 200 and one `INVALID_TRANSITION`, because the claim and the status write are each a single conditional write.

Defects and lessons from building it:

- **The test environment depended on a developer's private file.** A test failed because the download link came out with a host: `client/.env` sets `VITE_API_URL`, and Vitest read it. `vite.config.ts` now pins `VITE_API_URL` to empty for tests, so no `.env` can change a result.
- **A third Bootstrap-blue leak.** The breadcrumb link was Bootstrap's default blue. Plain links now take the primary token, checked by computed colour in the browser (nav links and buttons keep their own).
- **False alarms worth recording.** My first manual pass appeared to show a server restart on upload and a failed staff download. Neither was real: the file had been attached to the wrong Ticket (My Tickets does not read `?search=` from the URL), so there was no link to click, and the "Failed to fetch" console lines were navigations aborting in-flight requests. I reproduced the whole sequence under plain `npm run dev` and read the server log before concluding that, so no change was made for it.

Manual pass in real Chromium against the real API through the Vite proxy, on the seeded data (23 checks): claim; the workflow with an owner refusal and the select returning to the stored status; IT Priority; an empty Resolution Summary refused before anything is sent, then a valid one accepted; an inactive owner shown with the marker and badge, refused for In Progress until claimed; staff really downloading a file a Requester attached, with no upload or Remove control on the page; Back to Queue returning to the same filtered view; no horizontal scroll at 768 and 375; and the whole loop between two people, where the Requester reads the Resolution Summary, sends "problem appears resolved", the status stays Resolved, and staff then see the banner.

Review round 1 (songt888) on Issue 06 found two real defects, both mine, both now fixed:

- **The status write was guarded by a second, unvalidated read.** The move was checked against one read of the Ticket's status, but the conditional `updateMany` then used a status read again afterwards, so a change in between made the guard match the new status and an unchecked move, even out of `CLOSED` or `CANCELLED`, went through. The verdict now carries the status that was judged, and that exact status is what the write is conditional on; if the Ticket has moved on, nothing is written and the move is judged again from where it actually is. The new tests change the Ticket in the gap between the check and the write. Written first, three of the four failed against the old code (each answered 200 where 409 was expected, including a Ticket closed after the check); the fourth, an owner deactivated after the check, already held because that condition is part of the write.
- **Concurrent saves merged whole snapshots.** A save returns the whole Ticket as it was when the server answered, so a slow owner response carrying the old priority overwrote a newer priority save, and the reload after a status change could overwrite a newer owner. Each control now owns a group of fields and a response, or a reload, may change only that group. The four scenario tests failed against the old screen before the fix.

Two decisions worth recording. The status control deliberately stays disabled until its own reload has landed, because its options come from that reload, so a second status change is never made from stale options. And I first added per-control sequence guards as well, then removed them: every control is disabled while its own operation and reload run, so two operations for the same control cannot overlap, and the mutation check showed nothing exercised the guards. Untested defensive code that looks like protection is worse than none, so the invariant is stated in a comment instead. One reachable bug of the same class did turn up while thinking it through: if the route parameter changed while the screen stayed mounted, a save in flight for one Ticket would have been applied to the next. The screen now remounts per Ticket, with a test that fails without it.

Confirmed against the real API and real Chromium as well: a Claim and an IT Priority change made at the same instant both stick on screen and are what the server stored; the status options follow each reload without disturbing the owner or the priority; two parallel PATCHes to the same Ticket both applied; and of two conflicting status moves fired at once, one succeeded and one was refused, leaving the Ticket in one of the two requested statuses.

Review round 2 (songt888) on Issue 06 found one more real defect, also mine: `refresh()` swallowed every failure. After a status change the permitted next statuses and the Resolution Summary come from a reload, so if that reload failed the screen showed "Saved" and re-enabled the control on options that belonged to the previous status, and after a refused claim it said "It now shows its current owner" while showing the old owner. Now `refresh()` reports whether it worked. When it did not, nothing is applied and the control is locked: it offers only its current value, says the latest values could not be loaded, shows no "Saved", and has a Reload button that unlocks it once a reload succeeds. A refused change whose reload failed says the change was not made and the latest values could not be loaded, instead of claiming the screen is current. A failure of the owner list counts as a failed reload for the owner control, since a refused owner may still be in the list. The other controls stay usable.

Six tests were added under UI-33. Written after the fix, so each was checked by putting the old `refresh()` back (5 of the 6 failed; the sixth is the control case, a reload that works stays quiet) and by nine single-line mutations. Seven turned a test red: ignoring the owner list failure, offering the old options while locked, never clearing the lock, not locking the control, keeping the old refusal message, showing "Saving…" while reloading, and setting "Saved" regardless. The other two survived, which showed that two guards I had written could not be reached (a "Saved" hidden while locked, when it is never set then; a terminal-Ticket check while locked, when a terminal Ticket has no move to make stale), so both were removed instead of kept as untested code. Also checked in real Chromium against the real API with the detail request aborted after a status save, at 375 and 1280 px: the status control is locked with only its current value, no "Saved", IT Priority stays usable, no horizontal scroll, and Reload restores the correct options and removes the note.

### Issue 07: Public Comments and Internal Notes

Twelve rows are Pass: UNIT-06, API-11, API-28 to API-32, API-52, API-56, UI-19, UI-21 and UI-22. API-14 gained two legs, reading and posting Public Comments on another Requester's Ticket, which it had promised to add with this endpoint. No row was added, split or moved.

| Suite | Result |
|---|---|
| `cd server && npm test` | 27 files, 268 tests passed: 3 Lab 1, 78 Lab 2, 187 Lab 3. Fifteen consecutive full runs. |
| `cd client && npm test` | 15 files, 224 tests passed: 35 Lab 2, 189 Lab 3 |
| `npx playwright test` | 8 of 8 passed, two consecutive runs |

One Lab 2 test changed. `client/tests/lab-02/RequesterTicketDetail.test.tsx` (Lab 2 UI-10) asserted that no Public Comment text appears on the Requester's Ticket Detail, which was true in Lab 2 and is exactly what this Issue changes. The assertion is removed, with a comment saying why; the assertions that Internal Notes, actions and status controls are absent stay. `docs/lab-02/tests.md` is left as the Lab 2 record.

**What the server does.** The two kinds are two tables, so the only code that reads notes is the notes endpoint, which is closed to a Requester by role before any lookup: a Requester gets the same 403 for their own Ticket, someone else's, a Ticket that does not exist and a malformed id, with a body of only `error` and `message`, so it discloses nothing about the notes or about the Ticket. Author and time always come from the session and the server clock, and the role is stored on the row when it is written, so changing a person's role later does not relabel what they wrote (AC-44), while a former author who is now a Requester is refused on notes and other staff still read theirs (API-52). The check order is the one endpoint 10 uses: request (400), then Ticket (404).

**A race worth recording.** A Requester may not comment on a closed Ticket, and closing is a separate request, so a comment could be written just after the close if the status were checked and the comment inserted as two steps. The check and the insert are one transaction holding a share lock on the Ticket row, so a close in flight either finishes first, and the comment is refused, or waits for the comment. The test holds a close open in a transaction, starts the comment, proves the comment is waiting rather than deciding on the old status, then commits the close and expects 409 with nothing stored. Removing the lock turned it red.

**What the client does.** The IT Staff Ticket Detail shows Public Comments, Internal Notes and Attachments as tabs with counts; Attachments stopped being a plain section, as `ui-spec.md` said it would. Only the active tab is in the page, so the note composer is not merely hidden while comments are open: it does not exist. The draft in each box is kept when switching tabs. Internal Notes have a tinted panel, a lock and the words "Internal only. Not visible to the Requester." above the list, so the warning is met before anything can be typed. The Requester sees a Public Comments section with no tab strip, no notes request and no mention of notes; on a closed Ticket the composer is replaced by an explanation, and the server refuses regardless. Bodies are plain text, checked with a body full of markup.

Mutation checks. Server, 10 mutations, each turned tests red: dropping the share lock, dropping the terminal check, opening the notes endpoint to every role, taking the role from the request body, newest first, letting any Requester reach any Ticket, skipping validation, exposing the author id, taking the author id from the body, and reading the role from the author's current role. Two needed the test fixed first: the forged author id I sent happened to equal the real author's id, so it forged nothing, and a clause that also required the Requester to be active was unreachable, because a deactivated account has no session, so it was removed. Client, 17 mutations: 15 turned tests red at once (rendering every tab, not clearing the box, innerHTML, showing an unknown count as 0, keeping the complaint while typing, no Home and End keys, no roving tabindex, no notes tint, no internal-only words, the Requester asking for notes, no closed explanation, no 409 message, posting untrimmed text, no length check, and showing the composer on the wrong tab), and 2 survived. One was the guard against a second submit while one is in flight, which the disabled button hid; a test that submits the form twice now kills it. The other was a "still mounted" flag, unreachable because React ignores a late answer for an unmounted component and both screens unmount the panels when they reload a Ticket, so it was removed instead of kept as untested code.

Defects and lessons from building it:

- **A fourth Bootstrap-blue leak.** The selected tab rendered black rather than the primary token, because the plain `.zg-tab.active` rule was outranked by Bootstrap's tab rules; raising the specificity fixed it. Found by reading computed colours in the browser, not by any unit test.
- **A tab hidden off the edge.** At 375px the tab strip scrolled sideways and Attachments was out of sight, so nobody would know it existed. On a phone the three tabs now share the width and their labels wrap.
- **False alarms from my own script.** Playwright's `getByText` matched the text inside the composer's `<textarea>`, so "the comment has appeared" passed before the post finished and the next check read a stale tab count. The script now waits for the entry count to rise.

Manual pass in real Chromium against the real API through the Vite proxy on the seeded data, at 375, 768 and 1280 (84 checks, 28 per width): three tabs with counts; only the active composer rendered; a post with line breaks, literal markup and a 300 character unbroken word wraps with no horizontal scroll and the tab count rises; a one character body refused inline; the internal-only words visible without scrolling and the notes panel the warning tint; a note posted; ArrowRight, Home and the tab order; the Attachments tab; then as a Requester: no tab strip, no internal text, no request for notes, the staff comment carrying the IT Staff badge, a reply posted, and a closed Ticket explaining why there is no composer. Selected and idle tab colours and the 44px target were read from computed styles. The screenshots I read were the staff notes view at 1280 and 375, the staff comments view at 375, the Requester view at 375 and the closed Ticket at 1280.

Review round 1 (songt888) on Issue 07: BR-50 requires the seed to produce example Public Comments and Internal Notes, and it did not. That was a gap I left, not a disagreement.

- **The seed.** `server/prisma/seedContent.ts` adds 24 examples on 12 of the 14 seeded Tickets, 15 comments and 9 notes, from all three roles, with nothing sensitive in them. They follow the rules the application enforces: a Requester writes only on their own Ticket and never on a closed or cancelled one, notes are written by staff, each body is 2 to 2000 characters, and three are written by the inactive IT Staff account as the owner they used to be. Two seeded Tickets have none, so the empty states have real rows.
- **Idempotency without a natural key.** A comment has no unique field, so a row's identity is its Ticket, its author and its time, and the time is fixed per entry as minutes after the Ticket's own creation. An existing row is left exactly as it is, so a re-run neither duplicates nor overwrites, an edited body stays edited, and anything added through the application is untouched. The whole run holds a database advisory lock, so several seeds started together on an empty database add each example once. Checked on the real development database: seeded twice, 15 and 9 rows both times, and a checksum of every comment's id, body and time identical.
- **Tests.** Eight added to `seed.test.ts` under MIG-05: the examples exist across roles and statuses, they obey the application's rules, nothing sensitive, they show through the API with the right visibility (the Requester reads the comments and is refused the notes), a re-run changes nothing, four seeds at once add nothing extra, a hand-deleted row comes back without duplicating the rest, an edited body and an app-added comment survive, and it refuses to run before the Tickets are seeded. Seven mutations of `seedContent.ts` (always creating, identifying by body, overwriting the body, hard-coding the role, using the current time, always creating notes, dropping the lock) each turned a test red. The lock was the exception at first: the concurrency test ran against rows that already existed, where nothing races, so it now starts from an empty database.
- **A test-infrastructure flake, found while doing this.** The server suite failed between one full run in seven and one in fourteen, with a different test each time: a stray 404, a 20 second hang, and once a response body shaped like an Anthropic API error that no route of this app produces. The cause was not the app, as far as I can establish. Supertest starts the app on a random port on every interface and then connects to it as 127.0.0.1, and this machine has editor helper processes listening on 127.0.0.1 on ports in the same range, so now and then a request reached one of them instead. I did not prove a single collision; what supports it is the foreign response body and that the failures stopped once that could not happen. It predates this Issue (it showed on the committed code, about one run in fourteen, and in one file alone about one run in twenty-five). `tests/setup.ts` now serves the app once per test file on 127.0.0.1 itself, where the operating system refuses a port someone else holds, and points supertest at it. Pointing it at a wrong port turns every test red, so it is really used. After the fix: 15 full runs and 25 runs of the file that failed most, all green, where before the fix roughly one in seven to fourteen runs failed. It changes no application code and no assertion.

### Issue 08: Administrator User Management

Eighteen rows are Pass: UNIT-07, API-33 to API-40, API-44, API-45, API-50, API-51 and UI-23 to UI-27. API-12 (an IT Staff session against every admin endpoint) stays with the final sweep in Issue 09, but AC-33 is tested here too: IT Staff and a Requester get 403 on all four endpoints, an anonymous caller 401, with no user data in the body.

| Suite | Result |
|---|---|
| `cd server && npm test` | 29 files, 325 tests passed: 3 Lab 1, 78 Lab 2, 244 Lab 3. Five consecutive full runs. |
| `cd client && npm test` | 16 files, 253 tests passed: 35 Lab 2, 218 Lab 3 |
| `npx playwright test` | 8 of 8 passed, two consecutive runs |

Two existing client tests changed because the placeholder they asserted is gone: the two `RoleRoutes` cases that expected "Signed in as ..." on `/admin/users` now expect the User Management heading. The placeholder screen `RoleLanding` was unused after that and is deleted.

**What the server does.** Four endpoints, Administrator only, decided by the role before an id or a body is looked at. No response carries a password hash, no route deletes a user, and a body cannot set `mustChangePassword`, the hash or the id. Email is trimmed, lower-cased and compared case-insensitively, including against an older row stored in mixed case, and two identical addresses submitted at once give one 201 and the rest 409, from the unique index. A role change or a deactivation revokes that user's sessions in the same transaction as the change, and only when it really is one: renaming someone, or sending their current role again, leaves them signed in. A new initial password re-flags the change and revokes every session of that user. Deactivating a user who owns open Tickets is never refused, and not one Ticket row is written (API-44 compares every column, `updatedAt` included, before and after).

**The two guards on the Administrator role, and a race between them.** Checking "is anyone else still an active Administrator" and then writing is two steps, so two Administrators removing each other at the same moment would each see the other still active and both succeed, leaving none. The change therefore runs in one transaction that first locks the acting Administrator, the user being changed and every active Administrator, in id order, so a second change waits and then sees what the first did. The same lock lets it notice that the caller was themselves deactivated or demoted after their request was accepted, and refuse with 403. Tests: eight rounds of two Administrators deactivating each other at once, where exactly one succeeds, and eight of them demoting each other, where at least one always remains; and two tests that hold the caller's deactivation open in a transaction, start the change, prove it is waiting rather than deciding on the old state, then commit and expect 403 with nothing written. Removing the lock turned the race tests red, and removing the caller check turned the two held-open tests red.

**A rule I had to decide.** The spec gives "Deactivating, and demoting, the last active Administrator" (API-38, LAST_ADMINISTRATOR) and "an Administrator deactivating themselves" (API-37, SELF_DEACTIVATION) as separate rows. Taken literally they cannot both be reached one after the other: the caller must be an active Administrator, so if the target is a different Administrator there are at least two. The last Administrator can only be the caller acting on themselves. So when the only Administrator acts on their own account the answer is LAST_ADMINISTRATOR, the more basic reason, and SELF_DEACTIVATION is what an Administrator gets when others exist. Documented in `api-spec.md`. The other reachable route to LAST_ADMINISTRATOR is the race above.

**What the client does.** `/admin/users` is a search box, a role filter, Create User and a table with Name, Email, Role, Status and Edit; below 768px the table becomes cards. Create and Edit open a panel beside the list, and on anything narrower than a wide desktop it takes over the width and hides the list, so a tablet gets the single pane too. Focus moves to the first field when the panel opens and returns to what opened it when it closes. The four messages the spec calls unmissable are all there in its words: the duplicate email is an inline field error and the panel stays open with everything typed preserved; the Active toggle on the Administrator's own row is disabled with the reason as a tooltip and also written under it, because a disabled control shows no tooltip and a phone has no hover; the last-Administrator refusal is an error callout, and the form goes back to what is stored so it never shows a state that was not saved; and a non-Administrator sees "You do not have access to User Management." and no request is made for users. Edit sends only the fields that changed and keeps Save off until something has.

Decisions worth arguing with: (1) an Administrator's own row hides "Set new initial password" and points to Change password, because the server would accept it and end their own session; (2) the own-row Role select stays usable, since the spec disables only the toggle, and a refused change explains itself and puts the select back; (3) a search runs on every keystroke behind the same newest-answer-only guard the queue has.

Mutation checks. Server, 23 mutations on the routes and validation plus 3 on the Ticket effects, each turned tests red once the tests named below were added: dropping the locks, the last-Administrator check, the self check, revocation on a change, revocation on a deactivation, always revoking, case-sensitive duplicate checks on create and on update, not lower-casing, not revoking on a new password or not re-flagging it, no wildcard escaping in the search, no role filter, no caller check, mass assignment, a leaked hash, ignoring `isActive` on create, no 404, opening the endpoints to IT Staff, allowing an empty change, creating with `mustChangePassword` false, and losing the duplicate catch for the unique index. Deactivation unassigning Tickets, being refused for open Tickets and touching Tickets each turned tests red. Three survived at first and each showed a missing test: the case-insensitive check on update needed a mixed-case legacy row, and the caller check needed the held-open transaction, because the cross-deactivation race is caught by the last-Administrator rule before it. Client, 20 mutations: 18 turned tests red at once, and 2 survived until a test was added for each (the new initial password being remembered after it was set, and a form submitted twice while in flight).

Defects and lessons from building it:

- **A fifth Bootstrap-blue leak.** The checked Active switch was Bootstrap's blue (`rgb(13, 110, 253)`), found by reading its computed colour in the browser, and now takes the primary token, as does every checkbox.
- **A badge that wrapped.** In the two-pane layout the "IT Staff" badge broke over two lines. Badges no longer wrap.
- **A check nothing exercised.** The rule that refuses a caller who was deactivated a moment after their request was accepted had no test that could fail, because the cross-deactivation race is caught earlier by the last-Administrator rule. Removing it changed nothing until I wrote the two tests that hold the caller's deactivation open.
- **A false alarm from my own script.** "Focus returned to the Edit button" failed in the browser pass because the script checked before the focus call had run; with a short wait it passes at every width. The screen was right.

Manual pass in real Chromium against the real API through the Vite proxy on the seeded data, at 375, 768 and 1280 (72 checks, 24 per width): the list as a table or as cards with no horizontal scroll; search narrowing to one row; the role filter showing only Administrators; the panel opening with focus on Full Name and the list hidden or shown as designed; a duplicate email refused inline with everything preserved; a user created, focus back on Create User, and found in the list; a role change and a deactivation shown in the list; a new initial password with its feedback; focus returning to that Edit button; and, as the only Administrator, the own toggle disabled with its tooltip and the reason written out, and a role change refused with the callout in the error tokens and the select put back. The screenshots I read were the edit panel at 1280 (before and after the badge fix), the last-Administrator callout at 375, and the list at 375.
