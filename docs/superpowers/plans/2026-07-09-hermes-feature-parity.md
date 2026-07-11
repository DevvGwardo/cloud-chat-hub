# Hermes Feature Parity Plan - 2026-07-09

## Snapshot

CloudChat already covers a large part of the current Hermes surface: local Hermes bridge routing, provider/model picker, toolset toggles, MCP servers, cron jobs, sessions, usage, memory and skill panels, messaging platform admin, loop mode, swarm pipeline, background run continuation, and repo-aware agent mode.

The highest-value recent gap is Hermes Mixture of Agents (MoA). Hermes treats MoA as a virtual provider: presets appear under provider `moa`, the selected preset name is the model, `/moa <prompt>` runs a one-shot default preset, and the native Hermes agent keeps the normal tool loop with the aggregator as the acting model.

## Implemented Now

1. Expose MoA presets from Hermes `config.yaml` in `/v1/providers`.
2. Let CloudChat select provider `moa` and a preset model through the existing Hermes picker.
3. Route `x-hermes-provider: moa` to the native Hermes adapter with `provider="moa"`.
4. Add `/moa <prompt>` to the local slash menu and bridge shortcut handling.
5. Reject MoA in passthrough/swarm modes with explicit errors instead of silently misrouting it.

## Recommended Next Features

1. Context references in the composer: expand `@file:`, `@folder:`, `@diff`, and `@url` before send, with token estimates and line-range support.
2. Tool Search for large MCP setups: defer long MCP schemas and expose a searchable tool index when enabled tools exceed a context threshold.
3. Checkpoints and rollback UI: snapshot repo/workspace changes before agent writes and provide a tight rollback panel tied to tool events.
4. LSP diagnostics surfacing: after file writes, show newly introduced TypeScript/Python diagnostics in the activity stream.
5. Skill curator controls: show active/stale/archived skills, usage counts, and safe archive/restore actions in the Skills panel.

## Route

Keep MoA native to Hermes rather than reimplementing the full reference/aggregator loop in CloudChat. CloudChat should discover, select, and route MoA; Hermes should execute it. This preserves the real Hermes behavior as it evolves and avoids duplicating provider-specific model semantics in the bridge.
