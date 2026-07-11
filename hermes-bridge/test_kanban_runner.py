"""Smoke tests for server/scripts/run-kanban-agent.py (Phase 6.1 fleet adapter path)."""

import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock


REPO_ROOT = Path(__file__).resolve().parent.parent
RUNNER_PATH = REPO_ROOT / "server" / "scripts" / "run-kanban-agent.py"


def _load_runner_module():
    spec = importlib.util.spec_from_file_location("run_kanban_agent", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TestKanbanRunnerAdapter(unittest.TestCase):
    def test_runner_uses_hermes_adapter_not_legacy_run_agent(self):
        source = RUNNER_PATH.read_text(encoding="utf-8")
        self.assertIn("HermesAgentAdapter", source)
        self.assertNotIn("from run_agent import AIAgent", source)

    def test_register_fleet_tools_overrides_native_kanban(self):
        os.environ["KANBAN_CARD_ID"] = "test-card-id-for-unit-test"
        try:
            runner = _load_runner_module()
        finally:
            os.environ.pop("KANBAN_CARD_ID", None)

        registry = MagicMock()
        runner._register_fleet_tools(registry)

        registered = {call.kwargs["name"]: call.kwargs for call in registry.register.call_args_list}
        self.assertIn("kanban_show", registered)
        self.assertTrue(registered["kanban_show"]["override"])
        self.assertIn("kanban_read_current_card", registered)
        self.assertIn("team_signal_completion", registered)
        registry.register_toolset_alias.assert_called_once_with("team", "team")


if __name__ == "__main__":
    unittest.main()
