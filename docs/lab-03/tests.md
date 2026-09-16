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
| UNIT-01 | Unit | BR-03 | `hashPassword` then `verifyPassword` round trip, and a wrong password | Correct password verifies, wrong one does not, hash is never the plaintext | `server/tests/lab-03/password.unit.test.ts` | Planned |
| UNIT-02 | Unit | BR-03 | Two hashes of the same password | Different salts produce different stored values, both verify | `server/tests/lab-03/password.unit.test.ts` | Planned |
| UNIT-03 | Unit | BR-10, AC-07 | `validateNewPassword` against each unmet rule and the boundaries 7, 8, 128, 129 | One specific message per unmet rule; 8 and 128 accepted, 7 and 129 rejected | `server/tests/lab-03/password.unit.test.ts` | Planned |
| UNIT-04 | Unit | BR-25, AC-23 | `isTransitionPermitted` across every from/to pair in the matrix | Exactly the BR-25 pairs allowed, all others refused, including same-status | `server/tests/lab-03/statusTransition.unit.test.ts` | Planned |
| UNIT-05 | Unit | BR-26 | Terminal statuses `CLOSED` and `CANCELLED` | No transition out of either is permitted | `server/tests/lab-03/statusTransition.unit.test.ts` | Planned |
| UNIT-06 | Unit | BR-33 | Comment and note body validation: empty, whitespace-only, 1, 2, 2000, 2001 characters | Whitespace-only and 1 rejected, 2 and 2000 accepted, 2001 rejected, value trimmed | `server/tests/lab-03/contentValidation.unit.test.ts` | Planned |
| UNIT-07 | Unit | BR-40, BR-46 | User field validation: name bounds, email format and length, role enum | Out-of-bounds and malformed values rejected with a per-field message | `server/tests/lab-03/userValidation.unit.test.ts` | Planned |
| UNIT-08 | Unit | BR-23, L2-BR-23 | `parseStaffQueueQuery` with unknown sort, out-of-range page and pageSize, unknown filter values | Every unrecognised input falls back to its default, never throws | `server/tests/lab-03/staffQueueQuery.unit.test.ts` | Planned |
| API-01 | API | AC-01 | Valid login | 200, session cookie set, safe user body with role, no password field | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-02 | API | AC-06 | Login with an unknown email, and with a wrong password | Both 401 with the identical generic message | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-03 | API | AC-05 | Login to an inactive account with correct credentials | 401 `ACCOUNT_INACTIVE`, no session created | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-04 | API | AC-02, BR-02 | A `mustChangePassword` user calling a protected endpoint | 403 `PASSWORD_CHANGE_REQUIRED`; `/auth/me`, change-password, and logout still work | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-05 | API | AC-07 | Change password with each BR-10 rule unmet, and with a mismatched confirmation | 400 with the specific field message, old password still valid | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-06 | API | AC-08 | Successful password change | 200, `mustChangePassword` false, other sessions revoked, acting session survives | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-07 | API | AC-09 | Logout, then reuse the same cookie | 200 on logout, 401 on the next request | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-08 | API | AC-10, BR-08 | Deactivate a user holding a live session, then use it | 401 without an explicit logout | `server/tests/lab-03/auth.api.test.ts` | Planned |
| API-09 | API | AC-13 | Every protected endpoint with no cookie | 401 on each, no data in any body | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-10 | API | AC-12, AC-22 | A Requester session against every staff and admin endpoint | 403 on each, no protected data | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-11 | API | AC-04, BR-35 | A Requester requesting Internal Notes on a Ticket they own | 403, body contains no note content and no note count | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-12 | API | AC-33 | An IT Staff session against every admin user endpoint | 403 on each | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-13 | API | AC-03, BR-11 | A Requester sending another user's `requesterId` in body and query | The authenticated identity is used; the other Requester's data is never returned | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-14 | API | AC-15 | A Requester requesting another Requester's Ticket, Attachment, and Public Comments | 404 in every case, never 403 | `server/tests/lab-03/authorization.api.test.ts` | Planned |
| API-15 | API | AC-14 | Every Lab 2 Requester endpoint under a session, with `requesterId` removed | Same behaviour as Lab 2: create, list, detail, upload, download, soft remove | `server/tests/lab-03/requester-regression.api.test.ts` | Planned |
| API-16 | API | AC-16, AC-17 | Queue listing with search, each filter, each sort, and pagination | Returned set matches all criteria; pagination metadata consistent; no duplicates or gaps across pages | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-17 | API | AC-16 | Queue `owner` filter with `unassigned`, `me`, and a specific id | Each returns exactly the matching Tickets | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
| API-18 | API | BR-24a pattern | Queue query matching zero Tickets | Empty array with `total` 0, not an error | `server/tests/lab-03/staff-queue.api.test.ts` | Planned |
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
| UI-01 | UI | AC-01 | Login screen: valid submission | Calls the API once, stores nothing in `localStorage`, navigates to the role landing screen | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-02 | UI | FR-01 | Login: missing email, malformed email, missing password | Per-field messages shown, no API call made | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-03 | UI | AC-06 | Login: credential failure response | Generic callout, email preserved, password cleared | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-04 | UI | AC-05 | Login: inactive-account response | Distinct inactive message, visually different from a credential failure | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-05 | UI | FR-01 | Login: double submit while in flight | Button disabled and busy, exactly one request issued | `client/tests/lab-03/Login.test.tsx` | Planned |
| UI-06 | UI | AC-02 | A `mustChangePassword` user attempting any other route | Redirected to Change Password, no nav items rendered | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-07 | UI | AC-07 | Change Password: live rule checklist as the user types | Each rule flips met state; submission blocked while any is unmet | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-08 | UI | AC-08 | Change Password: success | Navigates into the application, nav items appear | `client/tests/lab-03/ChangePassword.test.tsx` | Planned |
| UI-09 | UI | AC-11 | Shell rendered for each of the three roles | Only that role's nav items appear; no hidden markup for the others | `client/tests/lab-03/Shell.role.test.tsx` | Planned |
| UI-10 | UI | AC-09 | Logout from the shell | Session cleared, redirected to Login, back-navigation does not restore the app | `client/tests/lab-03/Shell.role.test.tsx` | Planned |
| UI-11 | UI | AC-16 | Ticket Queue: loaded with rows | Ticket number, status, IT priority, and owner rendered; unassigned shown explicitly | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-12 | UI | AC-17 | Ticket Queue: search, each filter, sort toggle, and page change | Correct query issued per interaction; `aria-sort` reflects state | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-13 | UI | L2 race defect | Ticket Queue: an older request resolving after a newer one | The stale result never renders | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-14 | UI | FR-10 | Ticket Queue: loading, empty, no-results, and failure states | Four visually distinct states; toolbar stays mounted after first load | `client/tests/lab-03/StaffTicketQueue.test.tsx` | Planned |
| UI-15 | UI | AC-18, AC-19 | Staff Ticket Detail: claim, then reassign | Owner updates in place without a reload; Claim hidden once assigned | `client/tests/lab-03/StaffTicketDetail.test.tsx` | Planned |
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
| MIG-01 | Migration | AC-34 | Row count and ids in `User` after the rename, against `RequesterUser` before | Identical count, identical ids, no row lost or added | `server/tests/lab-03/migration.test.ts` | Planned |
| MIG-02 | Migration | AC-34, BR-47 | Every pre-existing Ticket's requester after migration | Each Ticket still resolves to its original person by ticket number | `server/tests/lab-03/migration.test.ts` | Planned |
| MIG-03 | Migration | BR-48 | Migrated Requesters after seeding | Role `REQUESTER`, `mustChangePassword` true, a usable hashed password, no plaintext stored | `server/tests/lab-03/migration.test.ts` | Planned |
| MIG-04 | Migration | BR-49 | `GET /api/requesters` after removal | 404 from the router | `server/tests/lab-03/migration.test.ts` | Planned |
| MIG-05 | Migration | BR-50 | Seed run twice | Idempotent: same counts, no duplicates, required active and inactive fixtures present for all three roles | `server/tests/lab-03/seed.test.ts` | Planned |
| E2E-01 | E2E | AC-01, AC-02, AC-09 | Sign in with an initial password, change it, reach the application, log out, attempt direct access | Normal screens open only after the change; access blocked after logout | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-02 | E2E | AC-11, AC-12 | Sign in as each role and inspect navigation and a forbidden route | Each role sees only its destinations; a forbidden route shows the forbidden state | `e2e/lab-03/authentication.spec.ts` | Planned |
| E2E-03 | E2E | AC-16 to AC-27 | Full staff flow: find in queue, open, claim, set IT Priority, move status, comment publicly, add an internal note, resolve with a summary | Every step succeeds and persists; the Requester sees the comment and the resolution but never the note | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-04 | E2E | AC-14 | Requester regression: create a Ticket with an attachment, list, filter, open detail, remove the attachment | Identical behaviour to Lab 2 under the authenticated identity | `e2e/lab-03/staff-ticket-flow.spec.ts` | Planned |
| E2E-05 | E2E | AC-29 to AC-32 | Administrator flow: create a user, hit a duplicate email, edit, set an initial password, sign in as that user and be forced to change it, attempt self-deactivation and last-admin removal | Every safety rule refuses clearly; the new user is forced through the password change | `e2e/lab-03/user-administration.spec.ts` | Planned |
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
| AC-34 | MIG-01, MIG-02 |
| AC-35 | RESP-01 |

Every AC-01 through AC-35 appears above, and every test row names a real file path that must exist before its row may be marked Pass.

## 4. Migration and regression evidence

Captured once, when the Issue 02 migration is applied to a database already holding Lab 2 data:

- `SELECT count(*) FROM "RequesterUser"` recorded before, `SELECT count(*) FROM "User"` after.
- The full `ticketNumber` to requester email mapping, compared before and after.
- The complete Lab 2 suites (`server/tests/lab-01`, `server/tests/lab-02`, `client/tests/lab-02`, `e2e/lab-02`) passing from the Lab 3 branch, proving the increment was evolved rather than replaced.

## 5. Manual verification

Automated tests did not catch the two worst Lab 2 defects: a stale-response race and design tokens that were defined but never applied. Both were found by running the app and looking at it. So each UI Issue also gets a manual pass against seeded data at 375, 768, and 1280, exercising the real flow rather than a mock, before its Pull Request is opened.

## 6. Results

To be completed as each Issue lands. Final counts from `main`, with the `Final` column above flipped from `Planned` to `Pass` per row, go here before submission.
