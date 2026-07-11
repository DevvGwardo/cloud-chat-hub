import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchHermesMcpServers,
  fetchHermesMcpToolIndex,
  HermesApiError,
  MCP_TOOL_CONTEXT_THRESHOLD,
  type HermesMcpServerInfo,
  type HermesMcpToolIndexEntry,
} from '@/lib/hermes-api';
import { filterMcpToolIndex } from '@/lib/mcp-tool-index';

export interface HermesMcpToolIndexState {
  servers: HermesMcpServerInfo[];
  tools: HermesMcpToolIndexEntry[];
  totalTools: number;
  enabledServers: number;
  overThreshold: boolean;
  threshold: number;
  loading: boolean;
  error: string | null;
  query: string;
  setQuery: (q: string) => void;
  filteredTools: HermesMcpToolIndexEntry[];
  reload: () => Promise<void>;
}

/**
 * Shared MCP tool index: installed servers + flattened tool list from the
 * agent registry, with client-side search filtering.
 */
export function useHermesMcpToolIndex(enabled = true): HermesMcpToolIndexState {
  const [servers, setServers] = useState<HermesMcpServerInfo[]>([]);
  const [tools, setTools] = useState<HermesMcpToolIndexEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [serverList, index] = await Promise.all([
        fetchHermesMcpServers(),
        fetchHermesMcpToolIndex(),
      ]);
      setServers(serverList);
      setTools(index.tools);
    } catch (err) {
      setError(err instanceof HermesApiError ? err.message : 'Could not load MCP tool index.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totalTools = tools.length > 0
    ? tools.length
    : servers.reduce((sum, s) => sum + (s.enabled ? s.tool_count : 0), 0);

  const enabledServers = servers.filter((s) => s.enabled).length;
  const threshold = MCP_TOOL_CONTEXT_THRESHOLD;
  const overThreshold = totalTools > threshold;
  const filteredTools = useMemo(
    () => filterMcpToolIndex(tools, query),
    [tools, query],
  );

  return {
    servers,
    tools,
    totalTools,
    enabledServers,
    overThreshold,
    threshold,
    loading,
    error,
    query,
    setQuery,
    filteredTools,
    reload,
  };
}
