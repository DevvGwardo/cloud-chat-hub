# SLICE 14 — Test coverage: hermes-bridge hermes_adapter model routing

## Problem
hermes_adapter.py routes models to providers (nous/openrouter/custom base_urls, vision
detection, image stripping). test_hermes_adapter_*.py files exist for MCP, web-fallback,
and notices — pre-flight should check whether core model→provider resolution and
vision/image handling are covered outside main.py's indirect tests.

## Change (finalize after pre-flight)
pytest-only additions. Skip anything needing a live API.

## Builder pre-flight
1. Map hermes_adapter.py public surface + which test files touch it.
2. List uncovered branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 411+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
