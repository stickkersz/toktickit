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
| UNIT-04 | Unit | BR-21 | Resolution gate from Planned and Completed counts | Blocked with `ACTIONS_INCOMPLETE` when any Planned, `NO_COMPLETED_ACTION` when none Completed, allowed otherwise | `server/tests/lab-04/actionValidation.unit.test.ts` | Planned |
| UNIT-05 | Unit | BR-29, AC-35 | Asia/Bangkok window start for 7 and 30 days, including just before and after local midnight and at month end | Window starts at 00:00 Bangkok N-1 days before today, as a UTC instant 7 hours earlier | `server/tests/lab-04/dashboardWindow.unit.test.ts` | Planned |
| UNIT-06 | Unit | BR-39 | `Idempotency-Key` format check and `requestHash` fingerprint | UUIDs of any version and case accepted, anything else rejected; hash equal for bodies that differ only in surrounding whitespace or key order, or in a field the endpoint ignores; hash different when any accepted field, the Ticket id in the path, or a file name or size differs; 64 lower-case hex characters | `server/tests/lab-04/idempotency.unit.test.ts` | Pass |
| UNIT-07 | Unit | BR-36 | List query parsing of `statusGroup`, `status`, `-updatedAt` | Known values applied, unknown values fall back to the default, a single status wins over a group | `server/tests/lab-04/listQuery.unit.test.ts` | Planned |
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
| API-15 | API | AC-39, BR-39 | Ticket, Public Comment, Internal Note, and Action create each sent twice with one key | One record each; second response 200 with `Idempotent-Replayed: true` and the same record | `server/tests/lab-04/idempotency.api.test.ts` | Planned |
| API-16 | API | AC-40, BR-39 | Same key on each of the four endpoints with: one accepted body field changed; a comment or note key reused on a different Ticket; Ticket create with a different file name, then a different file size; and a body differing only in surrounding whitespace | Each change: 409 `IDEMPOTENCY_KEY_REUSED`, nothing created; whitespace only: 200 replay with `Idempotent-Replayed: true`; every keyed row has a non-null `requestHash` | `server/tests/lab-04/idempotency.api.test.ts` | Planned |
| API-17 | API | BR-39 | Malformed key; two requests with one key sent at the same moment, first with equal bodies, then with different bodies; one key used by two different users | 400; equal bodies: exactly one record, the other a replay; different bodies: exactly one 201 and one 409 `IDEMPOTENCY_KEY_REUSED`, one record; the two users each get their own record | `server/tests/lab-04/idempotency.api.test.ts` | Planned |
| API-18 | API | BR-39, BR-47 | The four create endpoints with no key | Behaviour identical to Lab 3 | `server/tests/lab-04/idempotency.api.test.ts` | Planned |
| API-19 | API | BR-36 | `statusGroup` on My Tickets and the queue, all eight statuses on My Tickets, `-updatedAt` sort | Exactly the matching Tickets, in the requested order | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| API-20 | API | BR-21 | Ticket Detail for IT Staff and for a Requester | Staff body has `resolutionGate` with correct counts; Requester body has none | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| API-21 | API | AC-52, FR-20 | `GET /api/health` | 200 `{ status: "ok", service: "TokTickIT API" }` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| API-22 | API | BR-42, FR-17 | Every Lab 4 endpoint with the database call forced to throw | 500 with the generic `{ error: "INTERNAL_ERROR", message }` body; no stack trace, SQL, path, or token; nothing partly written | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| SEC-01 | Security | AC-15, BR-17 | A Requester calling every Action write endpoint on own, other, and missing Tickets and Actions | 403 every time from the role alone, nothing written | `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| SEC-02 | Security | AC-34 | Every Lab 4 endpoint with no session | 401 on each, no data in any body | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| SEC-03 | Security | AC-34, BR-35 | A Requester on the staff dashboard; IT Staff and an Administrator on the Requester dashboard | 403, no metric in the body | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| SEC-04 | Security | AC-33, BR-32 | Staff dashboard as IT Staff and as an Administrator | No `accounts` key for IT Staff; correct counts for the Administrator | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| SEC-05 | Security | AC-25, BR-26 | A Requester reading the history of their own and another Requester's Ticket | Own: 200; another's: 404 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| SEC-06 | Security | AC-02, BR-35 | Requester dashboard called with `requesterId`, `owner`, or other widening parameters | Parameters ignored; only the caller's figures returned | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| SEC-07 | Security | BR-47, BR-07 | Every integer read from a request above 2147483647: each Lab 2, Lab 3, and Lab 4 path id, Ticket create `categoryId` and `relatedSystemId`, owner `ownerId`, Action `responsibleStaffId` and `version`, queue and My Tickets `category`, `owner`, `page` | 404 for a path id (400 on the resolution indication, as before), 400 with a `fields` entry for a body value, the default for a list filter; never a 500, nothing written | `server/tests/lab-04/request-integers.api.test.ts`, `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| SEC-08 | Security | BR-07, L3-BR-18 | A Ticket Owner or Responsible Staff member deactivated after the request was checked and just before the write | 409 `INVALID_OWNER` or `INVALID_RESPONSIBLE`; nothing written | `server/tests/lab-04/request-integers.api.test.ts`, `server/tests/lab-04/actions-taken.api.test.ts` | Pass |
| WF-01 | Workflow | AC-18, BR-20 | Every from and to status pair as IT Staff and as an Administrator, and every move as a Requester | Exactly the BR-20 moves succeed, including Waiting for Requester to Cancelled and Reopened to Cancelled; others 409 `INVALID_TRANSITION`; Requester 403 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-02 | Workflow | AC-19, BR-21 | Resolve through the API directly while an Action is Planned | 409 `ACTIONS_INCOMPLETE` with `plannedActions`; status unchanged; no Status Change | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-03 | Workflow | AC-20, BR-21 | Resolve a Ticket with no Completed Action, including one with only Cancelled Actions | 409 `NO_COMPLETED_ACTION`; status unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-04 | Workflow | AC-21 | Resolve with all Actions final, one Completed, an eligible owner, a valid summary | 200 Resolved; Status Change with the summary | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-05 | Workflow | AC-22, BR-23 | Move from a status the Ticket no longer has; and without `fromStatus` | 409 `STATUS_CHANGED` naming the current status and its moves, nothing written; missing `fromStatus` 400 | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-06 | Workflow | AC-23, BR-24 | A sequence of moves; a failure injected after the status write; PATCH and DELETE on history | One Status Change per move in order; the failed move leaves neither the status nor a Status Change; no route changes history (404) | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-07 | Workflow | AC-13, BR-15 | Cancel a Ticket holding Planned and Completed Actions, from Open, Waiting for Requester, and Reopened; then an edit sent with a Planned Action's old version | Planned become Cancelled with "Ticket cancelled" in the same operation, each version up by one; Completed unchanged; the late edit gets 409 `TICKET_NOT_WORKABLE`, never `STALE_ACTION` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-08 | Workflow | AC-26, BR-27 | Requester's "problem appears resolved" indication | Status and Status History unchanged | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-09 | Workflow | BR-21 | An Action create and a resolve sent at the same moment, repeated 20 times | Never a Resolved Ticket with a Planned Action: either the Action is refused with `TICKET_NOT_WORKABLE` or the resolve with `ACTIONS_INCOMPLETE` | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-10 | Workflow | BR-22 | A request failing several checks at once | Reported in order: 400, 404, `STATUS_CHANGED`, `INVALID_TRANSITION`, `OWNER_REQUIRED`, gate | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| WF-11 | Workflow | BR-24 | Ticket creation | One Status Change from none to New by the Requester, in the same transaction | `server/tests/lab-04/ticket-workflow.api.test.ts` | Planned |
| DASH-01 | Dashboard | AC-28, BR-31 | Every IT Staff metric on the seeded database | Each equals its defining query run directly through Prisma | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| DASH-02 | Dashboard | AC-30, BR-34 | IT Staff user with nothing assigned and an empty queue | Every count 0, lists empty, `byStatus` still holds eight zero entries | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| DASH-03 | Dashboard | AC-31, BR-36 | Each IT Staff metric's `link` applied to `GET /api/staff/tickets` | The queue total equals the metric count for every card and status | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| DASH-04 | Dashboard | BR-28, AC-38 | List sizes and content | At most 5 items each, latest first, description cut to 120 characters | `server/tests/lab-04/staff-dashboard.api.test.ts` | Planned |
| DASH-05 | Dashboard | AC-29, BR-33 | Every Requester metric on the seeded database | Each equals its defining query restricted to that Requester | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| DASH-06 | Dashboard | AC-02 | Two Requesters with different Tickets | Each sees only their own figures and Tickets | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| DASH-07 | Dashboard | AC-32, BR-36 | Each Requester metric's `link` applied to `GET /api/tickets` | My Tickets total equals the metric count | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| DASH-08 | Dashboard | AC-35, BR-29 | With a fixed clock, activity at 00:00:00 Bangkok six days ago and 23:59:59 seven days ago, and resolutions at the same edges of the 30-day window | The 00:00:00 records counted, the 23:59:59 records not | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| DASH-09 | Dashboard | BR-38 | Last activity after an Action write, a Public Comment, an Attachment, and an Internal Note | The first three move `updatedAt`; the Internal Note does not | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| DASH-10 | Dashboard | AC-30 | Requester with no Tickets | Every count 0, lists empty | `server/tests/lab-04/requester-dashboard.api.test.ts` | Planned |
| MIG-01 | Migration | AC-45, BR-44 | Apply the Lab 4 migration to a copy of a seeded Lab 3 database | Every Lab 3 table's row count unchanged; Status Change count equals Ticket count; `idempotencyKey` and `requestHash` present and null on every existing Ticket, Public Comment, and Internal Note | `server/tests/lab-04/migration.test.ts` | Pass |
| MIG-02 | Migration | AC-45, BR-45 | Apply `server/prisma/rollback/lab-04-down.sql` after the migration | Lab 4 tables, enum, indexes, and the `idempotencyKey` and `requestHash` columns gone; every Lab 3 row identical to before | `server/tests/lab-04/migration.test.ts` | Pass |
| MIG-03 | Migration | AC-24, BR-25 | History of a migrated Ticket that is New and one that is In Progress, then the In Progress one moved to Waiting for Requester in Lab 4 | Both start with "Created as New"; the In Progress one has `earlierChangesUnrecorded: true`, still `true` after the Lab 4 move; the New one stays `false` after a Lab 4 move | `server/tests/lab-04/migration.test.ts` | Planned |
| MIG-04 | Migration | AC-46, BR-46 | Run the seed twice | Second run changes nothing; data includes Tickets with 0, 1, and several Actions, every status and priority, and users whose own dashboard figures are all zero | `server/tests/lab-04/seed.test.ts` | Pass |
| REG-01 | Regression | AC-43, BR-47 | Full Lab 1, Lab 2, and Lab 3 server suites | All pass; any test changed for a superseding Lab 4 rule is listed in section 6 | `server/tests/lab-01`, `lab-02`, `lab-03` | Planned |
| REG-02 | Regression | AC-43 | Full Lab 2 and Lab 3 client suites | All pass | `client/tests/lab-02`, `client/tests/lab-03` | Planned |
| REG-03 | Regression | AC-43 | Full Lab 2 and Lab 3 Playwright suites | All pass | `e2e/lab-02`, `e2e/lab-03` | Planned |
| PERF-01 | Performance | AC-47 | Both dashboards and the queue, 20 calls each, with about 500 Tickets | Median under 300 ms, none over 1 second | `server/tests/lab-04/performance.smoke.test.ts` | Planned |
| PERF-02 | Performance | AC-38, BR-28 | Dashboard response sizes with the same data | Each body under 10 KB | `server/tests/lab-04/performance.smoke.test.ts` | Planned |
| UI-01 | UI | AC-36, FR-14 | Navigation and landing route per role | Dashboard first in each role's nav, marked `aria-current="page"`; sign-in lands on the role's dashboard | `client/tests/lab-04/Navigation.test.tsx` | Planned |
| UI-02 | UI | FR-12, BR-31 | IT Staff Dashboard with a full response | Every card with label, value, and a link whose accessible name and href match the metric | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-03 | UI | AC-30, BR-34 | IT Staff Dashboard with all zeros | Each card shows 0 and its empty sentence; lists show theirs | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-04 | UI | AC-37 | IT Staff Dashboard loading, failure, and Retry | Skeleton with `aria-busy`; failure callout with Retry and no numbers; Retry loads | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-05 | UI | AC-34 | A Requester opening the staff dashboard route, and staff opening the Requester one | Forbidden state, no dashboard request made | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-06 | UI | AC-33 | Accounts card for an Administrator, absent for IT Staff | Shown with counts and a Users link only for the Administrator | `client/tests/lab-04/StaffDashboard.test.tsx` | Planned |
| UI-07 | UI | FR-11, BR-33 | Requester Dashboard with a full response | Four cards with links to My Tickets filters; Waiting for you tinted with "Needs your attention" when above 0; both lists link to Ticket Detail | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| UI-08 | UI | AC-30, AC-37 | Requester Dashboard empty, loading, and failure | Empty sentences; skeleton; failure with Retry | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| UI-09 | UI | AC-31, AC-32, BR-36 | My Tickets and the queue opened with dashboard query strings | Filters pre-selected from the URL, the "Active tickets only" chip shown and removable, request carries the same parameters | `client/tests/lab-04/RequesterDashboard.test.tsx` | Planned |
| UI-10 | UI | AC-14, BR-14, BR-16 | Actions Taken tab: list order, badges, Add shown only on a workable Ticket | Rows in BR-16 order with Action Status badges; Add hidden and the reopen sentence shown on a Resolved Ticket | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-11 | UI | AC-05, AC-50, BR-04 | Create form validation and the conditional Follow-Up Note | Messages under each field; the note and its asterisk appear only when Follow-Up Required is checked | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-12 | UI | AC-39, AC-41 | Save Action clicked twice quickly; then a retry after a lost response | One request on the double click; the retry reuses the same `Idempotency-Key` | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-13 | UI | AC-42, BR-41 | Save Action failing with 500 and with 409 | Every typed value still in the form; error callout shown | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-14 | UI | AC-11, BR-13 | Edit answered with `STALE_ACTION` | Conflict callout with server values beside the form's; "Use my changes" resends against the new version; "Discard" reloads | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-15 | UI | AC-09, AC-49 | Complete dialog, including on a Planned Action dated in the future | Focus moves in and stays in, Escape closes, focus returns to Complete, and after Mark as Completed or Cancel Action (both final) to the Action's row; Result required; Action Date/Time pre-filled (now for a future-dated Action) and always sent as `actionAt`; on success the Action shows read-only and final | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-16 | UI | AC-10 | Cancel dialog | Reason required; the request carries the loaded `version`; on success the Action is labelled Cancelled with its reason and has no actions | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-17 | UI | AC-09, BR-12 | A Completed and a Cancelled Action opened | Every field read-only (`readOnly`), no Edit, Complete, or Cancel; "This action is final" shown | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-18 | UI | AC-04, AC-17 | Ineligible Responsible Staff, and a save refused with `INVALID_RESPONSIBLE` | Name with "Not active"; select offers only active staff; error under the field and the list reloads | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| UI-19 | UI | AC-15, AC-25 | Requester Ticket Detail | Actions Taken and History shown read-only; no Add, Edit, Complete, Cancel, or status control | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| UI-20 | UI | AC-19, AC-20, FR-07 | Status control with the gate closed | Resolved chosen shows the gate sentence and "Go to Actions Taken"; nothing sent | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-21 | UI | AC-22, BR-41 | Move answered with `STATUS_CHANGED` | Conflict callout naming the new status, reloaded moves, pending confirmation dropped | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-22 | UI | AC-27 | Successful move | Header badge, summary, History, and permitted moves refresh; "Status updated." shown and announced | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-23 | UI | AC-24, BR-25 | History of a migrated Ticket | "Created as New" then "Earlier status changes were not recorded." | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-24 | UI | AC-13 | Cancel Ticket confirmation with Planned Actions, from In Progress, Waiting for Requester, and Reopened | Cancelled is offered from each; the confirmation states how many planned actions will be cancelled | `client/tests/lab-04/TicketWorkflow.test.tsx` | Planned |
| UI-25 | UI | AC-39, AC-42 | Create Ticket, Public Comment, and Internal Note forms | Each sends an `Idempotency-Key`, keeps it on retry, and keeps typed text after a failure | `client/tests/lab-04/Hardening.test.tsx` | Planned |
| UI-26 | UI | AC-44, BR-43 | Any console error or warning during the whole client suite | The test setup fails the test that produced it; the suite passes with none | `client/tests/setup.ts` | Planned |
| UI-27 | UI | AC-40, BR-39 | Add Action and Public Comment create answered with `IDEMPOTENCY_KEY_REUSED`, then submitted again | Typed text kept; the server's message shown; the next request carries a new `Idempotency-Key` | `client/tests/lab-04/Hardening.test.tsx` | Planned |
| STYLE-01 | Style | AC-51 | Action Status, follow-up, and eligibility badges | Fixed text plus token class on each, never color alone | `client/tests/lab-04/ActionsTaken.test.tsx` | Pass |
| STYLE-02 | Style | AC-50, BR-04 | Every required label on the Lab 4 forms and dialogs | Ends with the red asterisk; the Follow-Up Note's only while checked | `client/tests/lab-04/ActionsTaken.test.tsx` | Planned |
| STYLE-03 | Style | FR-19 | Lab 4 component sources | No hex color literal outside `zen-green.css`; every class used exists in the stylesheet | `client/tests/lab-04/Hardening.test.tsx` | Planned |
| RESP-01 | Responsive | AC-48 | Both dashboards at 375, 768, 1280 | No horizontal scroll, no clipping or overlap; screenshots saved | `e2e/lab-04/dashboards.spec.ts` | Planned |
| RESP-02 | Responsive | AC-48 | Actions Taken list, create form, Complete dialog, blocked Resolve, Status History, and Requester view at 375, 768, 1280 | Table at desktop, cards on mobile, no horizontal scroll; screenshots saved | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| A11Y-01 | Accessibility | AC-49 | Keyboard-only pass of a dashboard, the Actions tab, and both dialogs | Every control reachable and operable; focus ring computed as the Zen Green token; dialogs trap and return focus | `e2e/lab-04/actions-taken-flow.spec.ts` | Planned |
| E2E-01 | E2E | AC-01, AC-14 | IT Staff create two Actions with different Responsible Staff, edit one, reassign it, complete one, cancel the other | Both shown on one Ticket with correct people and statuses | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-02 | E2E | AC-03 | Create an Action, complete it, resolve the Ticket, then sign in as the Requester | Action Completed with Performed By, Ticket Resolved, Requester sees both and the History | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-03 | E2E | AC-19, AC-20 | Try to resolve with a Planned Action, complete it, resolve | Blocked with the gate message first, then succeeds | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-04 | E2E | AC-22 | Two staff browsers on one Ticket; one moves it, the other then moves it from the old status | The second sees the `STATUS_CHANGED` conflict and the reloaded status | `e2e/lab-04/ticket-resolution.spec.ts` | Planned |
| E2E-05 | E2E | AC-31 | IT Staff open every dashboard card | The queue opens filtered and shows the same count as the card | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-06 | E2E | AC-02, AC-32 | Two Requesters open their dashboards and drill down | Each sees only their own figures; My Tickets matches each card | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-07 | E2E | AC-36 | Sign in as each role | Each lands on its dashboard with Dashboard marked current | `e2e/lab-04/dashboards.spec.ts` | Planned |
| E2E-08 | E2E | AC-04 | An Administrator deactivates an IT Staff user while another staff user has the Action form open with them chosen | Saving is refused with the inactive-person message | `e2e/lab-04/actions-taken-flow.spec.ts` | Pass |
| E2E-09 | E2E | AC-44 | Browser console during every Lab 4 journey | No error or warning collected | `e2e/lab-04/dashboards.spec.ts` | Planned |

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

**Issue 02 (2026-10-30).** Tests on a scratch database in the Lab 3 state holding Users of every role, Tickets in all eight statuses, Attachments (one removed), Public Comments, an Internal Note and a Session:

- MIG-01: after the migration every Lab 3 row is identical except the two new key columns, which are nullable and null on every existing row; every Ticket has exactly one Status Change (none to New, at its creation time, by its Requester); keys are unique per creating user and keyless rows are unlimited.
- MIG-02: after the down script (run with Lab 4 rows present) every Lab 3 row and the whole public schema (tables, columns, indexes, constraints, enum types) are identical to before, and the migration applies again.
- MIG-04: a second seed run leaves every Action Taken, Status Change and Ticket identical; a migrated creation row is not duplicated; a seeded Ticket moved through the application gets no invented history or Actions.

The shared development database was migrated the same day after a `pg_dump` backup (kept outside the repository). Row counts before: User 224, Ticket 1694, Attachment 565, PublicComment 50, InternalNote 56, Session 1466, Category 5, RelatedSystem 8. After: the same, plus StatusChange 1694 (equal to Ticket) and ActionTaken 0. The seed then added 13 Actions Taken on 9 Tickets and their Status History, and a second run added nothing.

## 5. Manual verification

Recorded per Issue: each screen used in a real browser against the seeded database at 375, 768, and 1280, the screenshots read, and the browser console checked.

## 6. Results

Filled in per Issue as each one lands, with the exact counts copied from the test output, the tests changed for a superseding rule, and the lessons. Known superseding changes so far: the Lab 3 matrix tests (`server/tests/lab-03/statusTransition.unit.test.ts`, its permitted-move count 14 becoming 16, the fake backend's permitted table in `client/tests/lab-03/StaffTicketDetail.test.tsx`, and the "refuses every move BR-25 does not list" case in `server/tests/lab-03/staff-ticket-detail.api.test.ts`) are updated for the two Cancel moves added by BR-20.

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
