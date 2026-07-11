import type { HermesMcpToolIndexEntry } from '@/lib/hermes-api';

/** Filter MCP tools by server name, tool name, or description. */
export function filterMcpToolIndex(
  tools: HermesMcpToolIndexEntry[],
  query: string,
): HermesMcpToolIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.server.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q),
  );
}

/** Strip the `mcp__server__` prefix for compact display when present. */
export function displayMcpToolName(fullName: string, server?: string): string {
  if (server) {
    const safeServer = server.replace(/[^A-Za-z0-9_]/g, '_');
    const prefix = `mcp__${safeServer}__`;
    if (fullName.startsWith(prefix)) {
      return fullName.slice(prefix.length);
    }
  }
  const m = fullName.match(/^mcp__[^_]+__(.+)$/);
  return m?.[1] ?? fullName;
}
