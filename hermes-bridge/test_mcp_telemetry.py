"""Unit tests for mcp_telemetry.py — name sanitization, tool→server resolution,
start/end recording, and snapshot remapping. Persistence is mocked out."""

import unittest
from unittest import mock

import mcp_telemetry as mt


def _reset_state():
    mt._stats.clear()
    mt._inflight.clear()
    mt._global_recent.clear()
    mt._name_map.clear()
    # Disable write-through persistence for the duration of each test.
    patcher = mock.patch.object(mt, "_persist_call", return_value=None)
    patcher.start()
    self_addCleanup = getattr(unittest.TestCase, "addCleanup", None)
    return patcher


class _TelemetryCase(unittest.TestCase):
    def setUp(self):
        mt._stats.clear()
        mt._inflight.clear()
        mt._global_recent.clear()
        mt._name_map.clear()
        p = mock.patch.object(mt, "_persist_call", return_value=None)
        p.start()
        self.addCleanup(p.stop)


class SanitizeTests(unittest.TestCase):
    def test_hyphens_become_underscores(self):
        assert mt._sanitize("agent-chat-room") == "agent_chat_room"

    def test_alnum_underscore_preserved(self):
        assert mt._sanitize("my_server_1") == "my_server_1"

    def test_dots_and_spaces_replaced(self):
        assert mt._sanitize("a.b c") == "a_b_c"

    def test_none_like_empty(self):
        assert mt._sanitize("") == ""
        assert mt._sanitize(None) == ""


class ResolveServerTests(_TelemetryCase):
    def test_non_mcp_prefix_returns_none(self):
        assert mt.resolve_server("read_file") is None
        assert mt.resolve_server("") is None

    def test_known_servers_longest_prefix_wins(self):
        result = mt.resolve_server(
            "mcp_agent_chat_room_post_message",
            known_servers=["agent-chat-room", "agent-chat"],
        )
        assert result == "agent_chat_room"

    def test_no_match_returns_none(self):
        assert mt.resolve_server("mcp_unknown_server_do", known_servers=["other"]) is None

    def test_sanitized_name_returned_not_raw(self):
        result = mt.resolve_server("mcp_my_srv_tool", known_servers=["my-srv"])
        assert result == "my_srv"


class RecordTests(_TelemetryCase):
    def test_record_start_ignores_non_mcp_tools(self):
        mt.record_tool_start("read_file", "input")
        assert mt._inflight == {}

    def test_record_end_without_start_still_records_call(self):
        with mock.patch.object(mt, "resolve_server", return_value="srv"):
            mt.record_tool_end("mcp_srv_tool", "ok output")
        assert mt._stats["srv"].calls == 1

    def test_error_detection_by_output_prefix(self):
        with mock.patch.object(mt, "resolve_server", return_value="srv"):
            mt.record_tool_end("mcp_srv_a", "Error: bad thing")
            mt.record_tool_end("mcp_srv_b", '  {"error": {"message": "x"}}')
            mt.record_tool_end("mcp_srv_c", "Tool Error: nope")
            mt.record_tool_end("mcp_srv_d", "fine output")
        assert mt._stats["srv"].errors == 3
        assert mt._stats["srv"].calls == 4

    def test_unattributable_call_does_not_leak_inflight(self):
        with mock.patch.object(mt, "resolve_server", return_value=None):
            mt.record_tool_end("mcp_ghost_tool", "output")
        assert "mcp_ghost_tool" not in mt._inflight

    def test_minute_buckets_accumulate(self):
        with mock.patch.object(mt, "resolve_server", return_value="srv"):
            mt.record_tool_end("mcp_srv_a", "ok")
            mt.record_tool_end("mcp_srv_b", "Error: x")
        buckets = mt._stats["srv"].buckets
        assert len(buckets) >= 1
        total, errors = buckets[-1][1], buckets[-1][2]
        assert (total, errors) == (2, 1)

    def test_input_capped_at_400_chars(self):
        mt.record_tool_start("mcp_srv_big", "i" * 1000)
        assert len(mt._inflight["mcp_srv_big"][2]) == 400


class SnapshotRemapTests(_TelemetryCase):
    def test_sanitized_keys_remapped_to_raw_names(self):
        mt._name_map["agent_chat_room"] = "agent-chat-room"
        with mock.patch.object(mt, "resolve_server", return_value="agent_chat_room"):
            mt.record_tool_end("mcp_agent_chat_room_send", "ok")
        snap = mt.snapshot()
        assert "agent-chat-room" in snap["servers"]
        assert "agent_chat_room" not in snap["servers"]
        assert snap["recent"][0]["server"] == "agent-chat-room"


if __name__ == "__main__":
    unittest.main()
