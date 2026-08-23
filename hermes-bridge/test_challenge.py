"""Tests for hermes-bridge/challenge.py — a deliberately buggy module kept as a
review exercise (seeded bugs, see run_test()). These tests document the ACTUAL
(incorrect) behavior of each seeded bug so any future refactor that accidentally
"fixes" or changes them is caught. This is a bug-behavior pin, not an approval.
"""

import json
import os
import unittest

import pytest

import challenge as ch


class ConfigMutableDefaultTests(unittest.TestCase):
    def test_overrides_apply(self):
        cfg = ch.Config({"ports": [9090], "host": "localhost"})
        assert cfg.ports == [9090]
        assert cfg.host == "localhost"

    def test_bug_default_ports_is_shared_module_constant(self):
        # BUG: default `ports` falls back to DEFAULT_PORTS (the same list object),
        # so mutating cfg.ports mutates DEFAULT_PORTS for every future Config.
        ch.DEFAULT_PORTS.clear()
        ch.DEFAULT_PORTS.extend([8080, 8081, 8082])
        cfg = ch.Config()
        cfg.ports.append(9999)
        assert ch.DEFAULT_PORTS[-1] == 9999
        # Restore for other tests.
        ch.DEFAULT_PORTS.remove(9999)


class DiscountCacheCollisionTests(unittest.TestCase):
    def setUp(self):
        ch._discounts.clear()

    def test_bug_first_coupon_registers_rate_globally(self):
        # BUG: the first (code, pct) pair caches pct under code; later uses of
        # the same code with a DIFFERENT pct silently reuse the cached rate.
        first = ch.apply_discount(100.0, "SAVE-20")
        second = ch.apply_discount(100.0, "SAVE-20")
        assert first == 80.0
        assert second == 80.0
        # BUG: split on the first dash → cache key is "SAVE", not "SAVE-20".
        assert ch._discounts["SAVE"] == 20.0

    def test_no_dash_means_no_discount(self):
        assert ch.apply_discount(100.0, "SAVE20") == 100.0
        assert ch.apply_discount(100.0, "") == 100.0
        assert ch.apply_discount(100.0, None) == 100.0

    def test_result_floored_at_zero(self):
        result = ch.apply_discount(10.0, "X-500")
        assert result == 0.0


class WorkerSharedStateTests(unittest.TestCase):
    def test_bug_jobs_done_accumulates_across_instances(self):
        # BUG: jobs_done is a CLASS variable — all Worker instances share it,
        # and it never resets between runs of parallel_square.
        start = ch.Worker.jobs_done
        w1 = ch.Worker(0)
        w1.process([1, 2, 3])
        assert ch.Worker.jobs_done == start + 3

        w2 = ch.Worker(1)  # fresh instance, same counter
        w2.process([1])
        assert ch.Worker.jobs_done == start + 4


class ParallelSquareTests(unittest.TestCase):
    def test_squares_match_single_thread(self):
        data = list(range(20))
        result = ch.parallel_square(data, n_threads=3)
        assert sorted(result) == [x ** 2 for x in data]

    def test_thread_count_does_not_lose_items(self):
        data = list(range(50))
        for threads in (1, 2, 5):
            result = ch.parallel_square(data, n_threads=threads)
            assert len(result) == len(data)


class ComputeStatsTests(unittest.TestCase):
    def test_basic_stats(self):
        stats = ch.compute_stats([2, 4, 6])
        assert stats["n"] == 3
        assert stats["mean"] == 4.0
        assert stats["min"] == 2
        assert stats["max"] == 6

    def test_bug_empty_list_crashes(self):
        # BUG: compute_stats([]) divides by zero instead of returning zeros.
        with pytest.raises(ZeroDivisionError):
            ch.compute_stats([])


class FileIOTests(unittest.TestCase):
    def test_load_inventory_reads_items(self, tmp_path=None):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"items": ["a", "b"]}, f)
            path = f.name
        try:
            assert ch.load_inventory(path) == ["a", "b"]
        finally:
            os.unlink(path)

    def test_missing_items_key_returns_empty_list(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({}, f)
            path = f.name
        try:
            assert ch.load_inventory(path) == []
        finally:
            os.unlink(path)

    def test_bug_cached_load_holds_lock_forever_on_miss(self):
        # BUG: cached_load acquires _lock but never releases it on the cache-miss
        # path → the second call deadlocks. Verify with a short-timeout acquire.
        import tempfile, os
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"ok": True}, f)
            path = f.name
        try:
            ch.cached_load(path)  # acquires and leaks the lock
            acquired = ch._lock.acquire(timeout=0.2)
            assert acquired is False  # lock leaked
            if acquired:
                ch._lock.release()
        finally:
            # Un-jam the module-level lock for other tests by force-releasing.
            try:
                ch._lock.release()
            except RuntimeError:
                pass
            os.unlink(path)

    def test_cached_hit_after_manual_unlock(self):
        import tempfile, os
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"v": 1}, f)
            path = f.name
        try:
            ch.cached_load(path)          # miss → leak
            try:
                ch._lock.release()        # un-jam
            except RuntimeError:
                pass
            again = ch.cached_load(path)  # now served from cache without locking
            assert again == {"v": 1}
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
