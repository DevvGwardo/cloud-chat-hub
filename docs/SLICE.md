# SLICE 5 — Burn down the react-refresh warning class (29 of the remaining 30 warnings)

## Problem
29 of the 30 remaining lint warnings are `react-refresh/only-export-components` across
16 files. The class breaks Fast Refresh (HMR) for any file that exports both components
and non-component values. Two sub-shapes exist:

- **Constant exports next to components** (e.g. `buttonVariants`, config objects,
  motion variants in src/components/onboarding/motion.tsx, tour-config.tsx) — the rule's
  built-in `allowConstantExport: true` option covers plain `export const X = ...` of
  literal/derived constants WITHOUT touching any component file.
- **True mixed exports** (hooks/helpers exported from context files like
  PanelContext.tsx, CommandCallbacksContext.tsx) — need `export function useX` moved to
  its own file, which changes import sites repo-wide.

## Change
1. Read `eslint.config.js` (or .eslintrc*) and enable `allowConstantExport: true` in the
   react-refresh rule config.
2. Re-run lint. Record how many of the 29 disappear from the config change alone.
3. For any remaining warnings, fix the LOW-RISK ones only: move a pure-constant export to
   an adjacent file (e.g. `button-variants.ts`) and update its import sites — cap at 3
   files moved this slice. Context-provider hooks (PanelContext, CommandCallbacksContext)
   are OUT OF SCOPE — those touch many import sites and deserve their own slice.

## Out of scope
- Moving hooks out of context providers
- Any change to component behavior, props, or styling
- spark-landing/src/main.tsx if it requires restructuring (it's a separate app; if the
  config change doesn't cover it, defer)
- Disabling the rule for any file (suppression = anti-pattern)

## Builder pre-flight
1. Locate the ESLint config and show the current react-refresh rule settings.
2. Confirm the 29 warnings still match the class list above.
3. After enabling allowConstantExport, list exactly which warnings remain.

## Acceptance gates (frozen before results)
1. `npm run typecheck` → exit 0.
2. `npm run lint` → 0 errors; total warnings ≤ 20 (config change alone should clear most
   constant-export cases); **no NEW warnings**.
3. `npm test` → all tests pass (baseline: 134 files / 820 tests).
4. Diff touches ONLY: the ESLint config + at most 3 moved-constant files + their import sites.
5. One conventional commit (`chore:` or `fix:`) pushed to the current feat branch.

## Verify commands
```
npm run typecheck && npm run lint && npm test
npm run lint 2>&1 | grep -c "react-refresh"   # record before/after
```

## Commit message
`chore: enable allowConstantExport for react-refresh and move remaining constant exports out of component files`
