import json
import unittest
from unittest.mock import patch

import hermes_runs


class ParseUseRunsFlagTests(unittest.TestCase):
    def test_default_off(self):
        self.assertFalse(hermes_runs.parse_use_runs_flag())

    def test_env_flag(self):
        self.assertTrue(hermes_runs.parse_use_runs_flag(env_value="1"))
        self.assertTrue(hermes_runs.parse_use_runs_flag(env_value="true"))

    def test_header_flag(self):
        self.assertTrue(hermes_runs.parse_use_runs_flag(header_value="1"))
        self.assertTrue(hermes_runs.parse_use_runs_flag(header_value="yes"))

    def test_body_flag(self):
        self.assertTrue(hermes_runs.parse_use_runs_flag(body_value=True))
        self.assertTrue(hermes_runs.parse_use_runs_flag(body_value="on"))

    def test_any_source_enables(self):
        self.assertTrue(
            hermes_runs.parse_use_runs_flag(
                env_value="0",
                header_value="1",
                body_value=False,
            )
        )


class SplitMessagesForRunTests(unittest.TestCase):
    def test_splits_last_user_and_history(self):
        messages = [
            {"role": "system", "content": "Be helpful"},
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "second"},
        ]
        last_user, history, instructions = hermes_runs.split_messages_for_run(messages)
        self.assertEqual(last_user, "second")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["content"], "first")
        self.assertEqual(instructions, "Be helpful")


class TranslateRunEventTests(unittest.TestCase):
    def test_message_delta(self):
        out = hermes_runs.translate_run_event({"event": "message.delta", "delta": "hello"})
        self.assertEqual(out, [("text", "hello")])

    def test_tool_started(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "tool.started",
                "tool": "read_file",
                "preview": "Reading README",
                "args": {"path": "README.md"},
            }
        )
        self.assertEqual(out[0][0], "tool_start")
        self.assertEqual(out[0][1], "read_file")
        self.assertIn("README.md", out[0][2])

    def test_tool_completed(self):
        out = hermes_runs.translate_run_event(
            {"event": "tool.completed", "tool": "terminal", "duration": 1.2}
        )
        self.assertEqual(out[0][0], "tool_end")
        self.assertIn("Completed", out[0][2])

    def test_computer_use_tool_started_emits_running_frame(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "tool.started",
                "tool": "computer_use",
                "args": {"action": "capture", "mode": "som"},
            }
        )
        self.assertEqual(out[0][0], "tool_start")
        frame_events = [item for item in out if item[0] == "computer_use_frame"]
        self.assertEqual(len(frame_events), 1)
        frame = frame_events[0][1]
        self.assertEqual(frame["status"], "running")
        self.assertNotIn("image", frame)

    def test_computer_use_tool_completed_with_result_emits_frame(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "tool.completed",
                "tool": "computer_use",
                "args": {"action": "capture"},
                "result": {
                    "_multimodal": True,
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/png;base64,abc"},
                        },
                    ],
                },
            }
        )
        self.assertEqual(out[0][0], "tool_end")
        frame_events = [item for item in out if item[0] == "computer_use_frame"]
        self.assertEqual(len(frame_events), 1)
        self.assertEqual(frame_events[0][1]["image"], "data:image/png;base64,abc")

    def test_reasoning_available(self):
        out = hermes_runs.translate_run_event(
            {"event": "reasoning.available", "text": "thinking..."}
        )
        self.assertEqual(out, [("reasoning", "thinking...")])

    def test_approval_pending(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "approval.pending",
                "tool": "run_command",
                "preview": "rm -rf /",
                "run_id": "run_abc",
            }
        )
        self.assertEqual(out[0][0], "server_tool_event")
        self.assertEqual(out[0][1]["type"], "approval")

    def test_run_failed(self):
        out = hermes_runs.translate_run_event({"event": "run.failed", "error": "boom"})
        self.assertEqual(out[0][0], "text")
        self.assertIn("boom", out[0][1])

    def test_moa_reference_when_present(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "moa.reference",
                "name": "openai:gpt-5.5",
                "preview": "advice text",
                "moa_index": 0,
                "moa_count": 2,
            }
        )
        self.assertEqual(out[0], ("tool_start", "moa.reference", out[0][2]))
        meta = json.loads(out[0][2])
        self.assertEqual(meta["label"], "openai:gpt-5.5")
        self.assertEqual(meta["index"], 0)
        self.assertEqual(meta["count"], 2)
        self.assertEqual(out[1], ("tool_end", "moa.reference", "advice text"))

    def test_moa_aggregating_when_present(self):
        out = hermes_runs.translate_run_event(
            {
                "event": "moa.aggregating",
                "name": "anthropic:claude-opus-4.8",
                "moa_ref_count": 3,
            }
        )
        self.assertEqual(out[0][0], "tool_start")
        self.assertEqual(out[0][1], "moa.aggregating")
        meta = json.loads(out[0][2])
        self.assertEqual(meta["aggregator"], "anthropic:claude-opus-4.8")
        self.assertEqual(meta["ref_count"], 3)
        self.assertEqual(out[1][0], "tool_end")
        self.assertIn("Aggregating with anthropic:claude-opus-4.8", out[1][2])


class ParseRunsMoaFlagTests(unittest.TestCase):
    def test_default_off(self):
        self.assertFalse(hermes_runs.parse_runs_moa_flag(env_value=None))

    def test_env_on(self):
        self.assertTrue(hermes_runs.parse_runs_moa_flag(env_value="1"))
        self.assertTrue(hermes_runs.parse_runs_moa_flag(env_value="true"))


class GatewaySupportsMoaRunsTests(unittest.TestCase):
    def test_detects_moa_runs_feature(self):
        with patch.object(
            hermes_runs,
            "probe_gateway_capabilities",
            return_value={"features": {"moa_runs": True}},
        ):
            self.assertTrue(hermes_runs.gateway_supports_moa_runs())

    def test_absent_when_no_feature(self):
        with patch.object(
            hermes_runs,
            "probe_gateway_capabilities",
            return_value={"features": {"run_submission": True}},
        ):
            self.assertFalse(hermes_runs.gateway_supports_moa_runs())


class GatewaySupportsRunsParityTests(unittest.TestCase):
    def test_detects_runs_parity_feature(self):
        with patch.object(
            hermes_runs,
            "probe_gateway_capabilities",
            return_value={"features": {"runs_parity": True}},
        ):
            self.assertTrue(hermes_runs.gateway_supports_runs_parity())

    def test_detects_spark_runs_overrides_alias(self):
        with patch.object(
            hermes_runs,
            "probe_gateway_capabilities",
            return_value={"features": {"spark_runs_overrides": True}},
        ):
            self.assertTrue(hermes_runs.gateway_supports_runs_parity())

    def test_absent_when_no_feature(self):
        with patch.object(
            hermes_runs,
            "probe_gateway_capabilities",
            return_value={"features": {"run_submission": True}},
        ):
            self.assertFalse(hermes_runs.gateway_supports_runs_parity())

    def test_env_flag_forces_parity(self):
        with patch.object(
            hermes_runs,
            "gateway_supports_runs_parity",
            return_value=False,
        ):
            self.assertTrue(
                hermes_runs.runs_parity_available(env_override=True)
            )


class IsMoaRunsRejectionTests(unittest.TestCase):
    def test_accepts_202(self):
        self.assertFalse(hermes_runs.is_moa_runs_rejection(202, {}))

    def test_moa_error_message(self):
        self.assertTrue(
            hermes_runs.is_moa_runs_rejection(
                400,
                {"error": {"message": "provider moa not supported on runs"}},
            )
        )

    def test_generic_400_not_moa(self):
        self.assertFalse(
            hermes_runs.is_moa_runs_rejection(
                400,
                {"error": {"message": "invalid session_id"}},
            )
        )


class ShouldRouteViaRunsTests(unittest.TestCase):
    def test_requires_flag_and_gateway(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True):
            self.assertTrue(
                hermes_runs.should_route_via_runs(
                    flag_enabled=True,
                    provider="openrouter",
                    moa_provider_id="moa",
                )
            )

    def test_moa_blocked_by_default(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True), \
             patch.object(hermes_runs, "gateway_supports_moa_runs", return_value=False), \
             patch.object(hermes_runs, "parse_runs_moa_flag", return_value=False):
            self.assertFalse(
                hermes_runs.should_route_via_runs(
                    flag_enabled=True,
                    provider="moa",
                    moa_provider_id="moa",
                )
            )

    def test_moa_allowed_with_env_flag(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True):
            self.assertTrue(
                hermes_runs.should_route_via_runs(
                    flag_enabled=True,
                    provider="moa",
                    moa_provider_id="moa",
                    runs_moa_flag=True,
                )
            )

    def test_moa_allowed_when_gateway_reports_support(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True), \
             patch.object(hermes_runs, "gateway_supports_moa_runs", return_value=True), \
             patch.object(hermes_runs, "parse_runs_moa_flag", return_value=False):
            self.assertTrue(
                hermes_runs.should_route_via_runs(
                    flag_enabled=True,
                    provider="moa",
                    moa_provider_id="moa",
                )
            )

    def test_flag_off_never_routes(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True):
            self.assertFalse(
                hermes_runs.should_route_via_runs(
                    flag_enabled=False,
                    provider="openrouter",
                    moa_provider_id="moa",
                )
            )

    def test_computer_use_forces_agent_loop(self):
        with patch.object(hermes_runs, "gateway_supports_runs", return_value=True):
            self.assertFalse(
                hermes_runs.should_route_via_runs(
                    flag_enabled=True,
                    provider="openrouter",
                    moa_provider_id="moa",
                    enabled_toolsets=["web", "computer_use"],
                )
            )

    def test_enabled_toolsets_need_agent_loop_parity(self):
        self.assertTrue(
            hermes_runs.enabled_toolsets_need_agent_loop_parity(["web", "computer"])
        )
        self.assertFalse(
            hermes_runs.enabled_toolsets_need_agent_loop_parity(["web", "terminal"])
        )


class NeedsAgentLoopParityTests(unittest.TestCase):
    def test_worktree_forces_agent_loop_without_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(worktree_active=True)
        self.assertTrue(needs)
        self.assertIn("worktree", reason or "")

    def test_worktree_ok_with_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            worktree_active=True,
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)

    def test_computer_use_toolset(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            enabled_toolsets=["web", "browser", "terminal", "computer_use"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertTrue(needs)
        self.assertIn("computer_use", reason or "")

    def test_explicit_non_moa_provider(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(explicit_provider="openrouter")
        self.assertTrue(needs)
        self.assertIn("openrouter", reason or "")

    def test_custom_cli_base_url_forces_agent_loop(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            custom_cli_base_url="https://api.bullinf.fun/v1",
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertTrue(needs)
        self.assertIn("base_url", reason or "")

    def test_custom_provider_id_forces_agent_loop(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            explicit_provider="custom:api.bullinf.fun",
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertTrue(needs)
        self.assertIn("custom", reason or "")

    def test_explicit_provider_ok_with_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            explicit_provider="openrouter",
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)

    def test_moa_blocked_without_runs_allowed(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            explicit_provider="moa",
            moa_runs_allowed=False,
        )
        self.assertTrue(needs)
        self.assertIn("moa", reason or "")

    def test_moa_allowed_when_runs_enabled(self):
        needs, _ = hermes_runs.needs_agent_loop_parity(
            explicit_provider="moa",
            moa_runs_allowed=True,
        )
        self.assertFalse(needs)

    def test_non_default_toolsets(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            enabled_toolsets=["web", "vision"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertTrue(needs)
        self.assertIn("toolsets", reason or "")

    def test_non_default_toolsets_ok_with_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            enabled_toolsets=["web", "vision"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)

    def test_default_toolsets_ok(self):
        needs, _ = hermes_runs.needs_agent_loop_parity(
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)

    def test_toolsets_override_flag(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            enabled_toolsets=["web", "browser", "terminal"],
            toolsets_overridden=True,
        )
        self.assertTrue(needs)
        self.assertIn("toolsets", reason or "")

    def test_toolsets_override_ok_with_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            enabled_toolsets=["web", "browser", "terminal"],
            toolsets_overridden=True,
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)

    def test_repo_mode(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(repo_mode=True)
        self.assertTrue(needs)
        self.assertIn("repo_mode", reason or "")

    def test_github_pat(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(github_pat="ghp_test")
        self.assertTrue(needs)
        self.assertIn("github_pat", reason or "")

    def test_custom_tools(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            custom_tools=[{"name": "mcp_tool"}],
        )
        self.assertTrue(needs)
        self.assertIn("custom_tools", reason or "")

    def test_reasoning_effort(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(reasoning_effort="high")
        self.assertTrue(needs)
        self.assertIn("reasoning_effort", reason or "")

    def test_reasoning_effort_ok_with_parity(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            runs_parity_available=True,
            reasoning_effort="high",
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)

    def test_clean_request_ok(self):
        needs, reason = hermes_runs.needs_agent_loop_parity(
            enabled_toolsets=["web", "browser", "terminal"],
            default_toolsets=["web", "browser", "terminal"],
        )
        self.assertFalse(needs)
        self.assertIsNone(reason)


class BuildRunSubmitBodyTests(unittest.TestCase):
    def test_minimal_body(self):
        body = hermes_runs.build_run_submit_body(
            input_text="hello",
            session_id="conv-1",
        )
        self.assertEqual(body["input"], "hello")
        self.assertEqual(body["session_id"], "conv-1")
        self.assertNotIn("toolsets", body)
        self.assertNotIn("provider", body)
        self.assertNotIn("cwd", body)

    def test_gateway_accepted_fields_only(self):
        body = hermes_runs.build_run_submit_body(
            input_text="fix bug",
            session_id="conv-2",
            conversation_history=[{"role": "user", "content": "hi"}],
            instructions="Be helpful",
            model="gpt-4",
        )
        self.assertEqual(
            set(body.keys()),
            {"input", "session_id", "conversation_history", "instructions", "model"},
        )
        self.assertNotIn("toolsets", body)
        self.assertNotIn("enabled_toolsets", body)
        self.assertNotIn("reasoning_effort", body)
        self.assertNotIn("repo_mode", body)
        self.assertNotIn("github_pat", body)
        self.assertNotIn("custom_tools", body)
        self.assertNotIn("provider", body)
        self.assertNotIn("cwd", body)

    def test_parity_body_includes_overrides(self):
        body = hermes_runs.build_run_submit_body(
            input_text="hello",
            session_id="conv-3",
            cwd="/tmp/worktree",
            enabled_toolsets=["web", "terminal", "files"],
            provider="openrouter",
            reasoning_effort="high",
            include_parity_fields=True,
        )
        self.assertEqual(body["cwd"], "/tmp/worktree")
        self.assertEqual(body["enabled_toolsets"], ["web", "terminal", "files"])
        self.assertEqual(body["provider"], "openrouter")
        self.assertEqual(body["reasoning_effort"], "high")

    def test_parity_fields_omitted_when_disabled(self):
        body = hermes_runs.build_run_submit_body(
            input_text="hello",
            session_id="conv-4",
            cwd="/tmp/worktree",
            enabled_toolsets=["web"],
            provider="openrouter",
            reasoning_effort="high",
            include_parity_fields=False,
        )
        self.assertNotIn("cwd", body)
        self.assertNotIn("enabled_toolsets", body)
        self.assertNotIn("provider", body)
        self.assertNotIn("reasoning_effort", body)


class SubmitRunHeaderTests(unittest.TestCase):
    def test_session_key_header_forwarded(self):
        with patch("hermes_runs.httpx.Client") as client_cls:
            client = client_cls.return_value.__enter__.return_value
            client.post.return_value.status_code = 202
            client.post.return_value.json.return_value = {"run_id": "run_1"}
            hermes_runs.submit_run(
                base_url="http://127.0.0.1:8642",
                api_key="key",
                input_text="hi",
                session_id="sess-1",
                session_key="sk_test",
            )
            headers = client.post.call_args.kwargs["headers"]
            self.assertEqual(headers["X-Hermes-Session-Key"], "sk_test")
            body = client.post.call_args.kwargs["json"]
            self.assertEqual(set(body.keys()), {"input", "session_id"})

    def test_parity_fields_forwarded_when_enabled(self):
        with patch("hermes_runs.httpx.Client") as client_cls:
            client = client_cls.return_value.__enter__.return_value
            client.post.return_value.status_code = 202
            client.post.return_value.json.return_value = {"run_id": "run_1"}
            hermes_runs.submit_run(
                base_url="http://127.0.0.1:8642",
                api_key="key",
                input_text="hi",
                session_id="sess-1",
                cwd="/tmp/wt",
                enabled_toolsets=["web", "terminal"],
                provider="openrouter",
                reasoning_effort="medium",
                include_parity_fields=True,
            )
            body = client.post.call_args.kwargs["json"]
            self.assertEqual(body["cwd"], "/tmp/wt")
            self.assertEqual(body["enabled_toolsets"], ["web", "terminal"])
            self.assertEqual(body["provider"], "openrouter")
            self.assertEqual(body["reasoning_effort"], "medium")


class ActiveRunLifecycleTests(unittest.TestCase):
    def tearDown(self):
        hermes_runs.unregister_active_run("conv-test")

    def test_cancel_active_run_stops_gateway(self):
        with patch.object(hermes_runs, "stop_run", return_value=(200, {})) as stop_mock:
            hermes_runs.register_active_run(
                "conv-test",
                run_id="run_123",
                base_url="http://127.0.0.1:8642",
                api_key="key",
            )
            self.assertTrue(hermes_runs.cancel_active_run("conv-test"))
            self.assertTrue(hermes_runs.is_run_cancelled("conv-test"))
            stop_mock.assert_called_once_with(
                base_url="http://127.0.0.1:8642",
                api_key="key",
                run_id="run_123",
            )

    def test_cancel_unknown_conversation(self):
        self.assertFalse(hermes_runs.cancel_active_run("missing"))


if __name__ == "__main__":
    unittest.main()
