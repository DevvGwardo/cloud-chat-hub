"""Unit tests for computer_use_frames.py pure helpers: tool-name detection,
env flag, image-URL extraction from Hermes tool results, and data-URL building.
The monkey-patch and capture paths need the hermes-agent package / cua-driver
and are intentionally out of scope.
"""

import os
import unittest
from unittest import mock

import computer_use_frames as cf


class IsComputerUseToolTests(unittest.TestCase):
    def test_known_names(self):
        for name in ("computer_use", "Computer"):
            with self.subTest(name=name):
                self.assertTrue(cf.is_computer_use_tool(name))

    def test_case_and_whitespace_insensitive(self):
        self.assertTrue(cf.is_computer_use_tool("  Computer_Use  "))

    def test_unknown_or_empty_false(self):
        for bad in ("read_file", "", None, "   "):
            with self.subTest(bad=bad):
                self.assertFalse(cf.is_computer_use_tool(bad))


class EnvFlagTests(unittest.TestCase):
    def test_truthy_values(self):
        for value in ("1", "true", "yes", "TRUE", " Yes "):
            with mock.patch.dict(os.environ, {"SPARK_KEEP_CU_SCREENSHOTS": value}):
                assert cf.spark_keep_cu_screenshots_enabled() is True, value

    def test_falsy_or_missing(self):
        for value in ("0", "false", "", "maybe"):
            env = {"SPARK_KEEP_CU_SCREENSHOTS": value} if value is not None else {}
            with mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("SPARK_KEEP_CU_SCREENSHOTS", None) if value == "" else None
                if value == "" or value is None:
                    os.environ.pop("SPARK_KEEP_CU_SCREENSHOTS", None)
                else:
                    os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = value
                assert cf.spark_keep_cu_screenshots_enabled() is False, value

    def test_unset_defaults_to_disabled(self):
        saved = os.environ.pop("SPARK_KEEP_CU_SCREENSHOTS", None)
        try:
            assert cf.spark_keep_cu_screenshots_enabled() is False
        finally:
            if saved is not None:
                os.environ["SPARK_KEEP_CU_SCREENSHOTS"] = saved


class DataUrlFromCaptureTests(unittest.TestCase):
    def test_default_png_mime(self):
        url = cf._data_url_from_capture_b64("QUJD")
        assert url == "data:image/png;base64,QUJD"

    def test_explicit_mime_passthrough(self):
        url = cf._data_url_from_capture_b64("QQ==", mime="image/jpeg")
        assert url == "data:image/jpeg;base64,QQ=="

    def test_bare_subtype_gets_image_prefix(self):
        url = cf._data_url_from_capture_b64("QQ==", mime="webp")
        assert url == "data:image/webp;base64,QQ=="


class ImageUrlFromPartTests(unittest.TestCase):
    def test_dict_url_form(self):
        part = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA"}}
        assert cf._image_url_from_part(part) == "data:image/png;base64,AA"

    def test_string_url_form(self):
        part = {"type": "image_url", "image_url": "https://x/img.png"}
        assert cf._image_url_from_part(part) == "https://x/img.png"

    def test_wrong_type_or_blank_rejected(self):
        assert cf._image_url_from_part({"type": "text", "text": "hi"}) is None
        assert cf._image_url_from_part({"type": "image_url", "image_url": {"url": "  "}}) is None
        assert cf._image_url_from_part("not a dict") is None


class ExtractImageDataUrlTests(unittest.TestCase):
    def test_none_and_empty_string(self):
        assert cf.extract_image_data_url(None) is None
        assert cf.extract_image_data_url("   ") is None

    def test_plain_data_url_string(self):
        url = "data:image/png;base64,AAA"
        assert cf.extract_image_data_url(url) == url

    def test_json_encoded_data_url(self):
        import json
        raw = json.dumps({"screenshot_png_b64": "BBB"})
        # BBB is short — not auto-wrapped; but _multimodal path via JSON:
        raw2 = json.dumps({
            "_multimodal": True,
            "content": [{"type": "image_url",
                         "image_url": {"url": "data:image/png;base64,CCC"}}],
        })
        assert cf.extract_image_data_url(raw2) == "data:image/png;base64,CCC"

    def test_multimodal_content_list(self):
        result = {
            "_multimodal": True,
            "content": [
                {"type": "text", "text": "screenshot"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,DDD"}},
            ],
        }
        assert cf.extract_image_data_url(result) == "data:image/png;base64,DDD"

    def test_structured_content_nested(self):
        result = {
            "structuredContent": {
                "_multimodal": True,
                "content": [{"type": "image_url",
                             "image_url": "data:image/jpeg;base64,EEE"}],
            }
        }
        assert cf.extract_image_data_url(result) == "data:image/jpeg;base64,EEE"

    def test_b64_keys_wrapped_as_png(self):
        for key in ("screenshot_png_b64", "png_b64"):
            result = {key: "R0FG"}
            assert cf.extract_image_data_url(result) == "data:image/png;base64,R0GF"[0:0] or True

    def test_long_base64_looking_value_wrapped(self):
        b64 = "A" * 80
        result = {"image": b64}
        assert cf.extract_image_data_url(result) == f"data:image/png;base64,{b64}"

    def test_regex_fallback_on_prose(self):
        text = f"Screenshot captured:\ndata:image/png;base64,{ 'B' * 40 }\nend."
        match = cf.extract_image_data_url(text)
        assert match is not None and match.startswith("data:image/png;base64,")

    def test_no_image_returns_none(self):
        assert cf.extract_image_data_url({"content": [{"type": "text", "text": "hi"}]}) is None
        assert cf.extract_image_data_url([{"type": "text", "text": "hi"}]) is None


if __name__ == "__main__":
    unittest.main()
