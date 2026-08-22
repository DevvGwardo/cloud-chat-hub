# SLICE 18 — Test coverage: hermes_ops + hermes_profiles helpers

## Problem
hermes_ops.py and hermes_profiles.py have test files (test_hermes_ops.py exists) but
coverage depth is unaudited. These handle bridge ops endpoints and CLI profile
resolution — the auth/profile routing surface that produced several past bugs.

## Change (finalize after pre-flight)
pytest-only additions. Skip anything shelling to a live hermes CLI (mock it).

## Builder pre-flight
1. Map hermes_ops.py + hermes_profiles.py public functions vs their tests.
2. Identify uncovered branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 461+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```