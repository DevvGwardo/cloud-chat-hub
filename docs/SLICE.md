# SLICE 1 — Stabilize `members` array identity (kill per-render memo invalidation)

## Problem
`const members = activeRoom?.members ?? []` allocates a new array on every render in two
components. Because `members` is a dependency of downstream `useMemo`s, those memos recompute
on **every render**, defeating memoization entirely. ESLint confirms this:

- `src/components/chat/SwarmRoomPanel.tsx:83` — 3 warnings (`mentionedMembers`, `unknownMentions`, `filteredMentions`)
- `src/hooks/useRoomChat.ts:37` — 1 warning (useMemo at line ~79)

This is a real perf smell in hot chat-rendering code, not a style nit.

## Change
Wrap the initialization in its own `useMemo`, exactly as the lint message prescribes:
```ts
const members = useMemo(() => activeRoom?.members ?? [], [activeRoom]);
```
Apply to both locations. No other changes.

## Out of scope
- Any other lint warning (react-refresh, other exhaustive-deps in useChat.ts / useVoiceInput.ts / McpStoreView.tsx etc.)
- The unused eslint-disable directive in `server/lib/tool-schema.ts`
- Any refactor of the surrounding components, stores, or mention logic
- Any behavior change beyond array identity stability

## Builder pre-flight (mandatory)
Before coding, verify against the repo:
1. Read both files and confirm `activeRoom` is the only input needed for `members`
   (i.e., `activeRoom.members` is not mutated elsewhere after this line).
2. Confirm the exact warning lines still exist as described; if they've moved, update line refs in RESULTS.
3. Confirm `useMemo` is already imported in both files.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → the 4 warnings above are gone; **no new warnings or errors** anywhere (total warnings ≤ 38).
3. `npm test` → all tests pass (baseline: 134 files / 820 tests).
4. Diff touches ONLY `src/components/chat/SwarmRoomPanel.tsx` and `src/hooks/useRoomChat.ts`.
5. RESULTS section in HANDOFF.md contains raw numbers only.

## Verify commands
```
npm run typecheck && npm run lint && npm test
npm run lint 2>&1 | grep -c "SwarmRoomPanel\|useRoomChat"   # expect 0 matches for exhaustive-deps members warnings
```

## Commit
One commit: `fix: stabilize members array identity so mention memos don't invalidate every render`
