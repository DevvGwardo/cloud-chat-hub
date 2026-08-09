"""Unit tests for the structured SSE event helpers (bridge_events.py).

Covers the fixed event envelopes (tool_call_begin/delta/end, stream_retry,
plan_update, enriched approval_request), the plan-text → steps parser, the
plan-mode tool filtering, and the ACP dispatch mapping.
"""

import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(__file__))

import bridge_events
import acp_transport


class ToolCallEnvelopeTests(unittest.TestCase):
    def test_begin_envelope(self):
        event = bridge_events.tool_call_begin_event("call-1", "run_command", ts=123.5)
        self.assertEqual(
            event,
            {"type": "tool_call_begin", "call_id": "call-1", "name": "run_command", "ts": 123.5},
        )

    def test_begin_defaults_ts_to_now(self):
        event = bridge_events.tool_call_begin_event("c", "n")
        self.assertIsInstance(event["ts"], float)
        self.assertGreater(event["ts"], 1_700_000_000)

    def test_delta_envelope_keeps_string(self):
        event = bridge_events.tool_call_delta_event("call-1", "partial output")
        self.assertEqual(
            event,
            {"type": "tool_call_delta", "call_id": "call-1", "output": "partial output"},
        )

    def test_end_envelope_full(self):
        event = bridge_events.tool_call_end_event(
            "call-1", "run_command", success=True, exit_code=0,
            duration_ms=42, output_truncated=True, output_truncated_lines=7,
        )
        self.assertEqual(
            event,
            {
                "type": "tool_call_end",
                "call_id": "call-1",
                "name": "run_command",
                "success": True,
                "exit_code": 0,
                "duration_ms": 42,
                "output_truncated": True,
                "output_truncated_lines": 7,
            },
        )

    def test_end_envelope_unknown_exit_code_is_null(self):
        event = bridge_events.tool_call_end_event("c", "n", success=False)
        self.assertIsNone(event["exit_code"])
        self.assertEqual(event["duration_ms"], 0)
        self.assertFalse(event["output_truncated"])

    def test_stream_retry_envelope(self):
        event = bridge_events.stream_retry_event(2, 3, "http_429", 1000)
        self.assertEqual(
            event,
            {"type": "stream_retry", "attempt": 2, "max_attempts": 3, "reason": "http_429", "delay_ms": 1000},
        )

    def test_output_truncation_info(self):
        self.assertEqual(bridge_events.output_truncation_info("short", 500), (False, 0))
        self.assertEqual(bridge_events.output_truncation_info(None, 500), (False, 0))
        # Removed tail "line1\nline2\n" → 2 lines
        self.assertEqual(bridge_events.output_truncation_info("head\nline1\nline2\n", 5), (True, 2))
        # Removed tail "tail" (no newline) → 1 partial line
        self.assertEqual(bridge_events.output_truncation_info("head-tail", 4), (True, 1))

    def test_extract_exit_code(self):
        self.assertEqual(bridge_events.extract_exit_code(SimpleNamespace(raw_output={"exit_code": 2})), 2)
        self.assertEqual(bridge_events.extract_exit_code(SimpleNamespace(raw_output={"code": "1"})), 1)
        self.assertIsNone(bridge_events.extract_exit_code(SimpleNamespace(raw_output={"nope": 1})))
        self.assertIsNone(bridge_events.extract_exit_code(SimpleNamespace(raw_output="stdout text")))


class PlanUpdateTests(unittest.TestCase):
    def test_parse_checklist_lines(self):
        steps = bridge_events.plan_steps_from_text("- [ ] research\n- [x] implement\n- [X] ship")
        self.assertEqual(
            steps,
            [
                {"step": "research", "status": "pending"},
                {"step": "implement", "status": "completed"},
                {"step": "ship", "status": "completed"},
            ],
        )

    def test_parse_numbered_lines(self):
        steps = bridge_events.plan_steps_from_text("1. analyze\n2) build\n3. verify")
        self.assertEqual(
            steps,
            [
                {"step": "analyze", "status": "pending"},
                {"step": "build", "status": "pending"},
                {"step": "verify", "status": "pending"},
            ],
        )

    def test_parse_step_headings(self):
        steps = bridge_events.plan_steps_from_text("**Step 1: Analyze**\n**Step 2**\nStep 3: verify")
        self.assertEqual(
            [s["status"] for s in steps],
            ["in_progress", "in_progress", "in_progress"],
        )
        self.assertEqual(steps[0]["step"], "Analyze")
        self.assertEqual(steps[1]["step"], "Step 2")
        self.assertEqual(steps[2]["step"], "verify")

    def test_unparseable_text_returns_none(self):
        self.assertIsNone(bridge_events.plan_steps_from_text("just some prose"))
        self.assertIsNone(bridge_events.plan_steps_from_text(""))
        self.assertIsNone(bridge_events.plan_steps_from_text(None))

    def test_structured_entries(self):
        entries = [
            SimpleNamespace(content="read spec", status="completed"),
            SimpleNamespace(content="write code", status="in_progress"),
            SimpleNamespace(content="test", status="pending"),
        ]
        steps = bridge_events.plan_steps_from_entries(entries)
        self.assertEqual(
            steps,
            [
                {"step": "read spec", "status": "completed"},
                {"step": "write code", "status": "in_progress"},
                {"step": "test", "status": "pending"},
            ],
        )

    def test_entries_status_normalized(self):
        entries = [SimpleNamespace(content="odd", status="weird"), SimpleNamespace(content="", status="completed")]
        steps = bridge_events.plan_steps_from_entries(entries)
        self.assertEqual(steps, [{"step": "odd", "status": "pending"}])

    def test_build_from_entries(self):
        entries = [SimpleNamespace(content="a", status="in_progress")]
        self.assertEqual(
            bridge_events.build_plan_update_event(entries),
            {"type": "plan_update", "steps": [{"step": "a", "status": "in_progress"}]},
        )

    def test_build_from_text(self):
        self.assertEqual(
            bridge_events.build_plan_update_event("- [ ] a\n- [x] b"),
            {
                "type": "plan_update",
                "steps": [
                    {"step": "a", "status": "pending"},
                    {"step": "b", "status": "completed"},
                ],
            },
        )

    def test_build_fallback_single_step(self):
        event = bridge_events.build_plan_update_event("no structure here at all")
        self.assertEqual(
            event,
            {
                "type": "plan_update",
                "steps": [{"step": "no structure here at all", "status": "in_progress"}],
            },
        )

    def test_build_empty_returns_none(self):
        self.assertIsNone(bridge_events.build_plan_update_event([]))
        self.assertIsNone(bridge_events.build_plan_update_event(""))

    def test_todo_output_parsing(self):
        payload = json.dumps({"cli": "- [ ] one\n- [x] two", "summary": {"total": 2}})
        steps = bridge_events.todo_plan_steps(payload)
        self.assertEqual(
            steps,
            [
                {"step": "one", "status": "pending"},
                {"step": "two", "status": "completed"},
            ],
        )

    def test_todo_output_not_parseable_returns_none(self):
        self.assertIsNone(bridge_events.todo_plan_steps("not json"))
        self.assertIsNone(bridge_events.todo_plan_steps(json.dumps({"summary": {"total": 0}})))
        self.assertIsNone(bridge_events.todo_plan_steps(None))


class ApprovalRequestTests(unittest.TestCase):
    def test_build_approval_request_event(self):
        event = bridge_events.build_approval_request_event(
            approval_id="acp-abc123",
            session_id="sess-1",
            tool="terminal",
            kind="execute",
            summary="terminal",
            excerpt='{"command": "ls"}',
            options=[{"option_id": "allow_once", "name": "Allow once"}],
            command="ls -la",
            cwd="/tmp/work",
            reason=None,
        )
        self.assertEqual(event["type"], "approval_request")
        self.assertEqual(event["approval_id"], "acp-abc123")
        self.assertEqual(event["tool"], "terminal")
        self.assertEqual(event["command"], "ls -la")
        self.assertEqual(event["cwd"], "/tmp/work")
        self.assertIsNone(event["reason"])
        self.assertEqual(
            event["available_decisions"],
            ["approved", "approved_for_session", "denied", "timed_out", "abort"],
        )
        # Legacy keys preserved.
        self.assertEqual(event["session_id"], "sess-1")
        self.assertEqual(event["options"], [{"option_id": "allow_once", "name": "Allow once"}])

    def test_extract_approval_command(self):
        tool_call = SimpleNamespace(raw_input={"command": "ls -la", "path": "/tmp"})
        self.assertEqual(bridge_events.extract_approval_command(tool_call), "ls -la")
        self.assertEqual(
            bridge_events.extract_approval_command(SimpleNamespace(raw_input="git status")),
            "git status",
        )
        self.assertIsNone(bridge_events.extract_approval_command(SimpleNamespace(raw_input={"path": "/tmp/x"})))
        self.assertIsNone(bridge_events.extract_approval_command(SimpleNamespace(raw_input=None)))


class PlanModeFilterTests(unittest.TestCase):
    def test_is_mutating_tool_name(self):
        for name in (
            "run_command", "bash", "terminal", "shell", "apply_patch",
            "edit_file", "write_file", "delete_repo_file", "batch_edit_repo_files",
            "execute_python", "create_repo_file",
        ):
            self.assertTrue(bridge_events.is_mutating_tool_name(name), name)
        for name in ("read_file", "web_search", "todo", "browse_url", "git_log", "read_repo_file"):
            self.assertFalse(bridge_events.is_mutating_tool_name(name), name)

    def test_filter_toolsets(self):
        self.assertEqual(
            bridge_events.filter_toolsets_for_plan_mode(["web", "terminal", "files", "code_execution", "shell"]),
            ["web", "files"],
        )

    def test_filter_tool_defs_keeps_read_only_variants(self):
        defs = [
            {"type": "function", "function": {"name": "read_file", "description": "read"}},
            {"type": "function", "function": {"name": "write_file", "description": "write"}},
            {"type": "function", "function": {"name": "todo", "description": "tasks"}},
        ]
        kept = bridge_events.filter_tool_defs_for_plan_mode(defs)
        self.assertEqual([t["function"]["name"] for t in kept], ["read_file", "todo"])

    def test_filter_tool_defs_handles_malformed(self):
        kept = bridge_events.filter_tool_defs_for_plan_mode([{}, {"function": {"name": "run_command"}}, None])
        self.assertEqual(kept, [{}, None])


class CallbackKwargProbeTests(unittest.TestCase):
    def test_accepts_kwarg(self):
        def with_kwarg(a, call_id=None):
            return call_id

        def without_kwarg(a):
            return a

        def var_kwargs(**kwargs):
            return kwargs

        self.assertTrue(bridge_events.callback_accepts_kwarg(with_kwarg, "call_id"))
        self.assertFalse(bridge_events.callback_accepts_kwarg(without_kwarg, "call_id"))
        self.assertTrue(bridge_events.callback_accepts_kwarg(var_kwargs, "call_id"))
        self.assertFalse(bridge_events.callback_accepts_kwarg(None, "call_id"))


class AcpDispatchMappingTests(unittest.TestCase):
    """The ACP client maps session_update kinds onto the fixed event shapes."""

    def _client(self):
        emitted = []
        client = acp_transport.BridgeAcpClient(emit=lambda kind, *payload: emitted.append((kind, payload)), approvals={})
        return client, emitted

    def test_tool_call_start_emits_begin(self):
        client, emitted = self._client()
        client._dispatch("s1", SimpleNamespace(session_update="tool_call", tool_call_id="tc-1", title="terminal"))
        kinds = [e[0] for e in emitted]
        self.assertIn("tool_call_begin", kinds)
        self.assertIn("tool_start", kinds)
        begin = next(e[1][0] for e in emitted if e[0] == "tool_call_begin")
        self.assertEqual(begin["type"], "tool_call_begin")
        self.assertEqual(begin["call_id"], "tc-1")
        self.assertEqual(begin["name"], "terminal")

    def test_tool_call_update_completed_emits_end(self):
        client, emitted = self._client()
        client._dispatch("s1", SimpleNamespace(session_update="tool_call", tool_call_id="tc-1", title="bash"))
        emitted.clear()
        client._dispatch(
            "s1",
            SimpleNamespace(
                session_update="tool_call_update",
                tool_call_id="tc-1",
                status="completed",
                content=[],
                raw_output="done",
            ),
        )
        kinds = [e[0] for e in emitted]
        self.assertIn("tool_call_end", kinds)
        self.assertIn("tool_end", kinds)
        end = next(e[1][0] for e in emitted if e[0] == "tool_call_end")
        self.assertEqual(end["type"], "tool_call_end")
        self.assertEqual(end["call_id"], "tc-1")
        self.assertEqual(end["name"], "bash")
        self.assertTrue(end["success"])
        self.assertIsInstance(end["duration_ms"], int)

    def test_tool_call_update_in_progress_emits_delta(self):
        client, emitted = self._client()
        client._dispatch("s1", SimpleNamespace(session_update="tool_call", tool_call_id="tc-1", title="bash"))
        emitted.clear()
        client._dispatch(
            "s1",
            SimpleNamespace(
                session_update="tool_call_update",
                tool_call_id="tc-1",
                status="in_progress",
                content=[SimpleNamespace(type="text", text="partial")],
            ),
        )
        kinds = [e[0] for e in emitted]
        self.assertIn("tool_call_delta", kinds)
        self.assertNotIn("tool_call_end", kinds)
        delta = next(e[1][0] for e in emitted if e[0] == "tool_call_delta")
        self.assertEqual(delta["type"], "tool_call_delta")
        self.assertEqual(delta["call_id"], "tc-1")

    def test_plan_update_emits_plan_entries(self):
        client, emitted = self._client()
        client._dispatch(
            "s1",
            SimpleNamespace(
                session_update="plan_update",
                plan=SimpleNamespace(entries=[SimpleNamespace(content="a", status="in_progress")]),
            ),
        )
        self.assertEqual(emitted[0][0], "plan")
        self.assertEqual(emitted[0][1][0][0].content, "a")

    def test_plan_update_markdown_emits_text(self):
        client, emitted = self._client()
        client._dispatch(
            "s1",
            SimpleNamespace(
                session_update="plan_update",
                plan=SimpleNamespace(entries=None, content="- [ ] step"),
            ),
        )
        self.assertEqual(emitted[0][0], "plan")
        self.assertEqual(emitted[0][1][0], "- [ ] step")


if __name__ == "__main__":
    unittest.main()
