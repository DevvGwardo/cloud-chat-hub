# SLICE 19 — Test coverage: hermes_ops checkpoints & goals round-trip edges

## Problem
hermes_ops.py is 2912 lines; the checkpoint section (list/restore/format, ~line 280-450)
and goals/tool-search config setters have partial coverage. Pre-flight should check the
remaining branches: malformed checkpoint entries, goals config validation (bad body
shapes), tool-search config edge inputs.

## Change (finalize after pre-flight)
pytest-only additions. Mock the checkpoint manager factory.

## Builder pre-flight
1. Read hermes_ops.py checkpoint + goals + tool-search sections vs existing tests.
2. List uncovered branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 472+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```