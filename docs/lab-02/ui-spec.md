# Lab 2 Zen Green UI Specification

Companion to `docs/lab-02/specification.md`. Defines the visual system and per-screen layout so the Create Ticket, My Tickets, Ticket Detail, and Development Requester Selection screens can be implemented consistently and checked against a fixed reference rather than memory. Later labs reuse this system rather than inventing a new one.

## 1. Color Tokens

Fixed by the handout §7, not negotiable in Lab 2:

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#006B3C` | App header background, primary button background, strong emphasis text |
| `--color-secondary` | `#0B7A46` | Active nav tab, focus ring accent, links, hover state on secondary/tertiary buttons |
| `--color-pale` | `#EAF6EF` | Selected-row background, success banner background, subtle section headers |
| `--color-bg` | `#F5F7F6` | Page background |
| `--color-surface` | `#FFFFFF` | Cards, panels, table rows, with a 1px `#D9E2DC` border and a restrained `0 1px 2px rgba(0,0,0,0.06)` shadow |
| `--color-text` | `#1B2B23` | Body text (dark charcoal-green, not pure black) |
| `--color-text-muted` | `#5B6B62` | Secondary text (helper text, timestamps, placeholder) |
| `--color-field-editable-bg` | `#FFFFFF` | Editable input background |
| `--color-field-editable-border` | `#C7D2CC` | Editable input border (neutral) |
| `--color-field-readonly-bg` | `#F1F3EF` | Read-only field background (soft gray-green) |
| `--color-error` | `#B3261E` | Error text, error border, error icon |
| `--color-error-bg` | `#FBEAE9` | Error banner/callout background |
| `--color-warning` | `#B8860B` (amber) | Warning callout/badge text; amber background `#FCF3D9` |
| `--color-success` | `#0B7A46` | Success text/icon (paired with `--color-pale` background and a checkmark icon, never color alone) |

## 2. Typography and Spacing

- Font stack: system UI stack (`-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`); no custom webfont required for Lab 2.
- Scale: page title 24px/700, section heading 18px/600, field label 14px/600, body/input text 14px/400, helper/error text 12px/400, badge text 12px/600.
- Spacing unit: 4px base grid. Field vertical rhythm: 4px label-to-control gap, 16px between fields, 24px between field groups (e.g. classification block vs Summary/Description block).
- Max content width: 1040px, centered, on desktop.

## 3. Field, Button, and Feedback States

### Fields

| State | Style |
|---|---|
| Editable, empty/valid | White bg, `--color-field-editable-border`, 1px |
| Editable, focused | Border becomes `--color-secondary`, 2px focus ring `rgba(11,122,70,0.35)` outside the border; visible for keyboard `:focus-visible` |
| Read-only | `--color-field-readonly-bg`, no border-color change on hover/focus, `cursor: default`, still reachable by keyboard but not editable |
| Invalid | Border and helper text switch to `--color-error`; error message appears directly below the field, not only at the top of the form (handout §8.3) |
| Disabled | 50% opacity, `cursor: not-allowed`, no focus ring; used while a request that owns that field is in flight |

Required fields show a red asterisk (`*`, `--color-error`) immediately after the label text; the asterisk never substitutes for the validation message (handout §8.3).

### Buttons

| Variant | Style | Use |
|---|---|---|
| Primary | `--color-primary` bg, white text | Submit, Continue, Post Comment-equivalent actions |
| Secondary | White bg, `--color-secondary` border+text | Cancel, Back to My Tickets, Add Attachment |
| Tertiary | No border/bg, `--color-secondary` text | Change Requester, Clear Filters |
| Destructive | White bg, `--color-error` border+text; confirms before firing | Remove Attachment |
| Disabled | 50% opacity on whichever variant, no hover/active transform | invalid form, in-flight request |
| Busy | Primary variant shows an inline spinner + "Submitting…" label, replaces default label, button stays disabled until the request settles | Submit during POST /api/tickets |

Icon-only controls (e.g. a small "×" on a My Tickets filter chip) always carry an `aria-label` and a native `title` tooltip; no icon-only control ships without a text alternative (handout §8.3).

### Feedback patterns (reused across all three screens)

- **Loading**: skeleton rows (My Tickets, Ticket Detail attachments) or a centered spinner + "Loading…" text (Create Ticket reference data, Requester Selection).
- **Empty**: icon + one-line message + a primary action when applicable (e.g. "You haven't submitted any tickets yet." + Create Ticket button). Distinct from "no results" per BR-24a.
- **No results**: icon + "No tickets match your filters." + a Clear Filters tertiary button.
- **Error/failure**: `--color-error-bg` callout, icon, plain-language message, a Retry action where the request is safely retryable (reference-data load, list load); form values are always preserved on failure, never cleared.
- **Success**: `--color-pale` banner with a checkmark icon and text (never color alone), e.g. "Ticket TKT-2026-000042 created."

## 4. Application Shell and Navigation

- Header bar: `--color-primary` background, white text/icons, fixed height 56px.
  - Left: clock-glyph icon + "TokTickIT" wordmark (app identity, handout §8).
  - Center-left: "My Tickets" and "Create Ticket" nav items; the active route gets a `--color-secondary`-tinted underline/pill and `aria-current="page"`.
  - Right: current Requester name in a "Profile ▾" style control; opening it reveals "Change Requester" (FR-09), which routes to the Requester Selection screen and clears cached ticket/attachment state (BR-06).
- Below 768px the two nav items collapse into a hamburger/menu icon; the panel opens as a full-width dropdown, still keyboard-navigable, closes on selection or outside tap.
- If no Requester is selected (BR-07), any route other than the Selection screen itself redirects there before rendering (AC-02); the shell does not render My Tickets/Create Ticket/Ticket Detail without a current Requester.

## 5. Development Requester Selection Screen

Route: `/select-requester` (or app root when no Requester is set).

Layout (single centered card, ~420px wide on desktop, full-width with 16px side padding on mobile):

1. TokTickIT title + small gear/person icon.
2. Heading: "Select Development Requester".
3. One-line explanatory text (handout's suggested copy): *"Select a Development Requester to test requester-specific ticket behavior. This is not a login screen. Authentication and role-based access will be introduced in Lab 3."*
4. Labeled dropdown, `Development Requester *`, populated from `GET /api/requesters`.
5. Info callout under the dropdown: "Only active development requesters are shown."
6. Secondary info panel: "Authentication coming in Lab 3: this selection will be replaced with secure authentication."
7. Button row: Cancel (tertiary, no-op/disabled when there's nowhere to cancel to) + Continue (primary, disabled until a Requester is chosen).

States:
- **Loading**: dropdown shows a disabled "Loading Requesters…" placeholder, Continue disabled.
- **Empty** (BR-33): dropdown replaced by an inline message "No active Development Requesters are available. Contact your instructor." Continue stays disabled.
- **Error**: `--color-error-bg` callout "Unable to load Development Requesters." + Retry button; Continue disabled.
- **Success**: dropdown enabled; selecting an option enables Continue.

All controls are reachable and operable by keyboard alone (`Tab`, `Enter`/`Space`), satisfying handout §8.1's keyboard-accessibility requirement.

## 6. Create Ticket Screen (Create Mode)

Route: `/tickets/new`.

Arrangement, top to bottom (per handout §8.2's suggested ordering):

1. **System-generated row** (read-only fields, `--color-field-readonly-bg`): Ticket Number ("Assigned after submission"), Ticket Date ("Today"), Requester (current Requester's name, non-editable).
2. **Classification group**: Category (select), Related System (select), Requested Priority (select), laid out 3-across on desktop, stacked on mobile.
3. **Summary**: single-line text input, full width, character counter (e.g. "24/120") right-aligned under the field.
4. **Description**: multiline textarea, full width, taller (min 6 rows), resizable vertically only (does not break layout per §8.3), character counter "412/2000".
5. **Attachments**: a drop-zone/file-picker button ("Add files or drag and drop: JPG, PNG, WEBP, PDF, up to 5 MB, 5 files max"), followed by a list of selected files each showing filename, size, and a remove "×"; per-file error text appears inline under the offending file (e.g. "notes.docx: unsupported file type").
6. **Actions row**: Cancel (secondary, returns to My Tickets) + Submit Ticket (primary).

Screen states (all traced to AC-01/04/05/06/07/08/09/10/20):

| State | Behavior |
|---|---|
| Initial | Reference-data (categories/related systems) loaded via `GET /api/categories`, `GET /api/related-systems`; fields empty; Submit enabled once required fields are valid client-side |
| Reference-data loading | Category/Related System selects show a disabled "Loading…" option |
| Reference-data failure (BR-34) | Full-form failure banner replaces the form body: "Unable to load ticket form data." + Retry; Submit is not rendered until data loads |
| Validation error | Offending field(s) get the invalid style (§3); a toast/inline message is not the only signal; each field's own error text is authoritative (handout §8.3) |
| Attachment invalid | Per-file error text under that file row (size/type/count); other valid files remain selectable/uploadable |
| Submitting | Submit button enters busy state, disabled; all fields disabled to prevent edits mid-request (BR-17) |
| API failure on create | Error banner above the form; all entered values remain exactly as typed (BR-18/19) |
| Success | Form is replaced by a success panel: checkmark, "Ticket TKT-2026-000042 created.", a "View Ticket" primary button (→ Ticket Detail) and a "Create Another" secondary button |
| Attachment upload fails after ticket create (BR-25/AC-20) | Success panel still shows (Ticket exists), plus a warning callout listing which file(s) failed and a "Retry from Ticket Detail" link |

## 7. My Tickets Screen

Route: `/tickets`.

Desktop (≥992px) layout:

1. Page header: "My Tickets" title + one-line subtitle + "Clear Filters" (tertiary) and "+ Create Ticket" (primary) actions, top-right.
2. Toolbar row: search input (placeholder "Search by ticket number or summary…") + three filter selects (Category, Requested Priority, Current Status), each defaulting to "All …".
3. Table with sortable columns (click header toggles asc/desc, shown via a small caret icon): Ticket No., Created Date, Summary, Category, Requested Priority, Current Status, Last Updated. (Column choice justified below.)
4. Pagination footer: "Showing X–Y of Z tickets" + Previous/page-number/Next controls.

Column justification: these seven columns are the minimum a Requester needs to identify a ticket (`Ticket No.`), understand it at a glance (`Summary`, `Category`, `Requested Priority`, `Current Status`), and judge recency (`Created Date`, `Last Updated`), matching FR-04's search/filter/sort fields exactly so every visible column is also actionable. `IT Priority`/`Ticket Owner` are intentionally omitted (out of Lab 2 scope, BR-12).

Tablet (768–991px): table collapses to 5 columns (Ticket No., Summary, Priority badge, Status badge, Last Updated); filters wrap to two rows.

Mobile (<768px): table becomes a stacked card list, one card per Ticket showing Ticket No. + Created Date on the top line, Summary as the card title, Priority and Status badges side by side, Last Updated as small muted text at the bottom. Search and filters stack vertically above the list; pagination becomes Previous/Next only (no numbered pages) to stay touch-friendly.

Badges (Requested Priority, Current Status; reused in My Tickets and Ticket Detail):

| Value | Badge color | Text |
|---|---|---|
| Priority LOW | `--color-pale` bg, `--color-secondary` text | "Low" |
| Priority MEDIUM | `--color-warning` bg (amber), dark text | "Medium" |
| Priority HIGH | `--color-error-bg` bg, `--color-error` text | "High" |
| Status NEW | `--color-pale` bg, `--color-secondary` text | "New" |

Every badge pairs color with text, never a bare colored dot (accessibility, non-color indicator requirement).

States:
- **Loading**: 5 skeleton rows/cards.
- **Empty** (BR-24a, AC-21): "You haven't submitted any tickets yet." + Create Ticket primary button; filters/search are hidden since there is nothing to filter.
- **No results** (BR-24a, AC-12): filters/search remain visible; body shows "No tickets match your filters or search." + Clear Filters tertiary button.
- **Failure**: error banner + Retry, table/list not rendered.
- **Loaded**: table/card list per breakpoint above.

## 8. Requester Ticket Detail Screen (View Mode)

Route: `/tickets/:id`.

Layout:

1. Breadcrumb/back row: "My Tickets > Ticket Details" + "← Back to My Tickets" (top-right).
2. Read-only header grid (2–4 columns depending on breakpoint, all fields styled per §3's read-only field style): Ticket No., Ticket Date, Category, Related System, Requester, Requested Priority, Current Status (badge), Summary (full width), Description (full width, preserves line breaks).
3. Attachments panel, clearly separated from the header grid by a section divider and heading "Attachments (N active)":
   - Each active attachment row: file-type icon, filename, size, uploaded date, Download action, Remove action (destructive).
   - Each removed attachment row: same metadata, visually muted (reduced opacity, `--color-text-muted`), a "Removed" tag, removal date + reason shown, Download/Remove replaced by a disabled "Unavailable" label, never an active control (BR-30).
   - "+ Add Attachment" secondary button above the list, opens the same file-picker UI as Create Ticket's Attachments field, subject to the same per-file states.
4. No Public Comments, Internal Notes, Actions Taken, or status-change controls appear anywhere on this screen; explicitly out of scope (handout §8.5).

Attachment states:

| State | Presentation |
|---|---|
| Active | Normal row, Download + Remove enabled |
| Uploading (new add-attachment call in flight) | Row shows filename + inline spinner, no actions yet |
| Invalid (rejected on add) | Not added to the list; error shown in the picker UI, same as Create Ticket |
| Removed | Muted row, "Removed" tag, reason/date shown, Download/Remove replaced by "Unavailable" |
| Remove in progress | Row's Remove button shows a busy spinner; a reason prompt (modal or inline textarea, 5–200 chars per BR-29) must be filled before the request fires |

Remove flow: clicking Remove opens a reason prompt (required, 5–200 chars, inline validation) with Cancel/Confirm; Confirm is disabled until the reason is valid; on success the row transitions to the removed presentation without a page reload.

Ownership failure: if the Ticket id in the URL is not found or not owned by the current Requester (404 per BR-35), the screen shows a full-page "Ticket not found" message with a "Back to My Tickets" action; it never reveals whether the id belongs to someone else.

## 9. Screen Modes and User Feedback (handout §8.6)

Three top-level modes exist in Lab 2:

- **Select mode**: Requester Selection screen (§5).
- **Create mode**: Create Ticket screen (§6); no edit mode exists for Tickets in Lab 2 (BR-12 fields are the only post-creation values, and none of them are user-editable).
- **View mode**: My Tickets (list) and Ticket Detail (single record), both read-only with respect to Ticket fields; only Attachments are mutable from View mode.

Every mode's validation, success, failure, and empty-result feedback follows the shared patterns in §3; no screen invents its own loading spinner style, error color, or badge shape.

## 10. Responsive Rules

| Viewport | Behavior |
|---|---|
| Desktop ≥992px | Full multi-column layouts as described per screen; content centered, max-width 1040px |
| Tablet 768–991px | Two-column field groups where practical; My Tickets table narrows to 5 columns; Summary/Description keep full available width |
| Mobile <768px | All fields stack vertically; nav collapses to a menu; My Tickets becomes a card list; buttons remain ≥44px tall (touch target); no horizontal page scroll anywhere |
| All sizes | No clipped labels, no overlapping validation messages, no hidden buttons, attachment filenames truncate with an ellipsis + full name in a `title` tooltip rather than overflowing |

## 11. Accessibility

- Every input has a `<label>` associated via `for`/`id` (not placeholder-only labeling).
- Focus is always visible (`:focus-visible` outline using `--color-secondary`) and never suppressed.
- Tab order follows visual order on every screen and breakpoint.
- Status/badge meaning is never conveyed by color alone; always paired with text (§7).
- Icon-only controls carry `aria-label` + `title` (§3).
- The active nav item is marked with `aria-current="page"`.
- Toast-free validation: errors live next to their field so a screen-reader user reading the field also reads its error.

## 12. Visual Inspection Checklist (handout §8.8)

Run this checklist against the running app and screenshots before marking a screen "Done":

- [ ] Colors match §1 tokens exactly (no ad-hoc hex values in component code).
- [ ] Editable vs read-only fields are visually distinct at a glance.
- [ ] Every required field shows the asterisk; every validation message sits directly under its field.
- [ ] Button hierarchy (primary/secondary/tertiary/destructive/disabled/busy) is consistent across all three screens.
- [ ] Priority and status badges use the fixed color+text mapping in §7 everywhere they appear (My Tickets list and Ticket Detail).
- [ ] No clipped labels, overlapping messages, or unintended horizontal scrolling at 375px, 768px, and 1280px widths.
- [ ] My Tickets renders as a table ≥992px and as cards <768px with no missing columns' worth of information.
- [ ] Filters, search, pagination, and attachment controls remain usable (tappable, legible) at all three reference widths.
- [ ] Empty vs no-results vs failure states are visually distinguishable, not just differently worded.
- [ ] Removed attachments are visually muted and their controls are genuinely disabled, not just styled to look disabled.

## 13. Screenshot Paths

Playwright visual/E2E screenshots are saved under `artifacts/lab-02/screenshots/`, one subfolder per screen, one file per state × viewport:

```
artifacts/lab-02/screenshots/
├── create-ticket/
│   ├── initial-desktop.png
│   ├── validation-error-desktop.png
│   ├── submitting-desktop.png
│   ├── success-desktop.png
│   ├── api-failure-desktop.png
│   ├── invalid-attachment-desktop.png
│   ├── initial-tablet.png
│   └── initial-mobile.png
├── my-tickets/
│   ├── loaded-desktop.png
│   ├── empty-desktop.png
│   ├── no-results-desktop.png
│   ├── failure-desktop.png
│   ├── loaded-tablet.png
│   └── loaded-mobile.png
└── ticket-detail/
    ├── loaded-desktop.png
    ├── attachment-removed-desktop.png
    ├── loaded-tablet.png
    └── loaded-mobile.png
```

These paths are referenced from `docs/lab-02/tests.md`'s responsive/visual checklist and from the submission PDF's Part 9 evidence.
