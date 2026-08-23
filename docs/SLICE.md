# SLICE 21 — Test coverage: delegation_live.py / cursor_composer_bridge.py smoke edges

## Problem
delegation_live.py and cursor_composer_bridge.py are untested bridge modules (no
test_delegation*.py / test_cursor_*.py files). These handle cross-agent delegation —
a surface the loop hasn't touched. Pre-flight should map their pure-logic surface
(payload building, response parsing, validation) vs process-spawning code.

## Change (finalize after pre-flight)
pytest-only additions for pure logic; mock all subprocess/network paths.

## Builder pre-flight
1. Map public functions in both modules; classify pure vs side-effecting.
2. Check no existing coverage (grep test files).

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 499+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```