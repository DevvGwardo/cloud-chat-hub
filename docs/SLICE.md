# SLICE 2 — Fix same-class stale-dep warnings in the three MCP panels (`toolIndex.reload`)

## Problem
Three components call `useHermesMcpToolIndex()` into an object named `toolIndex`, then pass
`[toolIndex.reload]` as the useCallback dependency. ESLint flags these as missing-dependency
warnings because it wants `toolIndex` itself — but adding the whole object would make the
callback change identity every render (the hook returns a fresh object literal each render,
see src/hooks/useHermesMcpToolIndex.ts:72-85). The correct minimal fix is to destructure
`reload` at the call site so the dependency is a stable value, not a property access on a
per-render object:

- `src/components/mcp/McpStoreView.tsx:213,234`
- `src/components/settings/HermesMcpSettingsPanel.tsx` (~line 209)
- `src/components/sidebar/HermesMCPPanel.tsx` (~line 207)

## Change
In each of the three files, replace:
```ts
const toolIndex = useHermesMcpToolIndex();
```
with:
```ts
const { reload: reloadToolIndex, ...rest } = useHermesMcpToolIndex();
```
(keep every other property the component uses, named exactly as before so downstream code is
untouched), then update the callback body to `await reloadToolIndex()` and its dep array to
`[reloadToolIndex]`. No behavior change — `reload` was already stable (useCallback over
`[enabled]`).

## Out of scope
- Any other lint warning (useChat.ts, ContextualSuggestions.tsx, HermesMcpSettingsPanel's
  OTHER warnings if any, react-refresh warnings, etc.)
- Changing `useHermesMcpToolIndex` itself or its return shape
- Any refactor of the panels' rendering logic

## Builder pre-flight
1. Confirm all three warning sites still exist at the listed lines (update refs if moved).
2. Confirm each file only consumes `toolIndex.<prop>` accesses that survive the destructure.
3. Confirm `reload` in useHermesMcpToolIndex.ts is still `useCallback([enabled])` (stable).

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → the 3 `toolIndex` warnings gone; **no NEW warnings** anywhere (total ≤ 35).
3. `npm test` → all tests pass (baseline: 134 files / 820 tests).
4. Diff touches ONLY the three named component files.
5. One conventional commit (`fix:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
npm run lint 2>&1 | grep -c "missing dependency: 'toolIndex'"   # expect 0
```

## Commit message
`fix: destructure stable reload from MCP tool index hook to clear exhaustive-deps warnings`
