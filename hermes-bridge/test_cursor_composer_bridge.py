"""Unit tests for cursor_composer_bridge.py — health probe + aggregate status.

The network probe is mocked via urllib; skill detection uses a temp hermes home.
"""

import json
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import cursor_composer_bridge as ccb


class _FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status = status
        self._payload = json.dumps(payload or {}).encode()

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ProbeBridgeHealthTests(unittest.TestCase):
    def tearDown(self):
        mock.patch.stopall()

    def test_healthy_probe(self):
        with mock.patch.object(
            ccb.urllib.request, "urlopen",
            return_value=_FakeResponse(200, {"status": "ok"}),
        ):
            result = ccb.probe_bridge_health()
        assert result["reachable"] is True
        assert result["status"] == "ok"
        assert ":8790" in result["health_url"]
        assert result["payload"] == {"status": "ok"}

    def test_200_but_wrong_status_field_is_degraded(self):
        with mock.patch.object(
            ccb.urllib.request, "urlopen",
            return_value=_FakeResponse(200, {"status": "warming-up"}),
        ):
            result = ccb.probe_bridge_health()
        assert result["reachable"] is False
        assert result["status"] == "degraded"

    def test_connection_refused_is_down(self):
        exc = urllib.error.URLError(ConnectionRefusedError(61))
        with mock.patch.object(ccb.urllib.request, "urlopen", side_effect=exc):
            result = ccb.probe_bridge_health()
        assert result["reachable"] is False
        assert result["status"] == "down"
        # detail truncated to 200 chars max
        assert len(result.get("detail", "")) <= 200

    def test_unexpected_exception_is_error(self):
        with mock.patch.object(
            ccb.urllib.request, "urlopen",
            side_effect=RuntimeError("something weird"),
        ):
            result = ccb.probe_bridge_health()
        assert result["reachable"] is False
        assert result["status"] == "error"
        assert "something weird" in result["detail"]

    def test_invalid_json_body_is_error(self):
        resp = _FakeResponse(200)
        resp._payload = b"not-json{"
        with mock.patch.object(ccb.urllib.request, "urlopen", return_value=resp):
            result = ccb.probe_bridge_health()
        assert result["reachable"] is False
        assert result["status"] == "error"


class BridgeStatusTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name)

    def test_no_skills_not_connected(self):
        with mock.patch.object(ccb, "probe_bridge_health", return_value={"reachable": False}):
            status = ccb.bridge_status(hermes_home=self.home)
        assert status["connected"] is False
        assert status["skills_ready"] is False
        assert all(not v for v in status["skills"].values())

    def test_one_skill_installed_is_ready(self):
        skill_dir = self.home / "skills" / "composer-code"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("---\n---\nbody")
        with mock.patch.object(ccb, "probe_bridge_health", return_value={"reachable": True}):
            status = ccb.bridge_status(hermes_home=self.home)
        assert status["skills_ready"] is True
        assert status["skills"]["composer-code"] is True
        assert status["skills"]["cursor-composer"] is False
        assert status["connected"] is True

    def test_envelope_fields_present(self):
        with mock.patch.object(ccb, "probe_bridge_health", return_value={"reachable": False}):
            status = ccb.bridge_status(hermes_home=self.home)
        assert status["id"] == "cursor-composer"
        assert "launchd_label" in status
        assert "bridge_repo" in status


if __name__ == "__main__":
    unittest.main()
