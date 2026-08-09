"""Unit tests for worktree_support flag parsing, toolset routing, and cleanup."""

import os
import unittest
from pathlib import Path
from unittest import mock

import worktree_support as ws


class WorktreeRequestedTests(unittest.TestCase):
    def test_header_truthy_values(self):
        for value in ("1", "true", "True", "yes"):
            self.assertTrue(ws.worktree_requested(value))

    def test_header_falsy_values(self):
        for value in ("", "0", "false", "no", None):
            with self.subTest(value=value):
                self.assertFalse(ws.worktree_requested(value))

    def test_env_fallback(self):
        prev = os.environ.get("HERMES_WORKTREE")
        try:
            os.environ["HERMES_WORKTREE"] = "1"
            self.assertTrue(ws.worktree_requested(None))
            os.environ["HERMES_WORKTREE"] = "0"
            self.assertFalse(ws.worktree_requested(None))
        finally:
            if prev is None:
                os.environ.pop("HERMES_WORKTREE", None)
            else:
                os.environ["HERMES_WORKTREE"] = prev


class AdjustToolsetsTests(unittest.TestCase):
    def test_re_enables_local_toolsets(self):
        base = ["web", "browser"]
        adjusted = ws.adjust_toolsets_for_worktree(base)
        for toolset in ws.WORKTREE_LOCAL_TOOLSETS:
            self.assertIn(toolset, adjusted)
        self.assertIn("web", adjusted)
        self.assertIn("browser", adjusted)

    def test_does_not_duplicate_existing(self):
        base = ["web", "terminal", "files"]
        adjusted = ws.adjust_toolsets_for_worktree(base)
        self.assertEqual(adjusted.count("terminal"), 1)
        self.assertEqual(adjusted.count("files"), 1)


class PathOwnershipTests(unittest.TestCase):
    def test_bridge_owned_path(self):
        path = "/repo/.worktrees/hermes-abc12345"
        self.assertTrue(ws._path_created_by_bridge(path))

    def test_rejects_non_bridge_paths(self):
        self.assertFalse(ws._path_created_by_bridge("/tmp/random"))
        self.assertFalse(ws._path_created_by_bridge("/repo/.worktrees/other-name"))


class CleanupTests(unittest.TestCase):
    def setUp(self):
        ws._session_worktrees.clear()
        ws._active_worktree = None

    def test_cleanup_uses_cli_helper_when_available(self):
        info = {
            "path": "/repo/.worktrees/hermes-deadbeef",
            "branch": "hermes/hermes-deadbeef",
            "repo_root": "/repo",
        }
        ws._track_worktree(info)
        mock_cli = mock.MagicMock()
        with mock.patch.object(ws, "_import_cli", return_value=mock_cli):
            with mock.patch.object(Path, "exists", return_value=False):
                self.assertTrue(ws.cleanup_worktree(info))
        mock_cli._cleanup_worktree.assert_called_once_with(info)
        self.assertIsNone(ws._active_worktree)

    def test_cleanup_manual_fallback_for_bridge_paths(self):
        info = {
            "path": "/repo/.worktrees/hermes-cafebabe",
            "branch": "hermes/hermes-cafebabe",
            "repo_root": "/repo",
        }
        ws._track_worktree(info)
        with mock.patch.object(ws, "_import_cli", side_effect=ImportError("no cli")):
            with mock.patch.object(ws, "_manual_cleanup_worktree", return_value=True) as manual:
                self.assertTrue(ws.cleanup_worktree(info))
        manual.assert_called_once_with(info)
        self.assertIsNone(ws._active_worktree)

    def test_cleanup_session_worktrees(self):
        infos = [
            {"path": f"/repo/.worktrees/hermes-{i:08d}", "branch": f"b{i}", "repo_root": "/repo"}
            for i in range(2)
        ]
        for info in infos:
            ws._track_worktree(info)
        with mock.patch.object(ws, "cleanup_worktree", side_effect=[True, True]) as cleanup:
            count = ws.cleanup_session_worktrees()
        self.assertEqual(count, 2)
        self.assertEqual(cleanup.call_count, 2)


class RunAgentWorktreeModeTests(unittest.TestCase):
    def _local_run_agent(self):
        """Load the repo's own run_agent.py by path.

        Full-suite discovery imports hermes_adapter first, which puts the real
        hermes-agent dir at sys.path[0] and caches its run_agent module — a
        plain ``from run_agent import ...`` would bind that module, which has
        no REPO_MODE_BLOCKED_TOOLSETS / worktree_mode support.
        """
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "spark_run_agent_local",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_agent.py"),
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_repo_mode_blocks_local_toolsets_without_worktree(self):
        run_agent = self._local_run_agent()
        AIAgent, REPO_MODE_BLOCKED_TOOLSETS = run_agent.AIAgent, run_agent.REPO_MODE_BLOCKED_TOOLSETS

        agent = AIAgent(
            base_url="http://localhost",
            api_key="k",
            model="m",
            enabled_toolsets=["web", "terminal", "files", "code_execution"],
            repo_mode=True,
            worktree_mode=False,
        )
        for toolset in REPO_MODE_BLOCKED_TOOLSETS:
            self.assertNotIn(toolset, agent.enabled_toolsets)

    def test_worktree_mode_keeps_local_toolsets(self):
        run_agent = self._local_run_agent()
        AIAgent = run_agent.AIAgent

        agent = AIAgent(
            base_url="http://localhost",
            api_key="k",
            model="m",
            enabled_toolsets=["web", "terminal", "files", "code_execution"],
            repo_mode=True,
            worktree_mode=True,
        )
        self.assertIn("terminal", agent.enabled_toolsets)
        self.assertIn("files", agent.enabled_toolsets)
        self.assertIn("code_execution", agent.enabled_toolsets)
        self.assertTrue(agent.worktree_mode)
        repo_tool_names = {t["function"]["name"] for t in agent.tools}
        self.assertNotIn("edit_repo_file", repo_tool_names)
        self.assertNotIn("read_repo_file", repo_tool_names)


if __name__ == "__main__":
    unittest.main()
