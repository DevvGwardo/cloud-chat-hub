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
- 2026-08-22 — Slice 17 landed: request-validation tests (8) — ChatCompletionRequest defaults/extra-fields-tolerated/messages default, _no_api_key_error provider-specific vs generic messages + OpenAI error-dict shape, REPO_NOT_FOUND / GITHUB_TOKEN_EXPIRED envelopes. Tests must tolerate test_main.py's pydantic/fastapi STUBS (stub BaseModel doesn't validate types; stub JSONResponse exposes .content not .body) — assertions restricted to behavior shared by both environments, message-content access stub-adaptive. Tests 453→461; lint held at zero.
- 2026-08-22 — Slice 18 landed: hermes_ops guards + fallback-chain edges (11 tests) — set_fallback_providers moa case-insensitive block, base_url validated on set (file:// rejected, trailing slash stripped), get_fallback_providers skips non-dict/incomplete entries + legacy dedupe, assert_safe_http_base_url scheme/host checks, CLI token empty/dash/bad-chars rejection, goal multiline/null-byte/leading-dash rejection with natural-language passthrough. Tests 461→472 (hermes_ops 60→71); lint held at zero.
- 2026-08-22 — Slice 19 landed: goals/tool-search config edges (13 tests) — missing-section defaults, non-dict sections ignored, max_turns clamped to ≥1, set creates missing sections, no-op body changes nothing; tool_search boolean shorthand (True→auto/False→off), threshold clamped 0–100, limits clamped with search_default ≤ max, garbage numeric strings fall back to defaults, garbage "enabled" rejected on set. Tests 472→485 (hermes_ops 71→84); lint held at zero.
- 2026-08-22 — Slice 20 landed: checkpoint edges (14 tests) — workdir resolution (explicit wins, prefers live-with-commits over live-without, orphans never selected, blank fields skipped), assert_safe_workdir (relative/control-chars rejected), assert_safe_checkpoint_index (0/neg/garbage rejected, float truncates), _format_checkpoint_entries malformed rows (non-dict skipped with ORIGINAL index preserved, missing reason defaults). REAL DEFECT: garbage files_changed ("lots") raised ValueError inside int() and killed the whole checkpoint listing — wrapped in try/except → 0. Tests 485→499 (hermes_ops 84→98); lint held at zero.
- 2026-08-22 — Slice 21 landed: new test_delegation_live.py (18 tests) — path parsing (deleg id + task index), _safe_delegation_dir traversal/symlink escape rejection (resolve+relative_to guard works), manifest read (delegation_id injected, FileNotFoundError), list_recent_manifests (invalid JSON skipped, newest-first, limit clamped ≤20), tail_task_log (full read, offset paging with done-detection, missing log → empty not-done, task_index bounds −1/65 rejected). Traversal guard confirmed solid. Tests 499→515; lint held at zero.
- 2026-08-22 — Slice 22 landed: new test_cursor_composer_bridge.py (8 tests) — probe_bridge_health outcomes (healthy ok / 200-but-wrong-status-field → degraded / connection-refused URLError → down with truncated detail / unexpected exception → error / invalid JSON body → error) and bridge_status aggregate (no skills + unreachable → disconnected, one SKILL.md installed → skills_ready, envelope fields present). Tests 515→523; lint held at zero.
- 2026-08-22 — Slice 23 landed: new test_messaging_platforms.py (14 tests) — env-file helpers (missing→empty, comment/quote parsing, in-place update preserving comments + removing dropped keys, append), nested config get/set (missing→default, intermediate dict creation, overwrite), OAuth URL builders (discord client_id/scope/callback, slack/teams shape), gateway_state (missing/corrupt → empty platforms, valid read). Tests 523→537; lint held at zero.
- 2026-08-22 — Slice 24 landed: new test_kanban_tools.py (18 tests) — _active_card_ids env parsing (single/comma/missing), _find_current_card (explicit id preferred → first running fallback → None on fetch fail), kanban_read_current_card full/minimal render + no-card error, update_status PATCH body with reportPath + unreachable error + no-card error, alias mapping (show→read, complete→done+summary, block→blocked+reason), comment requires body, heartbeat timestamped note. Tests 537→555; lint held at zero.
- 2026-08-22 — Slice 25 landed: new test_team_tools.py (20 tests) — TEAM_ID/TEAM_SUBTASK_ID guards on all six tools, delegation POST body + confirmation id, progress blockers (coordinator /blocked call + importance 3 + blocked tag vs no-blocker importance 2), context query rendering (tags/stars/author/300-char truncation) + no-match + unreachable, publish_finding type inference (decision/artifact/question/default by title keywords) + title-prefixed content, request_help directed vs broadcast tags, signal_completion (finding→PATCH order, PATCH-failure coordinator-fallback third call, summary truncated to 200). Tests 555→575; lint held at zero.
- 2026-08-22 — Slice 26 landed: new test_mcp_telemetry.py (15 tests) — _sanitize hyphen→underscore mirroring the agent, resolve_server longest-prefix-wins + sanitized-name return + non-mcp None, error detection by output prefix (Error/tool error/json-error → errors counter), unattributable calls reaped from inflight without leaking, minute-bucket accumulation (total/errors), input capped at 400 chars, snapshot remaps sanitized keys to raw config names for the dashboard. Persistence mocked out. Tests 575→590; lint held at zero.
- 2026-08-22 — Slice 27 landed: new test_brain_cache.py (18 tests) — _CircuitBreaker state machine (closed→open at threshold, success resets, open→half-open via monotonic mock after recovery window, half-open allows attempt), token loading (openclaw.json → HERMES_BRAIN_TOKEN env fallback, cached after first load), retry logic (success first try no sleep, None→retry then succeed, exhausted retries → None + call count, circuit-open skips call entirely, exception counts as failure), safe wrappers (set/get/delete result mapping, ttl passthrough). Tests 590→608; lint held at zero.
- 2026-08-22 — Slice 28 landed: new test_challenge.py (14 tests) pinning the seeded-bug behavior of challenge.py (the review-exercise module from the fuzzing-infra commit): shared DEFAULT_PORTS mutation via Config default, discount cache keyed on first-dash split ("SAVE" not "SAVE-20") + floor at zero, Worker.jobs_done CLASS-variable accumulation across instances, parallel_square thread-count invariance, compute_stats([]) ZeroDivisionError, cached_load lock leak on miss (verified _lock.locked() True after call) with cache-hit-after-unjam. Tests are behavior-pins for the review exercise, not endorsements. Tests 608→622; lint held at zero.
- 2026-08-22 — Slice 29 landed: new test_challenge_script.py (18 tests) for the second exercise module — module crashes on plain import (register returns None → stacked decorators TypeError; pinned + worked around with a tolerant registry shim returning a no-op decorator), closure workers share final loop value, shared default buffer across instances, counter lock leak on negative increment, singleton class-attr clobber (instance attr shadows it — corrected my initial wrong assumption), silent None after exhausted retries, float bounds accepted, generator close termination despite swallowed GeneratorExit (corrected: Python forces the close). Tests 622→640; lint held at zero.
- 2026-08-22 — Slice 30 landed: new test_pricing_edges.py (19 tests) — rule precedence (free suffix beats opus/gpt rules, opus > sonnet, gemini-flash-lite < flash, bare "flash" NOT gemini so deepseek-v4-flash hits the deepseek rule, model rules beat provider defaults), resolve_provider edges (billing provider authoritative over model name, "custom:..." aggregator → unknown without a model, openai-codex/kimi-coding aliases, model-name inference fallback, unknown when nothing matches), cache-rate defaults (10% read / 125% write of input, explicit rates win, deepseek's explicit 0.014), cost math (zero tokens, reasoning at output rate, mixed bundle exact math). Tests 640→659; lint held at zero.
- 2026-08-22 — Slice 31 landed: new test_mcp_tool_loop_check.py (7 integration tests) — tool_def frontend contract, MockMCPServer success/failure payloads, run_round register→dispatch→deregister hygiene across multiple rounds. SEVENTH REAL DEFECT + fix: importing hermes_adapter clobbers sys.modules["run_agent"] unconditionally, breaking test_run_agent in shared runs; fixed with a _pin_bridge_run_agent() helper re-asserting the bridge-local module after each clobbering import. Tests 659→666; lint held at zero.
- 2026-08-22 — Slice 32 landed: new test_computer_use_frames.py (21 tests) — is_computer_use_tool detection (computer_use/computer only, case/whitespace-insensitive), SPARK_KEEP_CU_SCREENSHOTS env flag truthiness, _data_url_from_capture_b64 mime defaults/prefixing, _image_url_from_part dict+string forms and blank rejection, extract_image_data_url across shapes (plain data URL, JSON-encoded, _multimodal content list, structuredContent nesting, b64 keys wrapped as png, long base64 heuristic, regex fallback on prose, no-image → None). Patch/capture paths out of scope (need hermes-agent pkg + cua-driver). Tests 666→687; lint held at zero.

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

### Slice 17 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **461 passed, 5 skipped** (new test_request_validation.py, 8 tests) |
| diff | new hermes-bridge/test_request_validation.py only, +103 |
| commit | e116dea pushed to feat/codex-function-calling |

Gotcha recorded: test_main.py installs pydantic/fastapi STUBS at module level — any test
file importing main after it sees non-validating BaseModel and _JSONResponse(.content).
Strict-type validation is untestable in the shared process; keep such assertions
stub-adaptive or move to a subprocess-isolated file.

### Slice 18 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **472 passed, 5 skipped** (hermes_ops 60→71) |
| diff | only hermes-bridge/test_hermes_ops.py, +86 |
| commit | a8ede91 pushed to feat/codex-function-calling |

### Slice 19 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **485 passed, 5 skipped** (hermes_ops 71→84) |
| diff | only hermes-bridge/test_hermes_ops.py, +83 |
| commit | 53d7484 pushed to feat/codex-function-calling |

One test written then corrected against actual behavior: bare-string tool_search values
("true"/"off") are NOT parsed — only dict form reads enabled aliases; the string branch
falls back to defaults. Test pins that fallback rather than the imagined alias parsing.

### Slice 20 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **499 passed, 5 skipped** (hermes_ops 84→98) |
| diff | hermes_ops.py +6/−1 (files_changed guard) + test_hermes_ops.py +103 |
| commit | c4d5a55 pushed to feat/codex-function-calling |

Sixth real defect: one malformed files_changed value crashed the entire checkpoint
listing (int() uncaught). Now coerced to 0. Also pinned: float checkpoint indices
truncate (1.5→1) rather than reject, and entry indices reflect original positions.

### Slice 21 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **515 passed, 5 skipped** (delegation_live 0→18) |
| diff | new hermes-bridge/test_delegation_live.py, +142 |
| commit | 4b60b0e pushed to feat/codex-function-calling |

Security-relevant positive finding: the _safe_delegation_dir traversal/symlink guard
(resolve + relative_to) held against every escape attempt including symlinked deleg dirs.

### Slice 22 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **523 passed, 5 skipped** (cursor_composer_bridge 0→8) |
| diff | new hermes-bridge/test_cursor_composer_bridge.py, +114 |
| commit | cb93e59 pushed to feat/codex-function-calling |

### Slice 23 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **537 passed, 5 skipped** (messaging_platforms 0→14) |
| diff | new hermes-bridge/test_messaging_platforms.py, +127 |
| commit | df4e5f2 pushed to feat/codex-function-calling |

Note: HERMES_HOME must be set to a temp dir BEFORE importing the module — paths pin
at import time. The env-file writer preserves comments and drops removed keys, verified.

### Slice 24 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **555 passed, 5 skipped** (kanban_tools 0→18) |
| diff | new hermes-bridge/test_kanban_tools.py, +187 |
| commit | 230599d pushed to feat/codex-function-calling |

### Slice 25 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **575 passed, 5 skipped** (team_tools 0→20) |
| diff | new hermes-bridge/test_team_tools.py, +270 |
| commit | 9851b48 pushed to feat/codex-function-calling |

Notable pinned behavior: signal_completion has a three-call chain (context finding →
delegation PATCH → coordinator-fallback finding on PATCH failure) — now guarded by tests
so the fallback can't silently regress.

### Slice 26 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **590 passed, 5 skipped** (mcp_telemetry 0→15) |
| diff | new hermes-bridge/test_mcp_telemetry.py, +118 |
| commit | d3c7d5e pushed to feat/codex-function-calling |

### Slice 27 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **608 passed, 5 skipped** (brain_cache 0→18) |
| diff | new hermes-bridge/test_brain_cache.py, +195 |
| commit | 14226f3 pushed to feat/codex-function-calling |

### Slice 28 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **622 passed, 5 skipped** (challenge.py 0→14) |
| diff | new hermes-bridge/test_challenge.py, +159 |
| commit | 16c0411 pushed to feat/codex-function-calling |

### Slice 29 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **640 passed, 5 skipped** (challenge_script 0→18) |
| diff | new hermes-bridge/test_challenge_script.py, +236 |
| commit | e51f14d pushed to feat/codex-function-calling |

### Slice 30 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **659 passed, 5 skipped** (pricing 10→29) |
| diff | new hermes-bridge/test_pricing_edges.py, +125 |
| commit | 5354d66 pushed to feat/codex-function-calling |

### Slice 31 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **666 passed, 5 skipped** (mcp_tool_loop_check 0→7, real threaded server) |
| diff | new hermes-bridge/test_mcp_tool_loop_check.py, +129 |
| commit | 739eec4 pushed to feat/codex-function-calling |

### Slice 32 (architect, 2026-08-22)
| Gate | Result |
|---|---|
| typecheck | pass |
| lint | 0 errors, 0 warnings (held) |
| npm test | 134 files, 829 tests passed |
| pytest hermes-bridge | **687 passed, 5 skipped** (computer_use_frames 0→21) |
| diff | new hermes-bridge/test_computer_use_frames.py, +125 |
| commit | ec3ba90 pushed to feat/codex-function-calling |

Scope note: the monkey-patch install/restore and try_supplemental_capture paths need
the hermes-agent package and cua-driver respectively — intentionally untested here.
One subtest corrected against source: only "computer_use"/"computer" are CU tools.

Seventh real defect: hermes_adapter's import unconditionally overwrites
sys.modules["run_agent"], breaking test_run_agent in any shared-process run that
touches hermes_adapter first. Fixed in-test with _pin_bridge_run_agent() re-assertion.
Root cause lives in hermes_adapter.py:94 — a source fix would need the frozen-contract
escalation path (adapter relies on the swap for RealAIAgent resolution).

One assumption corrected against source: "custom:..." billing providers resolve to
"unknown" when no model name is present — "custom" is deliberately absent from
PROVIDER_DEFAULTS since aggregators are priced by model-name rules instead.

Discovery: challenge_script.py crashes on plain import — the stacked
@TaskRegistry.register decorators explode because register returns None (an
unstated bug #10). Tests load via exec with a tolerant shim. Two of my own
assertions corrected against actual runtime behavior during build.

challenge.py/challenge_script.py are the seeded-bug review exercises from the fuzzing-infra
commit (607cb62b) — never imported by main. Tests pin their buggy behavior so accidental
edits surface; they are documentation, not endorsements of the bugs.

Two test bugs caught during build (both mine, not the source): (1) recovery=0.0 makes the
circuit transition to half-open instantly — used monotonic mock + real 30s window instead;
(2) the env-fallback test never set HERMES_BRAIN_TOKEN. Also isolated the GLOBAL breaker
per retry test — failure accumulation across tests was opening the circuit mid-suite.

## Next slice
<!-- architect writes; small enough for one PR -->
See docs/SLICE.md.

### Factory mount (2026-08-31)
| Gate | Result |
|---|---|
| typecheck | pass — tsc 3 configs |
| lint | pass — 0 warnings (after fixing any) |
| vitest | 829 passed (134 files) |
| factory routes | /api/factory/status, /api/factory/dispatch, /api/factory/queue, /api/factory/kanban/sync added to HEALTH_ROUTES |
| adapter | server/routes/factory.ts lazy-imports ~/software-factory/src/adapters/cloud-chat-hub.ts |
| work | server/index.ts +2 lines import +1 line register +4 health routes |
| source | ~/software-factory 36/36 gates, mount verified via typecheck |
