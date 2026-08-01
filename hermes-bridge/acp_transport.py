"""ACP transport — drive the REAL hermes-agent via Agent Client Protocol.

CloudChat spawns ``hermes-acp`` (hermes-agent's ACP stdio server, from the
installed ``agent-client-protocol`` SDK) once per conversation and relays its
``task/update`` notifications into the bridge's SSE pipeline. The real hermes
agent loop runs inside CloudChat — with hermes-agent's own tools, MCP
servers, skills, and approval gates — instead of the reimplemented loop in
``run_agent.py``.

Two kinds of agent->client messages matter here:

* ``session_update`` notifications — streamed content (``agent_message_chunk``
  / ``agent_thought_chunk``) and tool calls (``tool_call`` start,
  ``tool_call_update`` complete/failed). Translated to the SSE event shapes
  the CloudChat UI already renders.
* ``request_permission`` — hermes pauses a risky tool (edit, terminal, …)
  and asks the client to approve. The bridge surfaces an ``approval_request``
  SSE event, and ``resolve_approval()`` (called from the bridge's
  ``POST /v1/approvals/{id}`` route) completes the parked future with the
  user's decision.

The connection is asyncio-native and must live on the bridge's main event
loop, so the client dispatches from that loop while ``run_prompt_blocking``
bridges into it from a worker thread (mirroring how the agent-loop transport
runs ``AIAgent.run_conversation`` in a thread).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

logger = logging.getLogger("acp_transport")

# ── Environment / availability ──────────────────────────────────────────────

_ACP_CMD_ENV = "HERMES_ACP_CMD"


def acp_available() -> tuple[bool, str]:
    """Return (available, reason). ``acp_available()[0]`` is False when the
    SDK is missing, no ``hermes-acp`` binary exists, or the installed
    hermes-agent lacks the ACP adapter."""
    try:
        import acp  # noqa: F401
    except ImportError:
        return False, "agent-client-protocol SDK not installed in bridge venv"
    cmd = _acp_command()
    if cmd is None:
        return False, "hermes-acp binary not found on PATH (install hermes-agent 0.19+)"
    return True, f"hermes-acp at {cmd}"


def _acp_command() -> Optional[list[str]]:
    """Resolve the hermes-acp command. Prefer the env override (handy when the
    binary isn't on the bridge's PATH), then ``hermes-acp`` on PATH."""
    raw = os.environ.get(_ACP_CMD_ENV, "").strip()
    if raw:
        return [raw]
    path = shutil.which("hermes-acp")
    if path:
        return [path]
    return None


# ── Content extraction (ACP blocks -> plain text) ───────────────────────────


def _block_text(block: Any) -> str:
    """Extract text from an ACP content block (any nesting level)."""
    if block is None:
        return ""
    # Discriminated by ``type``: text / image / audio / resource / content / diff / terminal
    btype = getattr(block, "type", None)
    if btype == "text":
        return str(getattr(block, "text", "") or "")
    inner = getattr(block, "content", None)
    if isinstance(inner, (list, tuple)):
        parts = [_block_text(b) for b in inner]
        return "\n".join(p for p in parts if p)
    if inner is not None and not isinstance(inner, str):
        return _block_text(inner)
    return ""


def _tool_output(update: Any) -> str:
    """Best-effort human-readable output for a tool_call_update."""
    if update is None:
        return ""
    text = _block_text(getattr(update, "content", None))
    if text:
        return text
    raw = getattr(update, "raw_output", None)
    if isinstance(raw, str):
        return raw
    if raw is not None:
        try:
            return json.dumps(raw, ensure_ascii=False)[:4000]
        except (TypeError, ValueError):
            return str(raw)[:4000]
    return ""


def _tool_input_for_display(update: Any) -> str:
    """Compact input string for tool_activity events. hermes sends tool starts
    without ``raw_input``, so derive it from the content blocks when present."""
    raw = getattr(update, "raw_input", None)
    if isinstance(raw, (str, dict, list)):
        try:
            return json.dumps(raw, ensure_ascii=False) if not isinstance(raw, str) else raw
        except (TypeError, ValueError):
            return str(raw)
    text = _block_text(getattr(update, "content", None))
    return text or ""


# ── The ACP client ──────────────────────────────────────────────────────────


class BridgeAcpClient:
    """The client half of ACP: receives hermes-agent's notifications.

    Not a subclass of ``acp.Client`` (that is a Protocol); the router calls
    these methods via ``getattr``. ``session_update`` and ``request_permission``
    are required by the protocol — everything else has router defaults.
    """

    def __init__(
        self,
        emit: Callable[[str, Any], None],
        approvals: dict[str, asyncio.Future],
    ) -> None:
        self.emit = emit
        self._approvals = approvals
        self._pending_tools: dict[str, tuple[str, str]] = {}  # tool_call_id -> (display title, input)

    def on_connect(self, conn: Any) -> None:
        self._conn = conn

    # -- required by the protocol --------------------------------------------

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        try:
            self._dispatch(session_id, update)
        except Exception as exc:  # never let a translate error kill the loop
            logger.warning("acp session_update dispatch failed: %s", exc, exc_info=True)

    async def request_permission(
        self,
        options: list[Any],
        session_id: str,
        tool_call: Any,
        **kwargs: Any,
    ) -> Any:
        """hermes paused a tool and wants the user's decision.

        Emit an ``approval_request`` SSE event, park a future keyed by
        approval_id, and block until the bridge's approval route resolves it.
        """
        from acp.schema import (
            AllowedOutcome,
            DeniedOutcome,
            RequestPermissionResponse,
        )

        approval_id = f"acp-{int(time.time() * 1000)}-{len(self._approvals) + 1}"
        options_clean = [
            {"option_id": str(getattr(o, "option_id", "")), "name": str(getattr(o, "name", "") or getattr(o, "option_id", ""))}
            for o in (options or [])
            if getattr(o, "option_id", None)
        ]
        title = str(getattr(tool_call, "title", "") or "tool")
        detail = _tool_input_for_display(tool_call) or title

        self.emit(
            "approval_request",
            {
                "approval_id": approval_id,
                "session_id": session_id,
                "tool": title,
                "kind": str(getattr(tool_call, "kind", "") or "other"),
                "summary": title,
                "excerpt": detail,
                "options": options_clean,
            },
        )

        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._approvals[approval_id] = future
        try:
            decision = await asyncio.wait_for(future, timeout=APPROVAL_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            decision = {"option_id": "deny"}
        finally:
            self._approvals.pop(approval_id, None)

        option_id = str(decision.get("option_id") or "deny")
        if option_id in ("deny", "deny_always") or option_id == "":
            return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))
        return RequestPermissionResponse(outcome=AllowedOutcome(outcome="selected", option_id=option_id))

    # -- optional client-side tools (delegated execution) ---------------------
    # hermes executes tools agent-side in ACP mode; these hooks exist for
    # protocol completeness. Returning None uses the router's safe defaults.

    async def create_terminal(self, command: str, session_id: str, **kwargs: Any) -> None:
        return None

    async def read_text_file(self, path: str, session_id: str, **kwargs: Any) -> None:
        return None

    async def write_text_file(self, content: str, path: str, session_id: str, **kwargs: Any) -> None:
        return None

    # -- dispatch ------------------------------------------------------------

    def _dispatch(self, session_id: str, update: Any) -> None:
        kind = getattr(update, "session_update", None)
        if kind in ("agent_message_chunk", "user_message_chunk"):
            text = _block_text(getattr(update, "content", None))
            if text:
                self.emit("text", text)
        elif kind == "agent_thought_chunk":
            text = _block_text(getattr(update, "content", None))
            if text:
                self.emit("reasoning", text)
        elif kind == "tool_call":
            # New tool call started.
            call_id = str(getattr(update, "tool_call_id", ""))
            title = str(getattr(update, "title", "") or "tool")
            tool_input = _tool_input_for_display(update)
            self._pending_tools[call_id] = (title, tool_input)
            self.emit("tool_start", title, tool_input)
        elif kind == "tool_call_update":
            call_id = str(getattr(update, "tool_call_id", ""))
            pending = self._pending_tools.pop(call_id, None)
            title = (pending[0] if pending else None) or str(
                getattr(update, "title", "") or "tool"
            )
            tool_input = pending[1] if pending else ""
            status = getattr(update, "status", None)
            if status in ("completed", "failed"):
                self.emit("tool_end", title, tool_input, _tool_output(update))
        elif kind == "plan_update":
            entries = getattr(update, "entries", None)
            if isinstance(entries, list) and entries:
                self.emit("plan", entries)
        # usage_update / session_info_update / config_option_update /
        # current_mode_update / available_commands_update are not rendered
        # in CloudChat's chat stream — ignored.


# ── Session registry & process management ───────────────────────────────────


@dataclass
class _AcpHandle:
    conversation_id: str
    cwd: str
    proc: Any  # asyncio subprocess
    conn: Any  # ClientSideConnection
    session_id: str
    client: BridgeAcpClient
    loop: asyncio.AbstractEventLoop
    approvals: dict[str, asyncio.Future] = field(default_factory=dict)
    last_used: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.last_used = time.time()

    async def close(self) -> None:
        try:
            await self.conn.close_session(self.session_id)
        except Exception:
            pass
        try:
            self.proc.kill()
        except Exception:
            pass


_sessions: dict[str, _AcpHandle] = {}
_sessions_lock = asyncio.Lock()

APPROVAL_TIMEOUT_SECONDS = float(os.environ.get("HERMES_ACP_APPROVAL_TIMEOUT", "3600"))
IDLE_TIMEOUT_SECONDS = float(os.environ.get("HERMES_ACP_IDLE_TIMEOUT", "1800"))
PROMPT_TIMEOUT_SECONDS = float(os.environ.get("HERMES_ACP_PROMPT_TIMEOUT", "3600"))


async def ensure_session(
    *,
    loop: asyncio.AbstractEventLoop,
    conversation_id: str,
    cwd: str,
    emit: Callable[[str, Any], None],
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> _AcpHandle:
    """Return a live ACP session for this conversation, spawning hermes-acp on first use."""
    import acp
    from acp.schema import ClientCapabilities, Implementation

    async with _sessions_lock:
        handle = _sessions.get(conversation_id)
        if handle is not None and handle.proc.returncode is None:
            handle.touch()
            return handle

        cmd = _acp_command()
        if cmd is None:
            raise RuntimeError("hermes-acp binary not found on PATH")

        client = BridgeAcpClient(emit=emit, approvals={})
        # Drain stderr to a per-conversation log file so a chatty agent can
        # never deadlock the stdio pipe, and failures are debuggable.
        import tempfile

        stderr_path = os.path.join(
            tempfile.gettempdir(),
            f"hermes-acp-{conversation_id[:40]}.log",
        )
        stderr_file = open(stderr_path, "ab", buffering=0)
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd or None,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=stderr_file,
            # hermes-acp emits large JSON-RPC lines (initialize/new_session
            # payloads can carry the full provider catalog + MCP tool lists).
            # The default 64KB StreamReader limit makes the acp SDK's readline
            # receive loop raise "Separator is not found" on them.
            limit=4 * 1024 * 1024,
        )
        conn = acp.connect_to_agent(client, proc.stdin, proc.stdout, use_unstable_protocol=True)

        init = await conn.initialize(
            protocol_version=acp.PROTOCOL_VERSION,
            client_info=Implementation(name="cloud-chat-hub", version="1.0.0"),
            client_capabilities=ClientCapabilities(),
        )
        auth_methods = getattr(init, "auth_methods", None) or []
        if auth_methods:
            first = auth_methods[0]
            method_id = str(getattr(first, "method_id", "") or "").strip()
            if method_id:
                try:
                    await conn.authenticate(method_id)
                except Exception as exc:
                    logger.warning("acp authenticate(%s) failed: %s", method_id, exc)

        ns = await conn.new_session(cwd=cwd or ".")
        session_id = str(getattr(ns, "session_id", "") or "")
        if not session_id:
            raise RuntimeError("hermes-acp returned no session id")

        if provider and provider not in ("auto", "default"):
            model_id = f"{provider}:{model}" if model else provider
            try:
                await conn.set_session_model(model_id, session_id)
            except Exception as exc:
                logger.warning("acp set_session_model(%s) failed: %s", model_id, exc)

        handle = _AcpHandle(
            conversation_id=conversation_id,
            cwd=cwd,
            proc=proc,
            conn=conn,
            session_id=session_id,
            client=client,
            loop=loop,
            approvals=client._approvals,
        )
        _sessions[conversation_id] = handle
        logger.info("acp session %s ready for conversation %s (cwd=%s)", session_id, conversation_id, cwd)
        return handle


def run_prompt_blocking(
    *,
    loop: asyncio.AbstractEventLoop,
    conversation_id: str,
    cwd: str,
    user_message: str,
    emit: Callable[[str, Any], None],
    provider: Optional[str] = None,
    model: Optional[str] = None,
    timeout: Optional[float] = None,
) -> None:
    """Blocking bridge used from the worker thread (mirrors the agent-loop transport)."""
    import acp

    async def _impl() -> None:
        handle = await ensure_session(
            loop=loop,
            conversation_id=conversation_id,
            cwd=cwd,
            emit=emit,
            provider=provider,
            model=model,
        )
        # Notifications must stream into THIS request's queue. The client is
        # shared across prompts on the same conversation, so repoint its emit
        # callback for the duration of this prompt.
        handle.client.emit = emit
        handle.touch()
        blocks = [acp.text_block(user_message)]
        # The `prompt` arg order changed between SDK versions: 0.9.0 is
        # `prompt(prompt, session_id)`, 0.11+ is `prompt(session_id, prompt)`.
        # Inspect the bound method so the transport works on whichever venv
        # the bridge is running under (bridge .venv vs hermes-agent venv).
        import inspect

        first_param = next(
            (n for n, p in inspect.signature(handle.conn.prompt).parameters.items() if n not in ("self", "kwargs")),
            "session_id",
        )
        if first_param == "session_id":
            await handle.conn.prompt(handle.session_id, blocks)
        else:
            await handle.conn.prompt(blocks, handle.session_id)

    future = asyncio.run_coroutine_threadsafe(_impl(), loop)
    future.result(timeout=timeout or PROMPT_TIMEOUT_SECONDS)


async def resolve_approval(approval_id: str, option_id: str) -> bool:
    """Complete a parked approval future. Returns True when the decision was delivered."""
    for handle in list(_sessions.values()):
        future = handle.approvals.get(approval_id)
        if future is not None and not future.done():
            future.set_result({"option_id": option_id})
            return True
    return False


async def close_conversation(conversation_id: str) -> None:
    """Close and drop a conversation's ACP session."""
    async with _sessions_lock:
        handle = _sessions.pop(conversation_id, None)
    if handle is not None:
        await handle.close()


async def reap_idle_sessions() -> int:
    """Close sessions idle for IDLE_TIMEOUT_SECONDS. Returns how many were closed."""
    now = time.time()
    closed = 0
    async with _sessions_lock:
        stale = [
            cid
            for cid, handle in _sessions.items()
            if now - handle.last_used > IDLE_TIMEOUT_SECONDS
        ]
        for cid in stale:
            handle = _sessions.pop(cid, None)
            if handle is not None:
                try:
                    await handle.close()
                    closed += 1
                except Exception:
                    pass
    return closed


async def shutdown_all() -> None:
    """Close every live ACP session (used on bridge shutdown)."""
    async with _sessions_lock:
        handles = list(_sessions.values())
        _sessions.clear()
    for handle in handles:
        try:
            await handle.close()
        except Exception:
            pass
