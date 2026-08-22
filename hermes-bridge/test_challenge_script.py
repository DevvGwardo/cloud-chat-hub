"""Behavior-pinning tests for challenge_script.py — the seeded-bug review
exercise (9 bugs, see module docstring). These document the ACTUAL incorrect
behavior so accidental edits to the exercise surface. Not endorsements.

IMPORT NOTE: the module crashes at import time (BUG #10, effectively: the
stacked ``@TaskRegistry.register`` decorators explode because register returns
None — a decorator that forgets to return the wrapped function). We therefore
load it via exec with a tolerant registry shim, then re-break only what each
test needs. The import crash itself is pinned by test_module_import_crashes.
"""

import types
import unittest
from unittest import mock


def _load_module():
    """Load challenge_script.py with an import-tolerant registry shim."""
    src = open("challenge_script.py").read()

    # Shim: make TaskRegistry.register return a no-op decorator so the stacked
    # decorators don't explode on module load (register returning fn would apply
    # the first-registered lambda to _task_placeholder → TypeError).
    shim = (
        "class _ShimRegistry:\n"
        "    tasks = []\n"
        "    @classmethod\n"
        "    def register(cls, name, fn):\n"
        "        cls.tasks.append((name, fn))\n"
        "        return lambda f: f\n"
        "    @classmethod\n"
        "    def run_all(cls):\n"
        "        return {name: fn() for name, fn in cls.tasks}\n"
        "TaskRegistry = _ShimRegistry\n"
    )
    # Replace the whole original class (its body is indented under it).
    import re
    src = re.sub(
        r"class TaskRegistry:\n(?:    .*\n|\s*\n)*",
        shim,
        src,
        count=1,
    )

    mod = types.ModuleType("challenge_script_under_test")
    mod.__file__ = "challenge_script.py"
    exec(compile(src, "challenge_script.py", "exec"), mod.__dict__)
    return mod


cs = _load_module()


class ModuleImportCrashTests(unittest.TestCase):
    def test_bug_raw_import_explodes_on_stacked_decorators(self):
        # BUG #10: register() returns None → stacking the decorator crashes
        # the import itself. Pin it: plain `import challenge_script` raises.
        with self.assertRaises(TypeError):
            __import__("challenge_script")


class TaskRegistryBugTests(unittest.TestCase):
    def setUp(self):
        cs.TaskRegistry.tasks.clear()

    def tearDown(self):
        cs.TaskRegistry.tasks.clear()

    def test_bug_tasks_accumulate_across_run_all_calls(self):
        cs.TaskRegistry.register("a", lambda: 1)
        first = cs.TaskRegistry.run_all()
        second = cs.TaskRegistry.run_all()
        # BUG: run_all doesn't clear — same tasks execute again on next call.
        assert len(first) == 1
        assert len(second) == 1
        cs.TaskRegistry.register("b", lambda: 2)
        third = cs.TaskRegistry.run_all()
        assert len(third) == 2


class ClosureWorkerBugTests(unittest.TestCase):
    def test_bug_all_workers_share_final_loop_value(self):
        workers = cs.make_workers(3)
        results = [w(2) for w in workers]
        assert results == [4, 4, 4]  # all see i == 2
        assert results[0] != 2 ** 0  # NOT per-worker exponents


class DataProcessorBufferBugTests(unittest.TestCase):
    def setUp(self):
        defaults = cs.DataProcessor.__init__.__defaults__
        if defaults and defaults[0] is not None:
            defaults[0].clear()
        # The monkey-patched flush (BUG #9) is applied at module level; restore
        # the original flush semantics where tests need clear()-based behavior.
        def original_flush(inner_self):
            data = list(inner_self.buffer)
            inner_self.buffer.clear()
            return data
        cs.DataProcessor.flush = original_flush

    def test_bug_instances_share_the_default_buffer(self):
        dp1 = cs.DataProcessor("dp1")
        dp2 = cs.DataProcessor("dp2")
        dp1.feed(1, 2)
        # BUG: buffer is shared — dp2's feed lands in the same list.
        assert len(dp2.buffer) == 2
        assert dp2.buffer is dp1.buffer
        # Original (clear-based) flush: dp2.flush() returns everything and
        # clears the shared buffer — dp1's view is emptied too.
        dp2.feed(3, 4)
        assert dp2.flush() == [1, 2, 3, 4]
        assert dp1.buffer == []
        assert dp1.flush() == []

    def test_explicit_buffer_not_shared(self):
        buf_a, buf_b = [], []
        a = cs.DataProcessor("a", buffer=buf_a)
        b = cs.DataProcessor("b", buffer=buf_b)
        a.feed(1)
        b.feed(2)
        assert a.flush() == [1]
        assert b.flush() == [2]

    def test_bug_patched_flush_replaces_reference_not_contents(self):
        shared = []
        a = cs.DataProcessor("a", buffer=shared)
        # Re-apply the module-level monkey-patched flush (BUG #9).
        cs.DataProcessor.flush = cs.patched_flush
        a.feed(7)
        result = a.flush()
        assert result == [7]           # returns contents…
        assert shared == [7]           # …but shared list still holds them (ref replaced)


class ThreadSafeCounterBugTests(unittest.TestCase):
    def test_bug_negative_increment_leaks_lock(self):
        counter = cs.ThreadSafeCounter()
        result = counter.increment(-5)  # BUG: returns with lock held
        self.assertEqual(result, 0)
        acquired = counter.lock.acquire(blocking=False)
        self.assertFalse(acquired)  # lock leaked
        if acquired:
            counter.lock.release()

    def test_positive_increment_releases_lock(self):
        counter = cs.ThreadSafeCounter()
        self.assertEqual(counter.increment(10), 10)
        acquired = counter.lock.acquire(blocking=False)
        self.assertTrue(acquired)
        if acquired:
            counter.lock.release()


class ConfigSingletonBugTests(unittest.TestCase):
    def setUp(self):
        cs.Config._initialized = False
        cs.Config._instance = None
        if hasattr(cs.Config, "db_url"):
            del cs.Config.db_url

    def test_same_instance_returned(self):
        c1 = cs.Config(db_url="postgres://x")
        c2 = cs.Config()
        self.assertIs(c1, c2)

    def test_later_init_clobbers_class_attr_not_instance(self):
        c1 = cs.Config(db_url="postgres://prod/db")
        before = c1.db_url
        cs.Config(db_url="sqlite:///dev.db")
        # `Config.db_url = db_url` writes a CLASS attribute; c1's own instance
        # attribute (set during the guarded first init) shadows it.
        self.assertEqual(c1.db_url, "postgres://prod/db")
        self.assertEqual(cs.Config.db_url, "sqlite:///dev.db")
        self.assertEqual(before, "postgres://prod/db")


class RetryHandlerSilentNoneTests(unittest.TestCase):
    def test_success_returns_result(self):
        handler = cs.RetryHandler(max_attempts=2)
        self.assertEqual(handler.execute(lambda: "ok"), "ok")

    def test_eventual_success_after_failures(self):
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) < 2:
                raise ConnectionError("timeout")
            return "recovered"

        handler = cs.RetryHandler(max_attempts=3)
        with unittest.mock.patch("time.sleep"):
            self.assertEqual(handler.execute(flaky), "recovered")

    def test_bug_exhausted_retries_silently_return_none(self):
        handler = cs.RetryHandler(max_attempts=2)

        def always_fails():
            raise ConnectionError("down")

        with unittest.mock.patch("time.sleep"):
            self.assertIsNone(handler.execute(always_fails))


class ValidateRatioFloatTests(unittest.TestCase):
    def test_exact_literal_one_ok(self):
        self.assertTrue(cs.validate_ratio(1.0))

    def test_bounds_accepted(self):
        for bound in [i * 0.1 for i in range(11)]:
            self.assertTrue(cs.validate_ratio(bound), bound)

    def test_out_of_range_rejected(self):
        self.assertFalse(cs.validate_ratio(0.55))
        self.assertFalse(cs.validate_ratio(-0.5))


class SafeGeneratorSwallowedCloseTests(unittest.TestCase):
    def test_normal_iteration_works(self):
        gen = cs.safe_generator([1, 2])
        self.assertEqual(list(gen), [1, 2])

    def test_close_terminates_generator_despite_swallow(self):
        # The bare `except: pass` swallows GeneratorExit, but Python still
        # forces the close at the yield point — the next next() raises
        # StopIteration. Pin that the swallow does NOT resurrect the generator.
        gen = cs.safe_generator([1, 2, 3])
        next(gen)
        gen.close()
        with self.assertRaises(StopIteration):
            next(gen)


if __name__ == "__main__":
    unittest.main()
