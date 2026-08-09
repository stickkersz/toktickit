# Lab 1 — AI Use and Reflection

**LLM/agent used:** Claude Code (Sonnet 5), Anthropic's CLI coding agent.

## Selected key prompts (6–10)

| # | Prompt (summarised) | What I did with the result |
|---|---|---|
| 1 | Convert the Lab 1 PDF handouts (labsheet, glossary, cheat sheet) to Markdown | Used the result as reference while planning the implementation |
| 2 | Pasted the full Lab 1 description and asked to start the homework | Had the agent read the labsheet, summarize the 4 Issues, dependencies, and acceptance criteria before writing any code |
| 3 | Agent asked clarifying questions (code-first vs Git-first, GitHub repo status, Postgres status) | Chose code-first; confirmed no repo yet and no local Postgres, letting the agent set up Docker Postgres itself |
| 4 | Asked the agent to implement all 4 Issues against the existing TODO-stubbed scaffold | Reviewed each diff (health route, Category model + seed, categories API, React UI states) before accepting |
| 5 | Asked the agent to demo the running app and show the Online/Offline states | Verified in browser myself before trusting the result |
| 6 | Reviewed the agent's proposed Git/GitHub plan (rebuild history into per-Issue commits, branches, 4 PRs, Project board) before approving | Confirmed only after checking each step against the grading rubric |
| 7 | "ok proceed it" | Let the agent execute repo creation, branch structure, Issues, Project board, and PRs |
| 8 | Reported a broken auth device-code flow ("code expired") | Agent retried with a fresh code; confirmed scope was granted before continuing |

## Reflection

Giving the agent the full labsheet text up front (instead of describing the task from memory) made the biggest difference — it caught the exact acceptance criteria and branch-naming requirements I would have paraphrased loosely. One place I had to watch closely: the agent initially committed the whole scaffold straight to `main`, which violates the "no direct development on main or lab1-staging" rule in section 6.3. It caught this itself against the rubric and rebuilt the branch structure properly (feature branches → lab1-staging → main), but it's a reminder to actually read the commit history it produces rather than trusting a green test run alone.
