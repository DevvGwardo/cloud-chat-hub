import { describe, expect, it } from 'vitest';
import { displayMcpToolName, filterMcpToolIndex } from '@/lib/mcp-tool-index';
import type { HermesMcpToolIndexEntry } from '@/lib/hermes-api';

const SAMPLE: HermesMcpToolIndexEntry[] = [
  { server: 'brain', name: 'mcp__brain__status', description: 'Agent coordination status' },
  { server: 'filesystem', name: 'mcp__filesystem__read_file', description: 'Read a file from disk' },
  { server: 'github', name: 'mcp__github__create_pr', description: 'Open a pull request' },
];

describe('filterMcpToolIndex', () => {
  it('returns all tools when query is empty', () => {
    expect(filterMcpToolIndex(SAMPLE, '')).toHaveLength(3);
    expect(filterMcpToolIndex(SAMPLE, '   ')).toHaveLength(3);
  });

  it('filters by tool name, server, or description', () => {
    expect(filterMcpToolIndex(SAMPLE, 'brain')).toHaveLength(1);
    expect(filterMcpToolIndex(SAMPLE, 'pull request')[0].server).toBe('github');
    expect(filterMcpToolIndex(SAMPLE, 'read_file')).toHaveLength(1);
  });

  it('is case insensitive', () => {
    expect(filterMcpToolIndex(SAMPLE, 'GITHUB')).toHaveLength(1);
  });
});

describe('displayMcpToolName', () => {
  it('strips mcp server prefix when server is known', () => {
    expect(displayMcpToolName('mcp__brain__status', 'brain')).toBe('status');
  });

  it('falls back to full name when prefix does not match', () => {
    expect(displayMcpToolName('custom_tool', 'brain')).toBe('custom_tool');
  });
});
