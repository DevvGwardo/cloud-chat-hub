"""Unit tests for brain_cache.py — circuit breaker, token loading, retry logic,
and the safe get/set/delete wrappers. All HTTP mocked via httpx.Client."""

import unittest
from unittest import mock

import brain_cache as bc


class CircuitBreakerTests(unittest.TestCase):
    def _breaker(self, threshold=3, recovery=15.0):
        return bc._CircuitBreaker(failure_threshold=threshold, recovery_timeout=recovery)

    def test_starts_closed(self):
        br = self._breaker()
        self.assertEqual(br.get_state(), "closed")
        self.assertTrue(br.is_available())

    def test_opens_after_consecutive_failures(self):
        br = self._breaker(threshold=3)
        for _ in range(3):
            br.record_failure()
        self.assertEqual(br.get_state(), "open")
        self.assertFalse(br.is_available())

    def test_success_resets_failures(self):
        br = self._breaker(threshold=3)
        br.record_failure()
        br.record_failure()
        br.record_success()
        self.assertEqual(br.failures, 0)
        self.assertEqual(br.get_state(), "closed")

    def test_open_recovers_to_half_open_after_timeout(self):
        import time as time_mod
        from unittest import mock as m

        br = self._breaker(threshold=1, recovery=30.0)
        br.record_failure()  # opens immediately
        self.assertFalse(br.is_available())

        # Simulate the recovery window elapsing.
        with m.patch.object(time_mod, "monotonic",
                            return_value=br.last_failure_time + 31.0):
            self.assertTrue(br.is_available())
        self.assertEqual(br.get_state(), "half-open")

    def test_half_open_allows_attempt(self):
        import time as time_mod
        from unittest import mock as m

        br = self._breaker(threshold=1, recovery=30.0)
        br.record_failure()
        with m.patch.object(time_mod, "monotonic",
                            return_value=br.last_failure_time + 31.0):
            self.assertTrue(br.is_available())  # half-open allows one attempt


class TokenLoadingTests(unittest.TestCase):
    def setUp(self):
        bc._BRAIN_GATEWAY_TOKEN = None
        self._prev_env = os.environ.pop("HERMES_BRAIN_TOKEN", None)

    def tearDown(self):
        bc._BRAIN_GATEWAY_TOKEN = None
        if self._prev_env is None:
            os.environ.pop("HERMES_BRAIN_TOKEN", None)
        else:
            os.environ["HERMES_BRAIN_TOKEN"] = self._prev_env

    def test_env_var_fallback_when_no_config(self):
        with mock.patch("os.path.exists", return_value=False), \
             mock.patch.dict(os.environ, {"HERMES_BRAIN_TOKEN": "env-token-value"}):
            token = bc._get_brain_token()
        self.assertEqual(token, "env-token-value")

    def test_result_cached_after_first_load(self):
        os.environ["HERMES_BRAIN_TOKEN"] = "first"
        with mock.patch("os.path.exists", return_value=False):
            first = bc._get_brain_token()
        os.environ["HERMES_BRAIN_TOKEN"] = "second"
        second = bc._get_brain_token()
        self.assertEqual(first, "first")
        self.assertEqual(second, "first")  # cached — env change ignored


import os  # noqa: E402  (needed by TokenLoadingTests)


class BrainSafeWrapperTests(unittest.TestCase):
    def setUp(self):
        bc._BRAIN_GATEWAY_TOKEN = "test-token"
        bc._brain_circuit.record_success()
        p = mock.patch.object(bc, "_retry_brain_call", return_value=None)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(setattr, bc, "_BRAIN_GATEWAY_TOKEN", None)
        self.addCleanup(bc._brain_circuit.record_success)

    def test_set_returns_true_on_result(self):
        with mock.patch.object(bc, "_retry_brain_call", return_value={"ok": True}):
            self.assertTrue(bc.brain_safe_set("k", "v"))

    def test_set_returns_false_on_none(self):
        self.assertFalse(bc.brain_safe_set("k", "v"))

    def test_get_returns_value_field(self):
        with mock.patch.object(
            bc, "_retry_brain_call", return_value={"value": "the-data"}
        ):
            self.assertEqual(bc.brain_safe_get("k"), "the-data")

    def test_get_returns_none_on_missing_value_field(self):
        with mock.patch.object(bc, "_retry_brain_call", return_value={"other": 1}):
            self.assertIsNone(bc.brain_safe_get("k"))

    def test_delete_true_on_result_false_on_none(self):
        with mock.patch.object(bc, "_retry_brain_call", return_value={"ok": True}):
            self.assertTrue(bc.brain_safe_delete("k"))
        with mock.patch.object(bc, "_retry_brain_call", return_value=None):
            self.assertFalse(bc.brain_safe_delete("k"))

    def test_set_passes_ttl_through(self):
        with mock.patch.object(bc, "_retry_brain_call", return_value={"ok": True}) as m:
            bc.brain_safe_set("k", "v", ttl=42)
        m.assert_called_once_with(
            bc._brain_http_call, "POST", "/state/set",
            {"key": "k", "value": "v", "ttl": 42},
        )


class RetryLogicTests(unittest.TestCase):
    def setUp(self):
        bc._BRAIN_GATEWAY_TOKEN = "test-token"
        # Snapshot and restore the global breaker so failure accumulation in one
        # test can't open the circuit for the next test.
        self._orig_brain_circuit = bc._brain_circuit
        fresh = bc._CircuitBreaker(failure_threshold=3, recovery_timeout=15.0)
        p = mock.patch.object(bc, "_brain_circuit", fresh)
        p.start()
        self.addCleanup(p.stop)
        p2 = mock.patch.object(bc, "_retry_brain_call" if False else "_brain_http_call",
                               return_value=None)  # placeholder, replaced below
        p2.stop()

    def tearDown(self):
        self._orig_brain_circuit.record_success()

    def test_success_first_try_no_retries(self):
        fn = mock.MagicMock(return_value={"ok": True})
        with mock.patch("time.sleep") as slept:
            result = bc._retry_brain_call(fn, retries=2, backoff=0.1)
        self.assertEqual(result, {"ok": True})
        fn.assert_called_once()
        slept.assert_not_called()

    def test_retries_on_none_then_succeeds(self):
        responses = [None, {"ok": True}]
        fn = mock.MagicMock(side_effect=responses)
        with mock.patch("time.sleep") as slept:
            result = bc._retry_brain_call(fn, retries=2, backoff=0.1)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(fn.call_count, 2)
        slept.assert_called_once()  # one backoff between attempts

    def test_exhausted_retries_return_none(self):
        fn = mock.MagicMock(return_value=None)
        with mock.patch("time.sleep"):
            result = bc._retry_brain_call(fn, retries=2, backoff=0.01)
        self.assertIsNone(result)
        self.assertEqual(fn.call_count, 3)  # retries + 1

    def test_circuit_open_skips_call_entirely(self):
        br = bc._brain_circuit
        br.failure_threshold = 1
        br.record_failure()  # opens the circuit
        fn = mock.MagicMock(return_value={"ok": True})
        try:
            with mock.patch("time.sleep"):
                result = bc._retry_brain_call(fn, retries=2, backoff=0.01)
            self.assertIsNone(result)
            fn.assert_not_called()
        finally:
            br.record_success()

    def test_exception_counts_as_failure(self):
        fn = mock.MagicMock(side_effect=RuntimeError("network down"))
        with mock.patch("time.sleep"):
            result = bc._retry_brain_call(fn, retries=1, backoff=0.01)
        self.assertIsNone(result)
        self.assertEqual(fn.call_count, 2)


if __name__ == "__main__":
    unittest.main()
