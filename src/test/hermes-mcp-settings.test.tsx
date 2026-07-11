import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HermesMcpSettingsPanel } from '@/components/settings/HermesMcpSettingsPanel';

vi.mock('@/lib/hermes-api', () => ({
  HermesApiError: class HermesApiError extends Error {},
  MCP_TOOL_CONTEXT_THRESHOLD: 40,
  fetchHermesMcpServers: vi.fn(async () => [{
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    url: '',
    enabled: true,
    env_keys: [],
    tool_count: 4,
    catalog_id: 'filesystem',
  }]),
  fetchHermesMcpCatalog: vi.fn(async () => [{
    id: 'brave-search',
    name: 'brave-search',
    description: 'Web search via Brave',
    transport: 'stdio',
    runtime: 'node',
    requires_param: null,
    docs_url: '',
  }]),
  fetchHermesMcpToolIndex: vi.fn(async () => ({
    tools: [
      { server: 'filesystem', name: 'mcp_filesystem_read', description: 'Read a file' },
      { server: 'filesystem', name: 'mcp_filesystem_write', description: 'Write a file' },
    ],
    total: 2,
  })),
  fetchToolSearchConfig: vi.fn(async () => ({
    enabled: 'auto',
    defer: true,
    threshold_pct: 10,
    search_default_limit: 5,
    max_search_limit: 20,
  })),
  updateToolSearchConfig: vi.fn(async () => ({
    enabled: 'off',
    defer: false,
    threshold_pct: 10,
    search_default_limit: 5,
    max_search_limit: 20,
  })),
  installHermesMcpServer: vi.fn(async () => ({ ok: true, installed: 'brave-search', reloaded: true })),
  uninstallHermesMcpServer: vi.fn(async () => ({ ok: true, removed: 'filesystem', reloaded: true })),
}));

vi.mock('@/stores/ui-store', () => ({
  useUIStore: vi.fn((selector: (s: { setMcpStoreFullscreen: () => void }) => unknown) =>
    selector({ setMcpStoreFullscreen: vi.fn() }),
  ),
}));

import { fetchHermesMcpServers, fetchHermesMcpCatalog, fetchHermesMcpToolIndex } from '@/lib/hermes-api';

describe('HermesMcpSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads MCP servers and catalog from hermes-api', async () => {
    render(
      <HermesMcpSettingsPanel
        fieldLabelClass="label"
        settingsCardClass="card"
      />,
    );

    await waitFor(() => {
      expect(fetchHermesMcpServers).toHaveBeenCalled();
      expect(fetchHermesMcpCatalog).toHaveBeenCalled();
      expect(fetchHermesMcpToolIndex).toHaveBeenCalled();
    });

    expect(screen.getAllByText('filesystem').length).toBeGreaterThan(0);
    expect(screen.getByText(/1\/1 enabled · 2 tools/)).toBeInTheDocument();
    expect(screen.getByText('Tool index')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search tools…')).toBeInTheDocument();
    expect(screen.getByText('Defer MCP schemas (tool search)')).toBeInTheDocument();
    expect(screen.getByText('brave-search')).toBeInTheDocument();
  });
});
