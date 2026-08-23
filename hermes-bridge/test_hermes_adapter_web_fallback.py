"""Tests for DuckDuckGo web fallback deferral to hermes-agent's keyless tier.

hermes_adapter._register_fallback_web_tools() must NOT stomp the real agent's
keyless web round-robin (Tavily/Firecrawl/Keenable) when that tier is enabled —
it should only register the DDG scraper when the tier is disabled or the probe
fails.

Strategy: import the real adapter module (which loads the real registry), then
re-run only the fallback-registration decision with mocked probes and inspect
whether a web_search handler from the adapter module itself got registered.
"""

import sys
import types
import unittest
from unittest.mock import patch


class KeylessWebDeferralTests(unittest.TestCase):
    """Run _register_fallback_web_tools under controlled probe results."""

    def _run_registration(self, has_api_key: bool, keyless_enabled, probe_raises: bool = False):
        """Import hermes_adapter with mocked check_web_api_key + keyless probe.

        Returns (module, ddg_registered). ddg_registered is True iff a
        web_search tool whose handler lives in hermes_adapter (the DDG scraper)
        ended up in the registry.
        """
        import hermes_adapter as ha  # real import — loads run_agent + registry

        # Snapshot registry state so re-runs don't accumulate.
        registry = ha.registry
        before = dict(registry._tools)

        fake_web_tools = types.SimpleNamespace(check_web_api_key=lambda: has_api_key)

        if probe_raises:
            def _tier():
                raise ImportError("simulated old hermes-agent")
        elif callable(keyless_enabled):
            _tier = keyless_enabled
        else:
            _tier = lambda: bool(keyless_enabled)  # noqa: E731

        fake_registry_mod = types.SimpleNamespace(_keyless_tier_enabled=_tier)

        with patch.dict(sys.modules, {
            "tools.web_tools": fake_web_tools,
            "agent.web_search_registry": fake_registry_mod,
            # Force the module-level imports inside the function to hit mocks
            "tools": types.SimpleNamespace(web_tools=fake_web_tools),
        }):
            ha._register_fallback_web_tools()

        entry = registry._tools.get("web_search")
        handler = getattr(entry, "handler", None)
        ddg_registered = (
            entry is not None
            and getattr(handler, "__module__", "") == ha.__name__
        )

        # Restore pre-run registry contents (remove any tools this call added).
        added = set(registry._tools) - set(before)
        for name in added:
            registry._tools.pop(name, None)
        removed = set(before) - set(registry._tools)
        for name in removed:
            registry._tools[name] = before[name]

        return ha, ddg_registered

    def test_defers_when_keyless_tier_enabled(self):
        """No API keys + upstream keyless tier enabled → no DDG registration."""
        _, registered = self._run_registration(
            has_api_key=False, keyless_enabled=True,
        )
        self.assertFalse(
            registered,
            "DDG fallback must NOT be registered when hermes-agent's keyless "
            "web tier is enabled — it would stomp the better round-robin",
        )

    def test_registers_ddg_when_keyless_probe_fails(self):
        """Older hermes-agent without the keyless tier → keep the DDG fallback."""
        _, registered = self._run_registration(
            has_api_key=False, keyless_enabled=None, probe_raises=True,
        )
        self.assertTrue(
            registered,
            "DDG fallback must remain registered when the keyless-tier probe "
            "fails (pre-keyless hermes-agent)",
        )


if __name__ == "__main__":
    unittest.main()
