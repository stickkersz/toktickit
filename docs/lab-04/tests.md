# Lab 4 Test Plan and Results

Companion to `docs/lab-04/specification.md`. This plan is written **before** implementation, as handout section 10 requires. Every row starts as `Planned` and is flipped to `Pass` only when that exact test runs green from the branch. Counts written anywhere in this document are copied from the real test output.

## 1. How to run

```bash
cd server && npm test      # Vitest and Supertest: units, every Lab 1 to Lab 4 endpoint, migration, seed, performance smoke
cd client && npm test      # Vitest and Testing Library: every Lab 2 to Lab 4 screen and state
npx playwright test        # from the repo root: Lab 2 to Lab 4 end-to-end, responsive, accessibility, screenshots
```

The database must be running, migrated, and seeded first. Playwright's `testDir` stays `./e2e`, so the Lab 2 and Lab 3 suites keep running as regression evidence. A Playwright run rewrites committed screenshots; after a run that is not meant to refresh evidence, restore `artifacts/` with git.

Type key: Unit, API (integration), Security (authorization), Workflow, Dashboard (metric against database), Migration, Regression, Performance (smoke), UI (component), Style (UI style), Responsive, Accessibility, E2E.

## 2. Planned tests

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | BR-03, BR-04, AC-05, AC-06 | Action field validation at every length boundary, Follow-Up Note required only when flagged | 5 and 2000 accepted, 4 and 2001 rejected (and 1000/1001, 500/501 for the shorter fields); note required with the flag, cleared without it; values trimmed | `server/tests/lab-04/actionValidation.unit.test.ts` | Pass |
| UNIT-02 | Unit | BR-05, AC-07 | Action Date/Time rules | Before Ticket creation rejected; 365 days ahead accepted, 366 rejected; completion more than 2 minutes in the future rejected, within 2 minutes accepted | `server/tests/lab-04/actionValidation.unit.test.ts` | Pass |
| UNIT-03 | Unit | BR-09 | Action Status moves across every pair | Only Planned to Completed and Planned to Cancelled allowed; nothing leaves a final status | `server/tests/lab-04/actionValidation.unit.test.ts` | Pass |
| UNIT-04 | Unit | BR-21 | Resolution gate from Planned and Completed counts | Blocked with `ACTIONS_INCOMPLETE` when any Planned, `NO_COMPLETED_ACTION` when none Completed, allowed otherwise | `server/tests/lab-04/actionValidation.unit.test.ts` | Pass |
| UNIT-05 | Unit | BR-29, AC-35 | Asia/Bangkok window start for 7 and 30 days, including just before and after local midnight and at month end | Window starts at 00:00 Bangkok N-1 days before today, as a UTC instant 7 hours earlier | `server/tests/lab-04/dashboardWindow.unit.test.ts` | Pass |
| UNIT-06 | Unit | BR-39 | `Idempotency-Key` format check and `requestHash` fingerprint | UUIDs of any version and case accepted, anything else rejected; hash equal for bodies that differ only in surrounding whitespace or key order, or in a field the endpoint ignores; hash different when any accepted field, or the Ticket id in the path differs; the hashed text unchanged since Issue 03; 64 lower-case hex characters | `server/tests/lab-04/idempotency.unit.test.ts` | Pass |
| UNIT-07 | Unit | BR-36 | List query parsing of `statusGroup`, `status`, `-updatedAt` | Known values applied, unknown values fall back to the default, a single status wins over a group | `server/tests/lab-04/listQuery.unit.test.ts` | Pass |
| API-01 | API | AC-14, BR-16 | List Actions of a Ticket holding several Actions by different Responsible Staff | Ordered by Action Date/Time then creation; each item carries Recorded By, Responsible Staff, Performed By | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-02 | API | AC-15, BR-17 | A Requester listing Actions on their own Ticket and on another Requester's | Own: every Action including Cancelled, full shape; another's: 404 | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-03 | API | AC-01 | Create a valid Actions Taken | Created under the correct Ticket and actor: 201, `ticketId` correct, Recorded By the caller, Responsible Staff the chosen active user | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-04 | API | AC-04, BR-07 | Create, and reassign, with an inactive user, a Requester, and a missing user as Responsible Staff | 409 `INVALID_RESPONSIBLE` each time; no row created or changed | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-05 | API | AC-05, BR-04 | Follow-Up Required true without a note; false with a note | 400 naming `followUpNote`; saved with the note cleared | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-06 | API | AC-06, BR-03 | Each text field at and beyond its limits through the API | Limits accepted, one beyond rejected with a `fields` entry | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-07 | API | AC-07, BR-05 | `actionAt` before Ticket creation, 366 days ahead, future at completion | 400 each time, nothing written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-08 | API | AC-16, BR-06 | Client sends `recordedById`, `performedById`, `status`, `createdAt`, `completedAt` | All ignored; server values stored | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-09 | API | AC-08, BR-12 | Edit a Planned Action, including fields that are not editable | Editable fields changed, Recorded By and Recorded at unchanged, other fields ignored, version up by one | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-10 | API | AC-17, BR-08 | Deactivate the Responsible Staff after creation, read, then reassign | Still named with `eligible: false`; reassign to an active user succeeds | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-11 | API | AC-09, BR-10 | Complete a Planned Action, then try to edit it | 200 Completed with Performed By the caller and server `completedAt`; the edit gets 409 `ACTION_FINAL` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-12 | API | AC-10, BR-11 | Cancel with a reason, then cancel and complete again | Cancelled with reason, Cancelled By, Cancelled at; both repeats 409 `ACTION_FINAL` | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-13 | API | AC-11, BR-13 | Two edits from the same loaded version, and a complete after an edit | First wins; second 409 `STALE_ACTION` with the current Action; nothing of the second written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-14 | API | AC-12, BR-14 | Create, edit, complete, cancel on Resolved, Closed, and Cancelled Tickets | 409 `TICKET_NOT_WORKABLE` for every combination, nothing written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| API-15 | API | AC-39, BR-39 | Ticket, Public Comment, Internal Note, and Action create each sent twice with one key | One record each; second response 200 with `Idempotent-Replayed: true` and the same record | `server/tests/lab-04/idempotency.api.test.ts` | Pass |
| API-16 | API | AC-40, BR-39 | Same key on each of the four endpoints with: one accepted body field changed; a comment or note key reused on a different Ticket; and a body differing only in surrounding whitespace | Each change: 409 `IDEMPOTENCY_KEY_REUSED`, nothing created; whitespace only: 200 replay with `Idempotent-Replayed: true`; every keyed row has a non-null `requestHash` | `server/tests/lab-04/idempotency.api.test.ts` | Pass |
| API-17 | API | BR-39 | Malformed key; two requests with one key sent at the same moment, first with equal bodies, then with different bodies; one key used by two different users | 400; equal bodies: exactly one record, the other a replay; different bodies: exactly one 201 and one 409 `IDEMPOTENCY_KEY_REUSED`, one record; the two users each get their own record | `server/tests/lab-04/idempotency.api.test.ts` | Pass |
| API-18 | API | BR-39, BR-47 | The four create endpoints with no key | Behaviour identical to Lab 3 | `server/tests/lab-04/idempotency.api.test.ts` | Pass |
| API-19 | API | BR-36 | `statusGroup` on My Tickets and the queue, all eight statuses on My Tickets, `-updatedAt` sort | Exactly the matching Tickets, in the requested order | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| API-20 | API | BR-21 | Ticket Detail for IT Staff and for a Requester | Staff body has `resolutionGate` with correct counts; Requester body has none | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-21 | API | AC-52, FR-20 | `GET /api/health` | 200 `{ status: "ok", service: "TokTickIT API" }` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| API-22 | API | BR-42, FR-17 | Every Lab 4 endpoint with the database call forced to throw | 500 with the generic `{ error: "INTERNAL_ERROR", message }` body; no stack trace, SQL, path, or token; nothing partly written | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| SEC-01 | Security | AC-15, BR-17 | A Requester calling every Action write endpoint on own, other, and missing Tickets and Actions | 403 every time from the role alone, nothing written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| SEC-02 | Security | AC-34 | Every Lab 4 endpoint with no session | 401 on each, no data in any body | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| SEC-03 | Security | AC-34, BR-35 | A Requester on the staff dashboard; IT Staff and an Administrator on the Requester dashboard | 403, no metric in the body | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| SEC-04 | Security | AC-33, BR-32 | Staff dashboard as IT Staff and as an Administrator | No `accounts` key for IT Staff; correct counts for the Administrator | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| SEC-05 | Security | AC-25, BR-26 | A Requester reading the history of their own and another Requester's Ticket | Own: 200; another's: 404 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| SEC-06 | Security | AC-02, BR-35 | Requester dashboard called with `requesterId`, `owner`, or other widening parameters | Parameters ignored; only the caller's figures returned | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| SEC-07 | Security | BR-47, BR-07 | Every integer read from a request above 2147483647: each Lab 2, Lab 3, and Lab 4 path id, Ticket create `categoryId` and `relatedSystemId`, owner `ownerId`, Action `responsibleStaffId` and `version`, queue and My Tickets `category`, `owner`, `page` | 404 for a path id (400 on the resolution indication, as before), 400 with a `fields` entry for a body value, the default for a list filter; never a 500, nothing written | `server/tests/lab-04/request-integers.api.test.ts`, `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| SEC-08 | Security | BR-07, L3-BR-18 | A Ticket Owner or Responsible Staff member deactivated after the request was checked and just before the write | 409 `INVALID_OWNER` or `INVALID_RESPONSIBLE`; nothing written | `server/tests/lab-04/request-integers.api.test.ts`, `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| WF-01 | Workflow | AC-18, BR-20 | Every from and to status pair as IT Staff and as an Administrator, and every move as a Requester | Exactly the BR-20 moves succeed, including Waiting for Requester to Cancelled and Reopened to Cancelled; others 409 `INVALID_TRANSITION`; Requester 403 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-02 | Workflow | AC-19, BR-21 | Resolve through the API directly while an Action is Planned | 409 `ACTIONS_INCOMPLETE` with `plannedActions`; status unchanged; no Status Change | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-03 | Workflow | AC-20, BR-21 | Resolve a Ticket with no Completed Action, including one with only Cancelled Actions | 409 `NO_COMPLETED_ACTION`; status unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-04 | Workflow | AC-21 | Resolve with all Actions final, one Completed, an eligible owner, a valid summary | 200 Resolved; Status Change with the summary | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-05 | Workflow | AC-22, BR-23 | Move from a status the Ticket no longer has; and without `fromStatus` | 409 `STATUS_CHANGED` naming the current status and its moves, nothing written; missing `fromStatus` 400 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-06 | Workflow | AC-23, BR-24 | A sequence of moves; a failure injected after the status write; PATCH and DELETE on history | One Status Change per move in order; the failed move leaves neither the status nor a Status Change; no route changes history (404) | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-07 | Workflow | AC-13, BR-15 | Cancel a Ticket holding Planned and Completed Actions, from Open, Waiting for Requester, and Reopened; then an edit sent with a Planned Action's old version | Planned become Cancelled with "Ticket cancelled" in the same operation, each version up by one; Completed unchanged; the late edit gets 409 `TICKET_NOT_WORKABLE`, never `STALE_ACTION` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-08 | Workflow | AC-26, BR-27 | Requester's "problem appears resolved" indication | Status and Status History unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-09 | Workflow | BR-21 | An Action create and a resolve sent at the same moment, repeated 20 times | Never a Resolved Ticket with a Planned Action: either the Action is refused with `TICKET_NOT_WORKABLE` or the resolve with `ACTIONS_INCOMPLETE` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-10 | Workflow | BR-22 | A request failing several checks at once | Reported in order: 400, 404, `STATUS_CHANGED`, `INVALID_TRANSITION`, `OWNER_REQUIRED`, gate | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| WF-11 | Workflow | BR-24 | Ticket creation | One Status Change from none to New by the Requester, in the same transaction | `server/tests/lab-04/ticket-workflow.api.test.ts` | Pass |
| DASH-01 | Dashboard | AC-28, BR-31 | Every IT Staff metric on the seeded database | Each equals its defining query run directly through Prisma | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| DASH-02 | Dashboard | AC-30, BR-34 | IT Staff user with nothing assigned and an empty queue | Every count 0, lists empty, `byStatus` still holds eight zero entries | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| DASH-03 | Dashboard | AC-31, BR-36 | Each IT Staff metric's `link` applied to `GET /api/staff/tickets` | The queue total equals the metric count for every card and status | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| DASH-04 | Dashboard | BR-28, AC-38 | List sizes and content | At most 5 items each, latest first, description cut to 120 characters | `server/tests/lab-04/staff-dashboard.api.test.ts` | Pass |
| DASH-05 | Dashboard | AC-29, BR-33 | Every Requester metric on the seeded database | Each equals its defining query restricted to that Requester | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| DASH-06 | Dashboard | AC-02 | Two Requesters with different Tickets | Each sees only their own figures and Tickets | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| DASH-07 | Dashboard | AC-32, BR-36 | Each Requester metric's `link` applied to `GET /api/tickets` | My Tickets total equals the metric count | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| DASH-08 | Dashboard | AC-35, BR-29 | With a fixed clock, activity at 00:00:00 Bangkok six days ago and 23:59:59 seven days ago, and resolutions at the same edges of the 30-day window | The 00:00:00 records counted, the 23:59:59 records not | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| DASH-09 | Dashboard | BR-38 | Last activity after an Action write, a Public Comment, an Attachment, and an Internal Note | The first three move `updatedAt`; the Internal Note does not | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| DASH-10 | Dashboard | AC-30 | Requester with no Tickets | Every count 0, lists empty | `server/tests/lab-04/requester-dashboard.api.test.ts` | Pass |
| MIG-01 | Migration | AC-45, BR-44 | Apply the Lab 4 migration to a copy of a seeded Lab 3 database | Every Lab 3 table's row count unchanged; Status Change count equals Ticket count; `idempotencyKey` and `requestHash` present and null on every existing Ticket, Public Comment, and Internal Note | `server/tests/lab-04/migration.test.ts` | Pass |
| MIG-02 | Migration | AC-45, BR-45 | Apply `server/prisma/rollback/lab-04-down.sql` after the migration | Lab 4 tables, enum, indexes, and the `idempotencyKey` and `requestHash` columns gone; every Lab 3 row identical to before | `server/tests/lab-04/migration.test.ts` | Pass |
| MIG-03 | Migration | AC-24, BR-25 | History of a migrated Ticket that is New and one that is In Progress, then the In Progress one moved to Waiting for Requester in Lab 4 | Both start with "Created as New"; the In Progress one has `earlierChangesUnrecorded: true`, still `true` after the Lab 4 move; the New one stays `false` after a Lab 4 move | `server/tests/lab-04/migration.test.ts` (backfill), `server/tests/lab-04/ticket-workflow.api.test.ts` (flag after a Lab 4 move) | Pass |
| MIG-04 | Migration | AC-46, BR-46 | Run the seed twice | Second run changes nothing; data includes Tickets with 0, 1, and several Actions, every status and priority, and users whose own dashboard figures are all zero | `server/tests/lab-04/seed.test.ts` | Pass |
| REG-01 | Regression | AC-43, BR-47 | Full Lab 1, Lab 2, and Lab 3 server suites | All pass; any test changed for a superseding Lab 4 rule is listed in section 6 | `server/tests/lab-01`, `lab-02`, `lab-03` | Pass |
| REG-02 | Regression | AC-43 | Full Lab 2 and Lab 3 client suites | All pass | `client/tests/lab-02`, `client/tests/lab-03` | Pass |
| REG-03 | Regression | AC-43 | Full Lab 2 and Lab 3 Playwright suites | All pass | `e2e/lab-02`, `e2e/lab-03` | Pass |
| PERF-01 | Performance | AC-47 | Both dashboards and the queue, 20 calls each, with about 500 Tickets | Median under 300 ms, none over 1 second | `server/tests/lab-04/performance.smoke.test.ts` | Pass |
| PERF-02 | Performance | AC-38, BR-28 | Dashboard response sizes with the same data | Each body under 10 KB | `server/tests/lab-04/performance.smoke.test.ts` | Pass |
| UI-01 | UI | AC-36, FR-14 | Navigation and landing route per role | Dashboard first in each role's nav, marked `aria-current="page"`; sign-in lands on the role's dashboard | `client/tests/lab-04/Navigation.test.tsx` | Pass |
| UI-02 | UI | FR-12, BR-31 | IT Staff Dashboard with a full response | Every card with label, value, and a link whose accessible name and href match the metric | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-03 | UI | AC-30, BR-34 | IT Staff Dashboard with all zeros | Each card shows 0 and its empty sentence; lists show theirs | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-04 | UI | AC-37 | IT Staff Dashboard loading, failure, and Retry | Skeleton with `aria-busy`; failure callout with Retry and no numbers; Retry loads | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-05 | UI | AC-34 | A Requester opening the staff dashboard route, and staff opening the Requester one | Forbidden state, no dashboard request made | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-06 | UI | AC-33 | Accounts card for an Administrator, absent for IT Staff | Shown with counts and a Users link only for the Administrator | `client/tests/lab-04/StaffDashboard.test.tsx` | Pass |
| UI-07 | UI | FR-11, BR-33 | Requester Dashboard with a full response | Four cards with links to My Tickets filters; Waiting for you tinted with "Needs your attention" when above 0; both lists link to Ticket Detail | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-08 | UI | AC-30, AC-37 | Requester Dashboard empty, loading, and failure | Empty sentences; skeleton; failure with Retry | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-09 | UI | AC-31, AC-32, BR-36 | My Tickets and the queue opened with dashboard query strings | Filters pre-selected from the URL, the "Active tickets only" chip shown and removable, request carries the same parameters | `client/tests/lab-04/RequesterDashboard.test.tsx` | Pass |
| UI-10 | UI | AC-14, BR-14, BR-16 | Actions Taken tab: list order, badges, Add shown only on a workable Ticket | Rows in BR-16 order with Action Status badges; Add hidden and the reopen sentence shown on a Resolved Ticket | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-11 | UI | AC-05, AC-50, BR-04 | Create form validation and the conditional Follow-Up Note | Messages under each field; the note and its asterisk appear only when Follow-Up Required is checked | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-12 | UI | AC-39, AC-41 | Save Action clicked twice quickly; then a retry after a lost response | One request on the double click; the retry reuses the same `Idempotency-Key` | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-13 | UI | AC-42, BR-41 | Save Action failing with 500 and with 409 | Every typed value still in the form; error callout shown | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-14 | UI | AC-11, BR-13 | Edit answered with `STALE_ACTION` | Conflict callout with server values beside the form's; "Use my changes" resends against the new version; "Discard" reloads | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-15 | UI | AC-09, AC-49 | Complete dialog, including on a Planned Action dated in the future | Focus moves in and stays in, Escape closes, focus returns to Complete, and after Mark as Completed or Cancel Action (both final) to the Action's row; Result required; Action Date/Time pre-filled (now for a future-dated Action) and always sent as `actionAt`; on success the Action shows read-only and final | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-16 | UI | AC-10 | Cancel dialog | Reason required; the request carries the loaded `version`; on success the Action is labelled Cancelled with its reason and has no actions | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-17 | UI | AC-09, BR-12 | A Completed and a Cancelled Action opened | Every field read-only (`readOnly`), no Edit, Complete, or Cancel; "This action is final" shown | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-18 | UI | AC-04, AC-17 | Ineligible Responsible Staff, and a save refused with `INVALID_RESPONSIBLE` | Name with "Not active"; select offers only active staff; error under the field and the list reloads | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-19 | UI | AC-15, AC-25 | Requester Ticket Detail | Actions Taken and History shown read-only; no Add, Edit, Complete, Cancel, or status control | `client/tests/lab-04/ActionsTaken.test.tsx` (Actions part), `client/tests/lab-04/TicketWorkflow.test.tsx` (History part) | Pass |
| UI-20 | UI | AC-19, AC-20, FR-07 | Status control with the gate closed, and right after an Action write | Resolved chosen shows the gate sentence and "Go to Actions Taken"; nothing sent. After an Action write the status control is disabled and busy until the gate is re-read, so no choice is judged on the old gate and no move starts before the re-read lands | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-21 | UI | AC-22, BR-41 | Move answered with `STATUS_CHANGED` | Conflict callout naming the new status, reloaded moves, pending confirmation dropped | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-22 | UI | AC-27 | Successful move | Header badge, summary, History, and permitted moves refresh; "Status updated." shown and announced | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-23 | UI | AC-24, BR-25 | History of a migrated Ticket | "Created as New" then "Earlier status changes were not recorded." | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-24 | UI | AC-13 | Cancel Ticket confirmation with Planned Actions, from In Progress, Waiting for Requester, and Reopened | Cancelled is offered from each; the confirmation states how many planned actions will be cancelled | `client/tests/lab-04/TicketWorkflow.test.tsx` | Pass |
| UI-25 | UI | AC-39, AC-42 | Create Ticket, Public Comment, and Internal Note forms | Each sends an `Idempotency-Key`, keeps it on retry, and keeps typed text after a failure | `client/tests/lab-04/Hardening.test.tsx` | Pass |
| UI-26 | UI | AC-44, BR-43 | Any console error or warning during the whole client suite | The test setup fails the test that produced it; the suite passes with none | `client/tests/setup.ts` | Pass |
| UI-27 | UI | AC-40, BR-39 | Add Action and Public Comment create answered with `IDEMPOTENCY_KEY_REUSED`, then submitted again | Typed text kept; the server's message shown; the next request carries a new `Idempotency-Key` | `client/tests/lab-04/Hardening.test.tsx` (comment), `ActionsTaken.test.tsx` (Add Action) | Pass |
| STYLE-01 | Style | AC-51 | Action Status, follow-up, and eligibility badges | Fixed text plus token class on each, never color alone | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| STYLE-02 | Style | AC-50, BR-04 | Every required label on the Lab 4 forms and dialogs | Ends with the red asterisk; the Follow-Up Note's only while checked | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| STYLE-03 | Style | FR-19 | Lab 4 component sources | No hex color literal outside `zen-green.css`; every class used exists in the stylesheet | `client/tests/lab-04/Hardening.test.tsx` | Pass |
| RESP-01 | Responsive | AC-48 | Both dashboards at 375, 768, 1280 | No horizontal scroll, no clipping or overlap; screenshots saved | `e2e/lab-04/dashboards.spec.ts` | Pass |
| RESP-02 | Responsive | AC-48 | Actions Taken list, create form, Complete dialog, blocked Resolve, Status History, and Requester view at 375, 768, 1280 | Table at desktop, cards on mobile, no horizontal scroll; screenshots saved | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| A11Y-01 | Accessibility | AC-49 | Keyboard-only pass of a dashboard, the Actions tab, and both dialogs | Every control reachable and operable; focus ring computed as the Zen Green token; dialogs trap and return focus | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-01 | E2E | AC-01, AC-14 | IT Staff create two Actions with different Responsible Staff, edit one, reassign it, complete one, cancel the other | Both shown on one Ticket with correct people and statuses | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-02 | E2E | AC-03 | Create an Action, complete it, resolve the Ticket, then sign in as the Requester | Action Completed with Performed By, Ticket Resolved, Requester sees both and the History | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |
| E2E-03 | E2E | AC-19, AC-20 | Try to resolve with a Planned Action, complete it, resolve | Blocked with the gate message first, then succeeds | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |
| E2E-04 | E2E | AC-22 | Two staff browsers on one Ticket; one moves it, the other then moves it from the old status | The second sees the `STATUS_CHANGED` conflict and the reloaded status | `e2e/lab-04/ticket-resolution.spec.ts` | Pass |
| E2E-05 | E2E | AC-31 | IT Staff open every dashboard card | The queue opens filtered and shows the same count as the card | `e2e/lab-04/dashboards.spec.ts` | Pass |
| E2E-06 | E2E | AC-02, AC-32 | Two Requesters open their dashboards and drill down | Each sees only their own figures; My Tickets matches each card | `e2e/lab-04/dashboards.spec.ts` | Pass |
| E2E-07 | E2E | AC-36 | Sign in as each role | Each lands on its dashboard with Dashboard marked current | `e2e/lab-04/dashboards.spec.ts` | Pass |
| E2E-08 | E2E | AC-04 | An Administrator deactivates an IT Staff user while another staff user has the Action form open with them chosen | Saving is refused with the inactive-person message | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-09 | E2E | AC-44 | Browser console during every Lab 4 journey | No error or warning collected | `e2e/lab-04/console.ts`, run by every Lab 4 spec (`dashboards.spec.ts`, `actions-taken-flow.spec.ts`, `ticket-resolution.spec.ts`) | Pass |

## 3. Acceptance-Criterion traceability

| AC | Tests |
|---|---|
| AC-01 | API-03, E2E-01 |
| AC-02 | SEC-06, DASH-06, E2E-06 |
| AC-03 | E2E-02 |
| AC-04 | API-04, UI-18, E2E-08 |
| AC-05 | UNIT-01, API-05, UI-11 |
| AC-06 | UNIT-01, API-06 |
| AC-07 | UNIT-02, API-07 |
| AC-08 | API-09 |
| AC-09 | API-11, UI-15, UI-17 |
| AC-10 | API-12, UI-16 |
| AC-11 | API-13, UI-14 |
| AC-12 | API-14 |
| AC-13 | WF-07, UI-24 |
| AC-14 | API-01, UI-10, E2E-01 |
| AC-15 | API-02, SEC-01, UI-19 |
| AC-16 | API-08 |
| AC-17 | API-10, UI-18 |
| AC-18 | WF-01 |
| AC-19 | WF-02, UI-20, E2E-03 |
| AC-20 | WF-03, UI-20, E2E-03 |
| AC-21 | WF-04 |
| AC-22 | WF-05, UI-21, E2E-04 |
| AC-23 | WF-06 |
| AC-24 | MIG-03, UI-23 |
| AC-25 | SEC-05, UI-19 |
| AC-26 | WF-08 |
| AC-27 | UI-22 |
| AC-28 | DASH-01 |
| AC-29 | DASH-05 |
| AC-30 | DASH-02, DASH-10, UI-03, UI-08 |
| AC-31 | DASH-03, UI-09, E2E-05 |
| AC-32 | DASH-07, UI-09, E2E-06 |
| AC-33 | SEC-04, UI-06 |
| AC-34 | SEC-02, SEC-03, UI-05 |
| AC-35 | UNIT-05, DASH-08 |
| AC-36 | UI-01, E2E-07 |
| AC-37 | UI-04, UI-08 |
| AC-38 | DASH-04, PERF-02 |
| AC-39 | API-15, UI-12, UI-25 |
| AC-40 | API-16, API-17, UNIT-06, UI-27 |
| AC-41 | UI-12 |
| AC-42 | UI-13, UI-25 |
| AC-43 | REG-01, REG-02, REG-03 |
| AC-44 | UI-26, E2E-09 |
| AC-45 | MIG-01, MIG-02 |
| AC-46 | MIG-04 |
| AC-47 | PERF-01 |
| AC-48 | RESP-01, RESP-02 |
| AC-49 | UI-15, A11Y-01 |
| AC-50 | UI-11, STYLE-02 |
| AC-51 | STYLE-01 |
| AC-52 | API-21 |

Every AC from AC-01 to AC-52 maps to at least one test.

## 4. Migration and regression evidence

Recorded at release: the full suite counts for Labs 1 to 4 on the final `main`.

**Final `main` (2026-11-01).** After the release Pull Request #92 was approved at `68d4a2a` and merged, all three suites were run from `main` at `f40da3a` (Merge pull request #92 from stickkersz/lab4-staging), with the database migrated and seeded. The complete output is the Part 3 evidence in the submission PDF.

| Suite | Labs 1 to 3 | Lab 4 | Total |
|---|---|---|---|
| Server (`cd server && npm test`) | 334 (30 files) | 111 (13 files) | 445 passed, 43 files |
| Client (`cd client && npm test`) | 266 (16 files) | 75 (6 files) | 341 passed, 22 files |
| Playwright (`npx playwright test`) | 22 | 11 | 33 passed |

The totals are from the run on `main`. The split by lab comes from runs of each lab's folders at `874a224`, whose code is identical to `main`'s (the two differ only in one line of this file). `tests.md` has 109 of 109 planned tests Pass and none Planned.

**Issue 02 (2026-10-30).** Tests on a scratch database in the Lab 3 state holding Users of every role, Tickets in all eight statuses, Attachments (one removed), Public Comments, an Internal Note and a Session:

- MIG-01: after the migration every Lab 3 row is identical except the two new key columns, which are nullable and null on every existing row; every Ticket has exactly one Status Change (none to New, at its creation time, by its Requester); keys are unique per creating user and keyless rows are unlimited.
- MIG-02: after the down script (run with Lab 4 rows present) every Lab 3 row and the whole public schema (tables, columns, indexes, constraints, enum types) are identical to before, and the migration applies again.
- MIG-04: a second seed run leaves every Action Taken, Status Change and Ticket identical; a migrated creation row is not duplicated; a seeded Ticket moved through the application gets no invented history or Actions.

The shared development database was migrated the same day after a `pg_dump` backup (kept outside the repository). Row counts before: User 224, Ticket 1694, Attachment 565, PublicComment 50, InternalNote 56, Session 1466, Category 5, RelatedSystem 8. After: the same, plus StatusChange 1694 (equal to Ticket) and ActionTaken 0. The seed then added 13 Actions Taken on 9 Tickets and their Status History, and a second run added nothing.

## 5. Manual verification

Recorded per Issue: each screen used in a real browser against the seeded database at 375, 768, and 1280, the screenshots read, and the browser console checked.

**Final screen pass on `main` (2026-11-01).** `lab-screen-checker` captured every screen at 375, 768 and 1280 on `main` at `45d2a25`, with keyboard-focus crops of every control type and the browser console on each screen. No horizontal scroll anywhere, and no console error or warning other than the browser's own line for a 4xx the app expects. It reported eleven points; each was checked against the code before anything changed, and the fixes were rechecked with fresh captures:
- Fixed, each behaviour change with a test that failed first: the status control now waits, disabled and busy, while the gate is re-read after an Action write, so a quick Resolved is never judged on the gate from before the write (this was also behind an intermittent Playwright failure in the resolution flow); Change Password validates on blur and its errors follow what is typed; Login drops an invalid-credentials banner once a field is edited; the Public Comments tab says it is visible to the Requester; the Create User panel names the password field once.
- Fixed, layout: Create Ticket's counters no longer run into a wrapped message, its fields keep a gap when stacked and no value is clipped at 768; My Tickets' filters fit at 768; User Management uses the full width when no panel is open; the resolve gate's "Go to Actions Taken" looks like a link.
- Not defects: the Requester opens an Action by clicking its row, which shows the cancel reason and Performed By (the checker had not clicked); the queue's phone cards carry the fields Lab 3's ui-spec lists.
- Left as it is: a date field's selected part (day, month, year, time) keeps the browser's own highlight. Chromium ignores a focus pseudo-class written on those parts, and styling them without one would hide which part is being edited; the field itself shows the Zen Green ring. The rule that tried to restyle them never applied and was removed.

## 6. Results

Filled in per Issue as each one lands, with the exact counts copied from the test output, the tests changed for a superseding rule (listed under each Issue below), and the lessons.

### Baseline before Lab 4

Run on `main` at `5619594` on 2026-10-02 before any Lab 4 change: server 333 passed (30 files), client 265 passed, Playwright 22 passed.

### Issue 02: migration, recovery and seed

Run on `feature/lab4-02-migration-seed` on 2026-10-30: server 343 passed (32 files, 10 of the tests new in `tests/lab-04/`), client 265 passed, Playwright 22 passed.

- Turned from Planned to Pass: MIG-01, MIG-02, MIG-04. MIG-03 stays Planned: its backfill half (a migrated Ticket starts with "Created as New" and nothing more) is checked in MIG-01, and the gap flag after a Lab 4 move needs the Status History endpoint of Issue 05.
- Mutation checks, each restored afterwards: the backfill limited to no rows (2 tests red); one `DROP INDEX` removed from the down script (MIG-02 red); the seed's "no Actions yet" guard removed (2 red), its "status unchanged" guard removed (1 red), a Planned Action placed on a Closed Ticket (1 red), the creation row always inserted (3 red).
- Superseding change: `server/tests/lab-03/seed.test.ts` now expects 5 active Requesters and 4 active IT Staff, because BR-46 adds one of each with zero figures of their own.
- Contract wording fixed: BR-46 and AC-46 asked for an IT Staff user "for whom every dashboard figure is zero", but the BR-31 Unassigned, Urgent, By status and Recently updated figures count across every Requester and cannot be zero on a seeded database. They now ask for zero personal figures, with the all-zero case shown on an empty database (DASH-02).

### Issue 03: Actions Taken API

Run on `feature/lab4-03-actions-api` on 2026-10-30: server 372 passed (36 files), client 265 passed, Playwright 22 passed. Of the server tests, 28 are new for this Issue (9 unit in `actionValidation.unit.test.ts` and `idempotency.unit.test.ts`, 15 in `actions-taken.api.test.ts`, 4 in `idempotency.api.test.ts`) and 1 is the seed fix below.

- Turned from Planned to Pass: UNIT-01, UNIT-02, UNIT-03, UNIT-06, API-01 to API-14, SEC-01. API-15 to API-18 are tested for Action create in `server/tests/lab-04/idempotency.api.test.ts`; the rows stay Planned until Ticket, Public Comment, and Internal Note create gain the key (Issue 08).
- Mutation checks, each restored afterwards: create open to every role (SEC-01 red); edit, complete, and cancel open to every role (SEC-01 red); the workable-status condition removed from the Ticket lock (API-14 red); the Responsible Staff check removed (API-04 red); the replay of a matching key removed (3 red); the Ticket last-activity update removed from edit, complete, and cancel (3 red). Removing only the early version check left the tests green, because the conditional `updateMany ... WHERE version` still refused the stale write; removing both layers turned API-13 red.
- Decision: every Action write (create, edit, complete, cancel) runs in one transaction holding `FOR NO KEY UPDATE` on the Ticket row. The api-spec first said a share lock for create, but the same transaction updates the Ticket's last activity (BR-19), and two creates holding a share lock and then updating the row would deadlock. The stronger lock serialises Action writes per Ticket, which also makes the version check and BR-14 race-free. api-spec endpoint 2 now says so.
- Decision: a key whose stored `requestHash` matches is replayed before any other check, so a retry after the Responsible Staff was deactivated or the Ticket resolved still returns the record it created. A key whose hash differs is reported in the contract's order, after `INVALID_RESPONSIBLE` and `TICKET_NOT_WORKABLE`. Keys are stored lower-cased, so an upper-case copy of a UUID is the same key.
- Added after the pre-PR gate: BR-02 (a Ticket owned by one staff member, an Action recorded by another with a third as Responsible Staff) in API-03, and BR-19 last activity on edit, complete, and cancel in API-09, API-11, API-12, with API-14 checking a refused write leaves it unchanged.
- Regression: `server/tests/lab-03/authorization.api.test.ts` (the route sweep) now lists the five Action endpoints; it failed until they were added, as it should, and now checks 401 on each and 403 for a Requester on each write against a real Planned Action.
- Seed fix from the #82 review (separate commit): seeded Actions and moves now set the Ticket's last activity (BR-38), and the seed transactions use a 30 second timeout. MIG-04 gains the assertion.

**Review round on #83 (songt, request changes).** `responsibleStaffId` accepted any positive integer, so 2147483648 reached Prisma and ended as a 500; create checked Responsible Staff before the Ticket lock, so someone deactivated in between was still recorded; and a lone `followUpNote` while follow-up was off wrote and bumped the version. Fixed with a test that failed first for each: API-04 (range on create and edit, and the deactivation race), API-05 (the no-op note is now a 400), API-09 (`version` 2147483648).
- Sweep (`lab-finding-sweeper`): the same missing 32-bit bound was in every Lab 2 and Lab 3 path id, Ticket create `categoryId` and `relatedSystemId`, the owner endpoint's `ownerId`, and the queue and My Tickets `category`, `owner`, and `page` filters, each a 500. Fixed once, in `isValidId` (`server/src/ids.ts`), which every route already uses, and in the two query parsers (SEC-07). The Lab 3 owner reassign had the same check-outside-the-write shape as finding 2 (SEC-08).
- Every eligibility check (Ticket Owner, Responsible Staff) now runs inside the write's transaction with `FOR SHARE` on the user's row, which conflicts with the `FOR UPDATE` an Administrator's deactivation takes, so a deactivation either waits for the write or is seen by it. The race tests commit the deactivation just before the write; the in-flight case rests on that lock, which no test simulates.
- Mutation check: removing the upper bound from `isValidId` turns 7 tests red.
- Left for the dashboard Issue (BR-38): a priority or owner change to the value it already has still moves `updatedAt`.
- Counts after the round: server 377 passed (37 files), client 265 passed, Playwright 22 passed.

### Issue 04: Actions Taken UI

Run on `feature/lab4-04-actions-ui` on 2026-10-30: server 377 passed (37 files), client 288 passed (17 files), Playwright 25 passed.

- Turned from Planned to Pass: UI-10 to UI-18, STYLE-01, E2E-01, E2E-08. UI-19, STYLE-02, RESP-02 and A11Y-01 are tested for the Actions Taken part only (`client/tests/lab-04/ActionsTaken.test.tsx`, `e2e/lab-04/actions-taken-flow.spec.ts`) and stay Planned until Status History (Issue 05) and the dashboards (Issues 07, 09).
- New tests: 23 in `client/tests/lab-04/ActionsTaken.test.tsx`; 3 in `e2e/lab-04/actions-taken-flow.spec.ts` (E2E-01, E2E-08, and the stale-edit callout against the real server). Screenshots: 18 in `artifacts/lab-04/screenshots/actions-taken/` (list, create and Complete dialog at 375, 768 and 1280; validation, edit, cancel dialog, inactive Responsible Staff, stale conflict, keyboard focus in the dialog; the Requester view at three widths). The `resolve-blocked` and `resolved-history` captures belong to Issue 05.
- Mutation checks, each restored afterwards: a new Idempotency-Key on every send (2 red); the single-flight guard removed (red only once a same-moment double submit test was added, since a double click lets the button disable itself first); the dialog focus trap removed (1 red); focus not returned on close (1 red); the Follow-Up Note always shown (1 red); a future-dated Action pre-filled with its own date in the Complete dialog (1 red); the draft not kept across a layout switch (1 red).
- Found by E2E-01 on the real stack and fixed with a test that failed first: (1) `datetime-local` names a whole minute, so the default "now" on a Ticket filed earlier that minute was before its creation and the server refused it; a time in the creation minute is now sent as the creation time, an earlier minute is refused under the field. (2) Crossing 768px swaps the table for the cards and remounted an open form, losing what was typed; the panel now keeps the draft.
- Found by `lab-screen-checker` and fixed: secondary buttons filled with Bootstrap grey on focus; a disabled primary button lost its colours to Bootstrap's `.btn:disabled`; four tabs cut "Attachments" at 375px (they now sit two per row); Action dates used a different format from the rest of the page; the date field's selected part used the browser's blue; the Cancel dialog's message touched its buttons; and the Lab 3 Ticket Information grid clipped values at 768px (now two columns from 768px, four from 992px).
- Superseding changes, Lab 2 and Lab 3 tests: `client/tests/lab-03/StaffTicketDetail.test.tsx` and `e2e/lab-03/staff-ticket-flow.spec.ts` open the Public Comments tab first, because Actions Taken is now the first tab (ui-spec section 7); `client/tests/lab-02/RequesterTicketDetail.test.tsx` now expects the read-only Actions Taken section (BR-17) instead of none. `client/tests/setup.ts` stubs the new list request for tests written before Lab 4.
- Decision: only one of the table and the cards is rendered (chosen with `matchMedia`), so an open Action's detail and edit form exist once in the page with unique field ids.

**Review round on #84 (songt, request changes).** After a successful Complete or Cancel, the dialog returned focus to the button that opened it, which the now-final Action no longer renders, so focus fell to the page. Fixed with a test that failed first: focus now goes to the Action's row (UI-15, UI-16).
- Sweep (`lab-finding-sweeper`), same pattern in the Actions Taken screens, fixed in the same commit with a test each: `ACTION_FINAL` from the edit form and from the Complete dialog, and `TICKET_NOT_WORKABLE` from the dialog, now focus the Action's row; `TICKET_NOT_WORKABLE` on a create (no row, no Add Action left) focuses the explanation; Keep editing returns focus to the form's Cancel; a refused resend after Use my changes keeps focus in the form. ui-spec section 7, AC-49 and UI-15 now say where focus goes when the opener is gone.
- Mutation checks: each of the four focus moves removed turns its tests red (2, 2, 1, 1).
- The sweep also found the pattern in Lab 3 screens outside this PR's diff (status confirmations, Claim, Reload, the Requester's flag and attachment remove, Set password, and Retry and Clear filters across lists); they are pre-existing and are handled outside this PR (LAB-WORKFLOW findings log, Lab 4 #84).
- Counts after the round: server 377 passed (unchanged), client 291 passed (17 files), Playwright 25 passed.

### Issue 05: Ticket workflow, resolution gate and Status History

Run on `feature/lab4-05-workflow` on 2026-10-30: server 392 passed (38 files), client 302 passed (18 files), Playwright 28 passed.

- Turned from Planned to Pass: UNIT-04, WF-01 to WF-11, SEC-05, API-20, MIG-03, UI-19 (its Actions Taken part came with Issue 04, its History part here), UI-20 to UI-24, E2E-02 to E2E-04.
- New tests: 14 in `server/tests/lab-04/ticket-workflow.api.test.ts` and 1 in `actionValidation.unit.test.ts`; 11 in `client/tests/lab-04/TicketWorkflow.test.tsx`; 3 in `e2e/lab-04/ticket-resolution.spec.ts`. Screenshots added: `resolve-blocked` and `resolved-history` at 375, 768 and 1280; the earlier Actions Taken captures were retaken because the tab bar now ends with History.
- Mutation checks, each restored afterwards. Server: the Planned part of the gate (3 red), the Completed part (1), the `fromStatus` check (2), the version bump on the cascade (1), and the `FOR UPDATE` on the Ticket row (the WF-09 race went red). Client: the gate pre-check (2), the lost-response retry (1), the History reload after a move (1), the planned-Action count in the Cancel confirmation (1), the gap line in the History (1).
- Found by `lab-screen-checker` and fixed: five tabs overflowed a 768px screen (History cut to "H"), so below 992px the tabs now wrap onto further rows, each as wide as its label; the Ticket Owner select was cut at 768px ("Pimchanok Somboon (y"), so the handling controls are two per row from 768px and three from 992px; the duplicate React key warning on the status select (the Lab 3 leftover named in ui-spec section 11) came from the new status also being in the old permitted list for a moment, and each status is now listed once (a test asserts no duplicate-key error; red without the fix). Kept as they are: Performed By moving into the detail below 992px (ui-spec section 7), the focus ring style and the 31px desktop button height, which match the rest of the app.
- Decision: the status move is now one transaction holding `FOR UPDATE` on the Ticket. Lab 3 judged a read and then made the write conditional on it; judging inside the lock makes the gate, the owner check and the stale-status check race-free together.
- Contract wording fixed: BR-15 and ADR 0004 said a form left open on an Action the Ticket's cancel cascaded would get `ACTION_FINAL`, but `TICKET_NOT_WORKABLE` is checked first (api-spec endpoint 3). They now say that, and WF-07 asserts it.
- Superseding changes, Lab 3 tests: the matrix tests (14 to 16 moves, `statusTransition.unit.test.ts` and `staff-ticket-detail.api.test.ts`); every Lab 3 move now sends `fromStatus` and a resolve gets a Completed Action first (`asLab4Move` in `server/tests/lab-03/helpers.ts`); the losing concurrent move is `STATUS_CHANGED`; the four "change between the check and the write" tests now land the change just before the move's transaction and expect `STATUS_CHANGED` or `OWNER_REQUIRED`; the route sweep lists the history route. Client: `changeTicketStatus` takes `fromStatus`, so Lab 3 call assertions add it; the tab list ends with History; the status control says "Status updated." (ui-spec section 10) where Lab 3 said "Saved". Playwright: the Lab 3 specs that resolve give the Ticket a Completed Action first (`completeAnActionOn`), and the admin spec's direct move sends `fromStatus`. Fixtures and stubs: `resolutionGate` added to the staff Ticket fixtures in `client/tests/lab-03/StaffTicketDetail.test.tsx` (an open gate, so the Lab 3 resolve flows still test what they were written for), `client/tests/lab-03/StaffTicketQueue.test.tsx` and `client/tests/lab-04/ActionsTaken.test.tsx`; `client/tests/setup.ts` also stubs `getTicketHistory`; `server/tests/lab-04/request-integers.api.test.ts` sends `fromStatus` on its out-of-range status call, so it still reaches the 404.

**Review round on #85 (songt, request changes).** The Resolve pre-check and the Cancel confirmation's count read the resolution gate loaded with the page, and Action writes on the same screen never re-read it, so after completing the last Planned Action Resolve stayed blocked until a reload; the E2E flows hid it with `page.reload()`. Fixed with tests that failed first: every Action write that succeeds, or finds the Action already final, re-reads the Ticket's status and gate (UI-20, UI-24, no reload), and the three reloads are gone from `e2e/lab-04/ticket-resolution.spec.ts`.
- Sweep (`lab-finding-sweeper`), same pattern, fixed in the same commit with a test each: the "cannot be resolved yet" sentence stayed after the gate opened (it is now built from the current gate); the `ACTION_FINAL` branch whose list re-read failed skipped the gate re-read; and the new re-read could overlap a move and apply an older snapshot (only the latest re-read per control applies now, section 5 async UI).
- Non-blocking note, also done: when a move finds the Ticket already in the requested status, the screen now says "This ticket is already In Progress." instead of claiming "Status updated." (spec section 11, neutral; History says who moved it).
- Mutation checks: the gate re-read removed (2 red), the per-control sequence check removed (1 red), the `ACTION_FINAL` fallback re-read removed (1 red).
- Counts after the round: server 392 passed, client 307 passed (18 files), Playwright 28 passed.

### Issue 06: dashboard APIs

Run on `feature/lab4-06-dashboards-api` on 2026-10-30: server 411 passed (41 files), client 307 passed, Playwright 28 passed.

- Turned from Planned to Pass: UNIT-05, API-19, SEC-02, SEC-03, SEC-04, SEC-06, DASH-01 to DASH-10. PERF-01 and PERF-02 stay with Issue 09.
- New tests: 3 in `server/tests/lab-04/dashboardWindow.unit.test.ts`, 7 in `staff-dashboard.api.test.ts` (on the full seed), 9 in `requester-dashboard.api.test.ts` (fixtures placed a minute inside and outside each Bangkok window).
- Every figure is checked against its defining query run directly (DASH-01, DASH-05), and every drill-down link is followed to the real list endpoint, whose total must equal the figure (DASH-03, DASH-07). The Unassigned figure and the queue's needs-owner filter now share one definition (`needsOwnerWhere` in `server/src/dashboardWindow.ts`).
- Mutation checks, each restored afterwards: the window one day too long (3 red), the Requester dashboard not scoped to the session (6 red), a Public Comment not moving last activity (1), account counts given to IT Staff (1), the queue ignoring `statusGroup=active` (1).
- BR-38 now holds for every write it names: a Public Comment and an Attachment added or removed move the Ticket's last activity (Action writes already did, Issue 03); an Internal Note does not (DASH-09). A change to a value the Ticket already has still moves it; that belongs to Issue 08.
- Superseding changes: `server/tests/lab-02/query-options.unit.test.ts` (My Tickets now takes any of the eight statuses), `server/tests/lab-03/staffQueueQuery.unit.test.ts` (the parsed query gains `statusGroup`), `server/tests/lab-02/attachments.api.test.ts` (its fake upload transaction gains `ticket`, which the upload now touches), and the route sweep in `server/tests/lab-03/authorization.api.test.ts` lists both dashboards.

**Review round on #86 (songt, request changes).** The Requester comment path took `FOR SHARE` on the Ticket and then, new in this Issue, updated the Ticket's last activity in the same transaction, so two comments at once deadlocked: one 500, its comment rolled back. It now takes `FOR NO KEY UPDATE`. This repeats the lesson of Issue 03 (#83), where the Action writes had already moved off a share lock for the same reason. A test posts two comments at once, five rounds, and expects two 201s (red with `FOR SHARE`).
- Non-blocking note, also done: the Attachment removal and its last-activity touch are one transaction (a test makes the touch fail and the Attachment stays; red when the touch is outside).
- Sweep (`lab-finding-sweeper`): the IT Staff comment path stored the comment and touched the Ticket as two separate statements; it is now one transaction (a test makes the touch fail and no comment is stored; red before the fix). Every other row lock in `server/src` was checked: none takes a share lock on a row its transaction later writes. A test posts a Requester comment, an IT Staff comment and an upload on one Ticket at once and expects all three.
- Counts after the round: server 415 passed (41 files), client 307, Playwright 28 (no client or e2e change).

### Issue 07: dashboard screens

Run on `feature/lab4-07-dashboards-ui` on 2026-10-30: server 415 passed (41 files), client 325 passed (21 files), Playwright 32 passed.

- Turned from Planned to Pass: UI-01 to UI-09, RESP-01, E2E-05, E2E-06, E2E-07. A11Y-01 (keyboard-only pass) and E2E-09 (console during every journey) span every screen and stay with Issue 09.
- New tests: 4 in `client/tests/lab-04/Navigation.test.tsx`, 7 in `StaffDashboard.test.tsx`, 7 in `RequesterDashboard.test.tsx` (the last 4 are the drill-down targets, UI-09), and 4 in `e2e/lab-04/dashboards.spec.ts`.
- E2E-05 clicks all 11 IT Staff cards and status chips and checks the queue's total against each card; E2E-06 signs in two Requesters, checks each card against that Requester's own dashboard response, and follows all four cards to My Tickets. Screenshots follow ui-spec section 15: `loaded` and `drill-down` at 375, 768 and 1280 (each checked for no horizontal scroll), plus `empty`, `loading`, `failure`, `forbidden` and the Administrator's view at 1280, in `artifacts/lab-04/screenshots/staff-dashboard/` and `requester-dashboard/`. Empty, loading and failure answer the dashboard request inside the browser (`page.route`), since the seeded database always has Tickets. They were taken on the development database before its reset, so the counts include earlier E2E Tickets; the report retakes them.
- Mutation checks, each restored afterwards: the Waiting for you tint shown at 0 (1 red), My Tickets dropping `updatedWithinDays` (1), the queue dropping `statusGroup` (2), a Requester landing on My Tickets (1), the Requester dashboard route open to every role (2), every Planned Action shown as overdue (1).
- My Tickets now keeps every filter, sort and page in the URL like the queue, so a dashboard link opens it already filtered and Back returns to the same view. Its status filter offers all eight statuses plus Active and Resolved or closed, its Last Updated column sorts, and a window shows as a removable chip.
- Superseding changes (Lab 4 FR-14 moved every role's landing route to its Dashboard): `client/tests/lab-03/Login.test.tsx`, `ChangePassword.test.tsx` and `RoleRoutes.test.tsx` now expect the Dashboard where they expected My Tickets, the queue or User Management; `client/tests/lab-02/MyTickets.test.tsx` (AC-18) opens My Tickets from the Dashboard after the second sign-in; `client/tests/lab-03/support.tsx` answers both dashboard requests. In `e2e`, the Lab 2 `login` helper and the Lab 3 `LANDING` and `signIn` helpers follow the new landing route, and the specs that start on the queue or User Management open it after signing in. The Lab 3 navigation spec (E2E-02) now expects Dashboard first and checks the other role's dashboard is forbidden with no request made.
- Screen check (`lab-screen-checker` at 375, 768 and 1280): no horizontal scroll on either dashboard or the drill-down lists. Three defects were fixed. Cards, status chips and list rows had only the faint field halo on focus; they now have the solid 2px Zen Green outline, which a computed-style check in E2E-05 enforces (red without the rule). Recently resolved showed relative time; it now shows the resolution date. My Tickets had no sort control below 768px; it now has the same Sort select as the queue, including Last updated. Two cosmetic notes are left for Issue 08: at 768px the IT Staff header wraps "Ticket Queue" and the user's name onto two lines (nothing is clipped), and an empty My Planned Actions panel stretches to the height of the panel beside it.

### Issue 08: final hardening

Run on `feature/lab4-08-hardening` on 2026-10-31: server 434 passed (42 files), client 337 passed (22 files), Playwright 32 passed.

- Turned from Planned to Pass: UNIT-07, API-15, API-16, API-17, API-18, API-21, API-22, UI-25, UI-26, UI-27, STYLE-02, STYLE-03. PERF-01, PERF-02, RESP-02, A11Y-01 and E2E-09 stay with Issue 09; REG-01 to REG-03 are run on the final branch in Issue 10.
- Idempotency-Key now covers all four create endpoints. Ticket, Public Comment and Internal Note create share `readKey` and `keyedCreate` in `server/src/idempotency.ts`; Action create keeps its Issue 03 flow. `server/tests/lab-04/idempotency.api.test.ts` runs API-15 to API-18 for each of the three (12 new tests): a replay, a changed field, a key reused on another Ticket, whitespace only, a malformed key, two sends at once with equal and with different bodies, one key from two users, and no key at all.
- Contract correction: BR-39, AC-40, api-spec "Idempotency-Key", ADR 0003 and API-16 had Ticket create fingerprinting uploaded files. Ticket create has never carried files (Attachments are uploaded to the created Ticket afterwards, as in Lab 2), so those clauses were removed rather than the endpoint changed. `requestHash` lost its unused `files` parameter; the hashed text is unchanged, so hashes stored by Action create still match (UNIT-06).
- API-22 runs 14 endpoints with every database call except sessions failing: each answers the generic 500 with only `error` and `message`, nothing from the thrown error (path, SQL, token) reaches the client, and no row is written.
- BR-38: a save that sets the value a Ticket already has (the same IT Priority, a re-claim, a second unassign) writes nothing, so last activity stays put (DASH-09 test in `requester-dashboard.api.test.ts`).
- UI-26: `client/tests/setup.ts` fails any test that writes a console error or warning. Turning it on failed 25 tests. The causes were all fixed: React Router future-flag warnings (both flags now set explicitly in `client/src/routerFuture.ts`; `v7_startTransition` is declined, because with it a URL-driven search box drops typed text, which a Lab 2 Playwright spec caught); comment and note requests that reached the network in tests (now stubbed in the setup); updates outside `act`; and the duplicate-key warning in StaffTicketDetail tests, which came from a fake save answering `{}` instead of a Ticket.
- Focus (carried from the #84 sweep, FR-17): Claim, Keep current status, the Close, Cancel and Resolve confirmations and Reload return focus to the select they acted on; Clear filters goes to Search; anything else that removes itself (Retry, Remove, the resolved flag, Set password) hands focus to the nearest region heading through `client/src/focusNet.ts`, mounted once in the shell. Tests: Claim and Keep current status (`StaffTicketDetail.test.tsx`), Clear filters and Retry (`Hardening.test.tsx`). The Internal Note composer has its own failure and key-reuse test there too (added after the pre-PR gate noted that only the comment path was tested).
- STYLE-03 found one class, `zg-history`, used but never styled; it was removed.
- The two cosmetic notes from #87 are fixed: no header label breaks mid-text at 768px (the user group moves to a second row), and an empty dashboard panel is its own height. The dashboard screenshots were retaken to show both.
- Mutation checks, each restored afterwards. Server: a replay never compared by hash (6 red), the simultaneous-send recovery removed (3), keys not lower-cased (3), the same IT Priority written again (1), a re-claim written again (1), Ticket create storing no key (3). Client: a console warning in a component (4 red), the focus net removed (1), Clear filters not focusing Search (1), Create Ticket making a new key on every submit (1), an undefined class in a Lab 4 source (1), Claim not returning focus (1). One mutation survived: renewing the composer's key after a success; that line was redundant, since the box is empty after a success and any typing starts a new key, so it was deleted.
- Superseding changes: three Lab 3 client tests now expect the Idempotency-Key argument on comment and note posts; the StaffTicketDetail fakes answer whole Tickets; every test router sets the future flags.

**Review round on #88 (songt, request changes, nothing broken).** Two small fixes: the BR-34 comment block in `server/src/routes/ticketContent.ts` kept its old indentation after the code moved into `write`, and is now indented with the function (the same check found the `app.ts` comment already in place); and the contract correction about files on Ticket create is now recorded in the spec's section 11, Assumptions and Decisions, not only in the PR. No code behaviour changed; server 434, client 337, Playwright 32 as before.

### Issue 09: end-to-end, responsive, accessibility, regression and performance

Run on `feature/lab4-09-final-tests` on 2026-10-31: server 440 passed (43 files), client 338 passed (22 files), Playwright 33 passed. No row is Planned any more.

- Turned from Planned to Pass: PERF-01, PERF-02, RESP-02, A11Y-01, E2E-09, REG-01, REG-02, REG-03.
- REG-01: `server/tests/lab-01`, `lab-02` and `lab-03` together, 333 passed (30 files). REG-02: `client/tests/lab-02` and `lab-03`, 266 passed (16 files). REG-03: `e2e/lab-02` and `e2e/lab-03`, 22 passed. Every test changed for a superseding Lab 4 rule is listed in the Issue 06 to Issue 08 sections above.
- PERF-01 and PERF-02 (`server/tests/lab-04/performance.smoke.test.ts`): the full seed plus fixtures to 500 Tickets, spread over every status, priority, Requester and 60 days of activity; one warm-up call, then 20 timed calls each. Medians were 2.2 to 2.9 ms and the slowest single call 7.6 ms, against limits of 300 ms and 1 second; dashboard bodies were 1,639 to 2,051 bytes, against 10 KB. A smoke test on one machine, not a benchmark.
- E2E-09 (`e2e/lab-04/console.ts`): every Lab 4 spec now fails a test whose browser console shows an error or warning, on every page it opens, including the two separate pages of E2E-04. The browser's own "Failed to load resource" line for a 4xx the app asked for and handles is left out (the 401 from the session check before sign-in, a 409 a test provokes); a 5xx is kept, and the one test that answers 500 on purpose removes exactly those. It found one real case: the API helper logged a console error for a request the browser cancelled because the page was being left; such a request no longer logs (`client/src/api.ts`), while a real network failure still does (the Lab 2 `api-errors` test). A client test dispatches `pagehide` and `pageshow` around a failed request and checks both (`Hardening.test.tsx`; red without the check).
- A11Y-01: a keyboard-only test in `e2e/lab-04/actions-taken-flow.spec.ts` goes from the IT Staff Dashboard (every card and chip reached, Enter opens the queue) through Add Action, the Complete dialog and the Cancel dialog, pressing only Tab, Shift+Tab, Enter, Escape and typing. At every stop inside the page the computed focus style must be the 2px Zen Green outline or the Zen Green field ring; each dialog keeps focus for 12 Tabs, Escape returns focus to its opener, and after each dialog focus stays in the page. It found a real defect: a date field's own calendar button showed no ring, because the input loses `:focus` while its built-in button has it. `.form-control:focus-within` now gets the same ring as `:focus` (red without it).
- RESP-02: the Actions Taken list is a table from 768px and cards below it, the Complete dialog stays inside the viewport at all three widths, and the create form, list, blocked Resolve, Status History and Requester view have no horizontal scroll; the 24 captures named in ui-spec section 15 are in `artifacts/lab-04/screenshots/actions-taken/`.
- Mutation checks, each restored afterwards: the `:focus-within` ring removed (A11Y-01 red); a `console.warn` in a component (E2E-09 red, once per page that rendered it).

**Final screen pass and the ui-spec section 14 checklist (Issue 09).** `lab-screen-checker` captured every Lab 4 screen and the carried-forward ones (Login, Change Password, both dashboards, Ticket Queue, My Tickets, Create Ticket, every staff Ticket Detail tab with the Action form and both dialogs, the resolve gate, Requester Ticket Detail, User Management) at 375, 768 and 1280, plus 62 keyboard-focus crops of every control type, with the computed focus style of each. Those captures were working material in the checker's scratch folder and are not committed; the committed set is the 44 named in ui-spec section 15, retaken on this branch after the fixes below. Overflow held on every capture; the console showed only the handled 4xx lines described under E2E-09. It found seven defects, all fixed on this branch and rechecked with fresh captures:
- The Complete and Cancel dialogs opened showing their error in development: React's StrictMode ran the dialog's focus effect twice, and the first cleanup sent focus back to the opener, which blurred the field. The opener is now recorded once, and focus returns only when the dialog has left the page and nothing else holds focus. A11Y-01 checks that no error shows on open (red with the old cleanup).
- Bootstrap's red appeared in the Create Ticket messages and in an invalid field's border and focus ring; it is now `--color-error` throughout (Bootstrap's danger and invalid-form variables set to the token).
- Clear filters turned Bootstrap blue on focus; it now keeps the Zen Green text (A11Y-01 checks the colour).
- A date field's calendar button showed the browser's blue ring. Chromium ignores a focus pseudo-class on that button, so the button's outline colour is set to the Zen Green token, which the browser's own focus outline then uses; checked by eye in a focus capture.
- The tab strip scrolls sideways and clipped a tab's outer ring to two stripes; tabs now get an inset 2px outline (A11Y-01 checks it).
- The resolve gate's "Go to Actions Taken" was a button; ui-spec section 10 names a link, and it is now one (it still opens the Actions tab).

Evidence for each item of the section 14 checklist, now ticked:
1. Tokens: no hex colour literal in any client source outside `zen-green.css` (grep, and STYLE-03); each of the 15 `--color-*` tokens is used by at least one rule (grep); the Bootstrap blue and red found above are gone (computed styles in the recheck).
2. Dashboard first and current: UI-01, E2E-07.
3. Metric cards: UI-02, UI-03, UI-07, UI-08; keyboard reach and outline in A11Y-01 and E2E-05.
4. Figures match the lists: E2E-05 opens all 11 IT Staff cards and chips and compares each with the queue's total; E2E-06 does the same for both Requesters' four cards; DASH-03 and DASH-07 on the server.
5. Action status badges and editable versus read-only fields: UI-10 (badges), UI-17 (a final Action opens read-only); captures `list-*` and `edit-desktop`.
6. Follow-Up Note and its asterisk: UI-11, STYLE-02.
7. Validation under fields: UI-11, UI-15, UI-16; `validation-desktop` and the recheck capture of an invalid dialog field.
8. Dialogs trap, close on Escape, return focus: UI-15, UI-16, A11Y-01 (both dialogs, keyboard only).
9. Requester view read-only: UI-19, E2E-02; captures `requester-view-*`.
10. Shared and private content distinct: the Lab 3 Internal Note panel tests (`client/tests/lab-03/StaffTicketDetail.test.tsx`); screen-pass captures of the Comments, Notes and Actions tabs.
11. Permitted moves and the blocked Resolve: WF-01, UI-20, E2E-03; captures `resolve-blocked-*`.
12. Focus visible everywhere: A11Y-01 checks the computed ring at every keyboard stop from the Dashboard through both dialogs; the screen pass recorded the computed focus style of every control type (white ring in the header, 2px Zen Green outline on cards, chips, rows and tabs, the Zen Green field ring on inputs, selects and buttons) after the fixes above.
13. No clipping, overlap or horizontal scroll: RESP-01, RESP-02, and the overflow check on every screen-pass capture.
14. Distinct states: UI-04, UI-08, UI-05 and the Lab 3 not-found and conflict tests; captures `loading-desktop`, `empty-desktop`, `forbidden-desktop`, `failure-desktop`, `stale-conflict-desktop`.
15. No console output, placeholder, or dead control: UI-26, E2E-09, STYLE-03.

Left as they are, all from Labs 2 and 3 and none clipped: the Create Ticket fields keep a grey border while their message shows; the Ticket Queue's Ticket No. column wraps at 1280; User Management lists every account without paging (408 on the development database, most of them E2E accounts the reset removes); the date field shows the browser's own date order.

**Review round on #89 (songt, request changes, nothing broken).** "Go to Actions Taken" became a link but cancelled every click, so Ctrl, Cmd or Shift click could not open it in a new tab or window. It now cancels only a plain left click (the one that switches the tab in place), and the UI-20 gate test clicks it with each modifier and checks the click is left to the browser (red before the fix). The sweep found no other link with a click handler; the other `preventDefault` calls are form submits and key handlers. The E2E-09 row now names `e2e/lab-04/console.ts` and the three specs that run it. Server 440, client 338, Playwright 33.

### Issue 10: pre-release review

Four reviews of `lab4-staging` (7b8cfe9) against `main` on 2026-10-31: standards (LAB-WORKFLOW sections 3 and 5, CONTEXT.md, the repo's style, and Fowler's smell list as judgement calls), spec (the Lab 4 specification, api-spec, ui-spec, ADRs 0003 and 0004), security (authorization, IDOR, idempotency, raw SQL, locks, integer bounds, error bodies, client trust), and `lab-labsheet-auditor` over all 485 checklist lines. Run on `feature/lab4-10-pre-release-review` after the fixes: server 445 passed (43 files), client 340 passed (22 files), Playwright 33 passed. REG-01 is now 334 passed (30 files): this Issue added one Lab 2 test, the Ticket Date check (L-452); REG-02 266 and REG-03 22 are unchanged. The 333 recorded under Issue 09 was the count on that branch (release review on #92).

Fixed, each behaviour change with a test that failed first:
- Spec: a Follow-Up Note the server discards (Follow-Up Required off) was part of the Action create fingerprint, so a retry differing only there got 409; it is now left out (API-16 test in `idempotency.api.test.ts`).
- Spec: Comment and Note create checked the Idempotency-Key before the Ticket; the key is now checked once the Ticket is found, as api-spec orders it (API-17 test).
- Spec: `TICKET_NOT_WORKABLE` closed an open Add or Edit form and lost what was typed (BR-41, AC-42); the form now stays with its text and focus goes to the explanation; a dialog still closes (UI-13 test in `ActionsTaken.test.tsx`).
- Spec: the dashboard's own 403 showed the forbidden sentence without "Go to your home screen" (ui-spec section 3). The first fix linked to the home of the cached role, which is exactly what goes stale when the API refuses mid-session, so the link pointed back at the refusing page (review on #90). The identity is now read again first: a changed role updates the session and the route guard shows its own forbidden state with the right home; an unchanged role gets no link (two UI-05 tests, both red before).
- Spec: ui-spec section 10 still said "Status updated." for a move to the status a Ticket already has; it now says the neutral "This ticket is already X." the code shows, as decided in the review of #85.
- Standards: the status move re-derived the resolution gate instead of using `resolutionGate()`, the rule Ticket Detail shows; it now uses it. `isUniqueViolation` existed twice; one is left, exported from `idempotency.ts`. `windowDays` now goes through `isValidId`. Comments no longer name earlier Issues.
- Standards (LAB-WORKFLOW 3.7): five `page.reload()` calls in `e2e/lab-04/dashboards.spec.ts` only re-rendered under a new mock and were not persistence checks; they are navigations now, and the sweep found and changed one more in `e2e/lab-03/responsive-visual.spec.ts`.
- Audit L-296 (carried Lab 2 rule): three symbol-only buttons had an `aria-label` but no tooltip (the filter chip's remove, Create Ticket's attachment remove, Requester Ticket Detail's error dismiss); all three now have a matching `title`, and `Hardening.test.tsx` checks every symbol-only button in the client source for both (red with the three).
- Audit L-452 (L2-BR-08): nothing proved the Ticket Date comes from the server; `server/tests/lab-02/create-ticket.api.test.ts` now sends a date, a status and another requester in the body and checks they are ignored.
- Audit: five Lab 2 test IDs had no tag comment (UNIT-01, UNIT-02, UNIT-03, API-08, UI-13); each is tagged where its test lives.

Chosen not to fix (file and line as reviewed at 7b8cfe9):
- Security, informational: the Requester reads of Actions, Status History and comments (`server/src/routes/actions.ts:98`, `statusHistory.ts:22`, `ticketContent.ts:85`) do not repeat the active-Requester check that Ticket Detail has. A deactivated account cannot reach them, because deactivation deletes its sessions and `requireAuth` answers 401 first.
- Security, informational: a path id such as `1e3` or ` 5 ` resolves to the same integer (`actions.ts:77`, `statusHistory.ts:24`, `staffTickets.ts:148`). Bounds and authorization apply to the resolved id; the effect is only a second spelling of a URL.
- Security, informational: the same instant written in two time formats hashes differently (`server/src/idempotency.ts:20`). A real retry resends the same bytes.
- Security, note: owner and IT Priority changes move last activity, so a Requester's "recently updated" shows that staff touched the Ticket; BR-38 asks for exactly this, and Internal Notes do not move it.
- Standards, judgement calls (refactors, not defects; a pre-release fix stays small): the eight status labels are written in five places (`client/src/StatusHistory.tsx:7`, `StaffTicketDetail.tsx:25`, `Badge.tsx:23`, `StaffDashboard.tsx:9`, `server/src/routes/staffTickets.ts:269`); last activity is touched with the same call in four places (`actions.ts:93`, `app.ts:344`, `app.ts:700`, the comment store in `ticketContent.ts`); Action create keeps its own key handling (`actions.ts:131-181`) because it runs inside the Ticket lock; the claim condition repeats the needs-owner filter (`staffTickets.ts:205`); `isEligibleOwner` and `isEligibleStaffLocked` live in `routes/staffTickets.ts:24-37` and `formatBangkok` in `ActionsTaken.tsx:28`, where other modules import them; `dashboardWindow.ts` and `ActionsTaken.tsx` hold several concerns each; a few short names (`cut`, `extra`, `Loaded`) and string-typed count helpers (`app.ts:520`, `dashboards.ts:77`).
- Standards: `canMoveAction` (`server/src/actionValidation.ts:48`) is used only by its unit test; it stays, because UNIT-03 tests BR-09 through it and the write path enforces the same rule with its `status: PLANNED` condition.
- Spec, extra: the "Resolved or closed only" chip label (`client/src/dashboard.tsx:11`) is not named in ui-spec; it names the `statusGroup=resolved` filter My Tickets offers, so it stays.

The committed Lab 4 screenshots showed earlier E2E Tickets, because the development database had not been reset since Issue 02 (audit L-254, L-187; spec section 11 asks for a clean seed). The database was backed up (`pg_dump`, kept outside the repository) and reset to the seed on 2026-10-31: 12 users, 14 Tickets, 13 Actions Taken, 40 Status Changes. The dashboard captures were then taken first, so their figures and lists show the seed only (Unassigned 5, Urgent 3), and the Actions Taken captures after them, each on the Ticket its own test creates.

Left for the release and the report (Issues 11 and 12), as the audit found: the Part 8 regression screenshots (L-245 to L-252); `reviewer.md` and `ai-use.md`; the release to `main` and its saved test output; the Kanban board's last three cards; and the PDF itself.

**Review round on #90 (songt, request changes, nothing broken).** The mid-session 403 link fix above, and two tidy items: the double blank lines left in `server/src/routes/actions.ts` and the over-long reworded comment in `server/src/idempotency.ts`. A sweep of every source file this PR changed found no other comment over 115 characters and no other double blank line. Server 445, client 341, Playwright 33.
