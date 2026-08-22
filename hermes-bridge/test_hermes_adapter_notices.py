"""Tests for AgentNotice forwarding: real AIAgent notice_callback → adapter
translators → CloudChat on_notice/on_notice_clear callbacks (SSE pipeline)."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


class AgentNoticeForwardingTests(unittest.TestCase):
    def _make_adapter(self, **kwargs):
        import hermes_adapter as ha

        captured_kwargs = {}

        def _fake_real_agent(**kw):
            captured_kwargs.update(kw)
            agent = MagicMock()
            return agent

        with patch.object(ha, "RealAIAgent", side_effect=_fake_real_agent):
            adapter = ha.HermesAgentAdapter(
                base_url="https://api.openai.com/v1",
                api_key="test-key",
                model="gpt-4.1",
                enabled_toolsets=["web"],
                **kwargs,
            )
        return adapter, captured_kwargs

    def test_notice_callback_bound_to_real_agent(self):
        """Adapter passes notice_callback + notice_clear_callback into AIAgent."""
        _, kw = self._make_adapter()
        self.assertIn("notice_callback", kw)
        self.assertIn("notice_clear_callback", kw)

    def test_notice_translates_to_plain_dict(self):
        """_on_notice extracts text/level/kind/ttl_ms/key and calls on_notice."""
        notice = SimpleNamespace(
            text="Credits running low", level="warn", kind="sticky",
            ttl_ms=None, key="credits-low",
        )
        seen = []
        adapter, _ = self._make_adapter(on_notice=seen.append)
        adapter._on_notice(notice)
        self.assertEqual(len(seen), 1)
        payload = seen[0]
        self.assertEqual(payload["text"], "Credits running low")
        self.assertEqual(payload["level"], "warn")
        self.assertEqual(payload["key"], "credits-low")

    def test_malformed_notice_does_not_raise(self):
        """A garbage notice must never break the agent loop."""
        seen = []
        adapter, _ = self._make_adapter(on_notice=seen.append)
        adapter._on_notice(None)
        adapter._on_notice(object())  # no .text attr → empty text → dropped
        self.assertEqual(seen, [])

    def test_notice_clear_forwards_key(self):
        cleared = []
        adapter, _ = self._make_adapter(on_notice_clear=cleared.append)
        adapter._on_notice_clear("credits-low")
        adapter._on_notice_clear(None)  # falsy key → ignored
        self.assertEqual(cleared, ["credits-low"])

    def test_run_budget_passed_through_when_set(self):
        _, kw = self._make_adapter(run_budget_seconds=1800)
        self.assertEqual(kw.get("run_budget_seconds"), 1800)

    def test_run_budget_omitted_when_unset(self):
        _, kw = self._make_adapter(run_budget_seconds=None)
        self.assertNotIn("run_budget_seconds", kw)


if __name__ == "__main__":
    unittest.main()
