# SLICE 9 — Perf: memoize per-render array allocations in hot chat paths (slice-1 pattern, round 2)

## Problem
Slice 1 fixed the `members` array pattern. Pre-flight should re-sweep the chat render
paths for the same class: `const x = someArray.filter/map/slice(...)` computed inline in
the component body (not in useMemo) and then used as a useMemo/useCallback dependency —
each re-run allocates and invalidates downstream memos every render.

Known candidates from the slice-1 audit (verify current state first):
- `src/hooks/useRoomChat.ts:38` — `const messages = roomMessages.map(toChatMessage)` runs
  every render; if it feeds a dependency anywhere downstream, wrap in useMemo over
  `[roomMessages]`.
- `src/components/sidebar/ImagesPanel.tsx` — `extractImageUrls` output state handling
  (verify; may already be effect-scoped).

## Change (finalize after pre-flight)
Wrap genuinely hot, dependency-feeding allocations in useMemo. Do NOT memoize anything
that renders once or feeds nothing — that's speculative.

## Out of scope
- Any component outside src/components/chat/ + src/hooks/ unless pre-flight proves a
  dependency-feeding allocation there
- Changing what is computed, only when/how often

## Builder pre-flight
1. For each candidate, trace whether the allocation is a dep of any memo/callback/effect.
2. Grep for other `= .*\.map(` / `= .*\.filter(` at component-body level in chat paths.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → 0 errors, 0 warnings.
3. `npm test` → all pass; total ≥ 829.
4. Diff touches ONLY the files pre-flight names, minimal lines each.
5. One conventional commit (`perf:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
```
