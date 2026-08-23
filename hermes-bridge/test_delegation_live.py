"""Unit tests for delegation_live.py — live subagent transcript readers.

All filesystem access goes through tmp_path fixtures; no live agent needed.
Covers: path parsing, traversal-guarded dir resolution, manifest read/list,
and log tailing (offsets, done-detection, invalid inputs).
"""

import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import delegation_live as dl


class _TempHomeCase(unittest.TestCase):
    """Base: fresh hermes-home per test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.hermes_home = Path(self._tmp.name) / "hermes-home"
        self.hermes_home.mkdir()


def _make_delegation(home, deleg_id, tasks=None, manifest=None):
    d = home / "cache" / "delegation" / "live" / deleg_id
    d.mkdir(parents=True, exist_ok=True)
    if manifest is None:
        manifest = {"goal": "test goal", "tasks": list((tasks or {}).values())}
    (d / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for idx, text in (tasks or {}).items():
        (d / f"task-{idx}.log").write_text(text, encoding="utf-8")
    return d


class ParsePathTests(unittest.TestCase):
    def test_extracts_deleg_id(self):
        path = "/home/x/.hermes/cache/delegation/live/deleg_abc123/task-2.log"
        assert dl.parse_delegation_id_from_path(path) == "deleg_abc123"

    def test_non_matching_path_returns_none(self):
        assert dl.parse_delegation_id_from_path("/tmp/other.log") is None
        assert dl.parse_delegation_id_from_path("") is None
        assert dl.parse_delegation_id_from_path(None) is None

    def test_task_index_extracted(self):
        path = "/home/x/live/deleg_ff/task-7.log"
        assert dl.parse_task_index_from_path(path) == 7

    def test_task_index_none_on_no_match(self):
        assert dl.parse_task_index_from_path("/tmp/whatever") is None


class SafeDirTests(_TempHomeCase):
    def test_valid_id_resolves_inside_root(self):
        d = dl._safe_delegation_dir(self.hermes_home, "deleg_abc123")
        # resolve() may differ from the raw path (macOS /private prefix) — the
        # contract is containment, not string equality.
        assert d.is_relative_to(self.hermes_home.resolve())
        assert d.name == "deleg_abc123"

    def test_traversal_rejected(self):
        for bad in ("../../etc", "deleg_abc/../../../etc", "", "not-deleg"):
            with self.assertRaises(ValueError):
                dl._safe_delegation_dir(self.hermes_home, bad)

    def test_symlink_escape_rejected(self):
        outside = self.hermes_home / "outside"
        outside.mkdir()
        link = self.hermes_home / "cache" / "delegation" / "live" / "deleg_fff"
        link.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(outside, link)
        with self.assertRaises(ValueError):
            dl._safe_delegation_dir(self.hermes_home, "deleg_fff")


class ManifestTests(_TempHomeCase):
    def test_read_manifest_sets_delegation_id(self):
        _make_delegation(self.hermes_home, "deleg_abc", manifest={"goal": "g"})
        data = dl.read_manifest(self.hermes_home, "deleg_abc")
        assert data["goal"] == "g"
        assert data["delegation_id"] == "deleg_abc"

    def test_missing_manifest_raises_file_not_found(self):
        _make_delegation(self.hermes_home, "deleg_abc")
        with self.assertRaises(FileNotFoundError):
            dl.read_manifest(self.hermes_home, "deleg_def")

    def test_invalid_json_skipped_in_listing(self):
        _make_delegation(self.hermes_home, "deleg_aaa")
        d = _make_delegation(self.hermes_home, "deleg_bbb")
        (d / "manifest.json").write_text("{broken json", encoding="utf-8")
        _make_delegation(self.hermes_home, "deleg_ccc")
        recent = dl.list_recent_manifests(self.hermes_home)
        ids = [m["delegation_id"] for m in recent]
        assert "deleg_bbb" not in ids
        assert set(ids) == {"deleg_aaa", "deleg_ccc"}

    def test_list_sorted_newest_first(self):
        _make_delegation(self.hermes_home, "deleg_aaa", manifest={"n": 1})
        time.sleep(0.02)
        _make_delegation(self.hermes_home, "deleg_bbb", manifest={"n": 2})
        recent = dl.list_recent_manifests(self.hermes_home)
        assert recent[0]["delegation_id"] == "deleg_bbb"

    def test_limit_clamped_to_twenty(self):
        for i in range(25):
            _make_delegation(self.hermes_home, f"deleg_{i:06x}")
        many = dl.list_recent_manifests(self.hermes_home, limit=500)
        assert len(many) <= 20

    def test_latest_manifest_none_when_empty(self):
        assert dl.latest_manifest(self.hermes_home) is None


class TailTaskLogTests(_TempHomeCase):
    def test_reads_full_log(self):
        _make_delegation(self.hermes_home, "deleg_abc", tasks={0: "line1\nline2\n"})
        result = dl.tail_task_log(self.hermes_home, "deleg_abc", 0)
        assert result["text"] == "line1\nline2\n"
        assert result["done"] is True
        assert result["lines"] == ["line1", "line2"]

    def test_offset_paging(self):
        _make_delegation(self.hermes_home, "deleg_abc", tasks={1: "aaaa\nbbbb\n"})
        first = dl.tail_task_log(self.hermes_home, "deleg_abc", 1, offset=0, max_bytes=5)
        assert first["text"] == "aaaa\n"
        assert first["done"] is False
        second = dl.tail_task_log(self.hermes_home, "deleg_abc", 1, offset=first["next_offset"])
        assert second["done"] is True
        assert "bbbb" in second["text"]

    def test_missing_log_returns_empty_not_done(self):
        _make_delegation(self.hermes_home, "deleg_abc")
        result = dl.tail_task_log(self.hermes_home, "deleg_abc", 3)
        assert result["done"] is False
        assert result["text"] == ""
        assert result["lines"] == []

    def test_task_index_bounds(self):
        _make_delegation(self.hermes_home, "deleg_abc")
        for bad in (-1, 65, 1000):
            with self.assertRaises(ValueError):
                dl.tail_task_log(self.hermes_home, "deleg_abc", bad)

    def test_invalid_deleg_id_rejected(self):
        with self.assertRaises(ValueError):
            dl.tail_task_log(self.hermes_home, "../../etc", 0)


if __name__ == "__main__":
    unittest.main()
