# SLICE 20 — Test coverage: hermes_ops checkpoint list/restore round 2

## Problem
Checkpoint tests exist (test_checkpoint_entries_format_and_workdir_resolution,
list/restore via mocked manager). Pre-flight should check remaining branches:
_format_checkpoint_entries with malformed raw entries, get_checkpoints_status shape,
_resolve_checkpoint_workdir edge inputs.

## Change (finalize after pre-flight)
pytest-only additions. Mock the checkpoint manager factory.

## Builder pre-flight
1. Read hermes_ops.py checkpoint section (~280-450) vs the 3 existing checkpoint tests.
2. List uncovered branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 485+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```