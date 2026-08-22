"""Unit tests for messaging_platforms.py config/env helpers + OAuth URL builders.

The module resolves its paths from HERMES_HOME at import time — tests set
HERMES_HOME to a temp dir BEFORE importing, then reload to re-pin paths.
No network calls: OAuth URL builders are pure string construction.
"""

import json
import os
import tempfile
import unittest
from pathlib import Path

_HOME = tempfile.mkdtemp(prefix="msgtest-")
os.environ["HERMES_HOME"] = _HOME

import messaging_platforms as mp


class EnvFileHelpersTests(unittest.TestCase):
    def setUp(self):
        self.env_path = mp._ENV_PATH
        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        if self.env_path.exists():
            self.env_path.unlink()

    def test_missing_env_file_returns_empty(self):
        self.assertEqual(mp._read_env_file(), {})

    def test_parses_keys_comments_and_quotes(self):
        self.env_path.write_text(
            "# comment\n\nFOO=bar\nQUOTED=\"a b\"\nSINGLE='x y'\n", encoding="utf-8"
        )
        env = mp._read_env_file()
        self.assertEqual(env["FOO"], "bar")
        self.assertEqual(env["QUOTED"], "a b")
        self.assertEqual(env["SINGLE"], "x y")

    def test_write_preserves_comments_and_updates_in_place(self):
        self.env_path.write_text("# keep me\nOLD=1\nREMOVE=2\n", encoding="utf-8")
        mp._write_env_file({"OLD": "updated", "NEW": "added"})
        text = self.env_path.read_text(encoding="utf-8")
        self.assertIn("# keep me", text)
        self.assertIn("OLD=updated", text)
        self.assertNotIn("REMOVE", text)
        self.assertIn("NEW=added", text)

    def test_write_appends_new_keys(self):
        self.env_path.write_text("", encoding="utf-8")
        mp._write_env_file({"A": "1", "B": "2"})
        env = mp._read_env_file()
        self.assertEqual(env, {"A": "1", "B": "2"})


class NestedConfigHelpersTests(unittest.TestCase):
    def test_get_nested_missing_returns_default(self):
        self.assertEqual(mp._get_nested({"a": {}}, "a.b.c", "dflt"), "dflt")
        self.assertEqual(mp._get_nested({}, "x.y", 7), 7)

    def test_get_nested_present(self):
        self.assertEqual(mp._get_nested({"a": {"b": {"c": 1}}}, "a.b.c", 0), 1)

    def test_set_nested_creates_intermediate_dicts(self):
        cfg = {}
        mp._set_nested(cfg, "discord.require_mention", True)
        self.assertEqual(cfg, {"discord": {"require_mention": True}})

    def test_set_nested_overwrites(self):
        cfg = {"a": {"b": 1}}
        mp._set_nested(cfg, "a.b", 2)
        self.assertEqual(cfg, {"a": {"b": 2}})


class OAuthUrlBuilderTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.get("DISCORD_CLIENT_ID")
        os.environ["DISCORD_CLIENT_ID"] = "discord123"

    def tearDown(self):
        if self._prev is None:
            os.environ.pop("DISCORD_CLIENT_ID", None)
        else:
            os.environ["DISCORD_CLIENT_ID"] = self._prev

    def test_discord_url_contains_client_id_and_redirect(self):
        url = mp.build_discord_oauth_url()
        self.assertIn("client_id=discord123", url)
        self.assertIn("discord/callback", url)
        self.assertIn("scope=bot", url)
        self.assertIn("response_type=code", url)

    def test_slack_url_has_code_and_scope(self):
        url = mp.build_slack_oauth_url()
        self.assertIn("client_id=", url)
        self.assertIn("response_type=code", url)

    def test_teams_url_is_https_oauth(self):
        url = mp.build_teams_oauth_url()
        self.assertTrue(url.startswith("https://"))
        self.assertIn("client_id=", url)


class GatewayStateHelpersTests(unittest.TestCase):
    def setUp(self):
        self.state_path = mp._GATEWAY_STATE_PATH
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        if self.state_path.exists():
            self.state_path.unlink()

    def test_missing_state_returns_empty_platforms(self):
        self.assertEqual(mp._read_gateway_state(), {"platforms": {}})

    def test_corrupt_state_returns_empty_platforms(self):
        self.state_path.write_text("{broken", encoding="utf-8")
        self.assertEqual(mp._read_gateway_state(), {"platforms": {}})

    def test_valid_state_read(self):
        self.state_path.write_text(
            json.dumps({"platforms": {"discord": {"connected": True}}}), encoding="utf-8"
        )
        self.assertEqual(
            mp._read_gateway_state()["platforms"]["discord"]["connected"], True
        )


if __name__ == "__main__":
    unittest.main()
