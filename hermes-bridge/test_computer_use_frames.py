import json
import os
import sys
import threading
import time
import types
import unittest
from unittest.mock import MagicMock, patch

from computer_use_frames import (
    COMPUTER_USE_CAPTURE_HINT,
    ComputerUseFramePoller,
    build_computer_use_frame_payload,
    extract_image_data_url,
    format_computer_use_action_label,
    install_spark_keep_cu_screenshots_patch,
    is_computer_use_tool,
    is_cua_capture_available,
    restore_spark_keep_cu_screenshots_patch,
    spark_keep_cu_screenshots_enabled,
    try_supplemental_capture,
)
import computer_use_frames as cu_frames


class ComputerUseFramesTest(unittest.TestCase):
    def tearDown(self):
        restore_spark_keep_cu_screenshots_patch()
        os.environ.pop("SPARK_KEEP_CU_SCREENSHOTS", None)

    def test_is_computer_use_tool(self):
        self.assertTrue(is_computer_use_tool("computer_use"))
        self.assertTrue(is_computer_use_tool("computer"))
        self.assertFalse(is_computer_use_tool("browser"))

    def test_extract_multimodal_image(self):
        result = {
            "_multimodal": True,
            "content": [
                {"type": "text", "text": "capture mode=som 1200x800"},
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/png;base64,abc123"},
                },
            ],
        }
        self.assertEqual(extract_image_data_url(result), "data:image/png;base64,abc123")

    def test_build_frame_payload(self):
        payload = build_computer_use_frame_payload(
            tool_name="computer_use",
            args={"action": "capture", "mode": "som", "app": "Safari"},
            result={
                "_multimodal": True,
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,xyz"}},
                ],
            },
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["action"], "capture · som · Safari")
        self.assertEqual(payload["image"], "data:image/png;base64,xyz")
        self.assertEqual(payload["status"], "completed")

    def test_format_action_label_click(self):
        label = format_computer_use_action_label(
            json.dumps({"action": "click", "element": 3, "app": "Notes"}),
        )
        self.assertEqual(label, "click · Notes · #3")

    def test_no_image_returns_none(self):
        payload = build_computer_use_frame_payload(
            tool_name="computer_use",
            args={"action": "type", "text": "hello"},
            result={"summary": "typed hello"},
        )
        self.assertIsNone(payload)

    def test_running_frame_without_image(self):
        payload = build_computer_use_frame_payload(
            tool_name="computer_use",
            args={"action": "click", "element": 2, "app": "Safari"},
            result=None,
            status="running",
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["status"], "running")
        self.assertEqual(payload["action"], "click · Safari · #2")
        self.assertNotIn("image", payload)

    def test_running_frame_with_supplemental_image(self):
        payload = build_computer_use_frame_payload(
            tool_name="computer_use",
            args={"action": "click", "element": 2},
            status="running",
            image="data:image/png;base64,midaction",
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["status"], "running")
        self.assertEqual(payload["image"], "data:image/png;base64,midaction")

    def test_completed_frame_with_explicit_image(self):
        payload = build_computer_use_frame_payload(
            tool_name="computer_use",
            args={"action": "type", "text": "hello"},
            result={"summary": "typed hello"},
            status="completed",
            image="data:image/png;base64,supplemental",
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertEqual(payload["image"], "data:image/png;base64,supplemental")

    def test_structured_content_screenshot_b64(self):
        result = {
            "structuredContent": {
                "screenshot_png_b64": "iVBORw0KGgo=",
                "summary": "captured",
            },
        }
        self.assertEqual(
            extract_image_data_url(result),
            "data:image/png;base64,iVBORw0KGgo=",
        )
        payload = build_computer_use_frame_payload(
            tool_name="computer",
            args={"action": "capture"},
            result=result,
            status="completed",
        )
        self.assertIsNotNone(payload)
        assert payload is not None
        self.assertTrue(payload["image"].startswith("data:image/png;base64,"))

    def test_capture_hint_is_short(self):
        self.assertIn("capture_after", COMPUTER_USE_CAPTURE_HINT)
        self.assertLess(len(COMPUTER_USE_CAPTURE_HINT), 220)

    def test_spark_keep_cu_screenshots_env(self):
        os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = "1"
        self.assertTrue(spark_keep_cu_screenshots_enabled())
        os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = "yes"
        self.assertTrue(spark_keep_cu_screenshots_enabled())
        os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = "0"
        self.assertFalse(spark_keep_cu_screenshots_enabled())

    def test_aux_vision_patch_respects_env(self):
        restore_spark_keep_cu_screenshots_patch()
        cu_frames._CU_AUX_PATCH_ORIGINAL = None

        def _original() -> bool:
            return True

        tool_mod = types.ModuleType("tools.computer_use.tool")
        tool_mod._should_route_through_aux_vision = _original
        cu_mod = types.ModuleType("tools.computer_use")
        cu_mod.tool = tool_mod
        tools_mod = types.ModuleType("tools")
        tools_mod.computer_use = cu_mod

        with patch.dict(
            sys.modules,
            {
                "tools": tools_mod,
                "tools.computer_use": cu_mod,
                "tools.computer_use.tool": tool_mod,
            },
        ):
            self.assertTrue(install_spark_keep_cu_screenshots_patch())
            os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = "1"
            self.assertFalse(tool_mod._should_route_through_aux_vision())
            os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = "0"
            self.assertTrue(tool_mod._should_route_through_aux_vision())
            restore_spark_keep_cu_screenshots_patch()
            self.assertIs(tool_mod._should_route_through_aux_vision, _original)

    def test_try_supplemental_capture_returns_none_when_unavailable(self):
        with patch("computer_use_frames.is_cua_capture_available", return_value=False):
            self.assertIsNone(try_supplemental_capture())

    def test_try_supplemental_capture_uses_backend(self):
        cap = MagicMock()
        cap.png_b64 = "abc123"
        cap.image_mime_type = "image/jpeg"
        backend = MagicMock()
        backend.is_available.return_value = True
        backend.capture.return_value = cap

        tool_mod = types.ModuleType("tools.computer_use.tool")
        tool_mod._get_backend = lambda: backend

        class ImmediateThread:
            def __init__(self, target=None, **kwargs):
                self._target = target

            def start(self):
                if self._target:
                    self._target()

            def join(self, timeout=None):
                return None

        with patch("computer_use_frames.is_cua_capture_available", return_value=True):
            with patch("computer_use_frames.threading.Thread", ImmediateThread):
                with patch.dict(sys.modules, {"tools.computer_use.tool": tool_mod}):
                    image = try_supplemental_capture(timeout=2.0)
        self.assertEqual(image, "data:image/jpeg;base64,abc123")
        backend.capture.assert_called_once_with(mode="vision")

    def test_is_cua_capture_available_false_on_import_error(self):
        with patch.dict("sys.modules", {"tools.computer_use.tool": None}):
            self.assertFalse(is_cua_capture_available())

    def test_poller_emits_running_frames(self):
        frames: list[dict] = []
        stop_patch = patch(
            "computer_use_frames.try_supplemental_capture",
            side_effect=["data:image/png;base64,poll1", None],
        )
        with patch("computer_use_frames.is_cua_capture_available", return_value=True):
            with stop_patch:
                poller = ComputerUseFramePoller(
                    tool_name="computer_use",
                    args={"action": "click"},
                    on_frame=frames.append,
                    interval_sec=0.05,
                    max_polls=2,
                    capture_timeout=0.5,
                )
                poller.start()
                time.sleep(0.2)
                poller.stop()
        self.assertGreaterEqual(len(frames), 1)
        self.assertEqual(frames[0]["status"], "running")
        self.assertIn("image", frames[0])

    def test_poller_skips_when_cua_unavailable(self):
        frames: list[dict] = []
        with patch("computer_use_frames.is_cua_capture_available", return_value=False):
            poller = ComputerUseFramePoller(
                tool_name="computer_use",
                args={"action": "click"},
                on_frame=frames.append,
                interval_sec=0.01,
                max_polls=3,
            )
            poller.start()
            time.sleep(0.05)
            poller.stop()
        self.assertEqual(frames, [])


if __name__ == "__main__":
    unittest.main()
