"""Unit tests for kanban_tools.py — card lookup, formatting, and alias behavior.

All HTTP goes through mocked _fetch; card ids come from the KANBAN_CARD_ID env var.
"""

import os
import unittest
from unittest import mock

import kanban_tools as kt


_CARD = {
    "id": "card-1",
    "title": "Fix login bug",
    "status": "running",
    "spec": "Steps go here",
    "acceptanceCriteria": ["logs out", "no crash"],
    "reportPath": "previous notes",
}


class _EnvCardId:
    """Context manager pinning KANBAN_CARD_ID."""

    def __init__(self, value):
        self.value = value
        self._prev = None

    def __enter__(self):
        self._prev = os.environ.get("KANBAN_CARD_ID")
        if self.value is None:
            os.environ.pop("KANBAN_CARD_ID", None)
        else:
            os.environ["KANBAN_CARD_ID"] = self.value
        return self

    def __exit__(self, *args):
        if self._prev is None:
            os.environ.pop("KANBAN_CARD_ID", None)
        else:
            os.environ["KANBAN_CARD_ID"] = self._prev


class ActiveCardIdsTests(unittest.TestCase):
    def test_single_id(self):
        with _EnvCardId("card-1"):
            self.assertEqual(kt._active_card_ids(), ["card-1"])

    def test_comma_separated_ids(self):
        with _EnvCardId("a, b ,,c"):
            self.assertEqual(kt._active_card_ids(), ["a", "b", "c"])

    def test_missing_env_empty_list(self):
        with _EnvCardId(None):
            self.assertEqual(kt._active_card_ids(), [])


class FindCurrentCardTests(unittest.TestCase):
    def test_prefers_explicit_id_match(self):
        cards = [
            {"id": "other", "status": "running"},
            {"id": "mine", "status": "running"},
        ]
        with mock.patch.object(kt, "_fetch", return_value={"cards": cards}):
            card = kt._find_current_card(["mine"])
        self.assertEqual(card["id"], "mine")

    def test_falls_back_to_first_running(self):
        cards = [{"id": "other", "status": "running"}]
        with mock.patch.object(kt, "_fetch", return_value={"cards": cards}):
            card = kt._find_current_card(["not-there"])
        self.assertEqual(card["id"], "other")

    def test_no_cards_returns_none(self):
        with mock.patch.object(kt, "_fetch", return_value={"cards": []}):
            self.assertIsNone(kt._find_current_card(["x"]))

    def test_fetch_failure_returns_none(self):
        with mock.patch.object(kt, "_fetch", return_value=None):
            self.assertIsNone(kt._find_current_card(["x"]))


class ReadCurrentCardTests(unittest.TestCase):
    def test_full_render_includes_sections(self):
        with mock.patch.object(kt, "_fetch", return_value={"cards": [_CARD]}), \
             _EnvCardId("card-1"):
            result = kt.kanban_read_current_card()
        self.assertIn("Card: Fix login bug", result)
        self.assertIn("Status: running", result)
        self.assertIn("ID: card-1", result)
        self.assertIn("Spec:\nSteps go here", result)
        self.assertIn("Acceptance criteria:", result)
        self.assertIn("  - logs out", result)
        self.assertIn("Previous report:\nprevious notes", result)

    def test_minimal_card_omits_empty_sections(self):
        minimal = {"id": "m", "title": "T", "status": "todo"}
        with mock.patch.object(kt, "_fetch", return_value={"cards": [minimal]}), \
             _EnvCardId("m"):
            result = kt.kanban_read_current_card()
        self.assertNotIn("Spec:", result)
        self.assertNotIn("Acceptance criteria:", result)
        self.assertNotIn("Previous report:", result)

    def test_no_active_card_error_message(self):
        with mock.patch.object(kt, "_fetch", return_value={"cards": []}), \
             _EnvCardId(None):
            result = kt.kanban_read_current_card()
        self.assertIn("Error: No active kanban card found", result)


class UpdateStatusTests(unittest.TestCase):
    def test_patch_sent_with_report_path(self):
        captured = {}

        def fake_fetch(path, method="GET", body=None, retries=2):
            if path == "/api/hermes/kanban":
                return {"cards": [_CARD]}
            captured.update({"path": path, "method": method, "body": body})
            return {"ok": True}

        with mock.patch.object(kt, "_fetch", side_effect=fake_fetch), \
             _EnvCardId("card-1"):
            result = kt.kanban_update_status("review", "did the thing")
        self.assertIn("review", result)
        self.assertIn("Report saved.", result)
        self.assertEqual(captured["method"], "PATCH")
        self.assertEqual(captured["body"]["reportPath"], "did the thing")

    def test_api_unreachable_error(self):
        def fake_fetch(path, method="GET", body=None, retries=2):
            if path == "/api/hermes/kanban":
                return {"cards": [_CARD]}
            return None

        with mock.patch.object(kt, "_fetch", side_effect=fake_fetch), \
             _EnvCardId("card-1"):
            result = kt.kanban_update_status("done")
        self.assertIn("API unreachable", result)

    def test_no_card_error(self):
        with mock.patch.object(kt, "_fetch", return_value={"cards": []}), \
             _EnvCardId(None):
            result = kt.kanban_update_status("done")
        self.assertIn("No active kanban card found", result)


class AliasBehaviorTests(unittest.TestCase):
    def test_kanban_show_is_read_current_card(self):
        with mock.patch.object(
            kt, "kanban_read_current_card", return_value="CARD"
        ) as m:
            self.assertEqual(kt.kanban_show(), "CARD")
        m.assert_called_once()

    def test_complete_maps_to_done_with_summary(self):
        with mock.patch.object(
            kt, "kanban_update_status", return_value="ok"
        ) as m:
            self.assertEqual(kt.kanban_complete("all green"), "ok")
        m.assert_called_once_with("done", "all green")

    def test_block_maps_to_blocked_with_reason(self):
        with mock.patch.object(
            kt, "kanban_update_status", return_value="ok"
        ) as m:
            self.assertEqual(kt.kanban_block("missing creds"), "ok")
        m.assert_called_once_with("blocked", "missing creds")

    def test_comment_requires_body(self):
        result = kt.kanban_comment(body="")
        self.assertIn("body is required", result)

    def test_heartbeat_appends_timestamped_note(self):
        with mock.patch.object(
            kt, "kanban_append_report", return_value="Notes appended to card."
        ) as m:
            result = kt.kanban_heartbeat(note="still alive")
        self.assertEqual(result, "Notes appended to card.")
        sent = m.call_args[0][0]
        self.assertIn("[heartbeat ", sent)
        self.assertIn("still alive", sent)


if __name__ == "__main__":
    unittest.main()
