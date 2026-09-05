# Lab 2 — Peer Review Record

**Author:** Nattakit Prasertsak — 67070503413 — GitHub: @stickkersz
**Peer reviewer:** Kirakit Kingkaew — 67070503460 — GitHub: @songt888

Unlike Lab 1 (individual repos, no reciprocal review), Lab 2 had both of us reviewing real, substantive PRs on each other's separate repositories throughout the whole sprint. Every round below is a real GitHub review: the reviewer read the actual diff, found concrete issues, and the author pushed a fix commit that the reviewer re-verified before approving.

## Pull Requests I authored (reviewed by my partner, on `stickkersz/toktickit`)

| PR | Scope | Review rounds | Fix commit(s) | Verdict |
|---|---|---|---|---|
| [#12](https://github.com/stickkersz/toktickit/pull/12) | Spec-DD engineering contract (`specification.md`, `api-spec.md`, `ui-spec.md`, `tests.md`) | 3 rounds: Prisma `ticketNumber` race, missing `isActive` on Category/RelatedSystem, inconsistent attachment status codes, placeholder test paths, inconsistent `{requesterId, reason}` shape, missing ownership tests → then a 400/404 consistency ask → then one leftover line (258) still saying 400 instead of 404 | `2eaca8e`, `9df1faa`, `8ecc730` | Approved |
| [#14](https://github.com/stickkersz/toktickit/pull/14) | DB schema, migration, idempotent seed (Issue #13) | 1 round: `GET /api/categories`'s 500 response used a bare error string instead of the documented `{ error, message }` envelope, no test for it | `a15389e` | Approved |
| [#16](https://github.com/stickkersz/toktickit/pull/16) | Development Requester context, selection screen (Issue #15) | 1 round: BR-05 gap — the full Requester object was trusted from `localStorage` with no re-validation against the active list on reload; also a Node-version conflict from `react-router-dom` v7 | `5f9ba23` | Approved |
| [#18](https://github.com/stickkersz/toktickit/pull/18) | Create Ticket screen + `POST /api/tickets` + attachment upload (Issue #17) | 1 round: reference-data lookups ran outside `try/catch`, `Number.isFinite` let decimal ids through, a batch-upload failure could delete an already-persisted file, client silently dropped client-rejected attachments from the retry warning | `15ac75d` | Approved |
| [#20](https://github.com/stickkersz/toktickit/pull/20) | My Tickets list, search/filter/sort/pagination (Issue #19) | 1 round: the previous round's own `hasLoadedOnce` fix suppressed the error banner on every request after the first, missing tablet/mobile layouts entirely, no `end` on the My Tickets `NavLink`, sortable headers not keyboard-operable | `7cb821f` | Approved |
| [#22](https://github.com/stickkersz/toktickit/pull/22) | Ticket Detail + Attachment lifecycle (Issue #21) | 1 round: no active-Requester check on any single-resource endpoint (a deactivated Requester kept access to their own data), the 5-active-attachment limit wasn't atomic against concurrent uploads, read-only fields used `disabled` instead of `readOnly`, missing file-type icons/filename truncation | `2e2bf23` | Approved |
| [#24](https://github.com/stickkersz/toktickit/pull/24) | Playwright E2E + responsive/visual evidence + mobile nav (Issue #23) | 1 round: the Playwright config assumed the API would start on port 3001 without pinning it, `@playwright/test`'s caret range had drifted onto a Node-20-only release, the mobile nav toggler icon had near-invisible contrast on the green header | `5396f3a` | Approved |
| [#26](https://github.com/stickkersz/toktickit/pull/26) | `reviewer.md`, `ai-use.md`, README currency pass (Issue #25) | 0 rounds: approved as submitted, "Looks good to me and is ready for approval and merge" | none needed | Approved, merged as `9bdefb9` |
| [#27](https://github.com/stickkersz/toktickit/pull/27) | Release: `lab2-staging` into `main` | Not a peer-review PR. Handout §10.1 requires review on the feature-to-staging PRs above; the release PR is the integration step itself. Integration testing was recorded as a PR comment before merging: server 80/80, client 39/39, Playwright 5/5 against `lab2-staging` | none needed | Merged as `b0a999f` |
| [#31](https://github.com/stickkersz/toktickit/pull/31) | Submission-evidence Playwright specs + `tests.md` §6 correction (Issue #30) | 0 rounds: approved as submitted, "good for merge" | none needed | Approved, merged as `1fb1cc0` |
| [#33](https://github.com/stickkersz/toktickit/pull/33) | Fix E2E-02 failing on a clean database, plus the missing Part 6 submit-failure evidence (Issue #32) | Self-found, not raised in review: reconfirming the suite against a genuinely empty database showed E2E-02 had always depended on Requester B already owning a Ticket, so it would time out for anyone starting from a fresh clone | `1e7eb48`, `87f2ceb` | See PR |

Every fix commit above was re-checked by the reviewer against the actual diff before approval, not accepted on the strength of the commit message alone — see e.g. PR #12's third round, where a fix for one line surfaced a leftover error-envelope inconsistency the previous round had introduced.

## Pull Requests I reviewed for my partner (on `songt888/toktickit`)

Both of us used the same reciprocal-review workflow going the other way: I read the real diff on their repo, found concrete bugs, posted them as a PR comment, and re-verified their fix commit before approving and merging (mirroring how they merge our PRs after approving).

| PR | Scope | What I found | Fix commit | Verdict |
|---|---|---|---|---|
| [#26](https://github.com/songt888/toktickit/pull/26) | Lab 2 engineering contract | §7 Data Changes had no concrete Prisma schema, an undefined 409 on ticket creation, no status code for the 5-attachment limit, no rule for a missing/malformed `X-Requester-Id`, AC-16 not mapped to a real test file | `9452f48`, `e6e84a0` | Approved, merged |
| [#27](https://github.com/songt888/toktickit/pull/27) | DB foundation + seed | `Category`/`RelatedSystem` seeds were 100% active, so BR-13's inactive-reference rejection path had no seed data to exercise it (the same gap my own reviewer had caught on my seed) | `a209810` | Approved, merged |
| [#28](https://github.com/songt888/toktickit/pull/28) | Development Requester context | `?active=true` query param decorative (hardcoded server-side), empty state missing `role="status"` | `266615e` | Approved, merged |
| [#29](https://github.com/songt888/toktickit/pull/29) | Create Ticket workflow | Attachment picker validated files client-side but never uploaded them and never said so; `{error, fieldErrors}` shape undocumented in their api-spec.md | `01d50a6` | Approved, merged |
| [#30](https://github.com/songt888/toktickit/pull/30) | My Tickets | No request-sequencing guard on the ticket fetch (the exact stale-response race I'd found by hand-testing my own PR #20), reference data refetched on every filter change, flat non-differentiated badge colors | `0a72520` | Approved, merged |
| [#31](https://github.com/songt888/toktickit/pull/31) | Ticket Detail | Opening a ticket unmounted `MyTickets` and destroyed its search/filter/page state; no nav item was marked active/`aria-current` on the detail screen; not-found detection string-matched an error message text | `d53e24e` | Approved, merged |
| [#32](https://github.com/songt888/toktickit/pull/32) | Attachment lifecycle | The 5-active-attachment count check and the insert weren't atomic, so two concurrent uploads could both pass the check (the same class of race I'd just fixed on my own PR #22) | `5e4aa41` | Approved, merged |

Two findings above (PR #27's seed gap, PR #30's request-sequencing race) were things my own reviewer had caught on my equivalent code first; recognizing the same pattern on their side, unprompted, is a direct payoff of having gone through the fix myself.

## How review comments were given and received

Both directions followed the same discipline: read the actual diff (`gh pr diff`), never approve or confirm a fix from the commit message or PR description alone, cite the real `file:line`, and re-fetch the fix commit's diff (`gh api .../commits/<sha>`) before confirming it actually resolved the issue. Comments were kept short and specific rather than long structured writeups, matching how a classmate would actually leave feedback on a PR.
