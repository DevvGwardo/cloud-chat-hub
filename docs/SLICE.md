# SLICE 13 — Test coverage: hermes-bridge acp_transport session lifecycle

## Problem
acp_transport.py (ACP transport to the real hermes-agent) has zero dedicated test file.
Pre-flight should check what's importable/testable without a live agent: `acp_available`,
session bookkeeping, idle-reaper logic, event-queue translation, PROMPT_TIMEOUT handling.

## Change (finalize after pre-flight)
pytest-only additions in a new test_acp_transport.py. Mock the agent process; test pure
logic and state transitions only. Skip anything requiring a live hermes-acp binary.

## Builder pre-flight
1. Map acp_transport.py: public functions, module state, what needs a live process.
2. Confirm no existing coverage (grep test_*.py for acp_transport imports).

## Acceptance gates (frozen before results)
1. `npm run typecheck` → 0; lint → 0/0; npm test → ≥ 829.
2. `.venv/bin/python -m pytest -q` → all pass (baseline 392+).
3. Diff touches ONLY hermes-bridge tests (+ minimal source if a real defect surfaces).
4. One conventional commit (`test:`/`fix:`) pushed.

## Verify commands
```
cd hermes-bridge && .venv/bin/python -m pytest -q
cd .. && npm run typecheck && npm run lint && npm test
```
