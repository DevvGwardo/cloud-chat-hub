"""Regression tests for the cwd-OSError guard (commit ef565f4 class).

The bridge process can outlive its original working directory — a build or
cleanup step deletes it, and os.getcwd() then raises FileNotFoundError (an
OSError). Every chat request used to 500. The guard falls back to the home
directory so requests keep working. These tests pin that behavior.
"""
import asyncio
import sys
import types
from unittest.mock import patch

from test_main import _FakeRequest, _invoke_chat_and_read_stream  # noqa: E402
import main  # noqa: E402


class _FakeAcpTransport:
    """Records run_prompt_blocking kwargs; never actually runs a prompt."""

    last_kwargs = None

    def module(self):
        return types.SimpleNamespace(
            acp_available=lambda: (True, ""),
            run_prompt_blocking=self._run_prompt_blocking,
            ensure_session=lambda **kwargs: None,
        )

    def _run_prompt_blocking(self, **kwargs):
        _FakeAcpTransport.last_kwargs = kwargs
        # Emit a minimal terminal event so the stream completes cleanly.
        emit = kwargs.get("emit")
        if emit:
            emit("done", {"stop": True})


def test_getcwd_oserror_falls_back_to_home():
    """os.getcwd() raising OSError must not 500 the request — the ACP prompt
    runs with the home directory as cwd instead."""
    fake = _FakeAcpTransport()

    body = main.ChatCompletionRequest.model_validate({
        "model": "auto",
        "messages": [{"role": "user", "content": "test"}],
        "stream": True,
    })
    request = _FakeRequest({"authorization": "Bearer test", "x-hermes-execution-mode": "acp"})

    def _boom():
        import errno
        raise FileNotFoundError(errno.ENOENT, "cwd does not exist")

    with patch.dict(sys.modules, {"acp_transport": fake.module()}), \
         patch.object(main.os, "getcwd", side_effect=_boom):
        response, _payload = asyncio.run(_invoke_chat_and_read_stream(request, body))

    assert response.status_code == 200
    assert _FakeAcpTransport.last_kwargs is not None
    assert _FakeAcpTransport.last_kwargs["cwd"] == main.os.path.expanduser("~")


def test_repo_root_header_wins_over_broken_cwd():
    """When a repo-root header is present, it is used as cwd even if
    os.getcwd() is broken — and it is NOT overwritten by the home fallback."""
    fake = _FakeAcpTransport()

    body = main.ChatCompletionRequest.model_validate({
        "model": "auto",
        "messages": [{"role": "user", "content": "test"}],
        "stream": True,
    })
    request = _FakeRequest({
        "authorization": "Bearer test",
        "x-hermes-repo-root": "/tmp/some-repo-root",
        "x-hermes-execution-mode": "acp",
    })

    def _boom():
        import errno
        raise FileNotFoundError(errno.ENOENT, "cwd does not exist")

    with patch.dict(sys.modules, {"acp_transport": fake.module()}), \
         patch.object(main.os, "getcwd", side_effect=_boom):
        response, _payload = asyncio.run(_invoke_chat_and_read_stream(request, body))

    assert response.status_code == 200
    assert _FakeAcpTransport.last_kwargs["cwd"] == "/tmp/some-repo-root"


def test_healthy_getcwd_still_used_when_no_repo_header():
    """Sanity: with a working os.getcwd() and no repo header, cwd == getcwd()."""
    fake = _FakeAcpTransport()

    body = main.ChatCompletionRequest.model_validate({
        "model": "auto",
        "messages": [{"role": "user", "content": "test"}],
        "stream": True,
    })
    request = _FakeRequest({"authorization": "Bearer test", "x-hermes-execution-mode": "acp"})

    with patch.dict(sys.modules, {"acp_transport": fake.module()}), \
         patch.object(main.os, "getcwd", return_value="/normal/working/dir"):
        response, _payload = asyncio.run(_invoke_chat_and_read_stream(request, body))

    assert response.status_code == 200
    assert _FakeAcpTransport.last_kwargs["cwd"] == "/normal/working/dir"
