# Lab 4: AI Use and Reflection

**LLM/agent used:** Claude Code, Anthropic's command-line coding agent, running in this repository's working directory for the whole Lab 4 sprint. Following our lab playbook:
- **Claude Opus 5.5** did the judgement work: the labsheet checklist, the design interview, the contract, every Issue's code, review fixes, and the release checks.
- **Claude Sonnet 5** ran the list-checking helpers: the pre-PR gate and the screen checker.

I used it in two roles:
- **Specification agent:** questioned me on the design and wrote the Sprint 4 contract (`docs/lab-04/`, including the authorization matrix in section 5 of the specification).
- **Coding agent:** implemented each of the 12 Issues from that contract, tests first.

Helper agents I wrote for the course each did one job: turn the labsheet into a checklist, check a branch before its Pull Request, sweep the codebase for a review finding's pattern, capture and inspect screens, and review my partner's Pull Requests.

**How it was used, in one line:** the specification agent settled every design question with me before any code existed, and the coding agent built one Issue at a time against that contract. Every decision that affects someone else stayed with me: opening and editing Pull Requests, closing Issues, replies to my partner, and resetting the database.

## Selected key prompts

Quoted prompts are my words as typed; a few are lightly trimmed.

| # | Prompt | Why I asked it this way | What I did with the result |
|---|---|---|---|
| 1 | "use grill with docs for lab4 again, use the question from q1 to q10 with grill with docs again, and i will answer the question", then for each round "Go with ur recommendation" | Lab 4 adds a new record type, a stricter workflow and two dashboards. I wanted every open question argued out against the labsheet before anything was written, with a recommended answer I could accept or change | Three rounds settled the Actions Taken model (Recorded By, Responsible Staff, Performed By), the resolution gate, the Status History, the dashboard figures and the 12-Issue plan. Each decision went into the specification's Assumptions and Decisions with the labsheet line it answers |
| 2 | "The path from our grilling is still on the same path from lab04 sheet right?, and if we can implement it better than the lab i think it's ok to do it but doing to get full score is the main piority." | I wanted to know whether the recommendations had drifted from what is graded | It checked the decisions against the 485-line labsheet checklist. Where we chose a stricter rule than the labsheet (the gate needs at least one Completed Action), it was written as a numbered rule with its reason, so a grader can see it is deliberate |
| 3 | "songt request changes our work on pr81 ... He said [the review pasted in full]", and the same for every later review | I wanted it working from my classmate's exact words. "the schema only stores idempotencyKey, so the server has nothing to compare" pointed at one real gap, and a paraphrase would have blurred it | For each finding I had it write a test that failed on the old code first, sweep the whole codebase for the same pattern, and log a prevention rule. I read the diff and posted the short reply myself, starting from its draft |
| 4 | "Why its not updating take a look at this: [a GitHub changelog link]", then "do the empty commit" | After a GitHub error, my #85 still showed an old commit, so my partner would have reviewed code without the fix | It confirmed the branch held the fix and GitHub's view did not. I approved one empty commit to refresh the Pull Request, and it checked that the Pull Request then showed the right head |
| 5 | "so im gonna go to sleep so in this issue 8, i will follow ur recommendation so finish it and post the pr" | Issue 8 was the hardening pass. I had said not to start until my usage limit reset, and I wanted it done before morning without me answering questions | It waited for the reset, then built the whole Issue, ran every gate, and opened the Pull Request. In the morning I read its report, including two mistakes it had caught and undone itself (a formatter that reformatted a whole file, a test pointing at a route that does not exist) |
| 6 | "Why his pr have many fixes", then "Yea check deeply everytime too, so it don't waste our time" | My partner's Pull Requests were going through three or four review rounds, and I wanted to know why | It traced the pattern: each recheck found the next layer, often tests that could not fail. From then on I asked for the deep check on the first review, including running each claimed test with the behaviour removed |
| 7 | "songt merged bro", followed by its plan for a whole-lab review, which I approved | Each Issue had been reviewed on its own; Issue 10 is the one place to look at all of Lab 4 together before release | Four reviews ran in parallel (standards, specification, security, labsheet audit). I chose which findings to fix before release; the rest are recorded with file and line in `tests.md` section 6 |
| 8 | "reset done", which turned out to be untrue | The screenshots needed a clean database, and the reset is the one step it may not run | It checked the row counts, saw nothing had changed, and found the likely cause: Prisma refuses `migrate reset` inside an agent session. I ran it from my own terminal, it checked the counts again, then retook the screenshots dashboards first |

## My Reflection

**The specification agent.**
- **What worked:** settling the design first. Only one decision was reopened during the 12 Issues (the status matrix, in #81, below), and the traceability table gave each of the 109 planned tests a reason to exist.
- **What it missed, which my partner and the tools found:**
  - My partner's first review (#81) found two real gaps. The contract asked for a 409 on a reused key "with different content", but stored nothing to compare. The status matrix also left a Ticket waiting on its Requester with no way to be cancelled.
  - The contract claimed that Ticket create sends files, which it has never done, and I approved it without checking against the Lab 2 code. That was only found in Issue 8, when the tests for it could not be written. It was corrected in the contract and recorded as a decision (#88).
- **What I take from it:** review a generated contract against the code it changes, not only against the labsheet.

**The coding agent.**
- **What worked:** making it prove things, not just claim them.
  - It broke the code on purpose for every new check, to show the test fails without the fix.
  - It read the screenshots it took instead of only saving them.
  - It turned on checks that fail a test on any console warning, and walked the screens by keyboard alone.

  Those checks found real defects that no human had noticed: a date field whose calendar button had no visible focus, dialogs that opened showing an error, Bootstrap's blue and red where the design tokens belonged, and a request logged as an error when the page was simply being left.
- **What it got wrong:**
  - My partner found the bugs that mattered most. The comment deadlock in #86 repeated a lesson from #83 that the agent itself had written into our playbook three Issues earlier. The fix in #90 trusted the very role the error had just shown was stale, and its test asserted the wrong link.
  - It made smaller mistakes I had to catch: screenshots with the wrong file names, test IDs cited from memory that did not match, and a claim that a reset had happened when it had not.

**What I kept for myself.**
- Every outward action went through me first: opening, editing or merging a Pull Request, closing an Issue, posting to my partner, and resetting the database.
- Every review reply went out in my words, edited from its draft.
- Every claim in a document or Pull Request had to be checked first: a count from a real run, a quote from GitHub, a line number from the file.

When it broke that rule, it said so at once and corrected it, and I treated that as the most useful habit it had.
