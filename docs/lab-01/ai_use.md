# Lab 1 — AI Use and Reflection

**LLM/agent used:** Claude Code (Sonnet 5), Anthropic's CLI coding agent, run interactively in this repo's working directory.

**How it was used, in one line:** as a pair-programmer that read the labsheet first, proposed a plan, and only wrote code/git history after each step was reviewed — not as an autocomplete for the whole assignment in one shot.

## Selected key prompts

| # | Prompt (summarised) | Why I asked it this way | What I did with the result |
|---|---|---|---|
| 1 | Convert the Lab 1 PDF handouts (labsheet, glossary, cheat sheet) to Markdown | PDFs are awkward for an agent to re-read accurately mid-task; Markdown once, reused many times | Used the converted files as the reference for every later prompt instead of re-uploading PDFs |
| 2 | Pasted the full Lab 1 description and asked it to start the homework | Wanted the agent working from the actual contract text, not a paraphrase from memory, so acceptance criteria and branch names would be exact | Had it read the labsheet, summarize the 4 Issues, their dependencies, and acceptance criteria before writing any code — caught the Issue-1-before-2/3-before-4 ordering rule this way |
| 3 | Answered its clarifying questions (code-first vs Git-first order, whether the GitHub repo existed yet, whether Postgres was running locally) | The agent asked rather than assumed, which surfaced decisions I actually needed to make | Chose code-first; confirmed no repo yet and no local Postgres, so it set up Docker Postgres itself instead of guessing at a connection string |
| 4 | Asked it to implement all 4 Issues against the existing TODO-stubbed scaffold | Scaffold already encoded the required file layout and test contracts, so the task was "fill in the stubs," not "design from scratch" | Reviewed each diff individually (health route, Category model + seed, categories API, React UI states) before accepting any of them |
| 5 | Asked it to demo the running app and show the Online/Offline states | Wanted to catch UI bugs a passing unit test could still miss (e.g. mocked tests can't prove the *real* fetch call works) | Verified manually in the browser myself rather than trusting its description — this produced the three screenshots in `tests.md` |
| 6 | Reviewed its proposed Git/GitHub plan (rebuild history into per-Issue commits, branches, 4 PRs, Project board) before approving | A wrong git history is expensive to unwind after PRs are open, so I wanted to check it against the grading rubric first, not after | Compared each planned step to labsheet section 6/7 before saying yes |
| 7 | "ok proceed" | Explicit go-ahead only after step 6's review, not a blanket approval | Let it execute repo creation, branch structure, Issue creation, Project board setup, and opening the 4 PRs |
| 8 | Reported a broken GitHub device-code auth flow ("code expired") | Needed the agent to recover from a real environment failure, not silently retry forever | It generated a fresh code and re-authenticated; I confirmed the granted scopes before letting it continue pushing |
| 9 | Asked it to check current git/GitHub status before merging `lab1-staging` into `main` | Wanted a real inventory (branches, PR merge state, remote sync) rather than trusting my own memory of what had been merged | It used `git log`/`gh pr list` to confirm all 4 PRs were merged into `lab1-staging` but `main` was still un-merged — this is what triggered the staging→main merge |
| 10 | Asked it to fill in `reviewer.md` with the real PR/review data | Wanted the peer-review record to reflect actual GitHub review state, not placeholder text | It pulled real PR review bodies via `gh pr view --json reviews` and asked me directly for the two names/IDs it couldn't get from git (identity isn't in commit metadata) |

## Reflection

The single biggest lever was giving the agent the *actual* labsheet text instead of describing the task from memory — it caught exact acceptance criteria and branch-naming rules that a paraphrase would have blurred. Two places needed real critical thinking rather than accepting output at face value:

1. **The agent initially committed the whole scaffold straight to `main`**, which violates the "no direct development on `main` or `lab1-staging`" rule (labsheet §6.3). It caught this itself when checked against the rubric and rebuilt the branch structure properly (feature branches → `lab1-staging` → `main`), but it's a reminder that a green test run alone doesn't prove the *process* requirements were followed — I still had to read the commit graph.
2. **Docs drift from code.** By the time Issue 4 was merged into `main`, `docs/lab-01/reviewer.md` was still the unfilled template — the agent had written code and tests but not gone back to update the human-facing record. This matches a specific warning in the professor's clarifications (if docs are missed after merging, fix them on a dedicated `feature/Lab1Doc` branch rather than committing straight to `main`), and is now something I check for explicitly at the end of every lab rather than assuming "tests pass" means "submission is complete."

Net takeaway: the agent is reliable at the mechanical parts (running commands, drafting diffs, querying GitHub state) but the workflow/process rules — where to commit, when docs count as "done" — needed my judgment call at each checkpoint, not just a final review of the diff.
