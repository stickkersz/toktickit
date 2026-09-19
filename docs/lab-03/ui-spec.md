# Lab 3 Zen Green UI Specification

Companion to `docs/lab-03/specification.md`. Lab 3 adds screens to an existing design system; it does not start a new one. Every token, field convention, button hierarchy, feedback pattern, responsive rule, and accessibility expectation fixed in `docs/lab-02/ui-spec.md` sections 1 through 4 and 10 through 11 remains in force and is not restated here. This document covers only what is new or changed.

## 1. Reused foundation

- Color tokens: unchanged, `docs/lab-02/ui-spec.md` section 1. No new color is introduced. New surfaces reuse `--color-primary`, `--color-secondary`, `--color-pale`, `--color-surface`, `--color-error`, `--color-warning`, and `--color-success`.
- Typography, spacing, field states, button hierarchy, and validation placement: unchanged, sections 2 and 3.
- No ad-hoc hex value appears in any Lab 3 component. Anything that needs a color uses a token.

## 2. New badges

Badges keep the Lab 2 shape (`.zg-badge`, 12px/600, color plus text, never color alone).

| Badge | Values and treatment |
|---|---|
| Ticket Status | `NEW` pale green, `OPEN` primary-tinted, `IN_PROGRESS` amber, `WAITING_FOR_REQUESTER` amber outline, `RESOLVED` success green, `CLOSED` neutral grey, `REOPENED` warning, `CANCELLED` muted grey with strikethrough-free plain text |
| Requested Priority | unchanged from Lab 2 |
| IT Priority | same three values, same color mapping as Requested Priority, distinguished by its column or field label rather than by a different palette, so one priority vocabulary is learned once |
| Role | `REQUESTER`, `IT Staff`, `Administrator` as neutral outline badges, used in the user list and beside a comment author |

Every status badge carries its full text label. A Requester and an IT Staff member reading the same Ticket see the same status wording.

## 3. Application shell and role navigation

The Lab 2 header keeps its 56px height, `--color-primary` background, and TokTickIT wordmark.

- The Development Requester display and the Change Requester action are **removed** and replaced by the authenticated user's name with their role badge, and a Logout action, in the same right-hand Profile position.
- Navigation is role-specific, and a destination the role may not use is never rendered:

  | Role | Nav items |
  |---|---|
  | Requester | My Tickets, Create Ticket |
  | IT Staff | Ticket Queue |
  | Administrator | Ticket Queue, Users |

- Active-item marking and `aria-current="page"` follow the Lab 2 rule, extended so that a Ticket Detail route marks its parent list as active: `/tickets/:id` keeps My Tickets active for a Requester, `/staff/tickets/:id` keeps Ticket Queue active for IT Staff.
- Below 768px the nav collapses to the existing hamburger panel. The user identity and Logout move inside that panel, and it closes on selection or outside tap.
- **Direct URLs are protected too (BR-63, AC-46).** A signed-in user who opens a screen their role does not permit, by typing or bookmarking its URL, gets the forbidden state instead of the screen: "You do not have access to the Ticket Queue.", "You do not have access to User Management.", or, for the Requester screens (My Tickets, Create Ticket, Ticket Detail) seen by IT Staff or an Administrator, "You do not have access to Requester tickets.". It replaces the screen entirely, offers a "Go to your home screen" link, and nothing the screen would have fetched is requested. A signed-out visitor is sent to Login, and an unknown URL goes to the signed-in user's own landing route.
- The shell renders only after the current user is known. While the identity request is in flight, neither navigation nor a redirect is shown, so the application never flashes the wrong role's menu.

## 4. Login screen

Route `/login`. Single centered card, approximately 420px wide on desktop, full width with 16px side padding on mobile. The only screen reachable with no session.

1. TokTickIT wordmark and a clock glyph.
2. Heading "Sign in to your account".
3. `Email address *`, type `email`, autofocus.
4. `Password *`, type `password`, with a show/hide toggle carrying an `aria-label` and `title`.
5. Primary full-width "Sign In" button.

States:

- **Initial**: both fields empty, Sign In enabled. Client-side validation runs on blur and on submit.
- **Validation error**: per-field message directly under the field, in `--color-error`, for a missing email, a malformed address, or a missing password. No API call is made.
- **Busy**: Sign In disabled and showing a busy label for the duration of the request, so a double click cannot produce two sessions.
- **Failure**: an `--color-error-bg` callout above the fields reading "Invalid email or password. Please try again." The email value is preserved, the password field is cleared. This same message covers both an unknown address and a wrong password.
- **Inactive account**: a distinct `--color-warning-bg` callout reading "This account is inactive. Contact an administrator." Shown only when credentials were correct.
- **API failure**: an error callout reading "Unable to sign in right now. Please try again." with a Retry affordance, distinguishable from a credential failure.

There is no "Forgot password" link: password reset by email is excluded from Lab 3, and a link that leads nowhere is worse than no link.

## 5. Change Password screen

Route `/change-password`. Reached automatically after signing in with an initial password, and reachable voluntarily from the Profile menu.

1. Heading "Change Your Password". When mandatory, a subheading reads "You must change your password to continue."
2. `Current (temporary) password *`, `New password *`, `Confirm new password *`, each with a show/hide toggle.
3. A rule checklist below the new-password field, each rule showing an unmet or met state live as the user types: at least 8 characters, upper and lower case letters, a number, a special character.
4. Primary "Continue" button.

States: initial, per-field validation error, busy, API failure with values preserved, and success which navigates straight to the role's landing screen.

While the change is mandatory, the shell renders the user identity and Logout but **no navigation items**, and any other route redirects back here. The checklist is text plus an icon, never color alone.

## 6. Requester screens

My Tickets and Create Ticket keep their Lab 2 layouts exactly. The Requester Selection screen is deleted.

Requester Ticket Detail gains, below the existing read-only fields and Attachments panel:

- A **Public Comments** panel: a chronological list, oldest first, each entry showing author name, role badge, timestamp, and body; plus an "Add Public Comment" textarea with a character counter and a primary "Post Comment" button. Empty state reads "No comments yet."
- A **Resolution Summary** field, read-only, shown only once populated.
- A secondary **"Problem appears resolved"** button, with a confirmation step, disabled with an explanatory tooltip once the Ticket is `CLOSED` or `CANCELLED`. After use, an inline confirmation shows when the indication was sent. The Ticket status badge visibly does not change, which is the point of the interaction.

Nothing on this screen lets a Requester change status, owner, or IT Priority, and the API refuses those operations regardless.

## 7. IT Staff Ticket Queue

Route `/staff/tickets`. The working surface for IT Staff and Administrators.

Toolbar: a search box ("Search by ticket number or summary"), and filters for Status, IT Priority, Category, and Owner, where Owner offers "Anyone", "Unassigned", "Assigned to me", and "Needs an owner". "Needs an owner" lists open Tickets that are unassigned or whose owner is inactive or no longer IT Staff (BR-59). One filter row, wrapping on narrow viewports. A result count reads "Showing 1 to 10 of 87 tickets".

Desktop table at 992px and above, columns: Ticket No., Created Date, Summary, Category, Req. Priority, IT Priority, Status, Owner. Ticket No., Created Date, IT Priority, and Status are sortable, each header showing its sort state through `aria-sort` and a caret. An unassigned Ticket shows a muted "Unassigned" rather than an empty cell. A Ticket whose owner is no longer eligible keeps the owner's name, followed by a muted "(inactive)" or "(not IT Staff)" marker and a "Needs new owner" badge, so the row is never mistaken for a healthy assignment (BR-56, BR-59). The marker is text plus the badge, never color alone. A row opens Ticket Detail by click, by Enter, or by Space.

The column set is deliberately capped at eight. Requester, Related System, and Last Updated are available on the detail screen; adding them here would produce the unreadable mega-grid the handout warns against, and Summary is the column that most needs the width.

Tablet 768 to 991px: Category and Req. Priority drop out, leaving six columns.
Mobile below 768px: a card list. Each card leads with Ticket No. and Status, then Summary on its own line, then Category, IT Priority, and Owner as label-value pairs.

Pagination sits below the list, 10 per page, with Previous and Next plus numbered pages.

States: loading (before the first successful load only), loaded, empty ("No tickets in the queue yet."), no results ("No tickets match these filters." with a Clear filters action), forbidden (shown if a Requester somehow reaches the route: "You do not have access to the Ticket Queue."), and failure (error callout plus Retry, with the toolbar still mounted so filters can be adjusted or retried).

After the first successful load the toolbar stays mounted permanently and updates in place, and every request carries a sequence guard so a slower earlier response can never overwrite a newer one. Both rules are carried over from defects found in Lab 2.

## 8. IT Staff Ticket Detail

Route `/staff/tickets/:id`. Extends the Lab 2 Ticket Detail layout rather than replacing it. A breadcrumb reads "Ticket Queue > Ticket Detail" with a "Back to Queue" action that returns to the queue with its search, filters, sort, and page intact.

Read-only field group, styled with `--color-field-readonly-bg` and kept keyboard-reachable with `readOnly` rather than `disabled`: Ticket No., Category, Related System, Requester, Requested Priority, Created Date, Summary, Description. A Requester whose account is inactive is shown with a muted "(inactive)" marker after the name (BR-60).

Operational field group, visibly editable with `--color-field-editable-border`:

- **Ticket Owner**: a select of active IT Staff and Administrators, plus an Unassigned option, and a "Claim" shortcut button shown while the Ticket is unassigned or its owner is ineligible. An ineligible current owner stays visible as the selected value with its "(inactive)" or "(not IT Staff)" marker and a "Needs new owner" badge, but is not offered as a choice for any other Ticket (BR-18, BR-58).
- **IT Priority**: a select of the three priority values.
- **Current Status**: a select offering only the statuses BR-25 permits from the current one. A disallowed status is never rendered as a choice, and the server rejects it too. Changing to Resolved reveals a required Resolution Summary textarea and a confirmation step before saving.

A Ticket showing the Requester's "problem appears resolved" indication displays a `--color-pale` banner with the timestamp, so staff see the signal without it being mistaken for a status.

Panels below, as labelled tabs with counts: **Public Comments**, **Internal Notes**, **Attachments**. The Attachments panel arrives first, as its own section, with the Issue that delivers this screen; Public Comments and Internal Notes join it as tabs with the Issue that delivers them.

Public Comments and Internal Notes must be impossible to confuse. Internal Notes use a distinct `--color-warning-bg` tinted panel, a lock glyph, and a standing label reading "Internal only. Not visible to the Requester." above its composer. Public Comments use the plain surface background. The two composers never appear simultaneously: only the active tab's composer is rendered, so a note cannot be typed into a comment box by accident.

Attachments render as in Lab 2 for reading: each row shows its metadata and a Download action, and a removed Attachment shows its removal reason with no Download action. The upload control and every Remove control are not rendered at all for IT Staff and Administrators, not merely disabled, since Attachment mutation stays a Requester capability (BR-54, BR-55). The API refuses both operations with 403 regardless of what the client renders.

States: loading, loaded, not found ("Ticket not found."), forbidden, saving (the affected control disabled and busy, others still usable), per-operation success (an inline confirmation next to the control that changed, not a page-level banner), validation error, conflict (a distinct callout for a rejected transition, naming what is permitted from the current status), and API failure with the prior value restored.

## 9. Administrator User Management

Route `/admin/users`. A two-pane layout on desktop: the user list on the left, a create or edit panel on the right. On mobile the panel takes over the full width and the list is hidden while it is open.

List: a search box ("Search users..."), an optional Role filter, a "Create User" primary button, and a table with Name, Email, Role, Status, and an Edit action. Role and Status render as badges. There is no pagination and no multi-column sorting, both excluded by the handout.

Create and edit panel fields: `Full Name *`, `Email Address *`, `Role *` as a single select of the three roles, `Active` as a labelled toggle, and an Initial Password section. In create mode the Initial Password is required. In edit mode it is a separate "Set new initial password" action, with helper text reading "The user must change this password at their next login."

Feedback this screen must make unmissable:

- Duplicate email: an inline field error reading "That email address is already in use."
- Self-deactivation: the Active toggle is disabled on the Administrator's own row with a tooltip reading "You cannot deactivate your own account."
- Last active Administrator: attempting to deactivate or to change the role of the only remaining active Administrator shows an error callout reading "At least one active Administrator is required." and no change is saved.
- Forbidden: a non-Administrator reaching the route sees "You do not have access to User Management." and no user data at all.

No screen offers a delete action, because Users are never deleted.

## 10. Screen modes and user feedback

Lab 3 modes: **authenticate** (Login, Change Password), **view** (Ticket Queue, both Ticket Details, user list), **create** (Create Ticket, Create User), and **edit** (user edit, and the operational fields of IT Staff Ticket Detail).

Every mode uses the shared Lab 2 patterns for processing, validation, success, empty, no-results, forbidden, not-found, conflict, and safe API failure. No screen invents its own spinner, error color, or badge shape. Forbidden and not-found are visually distinct from each other and from a failure: one says you may not, one says it is not here, one says something went wrong and offers Retry.

## 11. Responsive rules

As Lab 2 section 10, with two additions: the queue table narrows to six columns at tablet and becomes a card list below 768px, and the User Management two-pane layout collapses to a single pane. Buttons stay at least 44px tall on touch. No horizontal page scroll at 375px, 768px, or 1280px on any screen.

## 12. Accessibility

As Lab 2 section 11, with these Lab 3 specifics:

- The password show/hide toggle is a real button with an `aria-label` that reflects its current action, and it never removes the field's label.
- The password rule checklist is announced as a list, with each rule's met state conveyed by text and icon, not color.
- Sortable queue headers keep their native `columnheader` role. They are made operable with `tabIndex` and an Enter and Space handler, and `role="button"` is never placed on a `th`.
- Status, priority, and role badges pair color with text everywhere.
- The Internal Notes warning is text, not color alone.
- Focus moves to the first field of the create or edit panel when it opens, and returns to the triggering control when it closes.
- Read-only fields use `readOnly`, keeping them keyboard-reachable, never `disabled`.

## 13. Visual inspection checklist

Run against the running app and the captured screenshots before any screen is marked Done:

- [ ] Colors match the Lab 2 tokens exactly; no ad-hoc hex value in any Lab 3 component.
- [ ] Every token referenced in this document is actually applied somewhere, verified by grep, not assumed.
- [ ] Editable and read-only fields are distinguishable at a glance on IT Staff Ticket Detail.
- [ ] Public Comments and Internal Notes are impossible to confuse, and the internal-only warning is visible without scrolling the panel.
- [ ] Each role sees only its permitted navigation, and the active item is marked on every route including detail routes.
- [ ] Status, IT Priority, Requested Priority, and Role badges use their fixed text plus color mapping everywhere they appear.
- [ ] The status select offers only permitted transitions from the current status.
- [ ] On the IT Staff Attachments tab there is a Download action and no upload or Remove control.
- [ ] A Ticket with an inactive or non-staff owner shows the owner's name, the marker, and the "Needs new owner" badge in both the queue and the detail, and appears under the "Needs an owner" filter.
- [ ] No clipped labels, overlapping validation messages, or horizontal scrolling at 375px, 768px, and 1280px.
- [ ] The queue renders as a table at 992px and as cards below 768px with no information lost.
- [ ] Empty, no-results, forbidden, not-found, and failure states are visually distinguishable, not merely differently worded.
- [ ] Login shows a credential failure and an inactive-account response differently.
- [ ] Administrator safety rules surface as clear messages rather than silent no-ops.

## 14. Screenshot paths

Playwright writes Lab 3 screenshots under `artifacts/lab-03/screenshots/`, one subfolder per screen group, one file per state and viewport, matching handout section 12:

```
artifacts/lab-03/screenshots/
├── authentication/
│   ├── login-initial-desktop.png
│   ├── login-validation-error-desktop.png
│   ├── login-invalid-credentials-desktop.png
│   ├── login-inactive-account-desktop.png
│   ├── change-password-initial-desktop.png
│   ├── change-password-rules-unmet-desktop.png
│   ├── login-initial-tablet.png
│   └── login-initial-mobile.png
├── staff-queue/
│   ├── loaded-desktop.png
│   ├── filtered-desktop.png
│   ├── no-results-desktop.png
│   ├── failure-desktop.png
│   ├── loaded-tablet.png
│   └── loaded-mobile.png
├── staff-ticket-detail/
│   ├── loaded-desktop.png
│   ├── claimed-desktop.png
│   ├── internal-notes-desktop.png
│   ├── invalid-transition-desktop.png
│   ├── resolved-desktop.png
│   ├── loaded-tablet.png
│   └── loaded-mobile.png
└── user-management/
    ├── list-desktop.png
    ├── create-panel-desktop.png
    ├── duplicate-email-desktop.png
    ├── last-administrator-desktop.png
    ├── forbidden-desktop.png
    ├── list-tablet.png
    └── list-mobile.png
```

These paths are referenced from `docs/lab-03/tests.md` and from the submission PDF's Part 9 evidence.
