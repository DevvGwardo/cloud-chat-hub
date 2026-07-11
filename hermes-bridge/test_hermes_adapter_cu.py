"""Hermes adapter computer-use frame + aux-vision integration tests."""

import os
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


if __name__ == "__main__":
    unittest.main()
