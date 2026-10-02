# Lab 4 Sprint Engineering Specification

**Numbering scope:** `FR-nn`, `BR-nn`, and `AC-nn` in this document are Lab 4 identifiers and restart at 01. A Lab 3 rule is cited as `L3-BR-nn` and lives in `docs/lab-03/specification.md`; a Lab 2 rule is cited as `L2-BR-nn`. Every Lab 2 and Lab 3 rule stays in force unless a rule below says it is superseded, and section 11 lists every such change. Vocabulary follows `CONTEXT.md`.

## 1. Sprint Goal

Complete the TokTickIT service-desk workflow: IT Staff plan and record the work done on a Ticket as Actions Taken, a Ticket can only be resolved once that work is complete, every status change is kept as an append-only history, and each role starts from a concise dashboard that links to the detailed screens, while every Lab 1 to Lab 3 capability keeps working and the whole application is hardened for the final demonstration.

## 2. Stakeholder Request Interpretation

IT can already receive Tickets and talk to Requesters, but nothing records what was actually done. Each Ticket now carries a list of Actions Taken: one line per piece of work, saying when it happened or is planned, what was done, what came of it, who recorded it, who is responsible for it, who carried it out, whether more work must follow and why, and where to find supporting files. The Ticket Owner still coordinates the Ticket as a whole, but any IT Staff member can be responsible for, or carry out, an individual Action.

The Requester's "problem appears resolved" signal stays a signal. IT decides, and the system refuses to let a Ticket be resolved while planned work is still open or before any work has been recorded, even if someone calls the API directly.

Requesters and IT Staff each get a dashboard that answers "what needs my attention now" with a few numbers and short lists, every one of which opens the full screen behind it. Finally, the product is treated as finished software: duplicate clicks and network retries cannot create duplicate records, forms never lose what was typed, and every screen from Labs 2 and 3 still works, looks, and reads consistently in Zen Green.

## 3. Scope

### Included

- Actions Taken under a Ticket: list, create, view, edit while Planned, complete, cancel, assign and reassign the Responsible Staff (handout sections 3, 4.1, 4.3, 4.4, 8.3; rubric Part 6).
- The final Ticket status-transition matrix with roles, the backend resolution gate, stale-move detection, and an append-only Status History (sections 4.5, 6.1, 8.4; Part 7).
- Requester Dashboard and IT Staff Dashboard with defined metrics, time boundaries, empty states, and drill-down; the Administrator sees the IT Staff Dashboard plus account counts (sections 4.6, 6.2, 8.1, 8.2; Parts 5 and 8).
- Dashboard as each role's landing page and first navigation item (section 7).
- An additive database migration with backfill, a tested recovery path, and an idempotent seed (section 5).
- Final hardening: duplicate-submission protection on every create endpoint, consistent feedback states, forms that keep entered data, removal of leftover UI, console errors, and placeholders, current README (sections 7, 8.5).
- Full Lab 1 to Lab 3 regression (sections 1, 8.5; Part 8).

### Excluded

Per handout section 4.2: automatic SLA clocks, escalation engines, on-call scheduling, breach notifications; email, SMS, LINE, push, or any external notification; inventory, spare parts, purchasing, service cost accounting; time-sheet billing, payroll, labour cost; multi-level approvals and electronic signatures; business-intelligence tools, custom report builders, export warehouses; multi-tenant organisations and production-scale cloud operations; and any feature not approved in this contract.

Also excluded in Lab 4: deleting an Action Taken (Actions are cancelled, never deleted), editing a Completed or Cancelled Action, linking Attachment Notes to an Attachment record, Requester-initiated reopening, charts, configurable dashboards, and pruning of stored idempotency keys.

## 4. Functional Requirements

### Actions Taken

- FR-01 IT Staff and Administrators create an Action Taken on a Ticket with an Action Date/Time, an Action Description, a Responsible Staff member, Follow-Up Required with its Follow-Up Note when needed, and optional Attachment Notes. Recorded By and Recorded at are captured automatically.
- FR-02 IT Staff and Administrators see the list of Actions Taken on any Ticket's detail; a Requester sees the same list, read-only, on their own Ticket's detail.
- FR-03 IT Staff and Administrators edit a Planned Action Taken.
- FR-04 IT Staff and Administrators assign or reassign the Responsible Staff of a Planned Action Taken.
- FR-05 IT Staff and Administrators complete a Planned Action Taken by stating its Result; Performed By and the completion time are captured automatically.
- FR-06 IT Staff and Administrators cancel a Planned Action Taken by stating a reason.

### Ticket workflow

- FR-07 IT Staff and Administrators move a Ticket only through the permitted transitions of BR-20, and the status control offers only those moves; after a successful move the Ticket summary status refreshes.
- FR-08 The backend refuses to resolve a Ticket that fails the resolution gate (BR-21), whatever client sent the request.
- FR-09 A stale status move, made from a status the Ticket no longer has, is refused instead of silently applied (BR-23).
- FR-10 Every Ticket has a Status History that IT Staff and Administrators see on any Ticket and a Requester sees on their own.

### Dashboards

- FR-11 A Requester sees a Requester Dashboard summarising only their own Tickets.
- FR-12 IT Staff see an IT Staff Dashboard summarising the operational queue and their own work, including their Planned Actions.
- FR-13 An Administrator sees the IT Staff Dashboard plus account counts.
- FR-14 The Dashboard is each role's landing page after sign-in and the first navigation item.
- FR-15 Every dashboard card or list item opens the matching detailed view: My Tickets, the Ticket Queue, Ticket Detail, or User Management, already filtered.

### Hardening and regression

- FR-16 Repeated clicking or a network retry never creates a second Ticket, Public Comment, Internal Note, or Action Taken.
- FR-17 Every Lab 4 screen and every carried-forward screen shows consistent loading, validation, success, empty or no-results, forbidden, conflict, not-found, and safe-failure feedback, and important forms keep what the user typed after a recoverable failure.
- FR-18 Every Lab 2 and Lab 3 capability remains available to the roles that had it: authentication, role navigation, My Tickets, Create Ticket, Ticket Detail, Attachments, Public Comments, the IT Staff Ticket Queue and Ticket Detail, Internal Notes, and User Management.
- FR-19 The application has no console errors, broken links, placeholder text, or unfinished controls, and the README's setup, migration, seed, test, and demonstration instructions are current.
- FR-20 `GET /api/health` keeps answering as in Lab 1.

## 5. Business Rules

### Actions Taken

- BR-01 An Action Taken belongs to exactly one Ticket. Its Ticket is fixed at creation and never changes.
- BR-02 The Ticket Owner coordinates the Ticket, but an Action Taken may be by a different IT Staff member. Recorded By, Responsible Staff, and Performed By are each independent of the Ticket Owner and of each other, and a Ticket needs no Ticket Owner to receive an Action.
- BR-03 Field rules, all text trimmed before checking and storing: Action Description is required, 5 to 2000 characters; Attachment Notes are optional, at most 1000 characters, and an empty value is stored as none; Follow-Up Required is a yes or no value, default no.
- BR-04 The Follow-Up Note is required, 5 to 1000 characters, when Follow-Up Required is yes, and is cleared when Follow-Up Required is no. The required marker on the form appears only while it applies.
- BR-05 Action Date/Time is required. It may not be earlier than the Ticket's creation time. While the Action is Planned it may be in the future, at most 365 days ahead. An Action may only be Completed with an Action Date/Time that is not later than the moment of completion, with 2 minutes of tolerance for the difference between the browser and server clocks.
- BR-06 Recorded By and Recorded at are set by the server from the session and the server clock when the Action is created. Performed By and Completed at are set the same way when it is Completed, and Cancelled By and Cancelled at when it is Cancelled. Values for any of these supplied by a client are ignored. Recorded at is shown alongside the Action Date/Time, which covers the handout's "Action create date/time" (section 8.3) without losing the time the work actually happened.
- BR-07 Responsible Staff must be a user who is active and holds the IT Staff or Administrator role at the moment it is set. Any other user, including an inactive one, is rejected with 409 `INVALID_RESPONSIBLE` and nothing is written. It defaults to the user recording the Action.
- BR-08 A Responsible Staff member who later becomes inactive or loses the IT Staff role stays named on the Action, marked as no longer eligible, exactly as an Ineligible Owner is treated (`L3-BR-57`). The Action is not changed automatically; any IT Staff member may reassign it while it is Planned, and anyone permitted may complete or cancel it.
- BR-09 Action Status starts as Planned. The only moves are Planned to Completed and Planned to Cancelled. Completed and Cancelled are final: any edit, completion, or cancellation of a final Action is rejected with 409 `ACTION_FINAL`.
- BR-10 Completing requires a Result of 5 to 2000 characters. The user who completes it becomes Performed By. Completing may also correct the Action Date/Time within BR-05.
- BR-11 Cancelling requires a reason of 5 to 500 characters. A Cancelled Action stays in the list, labelled Cancelled with its reason.
- BR-12 Every edit records the editing user as Last Edited By. Only a Planned Action can be edited, and only these fields: Action Description, Action Date/Time, Responsible Staff, Follow-Up Required, Follow-Up Note, Attachment Notes. Recorded By, Recorded at, the Ticket, and the status are never edited. A Completed or Cancelled Action is read-only, so the record of finished work is append-only.
- BR-13 Every Action carries a version number. Every edit, completion, or cancellation must send the version the user loaded; the server applies the change only if it still matches, then increments it. A mismatch writes nothing and returns 409 `STALE_ACTION` with the current Action, so nobody unknowingly overwrites another user's recent change (ADR 0004).
- BR-14 Actions may be created, edited, completed, or cancelled only while the Ticket is `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, or `REOPENED`. On a `RESOLVED`, `CLOSED`, or `CANCELLED` Ticket every Action write is rejected with 409 `TICKET_NOT_WORKABLE`. A Resolved Ticket that needs more work is Reopened first.
- BR-15 Cancelling a Ticket cancels every Planned Action on it in the same transaction, with the reason "Ticket cancelled" and the cancelling user as Cancelled By, so a Cancelled Ticket never leaves work hanging.
- BR-16 Actions are listed by Action Date/Time, oldest first, and then by creation order, so the order is stable and never changes when an Action is edited to a different status.
- BR-17 A Requester sees every Action Taken on a Ticket they own, including Cancelled ones, with every field shown read-only. A Requester asking for the Actions of another Requester's Ticket gets 404 (`L3-BR-15`). A Requester calling any Action write endpoint gets 403, decided from the role alone before any lookup (`L3-BR-14`). The IT Staff form states that Actions Taken are visible to the Requester; private information belongs in an Internal Note.
- BR-18 Actions Taken are never deleted. No delete operation exists.
- BR-19 Creating, editing, completing, or cancelling an Action updates the Ticket's last-activity time (BR-38).

### Ticket workflow

- BR-20 The Ticket statuses stay `NEW`, `OPEN`, `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `RESOLVED`, `CLOSED`, `REOPENED`, and `CANCELLED`. The final transition matrix keeps `L3-BR-25` unchanged, and only IT Staff and Administrators may perform any move (`L3-BR-24`):

  | From | Permitted next status | Who | Extra condition |
  |---|---|---|---|
  | `NEW` | `OPEN`, `CANCELLED` | IT Staff, Administrator | confirmation for `CANCELLED` |
  | `OPEN` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER`, `CANCELLED` | IT Staff, Administrator | eligible owner for `IN_PROGRESS`; confirmation for `CANCELLED` |
  | `IN_PROGRESS` | `WAITING_FOR_REQUESTER`, `RESOLVED`, `CANCELLED` | IT Staff, Administrator | resolution gate, Resolution Summary, and confirmation for `RESOLVED`; confirmation for `CANCELLED` |
  | `WAITING_FOR_REQUESTER` | `IN_PROGRESS`, `RESOLVED` | IT Staff, Administrator | eligible owner for `IN_PROGRESS`; gate, summary, and confirmation for `RESOLVED` |
  | `RESOLVED` | `CLOSED`, `REOPENED` | IT Staff, Administrator | eligible owner and confirmation for `CLOSED` |
  | `REOPENED` | `IN_PROGRESS`, `WAITING_FOR_REQUESTER` | IT Staff, Administrator | eligible owner for `IN_PROGRESS` |
  | `CLOSED` | none, terminal | | |
  | `CANCELLED` | none, terminal | | |

- BR-21 Resolution gate. A move to `RESOLVED` is refused with 409 `ACTIONS_INCOMPLETE` while any Action on the Ticket is Planned, and with 409 `NO_COMPLETED_ACTION` when the Ticket has no Completed Action. The gate is checked by the backend inside the same transaction as the move, with the Ticket row locked, so an Action created at the same moment cannot slip past it. This is stricter than "blocked while incomplete" on purpose: a resolved Ticket always shows the work that resolved it. It applies only to the move itself, so Tickets that were already `RESOLVED` or `CLOSED` before Lab 4 are not changed.
- BR-22 `L3-BR-26` to `L3-BR-28` still apply: a move outside BR-20 gets 409 `INVALID_TRANSITION`, a move to `RESOLVED` needs a Resolution Summary of 10 to 2000 characters, and `IN_PROGRESS`, `RESOLVED`, and `CLOSED` need an eligible Ticket Owner. Checks run in this order: request (400), Ticket (404), stale status (BR-23), transition, owner, then the gate.
- BR-23 Every status move must state the status the user saw (`fromStatus`). If the Ticket's current status differs, the move is refused with 409 `STATUS_CHANGED`, nothing is written, and the response names the current status and its permitted moves, even when the requested move would be permitted from the new status. This supersedes the Lab 3 behaviour, in which a move permitted from the new status was applied (section 11).
- BR-24 Every successful move appends one Status Change in the same transaction: the Ticket, the previous status, the new status, the user who made the move, the server time, and the Resolution Summary when the move is to `RESOLVED`. Creating a Ticket appends a Status Change with no previous status and `NEW` as the new status, made by the Requester. Status Changes are never edited or deleted and no endpoint can change one.
- BR-25 Every Ticket that existed before Lab 4 receives, during migration, one Status Change recording its creation as `NEW`, at its creation time, made by its Requester. Its later moves were never recorded and are not invented. When a Ticket's current status differs from the last recorded Status Change, the history shows the line "Earlier status changes were not recorded." after the creation row.
- BR-26 The Status History is listed oldest first, then by creation order. IT Staff and Administrators see it on any Ticket; a Requester sees it on their own Ticket only, and gets 404 for another's.
- BR-27 The Requester's "problem appears resolved" indication stays advisory (`L3-BR-29`): it never changes status and never writes a Status Change. Only IT Staff and Administrators resolve, close, or reopen.

### Dashboards

- BR-28 Every dashboard figure is computed by the backend from the database at request time with a count or a capped query. The client performs no counting of its own and never receives whole Ticket collections; each list holds at most 5 items.
- BR-29 Time zone and boundaries. Times are stored in UTC and shown in Asia/Bangkok (UTC+7, no daylight saving). "In the last N days" means from 00:00 Asia/Bangkok on the calendar day N-1 days before today, up to the moment of the request, so "last 7 days" covers today and the six days before it.
- BR-30 An active Ticket is one whose status is not `RESOLVED`, `CLOSED`, or `CANCELLED`.
- BR-31 IT Staff Dashboard metrics, all across every Requester:

  | Metric | Calculation | Drill-down |
  |---|---|---|
  | Unassigned | Tickets that are not `CLOSED` or `CANCELLED` and are unassigned or have an ineligible owner, the queue's `needs-owner` rule (`L3-BR-59`) | Ticket Queue, Owner "Needs an owner" |
  | My Tickets | active Tickets whose Ticket Owner is the current user | Ticket Queue, Owner "Assigned to me", active only |
  | My Planned Actions | Planned Actions whose Responsible Staff is the current user, with a list of up to 5, earliest Action Date/Time first | each item opens its Ticket Detail at the Actions Taken area |
  | Urgent | active Tickets whose IT Priority is `HIGH` | Ticket Queue, IT Priority High, active only |
  | By status | one count for each of the eight statuses | Ticket Queue filtered to that status |
  | Recently updated | up to 5 Tickets with the latest last-activity time | each item opens its Ticket Detail |

- BR-32 The Administrator sees every BR-31 metric for themselves plus an Accounts card: the number of active users for each role and the number of inactive users, drilling down to User Management. IT Staff never receive the account counts.
- BR-33 Requester Dashboard metrics, only over Tickets the signed-in Requester created:

  | Metric | Calculation | Drill-down |
  |---|---|---|
  | Open | active Tickets | My Tickets, active only |
  | Waiting for you | Tickets in `WAITING_FOR_REQUESTER` | My Tickets, status Waiting for Requester |
  | Recently updated | count of Tickets whose last activity is in the last 7 days, with a list of up to 5 latest first | My Tickets limited to the last 7 days, sorted by last updated; each item opens its Ticket Detail |
  | Recently resolved | count of Tickets that moved to `RESOLVED` in the last 30 days, by their latest Status Change to `RESOLVED`, and are now `RESOLVED` or `CLOSED`, with a list of up to 5 latest first | My Tickets limited to Tickets resolved in the last 30 days; each item opens its Ticket Detail |

- BR-34 A figure with no matching records shows `0` and a short sentence saying so, and a list with no items shows its empty sentence. A card is never hidden and never blank because its value is zero.
- BR-35 The Requester Dashboard endpoint derives the Requester from the session only; no parameter can widen it. IT Staff and Administrators calling it get 403. A Requester calling the IT Staff Dashboard endpoint gets 403.
- BR-36 Drill-down uses query parameters that the target screens accept directly, so a dashboard link, a bookmark, and a refresh all show exactly the records the figure counted. The client routes `/staff/tickets` and `/tickets` read `status`, `statusGroup` (`active`, or `resolved` meaning `RESOLVED` or `CLOSED`), and `sort` including last updated; `/tickets` also reads `updatedWithinDays` and `resolvedWithinDays`, which apply the BR-29 windows; the Ticket Queue keeps its Lab 3 `owner` and `itPriority` filters. The APIs take the same parameters, except that `GET /api/tickets` keeps its Lab 2 name `currentStatus` for a single status.
- BR-37 A Ticket listed on a dashboard shows its Ticket Number, Summary, status badge, and last-activity time, and opens its Ticket Detail.
- BR-38 A Ticket's last-activity time is its `updatedAt`. It changes when any Ticket field changes (status, owner, IT Priority, Resolution Summary, resolution indication) and when an Action Taken is written, a Public Comment is posted, or an Attachment is added or removed. Posting an Internal Note does not change it, so a Requester cannot infer private staff activity from their dashboard.

### Hardening

- BR-39 Ticket create, Public Comment create, Internal Note create, and Action Taken create accept an `Idempotency-Key` header holding a UUID (ADR 0003). The key is stored with the created record, unique for the acting user and endpoint. A repeat of the same key with the same request returns the record already created, with 200 and an `Idempotent-Replayed: true` header, and creates nothing. The same key with a different request body is refused with 409 `IDEMPOTENCY_KEY_REUSED`. A malformed key is refused with 400. A request with no key behaves as before. The client creates one key per form submission and replaces it only after a confirmed success or when the user changes the content.
- BR-40 The client still sends each submission once and disables the submit control while it is in flight (`L2-BR-17`); BR-39 covers what the client cannot: a request repeated after its response was lost.
- BR-41 After a recoverable failure (400, 409, 500, or no response) every form keeps what the user typed. After a 409 caused by someone else's change, the screen reloads the current record, keeps the user's typed text, drops any pending confirmation, and says what changed (`L3-BR-64`).
- BR-42 Feedback states follow one pattern on every screen: loading, validation under the field, inline success next to what changed, empty and no-results, forbidden, conflict, not-found, and a safe failure with Retry (`L3-BR-65`). A 500 never exposes a stack trace, SQL, file path, hash, or token.
- BR-43 No screen produces a console error or warning during the test suites or a manual pass; no link leads nowhere; no placeholder text or control without behaviour remains. Temporary, duplicate, or obsolete UI from earlier labs is removed.

### Migration and seed

- BR-44 The Lab 4 migration is additive only: new tables for Actions Taken, Status Changes, and idempotency keys, new enums, new indexes, and the BR-25 backfill. It changes no existing column and deletes no row, so every User, Ticket, Attachment, Public Comment, and Internal Note stays valid.
- BR-45 Recovery: before migrating a database holding real data, take a `pg_dump` backup. A down script, `server/prisma/rollback/lab-04-down.sql`, removes only the Lab 4 objects and is tested: applying it after the migration leaves every Lab 3 row identical.
- BR-46 The seed stays idempotent (`L3-BR-50`) and adds, on top of the Lab 3 fixtures: Tickets in every status, every IT Priority, assigned and unassigned; Tickets with zero, one, and several Actions Taken, including Planned, Completed, Cancelled, follow-up, and different Responsible Staff on one Ticket; a Requester and an IT Staff user for whom every dashboard figure is zero; and Status Changes consistent with each seeded Ticket's status. Running it twice produces the same data.

### Regression

- BR-47 Lab 4 is an increment, not a rewrite: every Lab 2 and Lab 3 function keeps its behaviour, and the Lab 1, Lab 2, and Lab 3 suites keep passing unchanged except where a Lab 4 rule deliberately supersedes them, which section 11 lists.

### Authorization matrix

Lab 3's matrix (`docs/lab-03/specification.md` section 5) stays in force. Lab 4 adds:

| Operation | Requester | IT Staff | Administrator |
|---|---|---|---|
| List Actions Taken of a Ticket | own | any | any |
| Create an Action Taken | no | any | any |
| Edit, assign, complete, or cancel a Planned Action Taken | no | any | any |
| Read Status History | own | any | any |
| Change Ticket status (now with `fromStatus` and the gate) | no | yes | yes |
| Requester Dashboard | own | no | no |
| IT Staff Dashboard | no | yes | yes |
| Accounts card on the dashboard | no | no | yes |

`own` is enforced by folding the session identity into the query. Every write is enforced by the backend and covered by a direct-API authorization test (`L3-BR-16`).

## 6. UI Specification Summary

Full detail is in `docs/lab-04/ui-spec.md`. Every Lab 2 and Lab 3 token, component, feedback pattern, responsive rule, and accessibility rule stays in force.

- **Navigation**: Dashboard is the first item for every role and the landing page after sign-in; the active item is marked with `aria-current="page"`.
- **IT Staff Dashboard**: metric cards (Unassigned, My Tickets, Urgent), a My Planned Actions list, a By status row, a Recently updated list, and for the Administrator an Accounts card. Each card has a label, a value, and an accessible drill-down link. Loading, empty, forbidden, and safe-failure states.
- **Requester Dashboard**: Open, Waiting for you, Recently updated, Recently resolved, each linking to My Tickets filtered, and short lists linking to Ticket Detail.
- **Actions Taken on IT Staff Ticket Detail**: a new Actions Taken tab, first in the tab list before Public Comments, Internal Notes, and Attachments. A table on desktop, cards on mobile. Create mode is an inline form; selecting an Action opens it in view mode, with an Edit action while Planned. Complete and Cancel open small accessible dialogs. Completed and Cancelled Actions are read-only.
- **Actions Taken on Requester Ticket Detail**: the same list, read-only, with no controls.
- **Status History**: a History tab on IT Staff Ticket Detail and a History section on Requester Ticket Detail, oldest first, with no control to change an entry.
- **Workflow feedback**: the status control lists only permitted moves; when the resolution gate blocks Resolved, the reason is shown next to the control with a link to the Actions Taken tab; a stale move shows a conflict callout and the reloaded status.

## 7. Data Changes

New enum and models, added by one additive migration (BR-44):

```prisma
enum ActionStatus {
  PLANNED
  COMPLETED
  CANCELLED
}

model ActionTaken {
  id                  Int          @id @default(autoincrement())
  ticketId            Int
  ticket              Ticket       @relation(fields: [ticketId], references: [id])
  actionAt            DateTime
  description         String
  result              String?
  status              ActionStatus @default(PLANNED)
  followUpRequired    Boolean      @default(false)
  followUpNote        String?
  attachmentNotes     String?
  recordedById        Int
  recordedBy          User         @relation("ActionRecordedBy", fields: [recordedById], references: [id])
  responsibleStaffId  Int
  responsibleStaff    User         @relation("ActionResponsible", fields: [responsibleStaffId], references: [id])
  performedById       Int?
  performedBy         User?        @relation("ActionPerformedBy", fields: [performedById], references: [id])
  completedAt         DateTime?
  cancelledById       Int?
  cancelledBy         User?        @relation("ActionCancelledBy", fields: [cancelledById], references: [id])
  cancelledAt         DateTime?
  cancelReason        String?
  lastEditedById      Int?
  lastEditedBy        User?        @relation("ActionLastEditedBy", fields: [lastEditedById], references: [id])
  version             Int          @default(1)
  idempotencyKey      String?
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  @@unique([recordedById, idempotencyKey])
  @@index([ticketId, actionAt, id])
  @@index([responsibleStaffId, status, actionAt])
}

model StatusChange {
  id                Int           @id @default(autoincrement())
  ticketId          Int
  ticket            Ticket        @relation(fields: [ticketId], references: [id])
  fromStatus        TicketStatus?
  toStatus          TicketStatus
  changedById       Int
  changedBy         User          @relation(fields: [changedById], references: [id])
  resolutionSummary String?
  changedAt         DateTime      @default(now())

  @@index([ticketId, changedAt, id])
  @@index([toStatus, changedAt])
}
```

`Ticket`, `PublicComment`, and `InternalNote` each gain `idempotencyKey String?` with a unique constraint on the creating user and the key (`requesterId` for a Ticket, `authorId` for a comment or note). `User` gains the back-relations for the five Action relations and Status Changes. `Ticket` gains `actions ActionTaken[]` and `statusChanges StatusChange[]`, plus `@@index([updatedAt])` and `@@index([itPriority, currentStatus])` for the dashboard queries. No existing column changes.

**Justified decision 1, a version number for stale Action edits (ADR 0004).** Several IT Staff may edit the same Planned Action. An integer version with a conditional update (`WHERE id = ? AND version = ?`) detects a stale edit exactly and atomically in one statement, holding no lock between reading and writing. `updatedAt` comparison was rejected because millisecond timestamps can collide; last-write-wins was rejected because the handout forbids silently overwriting another user's change.

**Justified decision 2, Status History as its own append-only table.** A separate `StatusChange` table, written in the same transaction as the move, gives a stable, queryable order, lets the Requester's "recently resolved" metric use the real resolution time, and cannot be rewritten by any endpoint. Storing history as a JSON column on `Ticket` was rejected: it would be rewritten on every move, cannot be indexed for the dashboard, and invites edits.

**Justified decision 3, idempotency keys stored on the created rows (ADR 0003).** A unique constraint on (creating user, key) makes a duplicate impossible at the database level even when two retries arrive at once, without a separate key table to keep consistent. The key column is nullable, so existing rows and keyless requests are unaffected.

**Justified decision 4, Responsible Staff is required and defaults to the recorder.** Every Action always names someone accountable, so "My Planned Actions" is complete and the inactive-person rule (BR-07, BR-08) has one field to check.

**Migration and backfill.** One migration, generated with `prisma migrate dev --create-only` and reviewed by hand, runs in this order: create `ActionStatus`; create `ActionTaken` and `StatusChange` with their foreign keys and indexes; add the nullable `idempotencyKey` columns and their unique constraints; add the two `Ticket` indexes; then `INSERT INTO "StatusChange" ("ticketId", "fromStatus", "toStatus", "changedById", "changedAt") SELECT id, NULL, 'NEW', "requesterId", "createdAt" FROM "Ticket"` (BR-25). Legacy Tickets start with zero Actions Taken: they can still be worked, and before they can be resolved someone records and completes an Action (BR-21). Dashboards treat legacy records exactly like new ones, because every figure is computed from current columns, and "recently resolved" counts only resolutions with a recorded Status Change, so a Ticket resolved before Lab 4 is not counted as recent. Evidence: row counts of every Lab 3 table before and after, the Status Change count equal to the Ticket count, and the down script test (BR-45).

## 8. API Contract

Full shapes, statuses, and error bodies are in `docs/lab-04/api-spec.md`. All Lab 2 and Lab 3 endpoints continue, with the changes marked below.

| Method and path | Purpose | Authorization |
|---|---|---|
| GET `/api/tickets/:id/actions` | list Actions Taken | Requester own, IT Staff and Administrator any |
| POST `/api/tickets/:id/actions` | create an Action Taken (`Idempotency-Key`) | IT Staff, Administrator |
| PATCH `/api/actions/:id` | edit or reassign a Planned Action (with `version`) | IT Staff, Administrator |
| POST `/api/actions/:id/complete` | complete a Planned Action (with `version`) | IT Staff, Administrator |
| POST `/api/actions/:id/cancel` | cancel a Planned Action (with `version`) | IT Staff, Administrator |
| GET `/api/tickets/:id/history` | Status History | Requester own, IT Staff and Administrator any |
| PATCH `/api/staff/tickets/:id/status` | changed: requires `fromStatus`; resolution gate | IT Staff, Administrator |
| GET `/api/dashboard/requester` | Requester Dashboard | Requester |
| GET `/api/dashboard/staff` | IT Staff Dashboard, plus accounts for an Administrator | IT Staff, Administrator |
| GET `/api/tickets` | changed: accepts `statusGroup`, `status`, and `-updatedAt` sort | Requester, own |
| GET `/api/staff/tickets` | changed: accepts `statusGroup` | IT Staff, Administrator |
| GET `/api/tickets/:id` | changed: staff body adds `resolutionGate` | Requester own, IT Staff and Administrator any |
| POST `/api/tickets`, `/api/tickets/:id/comments`, `/api/tickets/:id/notes` | changed: accept `Idempotency-Key` | as Lab 3 |

New error codes: `INVALID_RESPONSIBLE`, `ACTION_FINAL`, `STALE_ACTION`, `TICKET_NOT_WORKABLE`, `ACTIONS_INCOMPLETE`, `NO_COMPLETED_ACTION`, `STATUS_CHANGED`, `IDEMPOTENCY_KEY_REUSED`.

## 9. Acceptance Criteria

### Actions Taken

- AC-01 Given a permitted IT Staff user and valid data, when an Actions Taken is created, then it is saved under the correct Ticket with the authenticated creator (Recorded By) and approved assignee (Responsible Staff).
- AC-02 Given an authenticated Requester, when dashboard data is retrieved, then only metrics and recent Tickets owned by that Requester are returned.
- AC-03 Given an IT Staff user on a Ticket Detail, when they create an Action, complete it with a Result, and then resolve the Ticket, then the Action shows as Completed with them as Performed By, the Ticket shows Resolved, and the Requester sees both the Action and the Resolved status on their own Ticket Detail.
- AC-04 Given a Responsible Staff member who is inactive or holds the Requester role, when an Action is created with them or reassigned to them, then it is rejected with 409 `INVALID_RESPONSIBLE` and nothing is written.
- AC-05 Given Follow-Up Required set to yes and no Follow-Up Note, when the Action is saved, then it is rejected with 400 naming the Follow-Up Note; and given Follow-Up Required set to no, then any Follow-Up Note sent is cleared.
- AC-06 Given an Action Description, Result, Follow-Up Note, Attachment Notes, or cancel reason at each boundary, when saved, then the lengths of BR-03, BR-04, BR-10, and BR-11 are accepted exactly at the limits and rejected one character beyond.
- AC-07 Given an Action Date/Time earlier than the Ticket's creation, or more than 365 days ahead, or later than now at completion, when saved, then it is rejected with 400.
- AC-08 Given a Planned Action, when it is edited, then the changed fields are stored, Recorded By and Recorded at are unchanged, and the version increases by one.
- AC-09 Given a Planned Action, when it is completed with a Result, then its status is Completed, Performed By is the completing user, Completed at is set by the server, and it can no longer be edited.
- AC-10 Given a Planned Action, when it is cancelled with a reason, then it is listed as Cancelled with the reason, Cancelled By, and Cancelled at, and it can no longer be edited, completed, or cancelled again (409 `ACTION_FINAL`).
- AC-11 Given two users who loaded the same Planned Action, when both save an edit, then the first succeeds and the second gets 409 `STALE_ACTION` with the current Action and nothing of theirs is written.
- AC-12 Given a Ticket that is Resolved, Closed, or Cancelled, when an Action is created, edited, completed, or cancelled on it, then the request is rejected with 409 `TICKET_NOT_WORKABLE`.
- AC-13 Given a Ticket with Planned Actions, when the Ticket is cancelled, then every Planned Action becomes Cancelled with the reason "Ticket cancelled" in the same operation, and Completed Actions are unchanged.
- AC-14 Given a Ticket with several Actions by different Responsible Staff, when the list is read, then every Action is returned in Action Date/Time order, then creation order, with its Recorded By, Responsible Staff, and Performed By.
- AC-15 Given a Requester, when they read the Actions of their own Ticket they see every Action read-only; when they read another Requester's they get 404; and when they call any Action write endpoint they get 403 and nothing is written.
- AC-16 Given client-supplied Recorded By, Performed By, or timestamps in a request, when it is saved, then they are ignored and the server's values are stored.
- AC-17 Given a Responsible Staff member who is deactivated after the Action was created, when the Action is read, then it still names them marked as no longer eligible, and it can be reassigned to an active IT Staff member.

### Ticket workflow

- AC-18 Given each status, when a move is attempted to each other status, then exactly the BR-20 moves succeed for IT Staff and Administrators, every other move gets 409 `INVALID_TRANSITION`, and a Requester gets 403 for every move.
- AC-19 Given a Ticket with a Planned Action, when it is moved to Resolved through the API directly, then it is rejected with 409 `ACTIONS_INCOMPLETE` and the status is unchanged.
- AC-20 Given a Ticket with no Completed Action, when it is moved to Resolved, then it is rejected with 409 `NO_COMPLETED_ACTION` and the status is unchanged.
- AC-21 Given a Ticket whose Actions are all Completed or Cancelled with at least one Completed, an eligible owner, and a valid Resolution Summary, when it is moved to Resolved, then it succeeds.
- AC-22 Given a user who loaded a Ticket as Open while another user moved it to In Progress, when the first user moves it to Waiting for Requester, then it is rejected with 409 `STATUS_CHANGED` naming In Progress, and the status stays In Progress.
- AC-23 Given any successful move, when the Status History is read, then it ends with one new entry naming the previous and new status, the user, and the time, and no entry can be changed or deleted through any endpoint.
- AC-24 Given a Ticket that existed before the migration, when its Status History is read, then it starts with one creation entry, and if its status is no longer New it shows that earlier changes were not recorded.
- AC-25 Given a Requester, when they read the Status History of their own Ticket they see it, and for another Requester's Ticket they get 404.
- AC-26 Given a Requester's "problem appears resolved" indication, when it is recorded, then the status and the Status History are unchanged.
- AC-27 Given IT Staff Ticket Detail, when a move succeeds, then the status badge and summary refresh to the new status and the status control lists only the moves permitted from it.

### Dashboards

- AC-28 Given the seeded database, when the IT Staff Dashboard is retrieved, then every BR-31 figure equals the result of its defining query run directly against the database.
- AC-29 Given the seeded database, when the Requester Dashboard is retrieved for a Requester, then every BR-33 figure equals its defining query restricted to that Requester's Tickets.
- AC-30 Given a Requester or an IT Staff user with no matching records, when their dashboard is retrieved, then every figure is 0, every list is empty, and the screen shows each empty sentence.
- AC-31 Given an IT Staff user, when they open a dashboard card or list item, then the Ticket Queue or Ticket Detail opens showing exactly the records the figure counted.
- AC-32 Given a Requester, when they open a dashboard card or list item, then My Tickets or Ticket Detail opens showing exactly the records the figure counted.
- AC-33 Given an IT Staff user, when the IT Staff Dashboard is retrieved, then no account counts are returned; and given an Administrator, then the account counts are returned.
- AC-34 Given a Requester calling the IT Staff Dashboard, or IT Staff or an Administrator calling the Requester Dashboard, then the response is 403; and with no session it is 401.
- AC-35 Given one Ticket with activity at exactly 00:00:00 Asia/Bangkok six days before today and another at 23:59:59 Asia/Bangkok seven days before today, when the 7-day window is computed, then the first is counted and the second is not; and the same holds at 29 and 30 days for the 30-day window (BR-29).
- AC-36 Given each role signing in, when sign-in completes, then their Dashboard is shown and the Dashboard navigation item is marked as the current page.
- AC-37 Given a dashboard whose request fails, or is still loading, when the screen renders, then a loading state, or a safe failure with Retry, is shown instead of cards with wrong values.
- AC-38 Given a dashboard response, when its size is measured with the performance-smoke data set, then it stays under 10 KB and no list holds more than 5 items.

### Hardening and regression

- AC-39 Given a Ticket, Public Comment, Internal Note, or Action Taken create request, when it is sent twice with the same `Idempotency-Key`, then exactly one record exists and the second response returns it with `Idempotent-Replayed: true`.
- AC-40 Given an `Idempotency-Key` reused with a different body, when it is sent, then it is rejected with 409 `IDEMPOTENCY_KEY_REUSED` and nothing new is created.
- AC-41 Given a create form, when the submit control is clicked twice quickly, then one request is sent and one record is created.
- AC-42 Given the Action form, Create Ticket form, or a comment or note composer, when the server fails or returns a conflict, then what the user typed is still in the form.
- AC-43 Given every Lab 2 and Lab 3 acceptance test, when the full suites run on the final `main`, then they all pass.
- AC-44 Given the client test run and a manual pass of every screen, when the console is inspected, then no error or warning appears.
- AC-45 Given the Lab 3 database, when the Lab 4 migration is applied, then the row count of every Lab 3 table is unchanged, every Ticket has exactly one Status Change, and applying the down script afterwards leaves every Lab 3 row identical.
- AC-46 Given the seed run twice, when the data is compared, then nothing changed on the second run, and the seeded data includes Tickets with zero, one, and several Actions and users whose dashboards are all zero.
- AC-47 Given each dashboard endpoint and the Ticket Queue with the performance-smoke data set, when each is called 20 times, then the median time is under 300 ms and none exceeds 1 second.
- AC-48 Given any Lab 4 screen at 375px, 768px, and 1280px, when rendered, then there is no horizontal page scrolling, no clipped or overlapping content, and every control is reachable.
- AC-49 Given any Lab 4 control, when it is reached with the keyboard, then it shows the Zen Green focus ring and can be operated without a mouse, and the Complete and Cancel dialogs keep focus inside, close on Escape, and return focus to the control that opened them.
- AC-50 Given any Lab 4 form, when it is shown, then every required field's label ends with the red asterisk, and the Follow-Up Note shows it only while Follow-Up Required is yes.
- AC-51 Given an Action Status, a Ticket status, or a priority shown anywhere, when it is rendered, then it uses its fixed badge text and colour, never colour alone.
- AC-52 Given `GET /api/health`, when it is called, then it returns 200 with `{ status: "ok", service: "TokTickIT API" }`.

## 10. Definition of Done

**Product:**

- Every FR, BR, and AC above is implemented and demonstrable from the final `main` branch, and every Day 1 checklist line is marked met with its spec ID, test ID, and screenshot.
- `server/tests/lab-04/*`, client `lab-04` tests, and `e2e/lab-04/*` all pass, together with the full Lab 1, Lab 2, and Lab 3 suites. No test is skipped or commented out.
- Every AC is linked to at least one test in `docs/lab-04/tests.md`, and every row is Pass.
- The API conforms to `docs/lab-04/api-spec.md` and the data model to section 7.
- Success, failure, and boundary cases are tested: validation limits at their exact boundaries, conflicts (409) including at least one stale-update or retry case for every new write, forbidden (403), not-found (404), and safe failure (500).
- Every write is enforced by the backend and proven by a direct-API authorization test.
- Every dashboard figure is proven equal to a direct database query.
- The migration preserves all Lab 3 data and its recovery path is tested.
- Every Lab 4 screen conforms to `docs/lab-04/ui-spec.md` at 375px, 768px, and 1280px, the visual and accessibility checklist is completed against the screenshots, and the screenshots are in `artifacts/lab-04/screenshots/`.
- No console error, broken link, placeholder, or unfinished control remains; the README is current.

**Process:**

- Each Issue implemented on its own feature branch and merged into `lab4-staging` through a peer-reviewed Pull Request with a formal review verdict; then one release Pull Request from `lab4-staging` into `main`.
- This specification merged into `lab4-staging` before the first implementation Pull Request opened.
- `docs/lab-04/reviewer.md` and `docs/lab-04/ai-use.md` completed.
- The Kanban board shows every Lab 4 Issue in Done.
- One concise submission PDF with the headings "Answer Part 1:" to "Answer Part 9:" in order, working links, screenshots readable without zooming, and Part 1 showing commit history, the final Kanban, `reviewer.md`, the README, the `.gitignore`, and the repository structure (handout section 14).

**Issue decomposition** (handout section 11): each Issue has its own branch off `lab4-staging`, and depends on the Issues listed.

| Issue | Branch | Depends on | Why it is separate |
|---|---|---|---|
| 01 #69 contract | `feature/lab4-01-contract` | none | Part 2 needs the spec merged before implementation |
| 02 #70 migration and seed | `feature/lab4-02-migration-seed` | 01 | every later Issue needs the tables and seed data |
| 03 #71 Actions API | `feature/lab4-03-actions-api` | 02 | backend rules and authorization reviewed on their own |
| 04 #72 Actions UI | `feature/lab4-04-actions-ui` | 03 | the screen consumes a reviewed API |
| 05 #73 workflow | `feature/lab4-05-workflow` | 03 | the gate counts Actions |
| 06 #74 dashboards API | `feature/lab4-06-dashboards-api` | 02, 03, 05 | metrics read Actions and Status Changes |
| 07 #75 dashboards UI | `feature/lab4-07-dashboards-ui` | 06 | consumes the dashboard API |
| 08 #76 hardening | `feature/lab4-08-hardening` | 04, 05, 07 | cross-cutting changes after the features exist |
| 09 #77 final tests | `feature/lab4-09-final-tests` | 08 | E2E and screenshots of finished screens |
| 10 #78 pre-release fixes | `feature/lab4-10-pre-release` | 09 | review of the whole increment |
| 11 #79 release | `lab4-staging` into `main` | 01 to 10 | one release PR |
| 12 #80 reviewer and AI docs | `docs/lab4-12-reviewer-ai-use` | 11 | quotes the real review history |

## 11. Assumptions and Decisions

Each decision names the handout line it answers.

- **Recorded By, Responsible Staff, and Performed By are three fields** (sections 3, 4.1, 8.3 "Performed by (auto)"; AC-01 "authenticated creator and approved assignee"; Part 6 "assign", "inactive-assignee rejection"). One "Performed by" set at creation would name the wrong person whenever one user records work that another carries out. The labsheet's "assignee" of an Action is the Responsible Staff; the bare word is avoided in TokTickIT because it is easily confused with the Ticket Owner (`CONTEXT.md`).
- **Actions have a status: Planned, Completed, Cancelled** (Part 6 "status transition, complete, cancel"; section 4.5 resolution rule). This is the smallest set that gives "incomplete" an exact meaning for the resolution gate.
- **Action Date/Time is entered by the user, and Recorded at is shown too** (sections 3 "Action Date/Time", 8.3 "Action create date/time"). Work is often recorded after it is done; showing both covers both wordings.
- **Requesters see every Action, read-only** (sections 4.3 and 8.3 "Requesters will see all Actions Taken items"). Private information belongs in an Internal Note, which the form says.
- **Attachment Notes are free text** (section 3 "what file to look for"). Linking to an Attachment record was rejected: Attachments stay a Requester capability (`L3-BR-55`).
- **The resolution gate also requires one Completed Action** (section 4.5). Stricter than the handout's wording, on purpose: a Resolved Ticket always shows the work that resolved it. Legacy Tickets record an Action before resolving.
- **Status History is added** (Part 7 "append-only behavior", "stable ordering"; learning outcome "auditability"). Public Comments and Internal Notes were already append-only; the workflow itself now is too.
- **Status moves carry `fromStatus`** (section 6.1). Lab 3 already prevented two simultaneous moves from both applying, but it applied a move a user chose against a status they never saw. This supersedes Lab 3 endpoint 10's behaviour for that case only; Lab 3 tests that move a Ticket are updated to send `fromStatus`.
- **An open follow-up does not block resolution** (section 4.5; flag on "incomplete"). Follow-Up Required describes work after this Action; the way to make it block is to record that work as a new Planned Action, which the gate does block. A flag nothing ever clears could otherwise freeze a Ticket.
- **Any IT Staff member or Administrator may edit, complete, or cancel any Planned Action** (section 4.3 "create and update Action Taken on accessible Tickets"; Lab 3 gives IT Staff every Ticket). Restricting it to the recorder, the Responsible Staff, or the Ticket Owner would add an authorization matrix the handout does not ask for and would strand work when that person is away. Each edit records who made it (Last Edited By) for auditability.
- **"Current-user Actions Taken" is My Planned Actions** (Part 5). The IT Staff Dashboard lists Planned Actions whose Responsible Staff is the signed-in user (BR-31), which is the work that user still owes.
- **Dashboard figures are proven against the database** (Part 5 "selected metrics match database queries"). Every figure has a test that runs its defining query directly and compares (DASH-01, DASH-05), and the drill-down list is checked to show the same records (DASH-03, DASH-07).
- **A retried Complete, Cancel, or status move is reported neutrally** (section 8.5 "network retry"). If the response to a Complete was lost, the retry finds the Action already final and gets `ACTION_FINAL`; the screen then reloads and says the Action "is already completed or cancelled" rather than blaming someone else. The same applies when a retried move finds the Ticket already in the requested status.
- **The transition matrix is unchanged and Requesters cannot reopen** (sections 3, 4.5). The handout says IT Staff must review and formally update the Ticket.
- **The Administrator dashboard reuses the IT Staff one, plus account counts** (sections 1, 4.6). No separate endpoint or path, which keeps the handout's section 12 structure.
- **Idempotency keys on all four create endpoints** (section 8.5 "repeated clicking or network retry"). Keying only the new endpoint would leave append-only comments and notes open to undeletable duplicates (ADR 0003). This extends `L2-BR-17`.
- **Dashboard is the landing page** (sections 7 and 8.1 "operational starting point"). This supersedes the Lab 3 landing routes; My Tickets and the Ticket Queue stay one click away.
- **"Urgent" means IT Priority High and active** (section 8.1 "recent or urgent"). TokTickIT has no SLA (excluded), so priority is the only urgency signal.
- **Last activity now includes Public Comments and Attachments** (BR-38; sections 4.6 and 8.2 "recently updated"). In Lab 3 `updatedAt` changed only with Ticket fields, so the queue's Last updated sort also changes meaning: it now follows the same last-activity rule. This supersedes the Lab 3 behaviour.
- **Internal Notes do not change last activity** (BR-38). Otherwise a Requester's "recently updated" would reveal private staff activity.
- **Asia/Bangkok calendar days for the windows** (section 6.2 "time zone and date boundaries"). The users are in Thailand; a rolling 168-hour window would make "last 7 days" disagree with the dates shown on screen.
- **Performance smoke thresholds** (section 10 "performance-smoke"): about 500 Tickets, 20 calls per endpoint, median under 300 ms, worst under 1 second, dashboard bodies under 10 KB. Local development hardware; the point is to catch an unbounded query, not to benchmark.
- **The dev database is reset to a clean seed, with a backup first, before Lab 4 screenshots** (Part 9 "readable", section 7 "remove ... obsolete"). Lab 3 screenshots showed test clutter.
