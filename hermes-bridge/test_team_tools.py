"""Unit tests for team_tools.py — team env guards, delegation, context ops,
finding type inference, and completion fallback. All HTTP mocked via _fetch."""

import os
import unittest
from unittest import mock

import team_tools as tt


class _TeamEnv:
    """Pin TEAM_ID / TEAM_SUBTASK_ID / TEAM_AGENT_PROFILE for a test."""

    def __init__(self, team_id="team-1", subtask_id="sub-1", profile="tester"):
        self.values = {
            "TEAM_ID": team_id,
            "TEAM_SUBTASK_ID": subtask_id,
            "TEAM_AGENT_PROFILE": profile,
        }
        self._prev = {}

    def __enter__(self):
        for key, value in self.values.items():
            self._prev[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        return self

    def __exit__(self, *args):
        for key, prev in self._prev.items():
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev


class TeamGuardTests(unittest.TestCase):
    def test_all_tools_require_team_id(self):
        fns = [
            lambda: tt.team_delegate_to_agent("a", "s", "c"),
            lambda: tt.team_report_progress("s"),
            lambda: tt.team_query_context("q"),
            lambda: tt.team_publish_finding("t", "c", []),
            lambda: tt.team_request_help("q"),
            lambda: tt.team_signal_completion("done"),
        ]
        for i, fn in enumerate(fns):
            with self.subTest(fn=i):
                with _TeamEnv(team_id=None):
                    self.assertIn("TEAM_ID not set", fn())

    def test_progress_and_completion_require_subtask_id(self):
        with _TeamEnv(team_id="t", subtask_id=None):
            self.assertIn("TEAM_SUBTASK_ID not set", tt.team_report_progress("s"))
            self.assertIn("TEAM_SUBTASK_ID not set", tt.team_signal_completion("d"))


class DelegateTests(unittest.TestCase):
    def test_delegation_post_body_and_confirmation(self):
        captured = {}

        def fake_fetch(path, method="GET", body=None, retries=2):
            captured.update({"path": path, "method": method, "body": body})
            return {"delegation": {"id": "deleg-9"}}

        with _TeamEnv(team_id="t1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_delegate_to_agent("bob", "write tests", "context here")
        self.assertIn("write tests → bob", result)
        self.assertIn("deleg-9", result)
        self.assertEqual(captured["path"], "/api/hermes/team/delegation")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["body"]["fromAgent"], "alice")
        self.assertEqual(captured["body"]["toAgent"], "bob")

    def test_api_unreachable_error(self):
        with _TeamEnv(team_id="t1"), \
             mock.patch.object(tt, "_fetch", return_value=None):
            result = tt.team_delegate_to_agent("bob", "s", "c")
        self.assertIn("API unreachable", result)


class ReportProgressTests(unittest.TestCase):
    def test_blockers_notify_coordinator_and_tag(self):
        calls = []

        def fake_fetch(path, method="GET", body=None, retries=2):
            calls.append({"path": path, "body": body})
            return {"ok": True}

        with _TeamEnv(team_id="t1", subtask_id="s1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_report_progress("halfway", blockers=["missing creds"])
        self.assertIn("halfway", result)
        self.assertIn("missing creds", result)
        self.assertIn("coordinator notified", result)
        # First call: coordinator blocked endpoint; second: context finding.
        self.assertEqual(calls[0]["path"], "/api/hermes/team/t1/blocked")
        self.assertEqual(calls[0]["body"]["reason"], "missing creds")
        self.assertEqual(calls[1]["body"]["tags"], ["progress", "blocked"])
        self.assertEqual(calls[1]["body"]["importance"], 3)

    def test_no_blockers_importance_two(self):
        calls = []

        def fake_fetch(path, method="GET", body=None, retries=2):
            calls.append(body)
            return {"ok": True}

        with _TeamEnv(team_id="t1", subtask_id="s1"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_report_progress("all clear")
        self.assertNotIn("Blockers", result)
        self.assertEqual(calls[0]["importance"], 2)
        self.assertEqual(calls[0]["tags"], ["progress"])


class QueryContextTests(unittest.TestCase):
    def test_results_rendered_with_tags_and_importance(self):
        entries = [{
            "type": "finding", "importance": 3, "tags": ["auth"],
            "author": "bob", "content": "x" * 400, "id": "abcdefgh1234",
        }]

        def fake_fetch(path, method="GET", body=None, retries=2):
            self.assertIn("q=auth+flow", path)
            return {"entries": entries}

        with _TeamEnv(team_id="t1"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_query_context("auth flow", tags=["auth"])
        self.assertIn("Found 1 context entries", result)
        self.assertIn("★★★", result)
        self.assertIn("[auth]", result)
        self.assertIn("@bob:", result)
        # content truncated to 300 chars in render
        self.assertLess(len([l for l in result.splitlines() if "@bob" in l][0]), 340)

    def test_no_matches_message(self):
        with _TeamEnv(team_id="t1"), \
             mock.patch.object(tt, "_fetch", return_value={"entries": []}):
            result = tt.team_query_context("nothing")
        self.assertIn("No matching context entries", result)

    def test_unreachable_error(self):
        with _TeamEnv(team_id="t1"), \
             mock.patch.object(tt, "_fetch", return_value=None):
            result = tt.team_query_context("q")
        self.assertIn("API unreachable", result)


class PublishFindingTests(unittest.TestCase):
    def _publish(self, title, content="body", tags=None):
        captured = {}

        def fake_fetch(path, method="GET", body=None, retries=2):
            captured.update({"path": path, "body": body})
            return {"entry": {"id": "entry-abcdef123456"}}

        with _TeamEnv(team_id="t1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_publish_finding(title, content, tags or [])
        return result, captured

    def test_type_inferred_decision(self):
        result, captured = self._publish("Decision: use postgres")
        self.assertIn("decision", result)
        self.assertEqual(captured["body"]["type"], "decision")

    def test_type_inferred_artifact(self):
        result, captured = self._publish("Artifact: schema.sql written")
        self.assertEqual(captured["body"]["type"], "artifact")

    def test_type_inferred_question(self):
        result, captured = self._publish("Question about retry policy")
        self.assertEqual(captured["body"]["type"], "question")

    def test_default_type_finding(self):
        result, captured = self._publish("Wrote the parser")
        self.assertEqual(captured["body"]["type"], "finding")

    def test_content_prefixed_with_title(self):
        _, captured = self._publish("Title here", "body text")
        self.assertEqual(captured["body"]["content"], "# Title here\n\nbody text")

    def test_unreachable_error(self):
        with _TeamEnv(team_id="t1"), \
             mock.patch.object(tt, "_fetch", return_value=None):
            result = tt.team_publish_finding("t", "c", [])
        self.assertIn("API unreachable", result)


class RequestHelpTests(unittest.TestCase):
    def test_directed_help_includes_target(self):
        captured = {}

        def fake_fetch(path, method="GET", body=None, retries=2):
            captured["body"] = body
            return {"ok": True}

        with _TeamEnv(team_id="t1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_request_help("how do I auth?", target_agent="bob")
        self.assertIn("Directed to @bob", result)
        self.assertEqual(captured["body"]["type"], "question")
        self.assertEqual(captured["body"]["importance"], 3)
        self.assertEqual(captured["body"]["tags"], ["help-request", "bob"])

    def test_undirected_notifies_all(self):
        captured = {}

        def fake_fetch(path, method="GET", body=None, retries=2):
            captured["body"] = body
            return {"ok": True}

        with _TeamEnv(team_id="t1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_request_help("stuck")
        self.assertIn("All agents notified", result)
        self.assertEqual(captured["body"]["tags"], ["help-request"])


class SignalCompletionTests(unittest.TestCase):
    def test_completion_posts_finding_then_patches_delegation(self):
        calls = []

        def fake_fetch(path, method="GET", body=None, retries=2):
            calls.append({"path": path, "method": method, "body": body})
            return {"ok": True}

        with _TeamEnv(team_id="t1", subtask_id="s1", profile="alice"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_signal_completion("shipped the parser")
        self.assertIn("shipped the parser", result)
        self.assertEqual(calls[0]["body"]["type"], "finding")
        self.assertEqual(calls[0]["body"]["tags"], ["completion"])
        self.assertEqual(calls[1]["method"], "PATCH")
        self.assertEqual(calls[1]["body"]["status"], "completed")

    def test_patch_failure_writes_coordinator_fallback_finding(self):
        calls = []

        def fake_fetch(path, method="GET", body=None, retries=2):
            calls.append({"path": path, "method": method, "body": body})
            # First (context finding) succeeds, second (PATCH) unreachable,
            # third (fallback finding) succeeds.
            return {"ok": True} if method == "POST" else None

        with _TeamEnv(team_id="t1", subtask_id="s1"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_signal_completion("done anyway")
        self.assertIn("done anyway", result)
        self.assertEqual(len(calls), 3)
        self.assertIn("coordinator fallback", calls[2]["body"]["content"])

    def test_summary_truncated_to_200_in_confirmation(self):
        def fake_fetch(path, method="GET", body=None, retries=2):
            return {"ok": True}

        with _TeamEnv(team_id="t1", subtask_id="s1"), \
             mock.patch.object(tt, "_fetch", side_effect=fake_fetch):
            result = tt.team_signal_completion("x" * 500)
        # "Subtask completion signaled: " (28 chars) + 200 = 228
        self.assertLessEqual(len(result), 229)


if __name__ == "__main__":
    unittest.main()
