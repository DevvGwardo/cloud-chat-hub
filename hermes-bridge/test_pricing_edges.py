"""Edge tests for pricing.py — rule precedence, cache-rate defaults, alias
resolution, and cost math beyond what test_pricing.py already pins."""

import unittest
from unittest import mock

import pricing


class RulePrecedenceTests(unittest.TestCase):
    def test_free_suffix_wins_over_everything(self):
        # ":free" beats the opus/gpt rules that would otherwise match.
        for model in ("claude-opus-4:free", "gpt-4o:free", "deepseek-v4-flash-free"):
            with self.subTest(model=model):
                price = pricing.price_for(model)
                self.assertEqual(price.input, 0.0)
                self.assertEqual(price.output, 0.0)

    def test_opus_priced_above_sonnet_despite_shared_claude_rule(self):
        opus = pricing.price_for("claude-opus-4")
        sonnet = pricing.price_for("claude-sonnet-4")
        assert opus.input == 15.0
        assert sonnet.input == 3.0

    def test_gemini_flash_lite_cheaper_than_flash(self):
        lite = pricing.price_for("gemini-3-flash-lite")
        flash = pricing.price_for("gemini-3-flash")
        assert lite.input < flash.input

    def test_bare_flash_is_not_gemini(self):
        # deepseek-v4-flash must hit the deepseek rule, not the gemini rule.
        price = pricing.price_for("deepseek-v4-flash")
        assert price.input == 0.14

    def test_model_rules_beat_provider_defaults(self):
        # deepseek-v4-pro billed via "custom" aggregator → family rate, not the
        # custom-provider guess (which has no default anyway).
        price = pricing.price_for("deepseek-v4-pro", billing_provider="custom")
        assert price.input == 0.55

    def test_provider_default_when_no_rule_matches(self):
        price = pricing.price_for("totally-unknown-model", billing_provider="nous")
        assert price.input == 0.90

    def test_none_model_and_provider_returns_none(self):
        assert pricing.price_for(None) is None
        assert pricing.price_for("") is None


class ResolveProviderEdgeTests(unittest.TestCase):
    def test_aggregator_prefix_with_no_model_falls_to_unknown(self):
        # "custom:..." splits to base "custom" which is intentionally absent
        # from PROVIDER_DEFAULTS (aggregators are priced by model name) — and
        # with no model name there's nothing to infer, so → unknown.
        assert pricing.resolve_provider(None, "custom:api.bullinf.fun") == "unknown"

    def test_alias_resolution(self):
        assert pricing.resolve_provider(None, "openai-codex") == "openai"
        assert pricing.resolve_provider(None, "kimi-coding") == "kimi"

    def test_model_name_inference_fallback(self):
        assert pricing.resolve_provider("claude-opus-4", None) == "anthropic"
        assert pricing.resolve_provider("hermes-4-5", None) == "nous"
        assert pricing.resolve_provider("qwen-max", None) == "alibaba"

    def test_billing_provider_beats_model_name(self):
        # billing_provider is authoritative even when the model name says otherwise.
        assert pricing.resolve_provider("claude-opus-4", "google") == "google"

    def test_unknown_when_nothing_matches(self):
        assert pricing.resolve_provider("zzz-model", "weird-aggregator") == "unknown"


class CacheRateDefaultsTests(unittest.TestCase):
    def test_default_cache_read_is_10pct_of_input(self):
        price = pricing.ModelPrice(input=4.0, output=20.0)  # no cache rates
        assert price.rate_cache_read() == 0.4

    def test_default_cache_write_is_125pct_of_input(self):
        price = pricing.ModelPrice(input=4.0, output=20.0)
        assert price.rate_cache_write() == 5.0

    def test_explicit_cache_rates_win(self):
        price = pricing.ModelPrice(input=4.0, output=20.0, cache_read=0.07, cache_write=1.0)
        assert price.rate_cache_read() == 0.07
        assert price.rate_cache_write() == 1.0

    def test_deepseek_has_explicit_cheap_cache_read(self):
        price = pricing.price_for("deepseek-v4-flash")
        assert price.cache_read == 0.014
        assert price.rate_cache_read() == 0.014


class CostMathEdgeTests(unittest.TestCase):
    def test_zero_tokens_zero_cost(self):
        price = pricing.ModelPrice(input=3.0, output=15.0)
        assert pricing.cost_for_tokens(price) == 0.0

    def test_reasoning_billed_at_output_rate(self):
        price = pricing.ModelPrice(input=1.0, output=10.0)
        cost = pricing.cost_for_tokens(price, reasoning_tokens=1_000_000)
        assert cost == 10.0

    def test_mixed_bundle_math(self):
        price = pricing.ModelPrice(input=2.0, output=6.0, cache_read=0.2, cache_write=2.5)
        cost = pricing.cost_for_tokens(
            price,
            input_tokens=100_000,
            output_tokens=50_000,
            cache_read_tokens=200_000,
            cache_write_tokens=10_000,
            reasoning_tokens=25_000,
        )
        expected = (
            100_000 * 2.0
            + 50_000 * 6.0
            + 200_000 * 0.2
            + 10_000 * 2.5
            + 25_000 * 6.0
        ) / 1_000_000
        assert abs(cost - expected) < 1e-9


if __name__ == "__main__":
    unittest.main()
