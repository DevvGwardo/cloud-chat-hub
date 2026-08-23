"""Integration tests for mcp_tool_loop_check.py — spins the real threaded mock
MCP server and exercises CustomMCPServerProvider register/dispatch/deregister
rounds against it. No hermes-agent process needed."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

# Bind the BRIDGE-LOCAL run_agent by explicit path BEFORE anything imports
# hermes_adapter (which clobbers sys.modules["run_agent"] with the real
# hermes-agent copy lacking repo_mode). See test_run_command_edges.py.
_BRIDGE_DIR = Path(__file__).resolve().parent


def _pin_bridge_run_agent():
    """Re-pin sys.modules["run_agent"] to the bridge-local module.

    hermes_adapter's import UNCONDITIONALLY overwrites that entry with the real
    hermes-agent copy (which lacks repo_mode), breaking test_run_agent.py's
    ``from run_agent import AIAgent`` binding in shared-process runs. Re-assert
    after every import that could clobber.
    """
    spec = importlib.util.spec_from_file_location(
        "run_agent_bridge_local", _BRIDGE_DIR / "run_agent.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.modules["run_agent"] = mod


_pin_bridge_run_agent()
import mcp_tool_loop_check as check  # noqa: E402  (clobbers; re-pinned below)
_pin_bridge_run_agent()
import hermes_adapter  # noqa: E402  (also clobbers)
_pin_bridge_run_agent()
import hermes_adapter


class ToolDefTests(unittest.TestCase):
    def test_shape_matches_cloudchat_frontend_contract(self):
        td = check.tool_def("srv", 8790, 2)
        assert td["type"] == "function"
        fn = td["function"]
        assert fn["name"] == "srv_tool_2"
        assert fn["parameters"]["required"] == ["query"]
        assert "query" in fn["parameters"]["properties"]
        # provenance fields used by the adapter to reach the right server
        assert td["mcp_server_id"] == "srv"
        assert td["mcp_server_url"] == "http://127.0.0.1:8790/mcp"
        assert td["mcp_server_api_key"] == "key-srv"


class MockMCPServerTests(unittest.TestCase):
    def test_start_stop_binds_an_ephemeral_port(self):
        server = check.MockMCPServer("ephemeral").start()
        try:
            assert 0 < server.port < 65536
        finally:
            server.stop()

    def test_success_payload_echoes_server_tool_and_args(self):
        server = check.MockMCPServer("echo-srv").start()
        try:
            import httpx
            resp = httpx.post(
                f"http://127.0.0.1:{server.port}/mcp",
                json={"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                      "params": {"name": "mytool", "arguments": {"q": "x"}}},
            )
            body = resp.json()
            assert body["id"] == 5
            text = body["result"]["content"][0]["text"]
            payload = json.loads(text)
            assert payload == {"server": "echo-srv", "tool": "mytool", "args": {"q": "x"}}
        finally:
            server.stop()

    def test_failure_rate_one_always_injects_error(self):
        server = check.MockMCPServer("bad-srv", failure_rate=1.0).start()
        try:
            import httpx
            for _ in range(3):
                resp = httpx.post(
                    f"http://127.0.0.1:{server.port}/mcp",
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                          "params": {"name": "t", "arguments": {}}},
                )
                body = resp.json()
                assert body["error"]["code"] == -32000
                assert "injected failure" in body["error"]["message"]
        finally:
            server.stop()


class RunRoundAgainstRealServerTests(unittest.TestCase):
    def setUp(self):
        self.server = check.MockMCPServer("round-srv").start()

    def tearDown(self):
        self.server.stop()

    def _tools(self, count):
        return [check.tool_def("round-srv", self.server.port, i) for i in range(count)]

    def test_single_round_single_tool(self):
        tools = self._tools(1)
        check.run_round(self.server, tools, round_no=0, quiet=True)
        # Hygiene contract from run_round itself: registry is clean afterwards.
        for t in tools:
            assert hermes_adapter.registry.get_entry(t["function"]["name"]) is None

    def test_multiple_tools_multiple_rounds(self):
        tools = self._tools(4)
        for round_no in range(3):
            check.run_round(self.server, tools, round_no=round_no, quiet=True)

    def test_deregister_leaves_registry_clean_even_after_reuse(self):
        tools = self._tools(2)
        for round_no in range(2):
            check.run_round(self.server, tools, round_no=round_no, quiet=True)
        names = {t["function"]["name"] for t in tools}
        leftovers = [n for n in names if hermes_adapter.registry.get_entry(n) is not None]
        assert leftovers == []


if __name__ == "__main__":
    unittest.main()
