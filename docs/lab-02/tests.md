# Lab 2 Test Plan and Results

Companion to `docs/lab-02/specification.md`, `docs/lab-02/api-spec.md`, and `docs/lab-02/ui-spec.md`. Written before implementation (Test DD): the coding agent implements against this plan; it does not invent tests after the fact and this file is not reconstructed from whatever the agent happened to generate.

## 1. Test Strategy

- **TDD loop per Issue**: write the planned test(s) for that Issue first, confirm they fail for the expected reason, implement the smallest correct behavior, refactor with tests green.
- **Levels covered**: unit (pure logic), API/integration (Supertest against Express + a test Postgres schema), UI component (Vitest + Testing Library, mocked API), responsive/visual (Playwright screenshots at 3 viewports), end-to-end (Playwright against a running stack).
- **Ownership isolation** is tested at both API and E2E level, never assumed from UI behavior alone. A UI that merely hides another Requester's ticket is not sufficient; the API must actually refuse it.
- Every Acceptance Criterion in `specification.md` (AC-01…AC-21) maps to at least one row below; a few rows also cover Business Rules or UI-spec component rules (§8.3/§8.8 of the handout) that aren't phrased as a numbered AC but are still required checks.
- No planned test is skipped, commented out, or replaced by manual-only verification in the final `main` branch.

## 2. Planned Tests

| Test ID | Type | Requirement / AC | What It Tests | Expected Result | Automated Test File | Final |
|---|---|---|---|---|---|---|
| UNIT-01 | Unit | AC-01 | Ticket Number generator produces `TKT-{year}-{6-digit sequence value}` from a given `ticket_number_seq` value/year | Correct, zero-padded format | `server/tests/lab-02/ticket-number.unit.test.ts` | Pass |
| UNIT-02 | Unit | AC-04, AC-05 | Summary/Description validator trims input and rejects out-of-range length (BR-13, BR-14) | Rejects <5 or >120 char summary, <20 or >2000 char description; accepts boundary values | `server/tests/lab-02/validation.unit.test.ts` | Pass |
| UNIT-03 | Unit | AC-07, AC-08, AC-09 | Attachment validator checks type, size, and active-count independently (BR-26) | Rejects disallowed extension/MIME with `UNSUPPORTED_TYPE`, files >5MB with `FILE_TOO_LARGE`, and a 6th active file with `MAX_ATTACHMENTS_EXCEEDED` | `server/tests/lab-02/attachment-validation.unit.test.ts` | Pass |
| API-01 | API | AC-01 | `POST /api/tickets` with valid body | 201, saved Ticket, unique `ticketNumber` returned | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-02 | API | AC-04, AC-05 | `POST /api/tickets` missing/out-of-range Summary or Description | 400 `VALIDATION_ERROR` with `fields.summary`/`fields.description`; no row persisted | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-03 | API | BR-15 | `POST /api/tickets` with unknown or inactive `categoryId`/`relatedSystemId` | 400 `VALIDATION_ERROR` | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-04 | API | AC-03, AC-11 | `GET /api/tickets?requesterId=` for two different Requesters who each own tickets | Each response contains only its own Requester's tickets | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-05 | API | BR-20, BR-21 | `GET /api/tickets` with `search` and combined filters | Matches only tickets satisfying all params (AND) | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-06 | API | AC-12 | `GET /api/tickets` with a filter matching zero tickets | 200, `data: []`, valid `pagination.total = 0` (not an error) | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-07 | API | AC-13, BR-23 | `GET /api/tickets` pagination across multiple pages, plus out-of-range `page`/`pageSize` | Correct slicing, no duplicates/gaps across pages; invalid params fall back to defaults instead of erroring | `server/tests/lab-02/my-tickets.api.test.ts` | Pass |
| API-08 | API | FR-05 | `GET /api/tickets/:id` for an owned Ticket | 200, full detail payload including `attachments[]` | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-09 | API | AC-03 | `GET /api/tickets/:id` for a nonexistent id, and for one owned by a different Requester | Both return 404 (never 403); existence not leaked (BR-35) | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-10 | API | AC-14 | `POST /api/tickets/:id/attachments` with one valid file | 201, file appears in `uploaded[]` and in a subsequent `GET /api/tickets/:id` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-11 | API | AC-07 | Upload a 6 MB file as the only file in the request | 400 `ALL_FILES_REJECTED`; file reported in `failed[]` with `reason: "FILE_TOO_LARGE"`; not stored | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-12 | API | AC-08 | Upload a `.docx` file as the only file in the request | 400 `ALL_FILES_REJECTED`; file reported in `failed[]` with `reason: "UNSUPPORTED_TYPE"`; not stored | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-13 | API | AC-09 | Upload a 6th file, as the only file in the request, when 5 active attachments already exist | 400 `ALL_FILES_REJECTED`; file reported in `failed[]` with `reason: "MAX_ATTACHMENTS_EXCEEDED"` | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-14 | API | AC-15 | `DELETE /api/attachments/:id` with a valid `{ requesterId, reason }` body on an active attachment | 200, `isRemoved: true`, metadata retained | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-15 | API | AC-16 | `GET /api/attachments/:id/download` on a removed attachment | 410, no file bytes returned | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-16 | API | AC-20 | Ticket created successfully, then its one attachment upload fails | Ticket still exists and is retrievable with its `ticketNumber`; failure reported per-file, not rolled back | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-17 | API | BR-11, BR-28 | As Requester B, call `GET /api/attachments/:id`, `GET /api/attachments/:id/download`, `DELETE /api/attachments/:id`, and `POST /api/tickets/:id/attachments` (a valid file) against a Ticket/attachment owned by Requester A | All four return 404, never 403; no metadata or file bytes leaked and the uploaded file is not stored or appended to Requester A's ticket (mirrors AC-03's ticket-level check, applied to attachments specifically, including upload) | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-18 | API | BR-15 | `POST /api/tickets` with an inactive `categoryId` and, separately, an inactive `relatedSystemId` (seeded per BR-37) | Both rejected with 400 `VALIDATION_ERROR`, same as an unknown id | `server/tests/lab-02/create-ticket.api.test.ts` | Pass |
| API-19 | API | AC-22 | `GET /api/tickets/:id` for a Ticket whose owning Requester is deactivated after creation | 404 (BR-38), same as any other ownership failure | `server/tests/lab-02/ticket-detail.api.test.ts` | Pass |
| API-20 | API | AC-22 | `GET /api/attachments/:id`, `GET /api/attachments/:id/download`, `DELETE /api/attachments/:id`, and `POST /api/tickets/:id/attachments` for a deactivated Requester's own Ticket/attachment | All four return 404 (BR-38) | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| API-21 | API | AC-23 | 5 concurrent `POST /api/tickets/:id/attachments` requests (1 file each) against a Ticket already at 4 active attachments | Exactly 1 succeeds (201), 4 rejected with `MAX_ATTACHMENTS_EXCEEDED`; active count never exceeds 5 (BR-39) | `server/tests/lab-02/attachments.api.test.ts` | Pass |
| UI-01 | UI | BR-13, BR-16 | Create Ticket form: required-field asterisks render; Submit disabled until required fields are valid | Asterisks present on Category/Related System/Priority/Summary/Description; Submit `disabled` attr reflects validity | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-02 | UI | AC-04 | Submit with Summary empty | Field-level error shown under Summary; no `fetch`/API call made | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-03 | UI | AC-10 | Click Submit, then click again before the first request resolves | Submit shows busy state and is `disabled` on the second click; only one POST is sent | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-04 | UI | AC-07, AC-08, AC-09 | Select an oversized file, a wrong-type file, and a 6th file with 5 already selected | Each shows its own inline error; other valid files remain in the list and selectable | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-05 | UI | BR-18, BR-19 | Mock `POST /api/tickets` to fail after filling the form | Error banner shown; all entered field values remain in the form unchanged | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-06 | UI | AC-01 | Mock a successful create response | Success panel shows the returned `ticketNumber` and a "View Ticket" action | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-16 | UI | AC-06 | Mock `GET /api/categories` (or related-systems/requesters) to fail | Full-form failure banner with Retry shown; Submit is not rendered | `client/tests/lab-02/CreateTicket.test.tsx` | Pass |
| UI-07 | UI | AC-21 | Mock `GET /api/tickets` returning `data: []` with no search/filter params sent | "Create your first ticket" empty state shown, filters hidden | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| UI-08 | UI | AC-12 | Mock `GET /api/tickets` returning `data: []` while a search/filter is active | "No tickets match your filters" no-results state shown, filters remain visible, Clear Filters shown | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| UI-17 | UI | AC-13 | Mock a multi-page result set | Pagination controls render with correct page count; clicking Next requests the next page | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| UI-09 | UI | AC-18 | Trigger "Change Requester" while My Tickets is loaded | Previously rendered rows are cleared before the new Requester's data loads (no stale flash of old data) | `client/tests/lab-02/MyTickets.test.tsx` | Pass |
| UI-10 | UI | handout §8.5 scope | Render Ticket Detail with mock data | No Public Comments, Internal Notes, Actions Taken, or status-change control is present in the DOM | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| UI-11 | UI | AC-14 | Add a valid attachment via the Ticket Detail Add Attachment control | New attachment appears in the active list immediately after the mocked response resolves | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| UI-12 | UI | AC-15 | Click Remove on an active attachment | Reason prompt appears; Confirm disabled until 5–200 chars entered; on success the row updates to removed state without a full reload | `client/tests/lab-02/AttachmentSection.test.tsx` | Pass |
| UI-13 | UI | BR-30 | Render an attachment with `isRemoved: true` | Row is visually muted, shows "Removed" tag + reason/date, Download/Remove replaced by a disabled "Unavailable" control (not a clickable disabled-looking one) | `client/tests/lab-02/RequesterTicketDetail.test.tsx` | Pass |
| UI-14 | UI | AC-17 | Mock `GET /api/requesters` returning `[]` | Empty-state message shown; Continue stays disabled | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| UI-15 | UI | AC-02 | Render the app shell with no current Requester selected, attempt to reach `/tickets`, `/tickets/new`, or `/tickets/:id` | Redirected to the Requester Selection screen in all three cases | `client/tests/lab-02/RequesterSelection.test.tsx` | Pass |
| STYLE-01 | UI style | ui-spec §7 | Render each `requestedPriority`/`currentStatus` value through the Badge component | Correct color class **and** correct text content for every value (never color-only) | `client/tests/lab-02/Badges.test.tsx` | Pass |
| RESP-01 | Responsive/visual | AC-19 | Playwright screenshot of Create Ticket, My Tickets, Ticket Detail at 375px, 768px, 1280px | Screenshots saved per `ui-spec.md` §13 paths; no horizontal scrollbar detected (`document.documentElement.scrollWidth <= clientWidth`) at any width | `e2e/lab-02/responsive-visual.spec.ts` | Pass |
| E2E-01 | E2E | AC-01, AC-14, AC-15 | Select a Requester → create a Ticket with one attachment → confirm success panel → open Ticket Detail → remove the attachment | Ticket Number shown at each step matches; attachment list reflects add then remove | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |
| E2E-02 | E2E | AC-03, AC-11, AC-18 | As Requester A, create a Ticket; switch to Requester B via Change Requester; attempt to open Requester A's Ticket by URL | Requester A's ticket does not appear in Requester B's My Tickets; direct URL access shows "Ticket not found", not the data | `e2e/lab-02/requester-ticket-flow.spec.ts` | Pass |

## 3. Acceptance-Criterion Traceability

| AC | Covered by |
|---|---|
| AC-01 | API-01, UI-06, E2E-01 |
| AC-02 | UI-15 |
| AC-03 | API-09, E2E-02 |
| AC-04 | API-02, UI-02 |
| AC-05 | API-02, UI-05 |
| AC-06 | UI-16 |
| AC-07 | UNIT-03, API-11, UI-04 |
| AC-08 | UNIT-03, API-12, UI-04 |
| AC-09 | UNIT-03, API-13, UI-04 |
| AC-10 | UI-03 |
| AC-11 | API-04, E2E-02 |
| AC-12 | API-06, UI-08 |
| AC-13 | API-07, UI-17 |
| AC-14 | API-10, UI-11, E2E-01 |
| AC-15 | API-14, UI-12, E2E-01 |
| AC-16 | API-15 |
| AC-17 | UI-14 |
| AC-18 | UI-09, E2E-02 |
| AC-19 | RESP-01 |
| AC-20 | API-16 |
| AC-21 | UI-07 |
| AC-22 | API-19, API-20 |
| AC-23 | API-21 |

Every AC has at least one covering test; the higher-risk ones (ownership, attachment lifecycle, duplicate-submission) are covered at more than one level on purpose.

## 4. Responsive and Visual Checklist

Executed via `RESP-01` plus manual confirmation against `docs/lab-02/ui-spec.md` §12's checklist. Every box below was checked against the generated screenshots under `artifacts/lab-02/screenshots/`, not from memory.

- [x] Colors match the token table (no ad-hoc hex in component code). Verified by grepping `client/src` for hex literals in `.tsx`: none; every colour comes from `zen-green.css` tokens.
- [x] Editable vs read-only fields are visually distinct. `create-ticket/initial-desktop.png` and `ticket-detail/loaded-desktop.png`: read-only fields render on `--color-field-readonly-bg`, editable fields on white with the `--color-field-editable-border`.
- [x] Required-field asterisks + inline validation messages present per field. `create-ticket/validation-error-desktop.png`: red asterisks on all five required fields, and the Summary/Description messages sit directly under their own field, not only at the top.
- [x] Button hierarchy consistent across Create Ticket, My Tickets, Ticket Detail. Primary (`View Ticket`, `+ Create Ticket`) is solid `--color-primary`; secondary (`Cancel`, `Back to My Tickets`) is outlined; destructive (`Remove`) is outlined in `--color-error`; disabled renders at 50% opacity.
- [x] Priority/status badges use the fixed color+text mapping everywhere. Rendered through the shared `Badge` component only, asserted per value by `STYLE-01`.
- [x] No clipping/overlap/unintended horizontal scroll at 375px, 768px, 1280px. `RESP-01` asserts `document.documentElement.scrollWidth <= clientWidth` on all three screens at all three widths.
- [x] My Tickets is a table ≥992px and a card list <768px, no missing information. `my-tickets/loaded-{desktop,tablet,mobile}.png`; `RESP-01` asserts the table is hidden and the card list visible at 375px.
- [x] Empty vs no-results vs failure states are visually distinguishable. `my-tickets/empty-desktop.png` ("haven't submitted any tickets yet" + Create Ticket), `no-results-desktop.png` ("No tickets match your filters" + Clear Filters, toolbar retained), `failure-desktop.png` (error callout + Retry).
- [x] Removed attachments are genuinely disabled, not just styled to look disabled. `ticket-detail/attachment-removed-desktop.png`: the Download control is not rendered at all (`E2E-01` asserts `toHaveCount(0)`), replaced by a plain "Unavailable" label, and the backend independently returns 410 (`API-15`).

## 5. Test Commands

```bash
# Server: unit + API tests (Vitest + Supertest)
cd server && npm test

# Server: Lab 2 tests only
cd server && npx vitest run tests/lab-02

# Client: UI component tests (Vitest + Testing Library)
cd client && npm test

# Client: Lab 2 tests only
cd client && npx vitest run tests/lab-02

# E2E + responsive/visual (Playwright). Starts the API and client dev servers
# itself; the Postgres container must already be running, migrated, and seeded.
npm install                 # once, at the repo root
npx playwright install chromium   # once, downloads the browser
npx playwright test
```

`@playwright/test` is a new dependency for Lab 2 (see `specification.md` §11 Assumptions). The root `package.json` and `playwright.config.ts` hold it; the config's `testDir` is `e2e/lab-02` and its `webServer` block boots both dev servers, so no separate terminal is needed. Note the servers are bound to `127.0.0.1` rather than `localhost` on purpose: Vite otherwise binds only the IPv6 loopback, which the config cannot reach.

## 6. Final Results

| Suite | Command | Pass/Fail | Notes |
|---|---|---|---|
| Server unit + API | `cd server && npm test` | Pass | 12 files, 80 tests, 0 skipped |
| Client UI | `cd client && npm test` | Pass | 7 files, 39 tests, 0 skipped |
| E2E + responsive | `npx playwright test` | Pass | 9 tests total: the 5 planned tests below, plus 4 supplementary evidence captures |

The 5 planned tests in the table above are E2E-01, E2E-02, and RESP-01
across its 3 screens, in `e2e/lab-02/requester-ticket-flow.spec.ts` and
`e2e/lab-02/responsive-visual.spec.ts`. Those two files are the graded
suite: they are idempotent and pass whether the database is freshly seeded
or already holds Tickets from an earlier run.

`npx playwright test` also picks up `e2e/lab-02/submission-evidence.spec.ts`,
whose 4 tests are not planned tests and have no row in §2's traceability
table. They exist only to capture screenshots the submission PDF requires
(handout §14 Parts 6-8) beyond what the planned tests already produce, so
the total the command reports is 9, not 5. Unlike the graded suite, that
file seeds an exact number of Tickets and asserts exact counts, so rerunning
it without first clearing Tickets and Attachments will fail its totals; see
the comment at the top of the file.

Confirmed from `main` on 2026-09-05 against a migrated and seeded local
database. The Playwright run starts the API and client dev servers itself
(see `playwright.config.ts`).

## 7. Known Limitations or Deferred Tests

- Load/performance testing is out of scope for Lab 2 (not required by the handout).
- Cross-browser testing is limited to Playwright's default Chromium project; Firefox/WebKit runs are not required for Lab 2.
- Duplicate-submission prevention (BR-17) is tested only client-side (UI-03); per `specification.md` §5, the backend intentionally does not deduplicate identical payloads in Lab 2, so no server-side idempotency test exists. This is a documented, not accidental, gap.
