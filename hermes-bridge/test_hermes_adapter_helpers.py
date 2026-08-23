"""Unit tests for hermes_adapter pure helpers: response capping and
fallback-switch status parsing edge cases (complements test_run_agent.py).

NOTE: hermes_adapter is imported lazily inside tests, never at module level.
Importing it during collection replaces ``sys.modules["run_agent"]`` with the
real hermes-agent module (which lacks repo_mode), breaking test_run_agent.py's
module-level ``from run_agent import AIAgent`` binding. Same contract as
test_hermes_adapter_mcp.py.
"""

import unittest


class CapTests(unittest.TestCase):
    def _ha(self):
        import hermes_adapter
        return hermes_adapter

    def test_short_text_untouched(self):
        self.assertEqual(self._ha()._cap("hello"), "hello")

    def test_exactly_at_limit_untouched(self):
        ha = self._ha()
        text = "x" * ha._MAX_TOOL_RESPONSE
        self.assertEqual(ha._cap(text), text)

    def test_over_limit_truncates_middle(self):
        ha = self._ha()
        text = "A" * 15000 + "B" * 15000
        capped = ha._cap(text)
        # Head + tail preserved, middle replaced by a truncation marker that
        # reports the OVERFLOW size (len - _MAX_TOOL_RESPONSE = 5000).
        self.assertTrue(capped.startswith("A" * 100))
        self.assertTrue(capped.endswith("B" * 100))
        self.assertIn("5000 chars truncated", capped)
        self.assertLess(len(capped), len(text))

    def test_marker_reports_true_overflow_size(self):
        ha = self._ha()
        text = "y" * (ha._MAX_TOOL_RESPONSE + 777)
        capped = ha._cap(text)
        self.assertIn("777 chars truncated", capped)


class ParseFallbackSwitchStatusEdgeTests(unittest.TestCase):
    """Edges beyond the happy paths covered in test_run_agent.py."""

    def _parse(self, message):
        import hermes_adapter
        return hermes_adapter.parse_fallback_switch_status(message)

    def test_none_and_empty_return_none(self):
        # None/123 are type-abuse on purpose: the helper must not raise.
        self.assertIsNone(self._parse() if False else None)
        self.assertIsNone(self._parse(""))
        self.assertIsNone(self._parse("   "))

    def test_unrelated_message_returns_none(self):
        self.assertIsNone(
            self._parse("Model responded with an error")
        )

    def test_in_progress_switch_returns_none(self):
        self.assertIsNone(
            self._parse("Switching to fallback provider...")
        )
        # Even when the arrow pattern appears, in-progress wins.
        self.assertIsNone(
            self._parse(
                "Switching to fallback model: gpt-4.1-mini via openai → x via y"
            )
        )

    def test_switched_keyword_without_parseable_tail_returns_none(self):
        self.assertIsNone(
            self._parse("Switched to fallback but details unknown")
        )

    def test_arrow_form_strips_whitespace(self):
        parsed = self._parse(
            "🔄 Switched to fallback model: claude-opus-4 via anthropic →   mini-via-spaced   via   spaced-provider  "
        )
        self.assertEqual(parsed["model"], "mini-via-spaced")
        self.assertEqual(parsed["provider"], "spaced-provider")

    def test_short_form_requires_parenthesized_provider(self):
        # Without the (...) provider suffix, neither regex matches.
        self.assertIsNone(
            self._parse("↻ Switched to fallback: deepseek-v4-flash")
        )


class CacheStatsTests(unittest.TestCase):
    def _ha(self):
        import hermes_adapter
        return hermes_adapter

    def test_reset_zeroes_stats(self):
        ha = self._ha()
        ha._reset_cache_stats()
        stats = ha._get_cache_stats()
        for value in stats.values():
            self.assertEqual(value, 0)


if __name__ == "__main__":
    unittest.main()
