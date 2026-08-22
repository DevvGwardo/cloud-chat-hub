"""Unit tests for main.py request-model validation and error-helper envelopes.

Covers the pure validation/error-construction surface that EdgeCaseTests
touches only indirectly.

IMPORTANT: like every test file that touches ``main``, this file must be
robust to test_main.py's pydantic/fastapi stubs (installed when test_main is
collected first). The stub's BaseModel does NOT validate types and its
_JSONResponse exposes ``.content`` instead of ``.body`` — so these tests
assert only behavior both real and stubbed environments share: status codes,
dict content, and no-raise on extra fields. Strict-type validation is
pydantic-only and asserted conditionally.
"""

import json
import unittest

import main


def _resp_json(resp):
    """Extract JSON content from a real starlette or stubbed _JSONResponse."""
    body = getattr(resp, "body", None)
    if body is None:
        return resp.content
    if isinstance(body, memoryview):
        body = bytes(body)
    return json.loads(body)


class ChatCompletionRequestValidationTests(unittest.TestCase):
    def test_defaults_applied(self):
        body = main.ChatCompletionRequest.model_validate({"messages": []})
        self.assertEqual(body.model, main.DEFAULT_MODEL)
        self.assertEqual(body.messages, [])

    def test_messages_default_when_key_missing(self):
        body = main.ChatCompletionRequest.model_validate({"model": "m"})
        self.assertEqual(body.messages, [])

    def test_extra_fields_allowed_and_ignored(self):
        # AI SDK sends extra fields (hermes_provider, planMode, ...) — must not raise.
        body = main.ChatCompletionRequest.model_validate({
            "model": "auto",
            "messages": [{"role": "user", "content": "hi"}],
            "hermes_provider": "custom:x",
            "planMode": True,
            "github_pat": "ghp_x",
            "unknown_future_field": {"nested": True},
        })
        self.assertEqual(body.model, "auto")
        self.assertEqual(len(body.messages), 1)
        # Real pydantic gives ChatMessage objects; the stub leaves plain dicts.
        first = body.messages[0]
        content = first.content if hasattr(first, "content") else first["content"]
        self.assertEqual(content, "hi")


class NoApiKeyErrorTests(unittest.TestCase):
    def test_known_provider_gets_specific_message(self):
        for provider, fragment in [
            ("openrouter", "HERMES_OPENROUTER_KEY"),
            ("minimax", "MiniMax API key required"),
            ("nous", "auth.json"),
            ("github", "x-hermes-github-pat"),
        ]:
            with self.subTest(provider=provider):
                resp = main._no_api_key_error(provider)
                self.assertEqual(resp.status_code, 401)
                text = json.dumps(_resp_json(resp))
                self.assertIn(fragment, text)

    def test_unknown_provider_gets_generic_message(self):
        resp = main._no_api_key_error("totally-unknown-provider")
        self.assertEqual(resp.status_code, 401)
        text = json.dumps(_resp_json(resp))
        # env var name derives from the raw provider string (dashes preserved).
        self.assertIn("totally-unknown-provider API key required", text)
        self.assertIn("HERMES_TOTALLY-UNKNOWN-PROVIDER_KEY", text)

    def test_envelope_shape_is_openai_style(self):
        payload = _resp_json(main._no_api_key_error("openrouter"))
        self.assertIsInstance(payload.get("error"), dict)
        self.assertIn("message", payload["error"])


class RepoErrorEnvelopeTests(unittest.TestCase):
    def test_repo_not_found_envelope(self):
        resp = main._repo_not_found_error("octo", "missing")
        self.assertEqual(resp.status_code, 404)
        payload = _resp_json(resp)
        self.assertIn("octo/missing", json.dumps(payload))
        self.assertEqual(payload["error"]["code"], "REPO_NOT_FOUND")

    def test_github_token_expired_envelope(self):
        resp = main._github_token_expired_error()
        self.assertEqual(resp.status_code, 401)
        payload = _resp_json(resp)
        self.assertEqual(payload["error"]["code"], "GITHUB_TOKEN_EXPIRED")


if __name__ == "__main__":
    unittest.main()
