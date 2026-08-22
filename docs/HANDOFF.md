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
- 2026-08-22 — Slice 6 landed: full lint burn-down to ZERO warnings — deleted stale eslint-disable, moved PROVIDER_KEY_URLS/tour-setup/image-extract/buildPickerSuggestions into lib modules, split cva variants out of button/badge/toggle, extracted context objects into *-value modules with hooks in src/hooks/, moved TourStep into its own file, split spark-landing Root.tsx. Lint backlog 14→0; build verified.
- 2026-08-22 — Slice 7 landed: added hermes provider-routing regression tests — placeholder keys ("none"/"null"/"undefined"/whitespace) must not become Authorization or keep an uncredentialed openrouter pin, and a keyless custom:base_url pin must survive. Tests 820→822; lint stays at zero.
- 2026-08-22 — Slice 8 landed: approval-engine edge cases — "once" rule consumption, expired-rule pruning, missing-command prefix non-match, APPROVAL_TIMEOUT_MS timeout via fake timers, emit-throw → abort, double-resolve idempotency, cross-conversation rule scoping. Tests 822→829 (28 in approval-engine); lint held at zero.
- 2026-08-22 — Slice 9 landed: `messages` in useRoomChat.ts wrapped in useMemo over `[roomMessages]` — the per-render `.map(toChatMessage)` allocation was a dependency of ChatArea's `panelToolActivity` memo (line ~647) and usage-tracking effect (~732), re-running both every render. HermesModelPicker/MessageBubble candidates inspected: feed nothing memoized — skipped per spec.
- 2026-08-22 — Slice 10 landed: cwd-OSError guard regression tests (3: broken getcwd → home fallback, repo-root header wins, healthy getcwd sanity). Found + fixed a real pre-existing test-infra defect on HEAD: test_main.py's httpx stub lacked TimeoutException/HTTPStatusError exception classes, so hermes_adapter's except clauses raised when the stub won the import race (test_dispatch_handles_connection_failure failed in combined runs). pytest hermes-bridge: 365 passed, 5 skipped; npm gates green.
- 2026-08-22 — Slice 11 landed: worktree edge cases — maybe_setup_worktree success/failure/no-root/missing-path, _untrack promotion + unknown-info noop, manual-cleanup empty-path/already-deleted/rmtree-failure, CLI-cleanup-leaves-path → manual fallback, cleanup_session count. Tests 365→379 (worktree 12→26); lint held at zero.
- 2026-08-22 — Slice 12 landed: extract_gateway_error_text direct tests (dict message/type/code preference, string error, top-level message, blank-value skip, non-serializable fallback, 500-char truncation) + needs_agent_loop_parity edges (whitespace base_url ignored, auto/default not explicit, blank github_pat, empty custom_tools, case-insensitive moa match, repo_mode wins with parity). Tests 379→392 (hermes_runs 62→75); lint held at zero.
- 2026-08-22 — Slice 13 landed: new test_acp_transport.py (19 tests) — _safe_conversation_id sanitization (traversal/charset/40-cap), _env_float fallbacks, idle reaper (idle reaped / busy protected / young survive / close failures swallowed), resolve_approval (pending future resolved, unknown id False, done future skipped), shutdown_all (registry cleared, close errors swallowed). Tests 392→411; lint held at zero.
- 2026-08-22 — Slice 14 landed: test_hermes_adapter_helpers.py (11 tests) — _cap truncation (short/exact-limit/overflow marker reports overflow size), parse_fallback_switch_status edges (in-progress wins over arrow pattern, unparseable tail, whitespace stripping, short-form requires parenthesized provider), cache stats reset. CRITICAL lesson re-learned: hermes_adapter must NEVER be imported at module level in tests — it replaces sys.modules["run_agent"] with the hermes-agent copy lacking repo_mode, breaking 47 test_run_agent tests. Lazy import inside test methods only (same contract as test_hermes_adapter_mcp.py). Tests 411→422; lint held at zero.
- 2026-08-22 — Slice 15 landed: bridge_events translation edges (20 tests) — output_truncation exact-cap/partial-line, extract_exit_code camelCase/negative-string/non-numeric, extract_approval_command cmd/script/shell fallbacks + priority skip + 2000-char cap, callback kwarg cache identity + uninspectable cb, tool_call_end coercion, plan-mode malformed inputs. Found + fixed real defect: filter_toolsets_for_plan_mode(None) raised TypeError while sibling filter_tool_defs handles None — now returns []. Tests 422→442; lint held at zero.
- 2026-08-22 — Slice 16 landed: run-command/read-file edge tests (11) — exit 127/2 hints, PermissionError→exit 126 (REAL DEFECT: subprocess.run raises PermissionError for non-executable files and _tool_run_command had no handler → unhandled crash instead of a hint; added except PermissionError), stderr merge, no-output placeholder, sibling-list overflow note (+5 more), permission-denied message, large-file truncation. Also pinned the module-clobber pattern: test binds bridge-local run_agent by explicit file path since hermes_adapter's import replaces sys.modules entry. Tests 442→453; lint held at zero.

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

### Slice 6 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | **0 errors, 0 warnings** (was 14) — `eslint .` exits clean |
| unit tests | 134 files, 820 tests passed |
| build | `npm run build` success (frontend + server bundle) |
| diff | 36 files, +438/−409 — all moves/un-exports, no behavior changes |
| commit | bf68518 pushed to feat/codex-function-calling |

All 11 items from the spec executed including the deferred contexts chunk. New modules:
button/badge/toggle-variants.ts, panel-context-value.ts + use-panel-context.ts,
command-callbacks-context-value.ts + use-command-callbacks.ts, image-extract.ts,
provider-key-urls.ts, tour-setup.ts, TourStep.tsx, spark-landing Root.tsx.

### Slice 7 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held at zero) |
| unit tests | 134 files, **822 tests passed** (was 820; +2 routing regression tests, 15 total in hermes-chat-route) |
| diff | only server/__tests__/hermes-chat-route.test.ts, +132 |
| commit | 5c59248 pushed to feat/codex-function-calling |

Pre-flight finding: the `_KNOWN_HOSTS ''` bug class is already covered by existing tests
("omits empty Authorization..." + "forwards usable Authorization...") — no production
defect surfaced. The new tests close two uncovered branches of `hermesBridgeAuthHeaders`
placeholder handling and keyless custom-pin survival.

### Slice 8 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| unit tests | 134 files, **829 tests passed** (was 822; approval-engine 21→28) |
| diff | only server/__tests__/approval-engine.test.ts, +136/−1 |
| commit | dc4e137 pushed to feat/codex-function-calling |

### Slice 9 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| unit tests | 134 files, 829 tests passed |
| diff | only src/hooks/useRoomChat.ts, +3/−1 |
| commit | 49576cd pushed to feat/codex-function-calling |

Pre-flight: swept chat paths for dep-feeding inline allocations. Only useRoomChat.messages
qualified (feeds ChatArea memo + effect). MessageBubble's buildInterleavedByOffset is a
plain function; HermesModelPicker has zero hooks/memos — both skipped as speculative.

### Slice 10 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **365 passed, 5 skipped** (full suite green incl. test_run_agent/test_main) |
| diff | test_cwd_oserror_guard.py (new, 3 tests) + test_main.py httpx stub fix, +123 |
| commit | 7a8caf2 pushed to feat/codex-function-calling |

Note: pytest with system python3 fails collection (PEP 604 unions) — use the bridge venv:
`.venv/bin/python -m pytest -q`. test_run_agent.py + test_main.py only collect under venv.

### Slice 11 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **379 passed, 5 skipped** (worktree_support 12→26) |
| diff | only hermes-bridge/test_worktree_support.py, +155 |
| commit | c10408c pushed to feat/codex-function-calling |

Pre-flight: existing tests covered flag parsing, toolset routing, path ownership, basic
cleanup. Uncovered: maybe_setup_worktree lifecycle (success chdir+track, failure fallbacks,
blank-root CLI discovery), _untrack promotion semantics, manual-cleanup error paths,
CLI-cleanup-leaves-path → manual fallback chain, cleanup_session counting. All now covered.

### Slice 12 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **392 passed, 5 skipped** (hermes_runs 62→75) |
| diff | only hermes-bridge/test_hermes_runs.py, +99 |
| commit | 4450868 pushed to feat/codex-function-calling |

Note: needs_agent_loop_parity was already well covered (13 cases); the real gap was
extract_gateway_error_text — zero direct tests despite being the user-visible error path
for /v1/runs rejections. Also pinned the truncation cap and case-insensitive moa matching.

### Slice 13 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **411 passed, 5 skipped** (acp_transport 0→19; only BridgeAcpClient._dispatch was covered before) |
| diff | new hermes-bridge/test_acp_transport.py, +221 |
| commit | ce48fbe pushed to feat/codex-function-calling |

Spawn/connect paths intentionally untested (need a live hermes-acp process). One test
expectation corrected during build: handle.close() swallows inner close_session failures
by design (bounded wait_for + force-kill), so the reaper counts those as closed.

### Slice 14 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **422 passed, 5 skipped** |
| diff | new hermes-bridge/test_hermes_adapter_helpers.py, +107 |
| commit | cc2f8a7 pushed to feat/codex-function-calling |

Mid-slice rollback: first version imported hermes_adapter at module level → clobbered
sys.modules["run_agent"] → 47 test_run_agent failures. Rolled back to lazy imports per
the documented contract in test_hermes_adapter_mcp.py's docstring; full suite green.

### Slice 15 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **442 passed, 5 skipped** (bridge_events 31→52) |
| diff | bridge_events.py +1/−1 (None-toolsets fix) + test_bridge_events.py +115 |
| commit | af4c080 pushed to feat/codex-function-calling |

### Slice 16 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **453 passed, 5 skipped** (run_agent edges 0→11) |
| diff | run_agent.py +6 (PermissionError handler) + new test_run_command_edges.py +118 |
| commit | c9953a7 pushed to feat/codex-function-calling |

## Next slice
<!-- architect writes; small enough for one PR -->
See docs/SLICE.md.
