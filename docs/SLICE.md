# SLICE 17 — Test coverage: main.py chat request validation & auth edges

## Problem
test_chat-route-validation.test.ts covers the Express side, but main.py (FastAPI bridge)
request validation — malformed messages arrays, oversized payloads, missing model,
auth-header edge cases on /v1/chat/completions and /v1/models — has only indirect
coverage via test_main.py's EdgeCaseTests.

## Change (finalize after pre-flight)
pytest-only additions to test_main.py or a new focused file. Skip live-agent paths.

## Builder pre-flight
1. Map main.py request-validation branches (4xx returns) vs existing tests.
2. Identify untested validation branches with line refs.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 453+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```