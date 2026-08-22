# SLICE 7 — Test coverage: hermes provider routing (custom endpoints)

## Problem
Lint debt is now zero and all 820 tests pass. The highest-value remaining gap per the
loop's priority list is test coverage of **provider routing for custom endpoints** —
the exact class that produced the `_KNOWN_HOSTS ''` base_url bug (empty-string host made
`'' in url` always true, hijacking custom-endpoint routing).

Find where request routing decides between default/hermes/custom endpoints (likely in
src/hooks/useChat.ts buildRequestBody + src/lib/api.ts + server route handling) and check
what's already covered before writing anything.

## Change (to be finalized after pre-flight)
Add unit tests ONLY for the pure routing/decision logic:
- given a custom base_url, requests route to it (not the default)
- given an empty-string base_url, the empty-host trap does NOT trigger (regression test
  for the `_KNOWN_HOSTS ''` bug class)
- given missing/unset config, falls back to the keyless/default tier

No production code changes unless a test exposes a real defect — if one is found, fix it
in this slice and note it explicitly.

## Out of scope
- Integration tests hitting real endpoints
- Electron IPC or bridge transport tests
- Any refactor of the routing code itself

## Builder pre-flight
1. Locate the routing decision code; cite file:line.
2. List existing tests touching it (`grep -rn "base_url\|baseUrl" src/test/ server/`).
3. Confirm whether the `_KNOWN_HOSTS ''` fix has any regression test today.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → 0 errors, **0 warnings** (stay at zero).
3. `npm test` → all pass; new tests included; count ≥ previous baseline (820+).
4. Diff touches ONLY test files (+ at most one production file if a real defect surfaced).
5. One conventional commit (`test:` or `fix:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
```
