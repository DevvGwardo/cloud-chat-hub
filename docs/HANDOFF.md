# HANDOFF — Spark (cloud-chat-hub)

> Shared memory for the architect loop. The builder appends after every work session.
> Not in this file = didn't happen. Raw results only — verdicts belong to the architect.

## Project
- Goal: Spark — an Electron + React + TypeScript AI coding assistant / GitHub workflow hub with an Express API server and a Python hermes-bridge. The loop's goal is continuous small, verified quality improvements (tests, types, lint, perf) without scope creep.
- Stack: TypeScript / React / Vite frontend (`src/`), Express server (`server/`), Electron shell (`electron/`), Python FastAPI bridge to Hermes agent (`hermes-bridge/`)
- How to run tests: `npm run typecheck && npm run lint && npm test` (+ `pytest -q` in `hermes-bridge/` if Python touched)

## Frozen contracts
<!-- schemas/interfaces frozen in PHASE 1; read-only after freeze. Link files in docs/. -->
(none yet)

## Frozen gates
<!-- acceptance criteria, written BEFORE results exist; never edited after -->
(none yet)

## Open disagreements
<!-- builder adds; architect rules accept/reject/modify + one line why, then moves to log -->
(none)

## Decision log
<!-- architect rulings: date — decision — one-line why -->
- 2026-08-22 — Loop initialized; baseline gate run recorded below — establishes green starting point before first slice.
- 2026-08-22 — Slice 1 landed: `members` array wrapped in `useMemo` in SwarmRoomPanel.tsx + useRoomChat.ts — kills 4 per-render memo invalidations in chat mention paths; lint backlog 42→38.
- 2026-08-22 — Slice 2 landed: destructured stable `reload` from `useHermesMcpToolIndex` in the 3 MCP panels — clears 3 exhaustive-deps warnings without destabilizing the callbacks; lint backlog 38→35.
- 2026-08-22 — Slice 3 landed: added missing stable deps in useRoomChat.handleSend (`setInput`), ContextualSuggestions effect (`lastAssistant`/`lastUser`, narrowed optional chains), useVoiceInput unmount cleanup (`cleanupStream`), useChat.buildRequestBody (`panelId`) — lint backlog 35→31; only remaining exhaustive-deps is useChat.ts:3213 `stop` (verified safe-add candidate for slice 4).
- 2026-08-22 — Slice 4 landed: added `stop` to the conversation-switch effect deps (useChat.ts:3213) — exhaustive-deps class fully cleared, zero remaining; lint backlog 31→30. Next class: react-refresh warnings (~29) and misc single-file warnings.
- 2026-08-22 — Slice 5 landed: pre-flight found `allowConstantExport` already enabled, so pivoted per spec fallback — moved motion presets into motion-presets.ts (10 warnings), removed toast.tsx dead re-export + unused `useToastContext` export (4), un-exported unused `HERMES_EFFORT_LABELS`/`filterJobsForConversation` (2); lint backlog 30→14. Remaining react-refresh sites need import-site changes (contexts, ui/* cva variants, helper fns) or are spark-landing.

## Raw results
<!-- builder appends per session: tables and numbers only -->

### Baseline (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 42 warnings |
| unit tests | 134 files, 820 tests passed (~16s) |

### Slice 1 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 38 warnings (was 42; 4 exhaustive-deps `members` warnings gone) |
| unit tests | 134 files, 820 tests passed |
| diff | only SwarmRoomPanel.tsx + useRoomChat.ts, 2 insertions / 2 deletions |
| commit | 19f6d10 pushed to feat/codex-function-calling |

### Slice 2 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 35 warnings (was 38; 3 `toolIndex` exhaustive-deps warnings gone; grep for "missing dependency: 'toolIndex'" = 0) |
| unit tests | 134 files, 820 tests passed |
| diff | only McpStoreView.tsx, HermesMcpSettingsPanel.tsx, HermesMCPPanel.tsx — 3 files, +9/−9 |
| commit | 0b7eb47 pushed to feat/codex-function-calling |

### Slice 3 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 31 warnings (was 35; all 4 targeted exhaustive-deps warnings gone) |
| unit tests | 134 files, 820 tests passed |
| diff | ContextualSuggestions.tsx +2/−2, useChat.ts +1, useRoomChat.ts +1/−1, useVoiceInput.ts +2/−1 — only the 4 named files |
| commit | 12b7a20 pushed to feat/codex-function-calling |

Note: useVoiceInput fix used dep-add (`[cleanupStream]`, stable useCallback []) rather
than the spec's suppression fallback — cleaner than spec'd, same warning count.

### Slice 4 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 30 warnings (was 31; exhaustive-deps count now 0) |
| unit tests | 134 files, 820 tests passed |
| diff | only useChat.ts, +1/−1 |
| commit | d27d352 pushed to feat/codex-function-calling |

### Slice 5 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 14 warnings (was 30; react-refresh 29→13) |
| unit tests | 134 files, 820 tests passed |
| diff | motion.tsx split into motion-presets.ts + 4 import-site updates; toast.tsx dead re-export + unused hook removed; 2 unused exports un-exported — 10 files, +88/−79 |
| commit | ad2b673 pushed to feat/codex-function-calling |

Spec deviation note: `allowConstantExport: true` was ALREADY set in eslint.config.js:36,
so the config step was a no-op; proceeded directly to the capped manual-fix fallback.

## Next slice
<!-- architect writes; small enough for one PR -->
See docs/SLICE.md.
