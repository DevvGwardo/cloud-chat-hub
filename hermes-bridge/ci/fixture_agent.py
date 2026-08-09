#!/usr/bin/env python3
"""Provision a minimal fake hermes-agent tree for CI test runs.

The real hermes-agent (``~/.hermes/hermes-agent``) is a private, per-developer
install, so CI cannot rely on it. The adapter loads ``run_agent.py`` and
``tools/registry.py`` from that dir at import time; the tests mock the agent
heavily but a few import the module surface directly (``toolsets.validate_toolset``,
``tools.registry.registry``). This script materializes a faithful-enough stand-in
so ``python -m unittest discover`` in ``hermes-bridge/`` runs green without the
real agent tree:

    python3 hermes-bridge/ci/fixture_agent.py
"""

import os
import shutil
import sys

AGENT_DIR = os.path.join(os.path.expanduser("~"), ".hermes", "hermes-agent")
BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REGISTRY_PY = '''\
"""Minimal ToolRegistry stand-in for CI (no real hermes-agent tree).

Matches the real registry's call surface: register(name=..., toolset=...,
schema=..., handler=..., check_fn=..., ...); entries expose .toolset/.schema.
"""


class _Entry:
    def __init__(self, name, toolset, schema, handler, check_fn):
        self.name = name
        self.toolset = toolset
        self.schema = schema or {"name": name}
        self.handler = handler
        self.check_fn = check_fn


class ToolRegistry:
    def __init__(self):
        self._entries = {}

    def register(self, name=None, toolset=None, schema=None, handler=None,
                 check_fn=None, override=False, **kwargs):
        self._entries[name] = _Entry(name, toolset, schema, handler, check_fn)

    def deregister(self, name):
        self._entries.pop(name, None)

    def get_entry(self, name):
        return self._entries.get(name)

    def get_definitions(self, toolset=None, **kwargs):
        return [e.schema for e in self._entries.values()
                if toolset is None or e.toolset == toolset]

    def register_toolset_alias(self, alias, target, **kwargs):
        pass

    def dispatch(self, name, *args, **kwargs):
        entry = self._entries.get(name)
        if entry and entry.handler:
            return entry.handler(*args, **kwargs)
        raise KeyError(name)


registry = ToolRegistry()
'''

TOOLSETS_PY = '''\
"""Minimal toolsets stand-in for CI (no real hermes-agent tree)."""


def validate_toolset(name, registry=None):
    from tools.registry import registry as _registry
    return len(_registry.get_definitions(toolset=name)) > 0


def resolve_toolset(name):
    from tools.registry import registry as _registry
    return sorted({d.get("name") for d in _registry.get_definitions(toolset=name)})
'''


def main() -> None:
    tools_dir = os.path.join(AGENT_DIR, "tools")
    os.makedirs(tools_dir, exist_ok=True)

    # The bridge's own run_agent.py doubles as the fake agent's (it falls back
    # to baked-in tool definitions when the agent tree has no toolsets).
    shutil.copyfile(os.path.join(BRIDGE_DIR, "run_agent.py"),
                    os.path.join(AGENT_DIR, "run_agent.py"))

    with open(os.path.join(tools_dir, "registry.py"), "w") as f:
        f.write(REGISTRY_PY)
    with open(os.path.join(AGENT_DIR, "toolsets.py"), "w") as f:
        f.write(TOOLSETS_PY)

    print(f"[ci] provisioned fake hermes-agent at {AGENT_DIR}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
