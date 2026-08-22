# SLICE 8 — Test coverage: approval engine edge cases

## Problem
The approval engine (plan-mode gates, tool approval) is on the loop's critical-path
coverage list and predates the current test suite's growth. `server/__tests__/approval-engine.test.ts`
exists — pre-flight must establish what it already covers before adding anything.

Candidate uncovered branches to check (verify against actual code first):
- concurrent/duplicate approval requests for the same tool call id
- approval arriving after a session/conversation switch (stale approval)
- deny vs approve side effects both cleaning up pending state
- timeout/expiry of a pending approval (if the feature exists)

## Change (finalize after pre-flight)
Add unit tests only. If any branch doesn't exist in code, don't invent it — test what's
there and record what was skipped as not-applicable.

## Out of scope
- Changing approval engine behavior
- UI-side approval components

## Builder pre-flight
1. Read server/lib approval-engine module + its existing test file; list covered cases.
2. Identify genuinely uncovered branches with file:line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → 0 errors, 0 warnings.
3. `npm test` → all pass; total ≥ 822.
4. Diff touches ONLY test files.
5. One conventional commit (`test:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
```
