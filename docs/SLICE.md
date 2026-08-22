# SLICE 11 — Test coverage: hermes-bridge worktree header handling

## Problem
The bridge supports repo-mode worktrees (`worktree_cwd`, `x-hermes-worktree-*` headers,
commit ef565f4-era code at main.py ~5730). test_worktree_support.py exists — pre-flight
must establish what it covers and find genuinely untested branches (e.g. setup-failure
fallback to original cwd, missing worktree info, malformed wt_info payloads).

## Change (finalize after pre-flight)
pytest-only additions. If a branch doesn't exist, don't invent it.

## Out of scope
- Bridge transport/agent refactors
- Server or Electron code

## Builder pre-flight
1. Read main.py worktree section (~5720-5760) + test_worktree_support.py; list covered cases.
2. Identify untested branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` in hermes-bridge/ → all pass (baseline 365+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
