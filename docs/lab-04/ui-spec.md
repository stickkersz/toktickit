# Lab 4 Zen Green UI Specification

Companion to `docs/lab-04/specification.md`. Lab 4 extends the existing design system; it does not start a new one. Every token, field convention, button hierarchy, feedback pattern, responsive rule, and accessibility rule in `docs/lab-02/ui-spec.md` and `docs/lab-03/ui-spec.md` remains in force and is not restated. This document covers only what is new or changed.

## 1. Reused foundation

- Color tokens: unchanged. No new color is introduced; every new surface uses the existing tokens (`--color-primary`, `--color-secondary`, `--color-pale`, `--color-surface`, `--color-error`, `--color-warning`, `--color-success`, and their `-bg` variants). No ad-hoc hex value appears in any Lab 4 component.
- Typography, spacing, field states, buttons, validation placement, red asterisk (`.zg-required`), read-only fields (`readOnly`, `--color-field-readonly-bg`), editable fields (`--color-field-editable-border`), tabs (WAI-ARIA tabs pattern), focus ring, and the feedback callouts: unchanged and reused.
- Existing components are reused rather than copied: status and priority badges, `Tabs`, `ContentPanel`, `RequiredMark`, the queue table and card patterns, the error callout with Retry, and the forbidden screen.

## 2. New badges

Same `.zg-badge` shape, 12px/600, text plus color, never color alone.

| Badge | Values and treatment |
|---|---|
| Action Status | `Planned` primary outline, `Completed` success green, `Cancelled` muted grey with the word "Cancelled" |
| Follow-up | `Follow-up needed` warning outline, shown only when Follow-Up Required is yes |
| No longer eligible | `Not active` muted marker after a Responsible Staff name, as for an Ineligible Owner in Lab 3 |

A Planned Action and a Completed Action are distinguishable in greyscale by their badge text.

## 3. Application shell and navigation

- **Dashboard** becomes the first navigation item for every role and the landing page after sign-in and after a mandatory password change (FR-14):

  | Role | Nav items | Landing route |
  |---|---|---|
  | Requester | Dashboard, My Tickets, Create Ticket | `/dashboard` |
  | IT Staff | Dashboard, Ticket Queue | `/staff/dashboard` |
  | Administrator | Dashboard, Ticket Queue, Users | `/staff/dashboard` |

- Active marking and `aria-current="page"` follow Lab 3; the Dashboard item is marked on its route only.
- A Requester opening `/staff/dashboard`, or IT Staff or an Administrator opening `/dashboard`, sees the forbidden state "You do not have access to this dashboard." with "Go to your home screen", and no dashboard data is requested (`L3-BR-63`).
- Unknown URLs and `/` go to the role's landing route.

## 4. IT Staff Dashboard

Route `/staff/dashboard`. Heading "Dashboard" with the subheading "Your work and the queue at a glance". Data from `GET /api/dashboard/staff`.

Layout, top to bottom:

1. **Metric cards row**: Unassigned, My Tickets, Urgent. Each card is one link: label (14px/600), value (32px/700, `--color-primary`), and a one-line description ("Tickets not yet closed or cancelled that have no active owner", "Active tickets you own", "Active tickets with IT Priority High"). The whole card is the link target, with an accessible name such as "Unassigned: 4 tickets. View in the Ticket Queue". Value 0 shows "0" and the description changes to the empty sentence, for example "No tickets need an owner".
2. **My Planned Actions** panel: heading with the count, then up to 5 rows, each showing the Ticket Number, the Action Description cut to one line, the Action Date/Time, and "Overdue" text plus a warning badge when the Action Date/Time is in the past. Each row links to `/staff/tickets/:id?tab=actions`. Empty sentence: "You have no planned actions."
3. **By status** row: eight compact chips, each with its status badge and count, each a link to the queue filtered to that status. Zero counts stay visible.
4. **Recently updated** panel: up to 5 Tickets with Ticket Number, Summary, status badge, and last activity ("2 hours ago" with the full Asia/Bangkok date and time as `title` and visually hidden text). Empty sentence: "No ticket activity yet."
5. **Accounts** card, Administrator only: active Requesters, IT Staff, Administrators, and inactive users, linking to `/admin/users`.

Responsive: at 1280px the metric cards sit three across and the two panels side by side; at 768px the cards three across and the panels stacked; below 768px everything is one column and the status chips wrap. No horizontal scroll at any width.

States: loading (card skeletons with the labels visible and the values replaced by a neutral placeholder bar, `aria-busy="true"`), loaded, empty per card (above), forbidden, and failure (error callout "The dashboard could not be loaded." with Retry; no stale numbers are shown as current).

## 5. Requester Dashboard

Route `/dashboard`. Heading "Dashboard" with "Your tickets at a glance". Data from `GET /api/dashboard/requester`.

1. **Metric cards row**: Open ("Tickets IT is still working on"), Waiting for you ("Tickets waiting for your reply"; when above 0 the card has a `--color-warning-bg` tint and the text "Needs your attention"), Recently updated ("Updated in the last 7 days"), Recently resolved ("Resolved in the last 30 days"). Each card links to My Tickets filtered (BR-36).
2. **Recently updated** list: up to 5 Tickets, as on the IT Staff Dashboard, each opening `/tickets/:id`.
3. **Recently resolved** list: up to 5 Tickets with the resolution date.
4. A primary "Create Ticket" button, so the most common next step is one click away.

It never repeats the full My Tickets table (handout section 8.2). Empty sentences: "You have no open tickets.", "Nothing is waiting for you.", "No updates in the last 7 days.", "Nothing resolved in the last 30 days."

Responsive and states: as section 4.

## 6. Drill-down targets

- **Ticket Queue** reads `owner`, `itPriority`, `status`, `statusGroup`, and `sort` from the URL on load, shows the matching filters as selected, and shows a removable "Active tickets only" chip when `statusGroup=active` is set. Clear filters removes it.
- **My Tickets** now reads `status`, `statusGroup`, `updatedWithinDays`, `resolvedWithinDays`, and `sort` from the URL the same way, shows a status filter offering all eight statuses plus "Active" and "Resolved or closed", shows a removable chip such as "Updated in the last 7 days" or "Resolved in the last 30 days" for a window, and adds "Last updated" to its sort options.
- A dashboard figure and the list it opens always agree, because both use the same server rule (AC-31, AC-32).

## 7. Actions Taken on IT Staff Ticket Detail

Route `/staff/tickets/:id`, tab **Actions Taken (n)** placed first in the Lab 3 tab list, before Public Comments, Internal Notes, and Attachments. `?tab=actions` opens it directly.

Above the list, a standing line: "Actions Taken are visible to the Requester. Use an Internal Note for anything private." with an information glyph.

### List mode

- Desktop at 992px and above: a table with columns Action Date/Time, Description, Responsible, Status, Follow-up, Performed By. Rows ordered as BR-16. A row opens view mode by click, Enter, or Space, with the Zen Green row focus outline.
- Tablet 768 to 991px: Performed By drops into the expanded view.
- Mobile below 768px: one card per Action: status badge and Action Date/Time first, Description, then Responsible and Follow-up as label-value pairs.
- A primary "Add Action" button above the list, shown only while the Ticket is workable (BR-14). On a Resolved, Closed, or Cancelled Ticket it is replaced by the text "Actions cannot be added to a Resolved, Closed, or Cancelled ticket. Reopen it to add work." 
- Empty sentence: "No actions recorded yet."

### Create mode

An inline form opens above the list and focus moves to its first field:

- `Action Date/Time *`: date and time input, default now, shown in Asia/Bangkok.
- `Action Description *`: textarea with a counter, 5 to 2000.
- `Responsible Staff *`: select of active IT Staff and Administrators from `GET /api/staff/owners`, default the current user.
- `Follow-Up Required`: a labelled checkbox.
- `Follow-Up Note *`: shown, required, and given its red asterisk only while Follow-Up Required is checked; 5 to 1000 with a counter.
- `Attachment Notes`: textarea, optional, up to 1000, helper text "Which file to look at, for example a photo in Attachments."
- Buttons: primary "Save Action", secondary "Cancel" (closes the form after confirming if anything was typed).

Validation runs on blur and on submit, with the message directly under each field. Cancel returns focus to "Add Action"; Discard in edit mode returns focus to the Action's row. While saving, Save shows "Saving..." and is disabled; the request carries one `Idempotency-Key` per submission (BR-39). On success the form closes, the new Action appears in its ordered place, focus moves to it, and an inline confirmation "Action added." shows above the list. On failure everything typed stays.

### View and edit mode

Selecting an Action expands it into a detail panel:

- Read-only group: Recorded By and Recorded at, Last Edited By when it differs, and for a final Action, Performed By and Completed at, or Cancelled By, Cancelled at, and the reason.
- For a **Planned** Action: the same fields as create mode, shown read-only first, with actions "Edit", "Complete", and "Cancel Action". Edit turns the fields editable in place and shows "Save Changes" and "Discard"; Save stays disabled until something changed.
- For a **Completed** or **Cancelled** Action: every field read-only, no actions, and the text "This action is final and cannot be changed."
- A Responsible Staff member who is no longer eligible shows the name with the "Not active" marker; in edit mode the select keeps them visible as the current value but offers only active staff as new choices.

### Complete and Cancel dialogs

Each is a modal dialog with `role="dialog"`, `aria-modal="true"`, a heading that names the Action, focus moved to its first field, focus kept inside while open, Escape and the secondary button closing it, and focus returned to the button that opened it.

- **Complete Action**: `Result *` (5 to 2000, counter), `Action Date/Time *` defaulting to the stored value or now if that is in the future, and buttons "Mark as Completed" and "Keep Planned". Helper text: "Once completed, this action cannot be changed."
- **Cancel Action**: `Reason *` (5 to 500) and buttons "Cancel Action" and "Keep Action".

### Conflicts

- `STALE_ACTION`: a conflict callout inside the open form, "Someone else changed this action. The latest version is shown below; your changes are still in the form.", showing the server's current values beside the form's, with "Use my changes" (resends against the new version) and "Discard my changes".
- `ACTION_FINAL`: the form closes, the Action reloads as final, and the callout says "This action is already completed or cancelled." with who did it and when, taken from the reloaded Action (a retried request after a lost response lands here too).
- `TICKET_NOT_WORKABLE`: the callout says the Ticket's status changed, and the list and status reload.
- `INVALID_RESPONSIBLE`: an error under Responsible Staff, "Choose an active IT Staff member.", and the staff list reloads.

## 8. Actions Taken on Requester Ticket Detail

Route `/tickets/:id`. A section "Actions Taken" between the Ticket fields and Public Comments: the same table or cards, read-only, every field shown, Cancelled Actions labelled with their reason, no Add, Edit, Complete, or Cancel control anywhere. Empty sentence: "IT has not recorded any actions yet."

## 9. Status History

Both Ticket Details gain a **History** section (IT Staff: a tab after Attachments; Requester: a section after Public Comments). It is a vertical list, oldest first: for each entry the new status badge, "from" the previous status in text, who made the change, and when; a Resolved entry also shows its Resolution Summary. The first entry reads "Created as New". When `earlierChangesUnrecorded` is true a muted line after it reads "Earlier status changes were not recorded." There is no control to change an entry.

## 10. Ticket workflow feedback

- The status select still offers only the moves the server permits (`permittedNextStatuses`), now sending `fromStatus`.
- When the gate blocks Resolved (`resolutionGate.canResolve` false), Resolved stays in the list but choosing it shows, next to the control, "This ticket cannot be resolved yet: 2 planned actions are still open." or "Record and complete at least one action before resolving." with a link "Go to Actions Taken" that opens the tab. Nothing is sent.
- If the server still refuses with `ACTIONS_INCOMPLETE` or `NO_COMPLETED_ACTION`, the same message is shown from the server's counts and the Ticket reloads.
- `STATUS_CHANGED`: a conflict callout "This ticket moved to In Progress while you were viewing it.", the reloaded status and moves, and any pending Resolve, Close, or Cancel confirmation dropped (`L3-BR-64`). When the current status is already the one the user asked for (a retry after a lost response), the screen shows "Status updated." instead of a conflict.
- After a successful move the status badge in the page header, the summary field group, the History, and the permitted moves all refresh, and an inline "Status updated." confirmation appears next to the control.
- Cancelling a Ticket with Planned Actions says in its confirmation: "Its 2 planned actions will be cancelled too."

## 11. Hardening across screens

- Every create form (Create Ticket, Public Comment, Internal Note, Add Action) disables its submit control while sending, sends one `Idempotency-Key` per submission, and keeps its text after a failure.
- The forbidden, not-found, conflict, empty, and failure states use the Lab 3 components with no screen-specific variants.
- Removed in Lab 4: any leftover Lab 2 or Lab 3 placeholder text, unused navigation targets, and the duplicate React key warning in IT Staff Ticket Detail.

## 12. Responsive rules

As Lab 2 and Lab 3: no horizontal page scrolling at 375px, 768px, or 1280px; touch targets at least 44px tall; tables become cards below 768px; forms one column on mobile. The dashboard grids follow sections 4 and 5. Dialogs take the full width minus 16px side margins on mobile and scroll internally if taller than the viewport.

## 13. Accessibility

As Lab 2 and Lab 3, plus:

- Each metric card is a single link with an accessible name that states the label, the value, and the destination.
- Counts that change after an action are announced through a polite live region ("Action added.", "Status updated.").
- Dialogs follow the WAI-ARIA dialog pattern of section 7.
- Action rows are focusable and operable with Enter and Space, with the Zen Green outline, never the browser's blue.
- Status, Action Status, priority, follow-up, and eligibility are conveyed by text, never color alone.
- Read-only Action fields use `readOnly`, never `disabled`, so they stay reachable.

## 14. Visual and accessibility inspection checklist

Completed against the running app and the captured screenshots before release; each item is ticked only with its evidence recorded in `docs/lab-04/tests.md` section 6.

- [ ] Colors match the Zen Green tokens; no ad-hoc hex in any Lab 4 component; every token used is applied (verified by grep).
- [ ] Dashboard is first in navigation for each role and marked as the current page on its route.
- [ ] Every metric card shows a label, a value, and works as a link by mouse and keyboard; zero values show their empty sentence.
- [ ] Dashboard figures match the drilled-down lists (spot-checked for every card).
- [ ] Actions Taken: Planned, Completed, and Cancelled are distinguishable by badge text; editable and read-only fields are distinguishable at a glance.
- [ ] The Follow-Up Note and its red asterisk appear only when Follow-Up Required is checked.
- [ ] Validation messages sit directly under their fields without overlapping the next field.
- [ ] Complete and Cancel dialogs trap focus, close on Escape, and return focus.
- [ ] Requester Ticket Detail shows Actions Taken and History with no editing control.
- [ ] Shared content (Actions Taken, Public Comments) and private content (Internal Notes) are visually distinct and labelled.
- [ ] The status control offers only permitted moves and explains a blocked Resolve.
- [ ] Keyboard focus is visible everywhere: Zen Green ring, white ring on the green header, Zen Green outline on table rows.
- [ ] No clipped content, overlapping controls, or horizontal scrolling at 375px, 768px, and 1280px.
- [ ] Loading, empty, forbidden, conflict, not-found, and failure states are visually distinct.
- [ ] No console errors or warnings on any screen; no placeholder text, dead link, or control without behaviour.

## 15. Screenshot paths

Playwright writes Lab 4 screenshots under `artifacts/lab-04/screenshots/`, matching handout section 12:

```
artifacts/lab-04/screenshots/
├── staff-dashboard/
│   ├── loaded-desktop.png
│   ├── loaded-tablet.png
│   ├── loaded-mobile.png
│   ├── administrator-desktop.png
│   ├── empty-desktop.png
│   ├── loading-desktop.png
│   ├── failure-desktop.png
│   ├── forbidden-desktop.png
│   ├── drill-down-queue-desktop.png
│   ├── drill-down-queue-tablet.png
│   └── drill-down-queue-mobile.png
├── requester-dashboard/
│   ├── loaded-desktop.png
│   ├── loaded-tablet.png
│   ├── loaded-mobile.png
│   ├── empty-desktop.png
│   ├── failure-desktop.png
│   ├── forbidden-desktop.png
│   ├── drill-down-my-tickets-desktop.png
│   ├── drill-down-my-tickets-tablet.png
│   └── drill-down-my-tickets-mobile.png
└── actions-taken/
    ├── list-desktop.png
    ├── list-tablet.png
    ├── list-mobile.png
    ├── create-desktop.png
    ├── create-tablet.png
    ├── create-mobile.png
    ├── validation-desktop.png
    ├── inactive-responsible-desktop.png
    ├── edit-desktop.png
    ├── complete-dialog-desktop.png
    ├── complete-dialog-tablet.png
    ├── complete-dialog-mobile.png
    ├── cancel-dialog-desktop.png
    ├── stale-conflict-desktop.png
    ├── resolve-blocked-desktop.png
    ├── resolve-blocked-tablet.png
    ├── resolve-blocked-mobile.png
    ├── resolved-history-desktop.png
    ├── resolved-history-tablet.png
    ├── resolved-history-mobile.png
    ├── requester-view-desktop.png
    ├── requester-view-tablet.png
    ├── requester-view-mobile.png
    └── focus-dialog-desktop.png
```

Every major Lab 4 screen (both dashboards, their drill-down targets, the Actions Taken list, create form, Complete dialog, blocked Resolve, Status History, and the Requester view) has a desktop, tablet, and mobile capture. These paths are referenced from `docs/lab-04/tests.md` and the submission PDF's Parts 5 to 9.
