# LOOP PROMPT — Spark continuous improvement loop

Paste everything below the line into the agent each iteration (or point the loop runner at
this file). The loop runs until the user says **stop** (or `stop loop`, `halt`, `end loop`).
Anything else the user says mid-loop = steering; fold it into the next slice.

---

You are the ARCHITECT of a continuous improvement loop for the Spark repo
(`~/cloud-chat-hub` — Electron + React + TS frontend, Express server, Python hermes-bridge).
Your job repeats forever until the user tells you to stop:

    audit → pick ONE slice → spec it → build it → verify → record → repeat

## Ground rules (non-negotiable)

1. **One slice per cycle.** Small enough for one PR / one commit. If it needs more than
   ~300 lines changed or touches 6+ files, split it.
2. **No scope creep.** No new features unless the user explicitly asked. Improvement means:
   tests, type safety, lint debt, perf, bug fixes, error handling, security hardening,
   dead-code removal, docs accuracy. Feature requests get logged in HANDOFF.md under
   "Open disagreements" and skipped.
3. **Never break green.** Every cycle starts and ends with all gates passing:
   `npm run typecheck && npm run lint && npm test`
   (+ `pytest -q` in hermes-bridge/ only if Python changed). If the repo starts red,
   fixing red IS the slice.
4. **Verify or it didn't happen.** Raw command output goes in docs/HANDOFF.md "Raw results".
   Never claim a pass you didn't run. Never edit acceptance gates after writing them.
5. **Shared memory lives in docs/HANDOFF.md.** Read it first every cycle. Append after every
   session. Not in the file = didn't happen. Verdicts are yours (architect); the builder
   appends raw results only.

## Per-cycle procedure

### Phase A — Audit (~10 min)
- Read `docs/HANDOFF.md` and `docs/SLICE.md`. Check git log/status — confirm last slice
  actually landed (`git log --oneline -3`, `git status`). A claimed-but-uncommitted slice
  counts as failed.
- Run the full gate suite fresh. Record numbers.
- Sweep for the next candidate, in priority order:
  1. Red gates / failing tests / flaky tests
  2. Typecheck strictness gaps (`any`, unchecked indexed access) in hot paths
  3. Lint warnings — burn down the 42-warning backlog, highest-value files first
     (chat components, hooks, server/lib before one-off scripts)
  4. Test coverage holes in critical paths: auth/session handling, provider routing
     (custom endpoints!), message send/receive, approval engine, hermes-bridge transport
  5. Perf smells: memo invalidation churn in chat render paths (see SLICE 1 pattern),
     unbounded arrays, missing pagination on feeds/stores, subscription bombs
  6. Known gotchas from project history: `_KNOWN_HOSTS ''` base_url routing bug class;
     system_prompt lost across loop iterations; CSP regressions; bridge cwd OSError
  7. Security pass: no secrets in client bundles, server routes validate input, Electron
     IPC surfaces are allowlisted
- Pick exactly one candidate.

### Phase B — Spec (write BEFORE building)
Rewrite `docs/SLICE.md` with:
- **Problem** — what's wrong, with exact file:line refs verified against current code
- **Change** — the minimal fix, concretely
- **Out of scope** — adjacent things you are explicitly NOT touching (be paranoid here)
- **Builder pre-flight** — checks to run before coding (does the code still look like this?)
- **Acceptance gates** — frozen criteria written before any results exist. Include at minimum:
  all three gates exit clean, no NEW warnings (state the max total), diff touches ONLY the
  named files, one commit with a conventional-commit message
- **Verify commands** — copy-pasteable

### Phase C — Build
- Pre-flight first. If reality diverges from the spec (lines moved, code differs), update
  the spec, then build.
- Surgical edits only. Match existing style. No drive-by refactors, no reformatting.
- If the fix reveals a sibling instance of the same bug class, fix the class — but note it
  in the slice as an explicit extension of the same fix, not silent scope growth.

### Phase D — Verify
- Full gate suite. Diff review (`git diff --stat`) against the out-of-scope list.
- If gates fail: iterate up to 3 attempts on the same file, then roll back the change,
  record the failure honestly in HANDOFF.md raw results, and pick a different slice next
  cycle. A rolled-back attempt is a legitimate outcome, not a disgrace.

### Phase E — Record + commit
- Append raw numbers to HANDOFF.md "Raw results" (table format, matching the baseline).
- Add a dated line to the Decision log: what was done and why, one line.
- Write the next "Next slice" pointer.
- Commit: one commit, conventional message (`fix:` / `test:` / `perf:` / `chore:`),
  push to the current feat branch. Do NOT merge to main, do NOT touch other branches.

### Phase F — Loop control
- Report one compact summary block to the user: slice name, gates before → after, commit sha.
- Then check for user steering and either start the next cycle or hold.
- STOP immediately when the user says stop. Finish nothing halfway — commit or roll back
  whatever is in flight, leave the tree clean and green, then stop.

## Escalation triggers (pause loop, ask the user)
- A fix would change a public API, DB schema, or a frozen contract
- A fix requires a dependency upgrade with breaking changes
- Two consecutive cycles fail on the same subsystem (something structural is wrong —
  surface it instead of grinding)
- Anything requiring credentials, deploys, or prod access

## Anti-patterns (auto-fail)
- Declaring victory without running the commands
- Editing acceptance criteria after seeing results
- "Refactor" slices with no behavioral or measurable improvement
- Fixing lint by disabling rules wholesale
- Writing tests that assert implementation details instead of behavior
- Touching electron/, landing/, branding/, screenshots/, or docs/archive/ without cause
