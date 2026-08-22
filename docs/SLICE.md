# SLICE 12 — Test coverage: hermes_runs submit/parity edge cases

## Problem
`hermes_runs.py` (Gateway /v1/runs client) is exercised via test_hermes_runs.py and
test_runs_parity_name.py, but main.py's runs-routing fallback chain (route_runs demotion:
moa rejection, parity mismatch, provider pinning) has branches around main.py:5700-5770
that pre-flight should check for coverage.

## Change (finalize after pre-flight)
pytest-only additions to existing files. Don't invent branches that don't exist.

## Builder pre-flight
1. Map the route_runs decision chain in main.py (lines ~5690-5790).
2. Check which demotion paths have tests today.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 379+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
