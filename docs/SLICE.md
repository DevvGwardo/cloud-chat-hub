# SLICE 10 — Test coverage: bridge cwd-OSError guard regression (known gotcha class)

## Problem
The loop's known-gotchas list includes the "bridge cwd OSError" class — the hermes-bridge
crashed when the spawn cwd no longer existed. Commit ef565f4 ("fix: bridge cwd-OSError
guard, admin proxy startup-race retry, CSP 127.0.0.1") landed the fix, but pre-flight must
verify whether a regression test exists in hermes-bridge/ for it.

## Change (finalize after pre-flight)
If untested: add pytest coverage in hermes-bridge/ for the cwd-missing path (spawn with a
deleted/nonexistent cwd must fall back gracefully, not raise). Test-only diff unless the
guard turns out to be missing/broken — then fix minimally and note it.

## Out of scope
- hermes-bridge transport refactors
- Any Electron/server code

## Builder pre-flight
1. Locate the cwd guard (grep hermes-bridge/main.py + acp_transport.py for cwd handling).
2. Check hermes-bridge/ tests for existing coverage (`pytest -q` baseline too).

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0; `npm run lint` → 0/0; `npm test` → all pass (≥ 829).
2. `pytest -q` in hermes-bridge/ → all pass (baseline from pre-flight + new tests).
3. Diff touches ONLY hermes-bridge test files (+ at most one bridge source file if a real
   defect surfaced).
4. One conventional commit (`test:` or `fix:`) pushed to the current feat branch.

## Verify commands
```
cd hermes-bridge && pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
