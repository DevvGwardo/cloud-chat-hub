"""Edge-case tests for run_agent._tool_run_command exit-code hints and
_tool_read_file error branches (complements ActionableErrorTests).

NOTE: ``import run_agent`` happens at MODULE level on purpose. hermes_adapter
(any test file touching it) replaces sys.modules["run_agent"] with the real
hermes-agent module, which lacks the bridge's _tool_* helpers. Binding at
import time — before any hermes_adapter import can run in the same pytest
process — pins these tests to the bridge-local module. Same pattern as
test_run_agent.py line 92.
"""

import importlib.util
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Bind the BRIDGE-LOCAL run_agent by explicit file path. hermes_adapter (imported
# at module level by test_run_agent.py, which pytest loads alphabetically before
# this file) replaces sys.modules["run_agent"] with the real hermes-agent module,
# which lacks the bridge's _tool_* helpers.
_BRIDGE_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "run_agent_bridge_local", _BRIDGE_DIR / "run_agent.py"
)
run_agent = importlib.util.module_from_spec(_spec)
sys.modules["run_agent_bridge_local"] = run_agent
_spec.loader.exec_module(run_agent)


class RunCommandExitCodeHintTests(unittest.TestCase):
    def test_exit_127_command_not_found(self):
        result = run_agent._tool_run_command("command_that_does_not_exist_xyz")
        self.assertIn("[Exit code: 127]", result)
        self.assertIn("Command not found", result)

    def test_exit_code_2_usage_hint(self):
        # `grep -c` with no pattern → exit code 2 (usage error) on BSD + GNU.
        result = run_agent._tool_run_command("grep -c")
        if "[Exit code: 2]" in result:
            self.assertIn("Incorrect usage", result)
        else:
            self.fail(f"expected exit code 2, got: {result[:200]}")

    def test_success_has_no_exit_code_suffix(self):
        result = run_agent._tool_run_command("echo ok")
        self.assertEqual(result.strip(), "ok")

    def test_nonzero_exit_appends_code_line(self):
        result = run_agent._tool_run_command("false")
        self.assertIn("[Exit code: 1]", result)

    def test_stderr_merged_into_output(self):
        result = run_agent._tool_run_command("echo err-line >&2")
        self.assertIn("err-line", result)

    def test_no_output_placeholder(self):
        result = run_agent._tool_run_command("true")  # exits 0, no output
        self.assertEqual(result, "(no output)")


class RunCommandPermissionTests(unittest.TestCase):
    def test_exit_126_permission_denied_hint(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            script = os.path.join(tmpdir, "not-executable.sh")
            with open(script, "w") as f:
                f.write("#!/bin/sh\necho hi\n")
            os.chmod(script, stat.S_IRUSR | stat.S_IWUSR)  # no exec bit

            result = run_agent._tool_run_command(script)
            if "126" not in result:
                self.fail(f"expected exit 126 hint, got: {result[:200]}")
            self.assertIn("Permission denied", result)


class ReadFileErrorBranchTests(unittest.TestCase):
    def test_permission_denied_message(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "secret.txt")
            with open(path, "w") as f:
                f.write("top secret")
            os.chmod(path, 0)
            try:
                result = run_agent._tool_read_file(path)
                self.assertIn("Permission denied", result)
            finally:
                os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    def test_sibling_list_capped_at_twenty_with_overflow_note(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            for i in range(25):
                open(os.path.join(tmpdir, f"f{i:02d}.txt"), "w").close()
            result = run_agent._tool_read_file(os.path.join(tmpdir, "missing.txt"))
            self.assertIn("(+5 more)", result)

    def test_small_sibling_list_has_no_overflow_note(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            open(os.path.join(tmpdir, "only-one.txt"), "w").close()
            result = run_agent._tool_read_file(os.path.join(tmpdir, "missing.txt"))
            self.assertIn("only-one.txt", result)
            self.assertNotIn("+", result.split("Available files")[1])


class ReadFileTruncationTests(unittest.TestCase):
    def test_large_file_truncated(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "big.txt")
            with open(path, "w") as f:
                f.write("z" * 30000)
            result = run_agent._tool_read_file(path)
            self.assertLess(len(result), 30000)


if __name__ == "__main__":
    unittest.main()
