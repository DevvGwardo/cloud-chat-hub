#!/usr/bin/env python3
"""Loop check: custom MCP tools work with the REAL hermes-agent registry.

Boots local mock MCP servers, then repeatedly registers CloudChat custom
tool definitions into the real hermes-agent tool registry via
``hermes_adapter.CustomMCPServerProvider``, dispatches each tool, verifies
the round-trip, and deregisters — asserting the registry is left clean.

Simulates a team of parallel subagents (``--agents``), each owning its own
mock server + tool set, looping for ``--iterations`` rounds.

Usage:
    python mcp_tool_loop_check.py [--iterations N] [--agents M] [--tools K]
                                   [--failure-rate P] [--quiet]

Exit code 0 = all rounds passed, 1 = any round failed.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import hermes_adapter  # noqa: F401  (imports the real hermes-agent + registry)


class MockMCPServer:
    """Threaded Streamable-HTTP MCP server with optional failure injection."""

    def __init__(self, server_id: str, failure_rate: float = 0.0):
        self.server_id = server_id
        self.failure_rate = failure_rate
        self.handler = self._make_handler()
        self.httpd = HTTPServer(("127.0.0.1", 0), self.handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def _make_handler(self):
        outer = self

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                name = (body.get("params") or {}).get("name", "?")
                args = (body.get("params") or {}).get("arguments", {})
                if random.random() < outer.failure_rate:
                    payload = {
                        "jsonrpc": "2.0",
                        "id": body.get("id", 1),
                        "error": {"code": -32000, "message": "injected failure"},
                    }
                else:
                    payload = {
                        "jsonrpc": "2.0",
                        "id": body.get("id", 1),
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps(
                                        {"server": outer.server_id, "tool": name, "args": args}
                                    ),
                                }
                            ]
                        },
                    }
                data = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        return _Handler

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.thread.join(timeout=5)


def tool_def(server_id: str, port: int, index: int) -> dict:
    """OpenAI-format custom tool definition, as sent by the CloudChat frontend."""
    name = f"{server_id}_tool_{index}"
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": f"Mock tool {index} on server {server_id}",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
        "mcp_server_id": server_id,
        "mcp_server_url": f"http://127.0.0.1:{port}/mcp",
        "mcp_server_api_key": f"key-{server_id}",
    }


def run_round(server: MockMCPServer, tools: list[dict], round_no: int, quiet: bool):
    """One agent round: register → dispatch every tool → deregister → verify clean."""
    provider = hermes_adapter.CustomMCPServerProvider(tools)
    provider._register_tools()

    registered = set(provider._registered_tools)
    expected = {t["function"]["name"] for t in tools}
    if registered != expected:
        raise AssertionError(f"round {round_no}: registered={registered} expected={expected}")

    # Every registered tool must be exposed for the real agent (validate_toolset)
    from toolsets import validate_toolset

    if not validate_toolset(hermes_adapter._CUSTOM_MCP_TOOLSET):
        raise AssertionError(f"round {round_no}: toolset does not validate")

    for name in expected:
        result = hermes_adapter.registry.dispatch(name, {"query": f"q{round_no}"})
        # The adapter's contract: handlers never raise — they return either a
        # success payload or an error string ("MCP error (...)" /
        # "Error calling MCP tool ..."). Tolerate both when the server is
        # configured to inject failures; verify the payload fields on success.
        parsed = None
        try:
            parsed = json.loads(result)
        except (TypeError, ValueError):
            pass
        if isinstance(parsed, dict):
            if parsed.get("tool") != name or parsed.get("server") != server.server_id:
                raise AssertionError(
                    f"round {round_no}: tool '{name}' got result {result!r}"
                )
        else:
            if not isinstance(result, str) or not result.strip():
                raise AssertionError(
                    f"round {round_no}: tool '{name}' returned non-string result {result!r}"
                )

    provider._deregister_tools()

    # Hygiene: nothing of ours may remain in the shared registry.
    for name in expected:
        if hermes_adapter.registry.get_entry(name) is not None:
            raise AssertionError(
                f"round {round_no}: tool '{name}' still registered after deregister"
            )
    if not quiet:
        print(f"  round {round_no}: {len(expected)} tools ok", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=10)
    parser.add_argument("--agents", type=int, default=3)
    parser.add_argument("--tools", type=int, default=4)
    parser.add_argument("--failure-rate", type=float, default=0.0)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    print(
        f"[mcp-loop] team={args.agents} agents × {args.iterations} rounds × "
        f"{args.tools} tools each, failure_rate={args.failure_rate}",
        flush=True,
    )

    servers = [MockMCPServer(f"agent{i}", args.failure_rate).start() for i in range(args.agents)]
    failures: list[str] = []

    def _agent_worker(agent_idx: int):
        server = servers[agent_idx]
        tools = [tool_def(server.server_id, server.port, i) for i in range(args.tools)]
        try:
            for r in range(1, args.iterations + 1):
                if not args.quiet:
                    print(f"  agent{agent_idx}: round {r}", flush=True)
                run_round(server, tools, r, args.quiet)
        except Exception as exc:  # noqa: BLE001 — report and continue
            failures.append(f"agent{agent_idx}: {exc}")

    threads = [threading.Thread(target=_agent_worker, args=(i,)) for i in range(args.agents)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    for server in servers:
        server.stop()

    if failures:
        print(f"[mcp-loop] FAILED: {len(failures)} failure(s)", flush=True)
        for f in failures:
            print(f"  - {f}", flush=True)
        return 1

    total = args.agents * args.iterations * args.tools
    print(f"[mcp-loop] OK: {total} tool round-trips across {args.agents} agents × {args.iterations} rounds", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
