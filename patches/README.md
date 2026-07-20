# Hermes agent patches (Spark)

Patches in this directory are applied to the local Hermes git clone at
`~/.hermes/hermes-agent`. They are **not** upstreamed yet.

## `hermes update` clobbers local edits

Running `hermes update` (or pulling a new hermes-agent release) overwrites
`gateway/platforms/api_server.py` and removes these patches. After an update,
re-apply:

```bash
cd ~/.hermes/hermes-agent
git apply /path/to/cloud-chat-hub/patches/hermes-api-server-runs-parity.patch
# or: patch -p1 < .../hermes-api-server-runs-parity.patch
```

Restart the Hermes gateway (API server on port 8642) so `/v1/capabilities`
advertises `features.runs_parity`.

**Rebased for Hermes 0.19.0 (2026.7.20).** If `git apply` fails after a future
update, regenerate against the current `api_server.py` — line anchors drift
quickly around `_handle_runs` / `_create_agent`.

## What the runs-parity patch adds

- `POST /v1/runs` accepts optional `cwd` / `working_directory`, `enabled_toolsets` /
  `toolsets`, `provider`, and `reasoning_effort`.
- `_create_agent` honors those overrides instead of only platform config.
- Session cwd is pinned via `set_session_vars(cwd=...)` for the run thread.
- `GET /v1/capabilities` reports `features.runs_parity` and
  `features.spark_runs_overrides`.

Spark probes those capability flags (or `HERMES_RUNS_PARITY=1`) before sending
parity fields from `hermes-bridge/hermes_runs.py`.
