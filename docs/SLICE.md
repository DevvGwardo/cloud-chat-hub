# SLICE 15 — Test coverage: bridge_events translation edge cases

## Problem
test_bridge_events.py covers the ACP dispatch mapping and run-event translation basics.
Pre-flight should check the remaining translation branches (reasoning deltas, approval
pending payloads, error frames) for gaps.

## Change (finalize after pre-flight)
pytest-only additions to test_bridge_events.py. Skip live-process paths.

## Builder pre-flight
1. Map bridge_events.py + acp_transport._dispatch translation surface vs existing tests.
2. List uncovered branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 422+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
