"""Hermes adapter computer-use frame + aux-vision integration tests."""

import os
import threading
import unittest
from unittest.mock import MagicMock, patch

from computer_use_frames import restore_spark_keep_cu_screenshots_patch


@unittest.skipUnless(
    __import__("importlib").util.find_spec("hermes_adapter") is not None,
    "hermes_adapter not importable",
)
class HermesAdapterComputerUseTests(unittest.TestCase):
    def tearDown(self):
        restore_spark_keep_cu_screenshots_patch()
        os.environ.pop("SPARK_KEEP_CU_SCREENSHOTS", None)

    def _make_adapter(self, **kwargs):
        import hermes_adapter as ha

        with patch.object(ha, "RealAIAgent") as mock_real_agent:
            mock_real_agent.return_value = MagicMock()
            with patch(
                "computer_use_frames.install_spark_keep_cu_screenshots_patch",
                return_value=True,
            ):
                adapter = ha.HermesAgentAdapter(
                    base_url="https://api.openai.com/v1",
                    api_key="test-key",
                    model="gpt-4.1",
                    enabled_toolsets=["web", "computer_use"],
                    **kwargs,
                )
        return adapter

    def test_computer_use_sets_spark_keep_env(self):
        adapter = self._make_adapter()
        self.assertEqual(os.environ.get("SPARK_KEEP_CU_SCREENSHOTS"), "1")
        self.assertIsNotNone(adapter._cu_poller_lock)

    def test_on_tool_start_emits_running_frame_and_starts_poller(self):
        frames = []
        adapter = self._make_adapter(on_computer_use_frame=frames.append)
        started: list[tuple[str, dict]] = []

        def _capture_start(name, args):
            started.append((name, args))

        adapter._start_cu_frame_poller = _capture_start
        adapter._on_tool_start("tc1", "computer_use", {"action": "click", "element": 1})
        self.assertEqual(started, [("computer_use", {"action": "click", "element": 1})])
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0]["status"], "running")

    def test_start_cu_frame_poller_replaces_existing_poller_without_deadlock(self):
        frames = []
        adapter = self._make_adapter(on_computer_use_frame=frames.append)
        previous_poller = MagicMock()
        adapter._cu_poller = previous_poller

        with patch("computer_use_frames.ComputerUseFramePoller") as poller_cls:
            next_poller = MagicMock()
            poller_cls.return_value = next_poller
            worker = threading.Thread(
                target=adapter._start_cu_frame_poller,
                args=("computer_use", {"action": "click"}),
                daemon=True,
            )
            worker.start()
            worker.join(timeout=1)

        self.assertFalse(worker.is_alive(), "starting the poller deadlocked")
        previous_poller.stop.assert_called_once()
        next_poller.start.assert_called_once()
        self.assertIs(adapter._cu_poller, next_poller)

    def test_tool_complete_stops_poller_and_supplements_missing_image(self):
        frames = []
        adapter = self._make_adapter(on_computer_use_frame=frames.append)
        poller = MagicMock()
        adapter._cu_poller = poller
        with patch(
            "computer_use_frames.try_supplemental_capture",
            return_value="data:image/png;base64,fallback",
        ):
            adapter._on_tool_complete(
                "tc1",
                "computer_use",
                {"action": "type", "text": "hi"},
                '{"summary": "typed hi"}',
            )
        poller.stop.assert_called_once()
        self.assertIsNone(adapter._cu_poller)
        completed = [f for f in frames if f.get("status") == "completed"]
        self.assertEqual(len(completed), 1)
        self.assertEqual(completed[0]["image"], "data:image/png;base64,fallback")

    def test_run_conversation_restores_patch_and_stops_poller(self):
        adapter = self._make_adapter()
        poller = MagicMock()
        adapter._cu_poller = poller
        adapter._agent.run_conversation.return_value = {"api_calls": 0, "completed": True}
        with patch("computer_use_frames.restore_spark_keep_cu_screenshots_patch") as restore:
            adapter.run_conversation("hello", [])
        poller.stop.assert_called_once()
        restore.assert_called_once()


@unittest.skipUnless(
    __import__("importlib").util.find_spec("hermes_adapter") is not None,
    "hermes_adapter not importable",
)
class HermesAdapterRepoToolTests(unittest.TestCase):
    """Repo-mode tool registration: the FULL repo toolset (read + edit) must
    always be exposed, regardless of the per-message edit-intent heuristic.

    hermes-desktop parity: gating edit tools on message phrasing left agents
    unable to edit ("edit tools aren't available in this session's catalog").
    The intent flag only shapes the prompt; it never strips tools.
    """

    _REPO_TOOLS = {
        "list_user_repos", "read_repo_file", "git_log", "git_show", "git_diff",
        "edit_repo_file", "create_repo_file", "delete_repo_file",
        "batch_edit_repo_files",
    }

    def tearDown(self):
        # Defensive: never leave repo tools in the shared registry.
        import hermes_adapter as ha

        for name in self._REPO_TOOLS:
            if ha.registry.get_entry(name) is not None:
                ha.registry.deregister(name)

    def _make_repo_adapter(self, repo_edit_intent=False):
        import hermes_adapter as ha

        with patch.object(ha, "RealAIAgent") as mock_real_agent:
            mock_real_agent.return_value = MagicMock()
            adapter = ha.HermesAgentAdapter(
                base_url="https://api.openai.com/v1",
                api_key="test-key",
                model="gpt-4.1",
                enabled_toolsets=["web"],
                repo_mode=True,
                repo_edit_intent=repo_edit_intent,
                github_pat="test-pat",
                github_repo_owner="octo",
                github_repo_name="repo",
            )
        # The adapter holds the process-global repo tool registry lock from
        # __init__ until run_conversation's finally (or _cleanup_repo_tools).
        # Tests that only inspect registration never run a conversation, so
        # release the lock after each test or later repo adapters deadlock.
        self.addCleanup(adapter._cleanup_repo_tools)
        return adapter, mock_real_agent

    def test_edit_tools_registered_even_without_edit_intent(self):
        import hermes_adapter as ha

        for edit_intent in (False, True):
            adapter, _ = self._make_repo_adapter(repo_edit_intent=edit_intent)
            try:
                for tool_name in self._REPO_TOOLS:
                    self.assertIsNotNone(
                        ha.registry.get_entry(tool_name),
                        f"{tool_name} must be registered (edit_intent={edit_intent})",
                    )
            finally:
                adapter._cleanup_repo_tools()

    def test_repo_toolset_enabled_in_agent_kwargs(self):
        import hermes_adapter as ha

        adapter, mock_real_agent = self._make_repo_adapter(repo_edit_intent=False)
        try:
            kwargs = mock_real_agent.call_args.kwargs
            self.assertIn(ha._REPO_TOOLSET, kwargs["enabled_toolsets"])
        finally:
            adapter._repo_provider._deregister_tools()

    def test_repo_tools_deregistered_after_run(self):
        import hermes_adapter as ha

        adapter, mock_real_agent = self._make_repo_adapter(repo_edit_intent=False)
        mock_real_agent.return_value.run_conversation.return_value = {
            "api_calls": 0,
            "completed": True,
        }
        self.assertIsNotNone(ha.registry.get_entry("edit_repo_file"))
        adapter.run_conversation("hello", [])
        for tool_name in self._REPO_TOOLS:
            self.assertIsNone(ha.registry.get_entry(tool_name))


if __name__ == "__main__":
    unittest.main()
