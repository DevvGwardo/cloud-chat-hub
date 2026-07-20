"""Tests for Hermes 0.19 live delegation transcript helpers."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import delegation_live


class DelegationLiveTests(unittest.TestCase):
    def test_path_helpers_and_tail(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            root = home / "cache" / "delegation" / "live" / "deleg_abc12345"
            root.mkdir(parents=True)
            log = root / "task-0.log"
            log.write_text("00:00:01 start   | kickoff\n00:00:02 tool    | read_file\n", encoding="utf-8")
            (root / "manifest.json").write_text(
                json.dumps({
                    "delegation_id": "deleg_abc12345",
                    "task_count": 1,
                    "tasks": [{"index": 0, "goal": "Count files", "log": str(log), "status": "running"}],
                }),
                encoding="utf-8",
            )

            self.assertEqual(
                delegation_live.parse_delegation_id_from_path(str(log)),
                "deleg_abc12345",
            )
            self.assertEqual(delegation_live.parse_task_index_from_path(str(log)), 0)

            manifest = delegation_live.read_manifest(home, "deleg_abc12345")
            self.assertEqual(manifest["task_count"], 1)
            latest = delegation_live.latest_manifest(home)
            self.assertEqual(latest["delegation_id"], "deleg_abc12345")

            first = delegation_live.tail_task_log(home, "deleg_abc12345", 0, offset=0)
            self.assertIn("kickoff", first["text"])
            self.assertIn("read_file", first["text"])
            self.assertGreater(first["next_offset"], 0)

    def test_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            with self.assertRaises(ValueError):
                delegation_live.read_manifest(home, "../etc")
            with self.assertRaises(ValueError):
                delegation_live.tail_task_log(home, "deleg_abc12345", -1)


if __name__ == "__main__":
    unittest.main()
