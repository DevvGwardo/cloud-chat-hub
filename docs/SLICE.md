# SLICE 6 — Clear the remaining 13 lint warnings (mixed exports + stale disable)

## Problem
14 warnings remain after slice 5 (13 react-refresh + 1 unused eslint-disable). Each is a
true mixed export or a dead directive. All have known, small fixes:

1. `server/lib/tool-schema.ts:40` — `// eslint-disable-next-line no-constant-condition`
   above `while (true)` is now unused (the loop terminates via break; rule not triggering).
   Fix: delete the directive line.
2. `spark-landing/src/main.tsx:17` — file exports a component but has no exports the
   plugin recognizes. Read it first; if it's a false positive from an odd export shape,
   normalize the export. If restructuring is needed, DEFER and record.
3. `src/components/chat/ApiKeyModal.tsx:15` — `PROVIDER_KEY_URLS` const exported next to
   the component; sole consumer is SettingsModal.tsx:11.
   Fix: move to `src/lib/provider-key-urls.ts`, update both imports.
4. `src/components/chat/CommandSuggestions.tsx:14` — local `commandTakesArgs` duplicates
   `src/lib/hermes-commands.ts:470`. ChatInput.tsx imports BOTH today.
   Fix: delete the duplicate in CommandSuggestions.tsx; import from '@/lib/hermes-commands'
   in ChatInput.tsx (already imported there) and inside CommandSuggestions.tsx if still used
   at its line 72.
5. `src/components/chat/ContextRefSuggestions.tsx:126` — `buildPickerSuggestions` helper +
   `ContextRefSuggestion` interface exported next to the component; consumers are only
   ChatInput.tsx. Fix: move both into a sibling `context-ref-suggestions-utils.ts` OR
   relocate `buildPickerSuggestions` to `@/lib/context-refs` (preferred — that's where
   CONTEXT_REF_PICKER_ITEMS lives); update imports in ChatInput.tsx.
6. `src/components/sidebar/ImagesPanel.tsx:96` — `extractImageUrls` exported for tests
   only (`src/test/images-panel.test.tsx`). Fix: move function (+ its private regexes and
   getRenderableImage/getToolResultText helpers) to `src/lib/image-extract.ts`, keep
   ImagesPanel importing from there, update test import.
7. `src/components/tour/TourController.tsx:13` — `prepareUiForTour` exported next to the
   component; sole consumer SettingsModal.tsx:29. Fix: move to `src/lib/tour-setup.ts`.
8. `src/components/tour/tour-config.tsx:9` — exports `appTourSteps`/`tourStyles` consts
   AND contains the TourStep component. Fix: move TourStep into TourController.tsx (its
   only consumer), leaving tour-config.tsx as pure data.
9. `src/components/ui/badge.tsx:29` / `button.tsx:47` / `toggle.tsx:37` — shadcn-style
   files exporting `<name>Variants` cva beside the component. Fix per file: create
   `<name>-variants.ts` (e.g. `button-variants.ts`) holding the cva + variant type defs,
   re-import into the tsx, update external importers (only alert-dialog.tsx imports
   buttonVariants; badgeVariants/toggleVariants have NO external importers — just un-export
   them from the public surface by moving them out).
10. `src/components/ui/toast.tsx:125` — remaining warning at the ToastContainer export?
    Re-read after slice 5 edits; likely `ToastProvider` context internals still count.
    Inspect and apply the smallest fix; defer if non-obvious.
11. `src/contexts/CommandCallbacksContext.tsx:33` / `PanelContext.tsx:32,36` — hooks
    exported from provider files with real consumers (7+ files use usePanelId/useChatScopeId).
    Fix: create `src/hooks/use-panel-context.ts` exporting both hooks (importing the
    context object from PanelContext — requires exporting the context itself), same for
    command callbacks. Update all consumer imports. This is the biggest chunk; do it LAST
    in this slice and only if everything above lands clean.

## Out of scope
- Any behavioral change
- spark-landing restructuring beyond the trivial case
- Renaming or reshaping any public API beyond what's listed

## Builder pre-flight
1. Confirm warning lines still match (lint output moves lines — update refs as needed).
2. For item 4, verify the two `commandTakesArgs` are behaviorally identical for the types
   ChatInput passes (both do `usage.includes('<')`).
3. Do items in order 1→10; item 11 only if gates stay green throughout.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → 0 errors; total warnings ≤ 5 (target 0-2; contexts may be deferred);
   **no NEW warnings**.
3. `npm test` → all pass (baseline: 134 files / 820 tests).
4. One conventional commit (`chore:` or `refactor:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
```
