# SLICE 3 — Clear the four remaining exhaustive-deps warnings (behavior-preserving dep additions)

## Problem
Four warnings where a callback/effect reads a value but omits it from its dependency array.
In each case adding the dep is safe because the value is already stable (a `useCallback`
product or state-derived value), so no behavior change and no extra re-runs:

1. `src/hooks/useRoomChat.ts:104` — `handleSend` useCallback missing `setInput`.
   `setInput` is `useCallback(..., [])` (line 47) → stable; adding it is a no-op.
2. `src/components/chat/ContextualSuggestions.tsx:63` — effect missing `lastAssistant`.
   Effect already depends on `lastAssistant?.content`; `lastAssistant` is a `findLast`
   result re-created each render, but the effect only re-runs when its deps change, and
   `lastAssistant` is only used via `lastAssistant?.content` inside — replace the dep
   `lastAssistant?.content` usage consistently: keep dep as-is but reference the variable
   instead of repeating the optional chain, i.e. add `lastAssistant` to deps AND use
   `lastAssistant.content` in the body (the guard `!lastAssistant` at line 41 already
   narrows it). Net effect: identical behavior, warning gone.
3. `src/hooks/useVoiceInput.ts:150` — unmount effect missing `cleanupStream`.
   This is a mount-only cleanup effect (`[]` deps) with an in-code comment explaining why
   `onstop` is not nulled. The correct fix is NOT to add the dep (would re-run the effect);
   it is to verify the intent and add a targeted `// eslint-disable-next-line
   react-hooks/exhaustive-deps` with the existing comment as justification. This is a
   single-line suppression with documented rationale — NOT "fixing lint by disabling rules
   wholesale" (anti-pattern only bans wholesale rule disabling).
4. `src/hooks/useChat.ts:1748` — useCallback missing `panelId`. Read the site first: if
   `panelId` is a stable primitive from a store selector, add it to deps. If adding it
   would change callback identity per render, use the ref-pattern the file already uses
   elsewhere; if neither is clean, SKIP this one this slice and record it as deferred
   (3 of 4 cleared still meets the gate).

## Change
Minimal per-site fixes above. No logic rewrites, no extraction of new hooks.

## Out of scope
- The `useChat.ts:3212` `stop` warning (streaming lifecycle — riskier, defer)
- All react-refresh warnings (29 of them, separate class)
- `ContextualSuggestions` suggestion-generation logic itself
- `useVoiceInput` recorder logic itself

## Builder pre-flight
1. Confirm the four warning sites still exist at the listed lines.
2. For site 4: read useChat.ts around 1700-1760 and decide add-dep vs skip per the rule above.
3. Confirm `setInput` in useRoomChat.ts is still `useCallback(..., [])`.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → at least 3 of the 4 warnings gone; **no NEW warnings** (total ≤ 33 if 3 cleared, ≤ 32 if 4).
3. `npm test` → all tests pass (baseline: 134 files / 820 tests).
4. Diff touches ONLY: useRoomChat.ts, ContextualSuggestions.tsx, useVoiceInput.ts, and (only if site 4 attempted) useChat.ts.
5. One conventional commit (`fix:` or `chore:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
npm run lint 2>&1 | grep -c "exhaustive-deps"   # expect 4 fewer than slice-2's count
```
