# SLICE 16 — Log-reasoning path: run_agent exit-code / error frame translation

## Problem
test_run_agent.py is the largest bridge test file (80 tests) but the loop hasn't audited
it for gaps. Its coverage is heavy on repo-tools and vision. Pre-flight should check the
exit-code normalization, error actionability (ActionableErrorTests class exists), and
VERIFICATION_COMPLETE / run-final translation branches for holes.

## Change (finalize after pre-flight)
pytest-only additions. Avoid re-testing what ActionableErrorTests etc. already cover.

## Builder pre-flight
1. Run `grep -c "def test" test_run_agent.py`; list classes; identify weak spots.
2. Cross-ref run_agent.py error/exit-code branches against existing tests.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 442+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```