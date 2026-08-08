"""Hermes adapter custom MCP tool registration + execution tests.

Covers the path where CloudChat's user-configured MCP servers (sent as
``custom_tools`` on the request) must be registered into the REAL
hermes-agent tool registry so the agent can call them — previously they
were silently dropped by ``HermesAgentAdapter``.

NOTE: hermes_adapter is imported lazily (inside tests) on purpose. Importing
it at module level during collection replaces ``sys.modules["run_agent"]``
with the real hermes-agent module, which breaks test_run_agent.py's module
level ``from run_agent import AIAgent`` (it binds the wrong class). Same
convention as test_hermes_adapter_cu.py.
"""

import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import MagicMock, patch


def _ha():
    """Import hermes_adapter lazily — see module docstring."""
    import hermes_adapter

    return hermes_adapter


class _MockMCPHandler(BaseHTTPRequestHandler):
    """Minimal Streamable-HTTP MCP server that answers ``tools/call``."""

    result_text = "mock tool output"

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        method = body.get("method")
        name = (body.get("params") or {}).get("name", "?")
        if method == "tools/call":
            payload = {
                "jsonrpc": "2.0",
                "id": body.get("id", 1),
                "result": {
                    "content": [{"type": "text", "text": f"{name}: {self.result_text}"}],
                },
            }
        else:
            payload = {"jsonrpc": "2.0", "id": body.get("id", 1), "result": {}}
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class _MockMCPErrorHandler(_MockMCPHandler):
    """Server that always answers with a JSON-RPC error."""

    def do_POST(self):
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "error": {"code": -32000, "message": "simulated server error"},
        }
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@unittest.skipUnless(
    importlib.util.find_spec("hermes_adapter") is not None,
    "hermes_adapter not importable",
)
class CustomMCPServerProviderTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), _MockMCPHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.provider = None

    def tearDown(self):
        if self.provider is not None:
            self.provider._deregister_tools()
        self.server.shutdown()
        self.thread.join(timeout=5)

    def _tool_def(self, name="get_weather", url=None):
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": "Get the current weather",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
            },
            "mcp_server_id": "srv1",
            "mcp_server_url": url or f"http://127.0.0.1:{self.port}/mcp",
            "mcp_server_api_key": "secret-key",
        }

    def test_register_exposes_tool_and_toolset(self):
        from toolsets import validate_toolset

        ha = _ha()
        self.provider = ha.CustomMCPServerProvider([self._tool_def()])
        self.provider._register_tools()

        entry = ha.registry.get_entry("get_weather")
        self.assertIsNotNone(entry, "custom MCP tool must be in the registry")
        self.assertEqual(entry.toolset, ha._CUSTOM_MCP_TOOLSET)
        self.assertEqual(entry.schema["name"], "get_weather")
        self.assertEqual(
            entry.schema["parameters"]["properties"]["city"]["type"], "string"
        )
        # The toolset must validate so the real agent exposes the tools in
        # get_tool_definitions() during __init__.
        self.assertTrue(validate_toolset(ha._CUSTOM_MCP_TOOLSET))

    def test_dispatch_proxies_to_remote_server(self):
        ha = _ha()
        self.provider = ha.CustomMCPServerProvider([self._tool_def()])
        self.provider._register_tools()

        result = ha.registry.dispatch("get_weather", {"city": "NYC"})
        self.assertEqual(result, "get_weather: mock tool output")

    def test_dispatch_sends_auth_header_and_payload(self):
        captured = {}

        class _CaptureHandler(_MockMCPHandler):
            def do_POST(self):
                captured["auth"] = self.headers.get("Authorization")
                captured["body"] = json.loads(
                    self.rfile.read(int(self.headers.get("Content-Length", 0)))
                )
                data = b'{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}]}}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = HTTPServer(("127.0.0.1", 0), _CaptureHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            ha = _ha()
            self.provider = ha.CustomMCPServerProvider(
                [self._tool_def(url=f"http://127.0.0.1:{port}/mcp")]
            )
            self.provider._register_tools()
            result = ha.registry.dispatch("get_weather", {"city": "NYC"})
            self.assertEqual(result, "ok")
            self.assertEqual(captured["auth"], "Bearer secret-key")
            self.assertEqual(captured["body"]["method"], "tools/call")
            self.assertEqual(captured["body"]["params"]["name"], "get_weather")
            self.assertEqual(captured["body"]["params"]["arguments"], {"city": "NYC"})
        finally:
            server.shutdown()
            thread.join(timeout=5)

    def test_dispatch_returns_jsonrpc_error_text(self):
        server = HTTPServer(("127.0.0.1", 0), _MockMCPErrorHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            ha = _ha()
            self.provider = ha.CustomMCPServerProvider(
                [self._tool_def(url=f"http://127.0.0.1:{port}/mcp")]
            )
            self.provider._register_tools()
            result = ha.registry.dispatch("get_weather", {"city": "NYC"})
            self.assertIn("simulated server error", result)
            self.assertIn("-32000", result)
        finally:
            server.shutdown()
            thread.join(timeout=5)

    def test_dispatch_handles_connection_failure(self):
        # Closed port on 127.0.0.1 — connect fails fast, must not raise.
        ha = _ha()
        self.provider = ha.CustomMCPServerProvider(
            [self._tool_def(url="http://127.0.0.1:1/mcp")]
        )
        self.provider._register_tools()
        result = ha.registry.dispatch("get_weather", {"city": "NYC"})
        self.assertIsInstance(result, str)
        self.assertIn("get_weather", result)

    def test_deregister_removes_tools(self):
        ha = _ha()
        self.provider = ha.CustomMCPServerProvider(
            [self._tool_def("tool_a"), self._tool_def("tool_b")]
        )
        self.provider._register_tools()
        self.assertIsNotNone(ha.registry.get_entry("tool_a"))
        self.assertIsNotNone(ha.registry.get_entry("tool_b"))

        self.provider._deregister_tools()
        self.assertIsNone(ha.registry.get_entry("tool_a"))
        self.assertIsNone(ha.registry.get_entry("tool_b"))
        self.assertEqual(self.provider._registered_tools, [])

    def test_duplicate_tool_names_keep_first(self):
        ha = _ha()
        self.provider = ha.CustomMCPServerProvider(
            [self._tool_def("dup_tool"), self._tool_def("dup_tool")]
        )
        self.provider._register_tools()
        self.assertEqual(
            self.provider._registered_tools, ["dup_tool"], "duplicates must collapse"
        )

    def test_malformed_definitions_are_skipped(self):
        ha = _ha()
        self.provider = ha.CustomMCPServerProvider(
            [
                {"type": "function"},  # no function payload
                {"function": {"name": "", "description": ""}},  # empty name
                {"function": {"name": "   ", "description": ""}},  # blank name
                self._tool_def("good_tool"),
            ]
        )
        self.provider._register_tools()
        self.assertEqual(self.provider._registered_tools, ["good_tool"])


@unittest.skipUnless(
    importlib.util.find_spec("hermes_adapter") is not None,
    "hermes_adapter not importable",
)
class HermesAdapterCustomToolsIntegrationTests(unittest.TestCase):
    """HermesAgentAdapter must wire custom_tools through to the real agent."""

    def _make_adapter(self, custom_tools=None, **kwargs):
        ha = _ha()

        with patch.object(ha, "RealAIAgent") as mock_real_agent:
            mock_real_agent.return_value = MagicMock()
            adapter = ha.HermesAgentAdapter(
                base_url="https://api.openai.com/v1",
                api_key="test-key",
                model="gpt-4.1",
                enabled_toolsets=["web"],
                custom_tools=custom_tools or [],
                **kwargs,
            )
        return adapter, mock_real_agent

    def tearDown(self):
        ha = _ha()
        # Defensive: never leave custom tools in the shared registry.
        if ha.registry.get_entry("adapter_mcp_tool"):
            ha.registry.deregister("adapter_mcp_tool")

    def test_custom_tools_registered_before_agent_creation(self):
        ha = _ha()
        tool_def = {
            "type": "function",
            "function": {
                "name": "adapter_mcp_tool",
                "description": "Adapter test tool",
                "parameters": {"type": "object", "properties": {}},
            },
            "mcp_server_id": "srv1",
            "mcp_server_url": "http://127.0.0.1:9/mcp",
        }
        adapter, mock_real_agent = self._make_adapter(custom_tools=[tool_def])

        # Tool was in the registry BEFORE the real agent was constructed, and
        # the toolset was enabled in the kwargs handed to the real agent.
        entry = ha.registry.get_entry("adapter_mcp_tool")
        self.assertIsNotNone(entry)
        kwargs = mock_real_agent.call_args.kwargs
        self.assertIn(ha._CUSTOM_MCP_TOOLSET, kwargs["enabled_toolsets"])
        self.assertIsNotNone(adapter._custom_mcp_provider)

    def test_run_conversation_deregisters_custom_tools(self):
        ha = _ha()
        tool_def = {
            "type": "function",
            "function": {
                "name": "adapter_mcp_tool",
                "description": "Adapter test tool",
                "parameters": {"type": "object", "properties": {}},
            },
            "mcp_server_id": "srv1",
            "mcp_server_url": "http://127.0.0.1:9/mcp",
        }
        adapter, mock_real_agent = self._make_adapter(custom_tools=[tool_def])
        mock_real_agent.return_value.run_conversation.return_value = {
            "api_calls": 0,
            "completed": True,
        }
        self.assertIsNotNone(ha.registry.get_entry("adapter_mcp_tool"))

        adapter.run_conversation("hello", [])
        self.assertIsNone(
            ha.registry.get_entry("adapter_mcp_tool"),
            "custom MCP tools must be deregistered after the run",
        )


if __name__ == "__main__":
    unittest.main()
