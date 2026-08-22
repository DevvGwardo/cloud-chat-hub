# SLICE 4 — Last exhaustive-deps warning: add `stop` to the conversation-switch effect

## Problem
`src/hooks/useChat.ts` — the effect starting at line 3037 (conversation-switch guard) calls
`stop()` at line 3068 but omits it from its dep array at line 3213. ESLint flags this as the
repo's only remaining exhaustive-deps warning.

Verified in slice 3 pre-flight:
- `stop` is `useCallback(..., [sdkStop])` at useChat.ts:2436, and `sdkStop` comes from
  `useAIChat` — so `stop`'s identity changes only when the SDK's stop changes.
- The effect already depends on `isStreaming`, and the switch-guard only fires while
  streaming. Adding `stop` cannot introduce spurious re-runs beyond what `sdkStop`
  identity changes already imply.

## Change
Add `stop` to the dep array at line 3213 (alphabetical placement per existing style):
```ts
}, [aiChatSessionId, chatSessionId, clearStreamRetryIndicator, conversationId, safeSetMessages, panelId, resetPanelFileState, restoreFileState, saveConversationFiles, hydrateConversationMessages, isStreaming, scopeId, sessionLock, stop]);
```

## Out of scope
- The remaining ~30 react-refresh / other warnings (separate classes)
- Any change to `stop` itself, `useAIChat`, or the switch-guard logic
- The giant dep-array's general shape (a refactor for another day)

## Builder pre-flight
1. Confirm warning still reads "missing dependency: 'stop'" at line ~3213/3214.
2. Confirm `stop` is still `useCallback(..., [sdkStop])`.
3. Confirm no OTHER missing-dep warnings appear after the edit (the plugin reports one
   missing dep at a time — if adding `stop` reveals a second missing name, STOP, roll back,
   and record it as deferred rather than growing scope).

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → zero exhaustive-deps warnings; **no NEW warnings** of any kind (total ≤ 31).
3. `npm test` → all tests pass (baseline: 134 files / 820 tests).
4. Diff touches ONLY src/hooks/useChat.ts (1-2 lines).
5. One conventional commit (`fix:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
npm run lint 2>&1 | grep -c "exhaustive-deps"   # expect 0
```

## Commit message
`fix: add stop to conversation-switch effect deps to clear last exhaustive-deps warning`
