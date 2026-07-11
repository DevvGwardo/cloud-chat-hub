import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  detectContextRefQuery,
  expandContextRefs,
  filterFileSuggestions,
  filterFolderSuggestions,
  hasContextRefs,
  parseContextRefs,
} from '@/lib/context-refs';

describe('context-refs parse', () => {
  it('parses prefixed file, folder, url, and diff refs', () => {
    const text = 'see @file:src/a.ts and @folder:src/lib also @diff and @url:https://x.com/y';
    const refs = parseContextRefs(text);
    expect(refs.map((r) => [r.kind, r.value])).toEqual([
      ['file', 'src/a.ts'],
      ['folder', 'src/lib'],
      ['diff', ''],
      ['url', 'https://x.com/y'],
    ]);
  });

  it('does not treat bare @mentions as context refs', () => {
    expect(parseContextRefs('ping @alice about this')).toEqual([]);
    expect(hasContextRefs('ping @alice')).toBe(false);
  });

  it('detects picker at bare @', () => {
    const q = detectContextRefQuery('hello @', 7);
    expect(q?.kind).toBe('picker');
    expect(q?.replaceStart).toBe(6);
  });

  it('detects partial file path query', () => {
    const q = detectContextRefQuery('use @file:src/hooks/use', 23);
    expect(q).toEqual({
      kind: 'file',
      query: 'src/hooks/use',
      replaceStart: 4,
      replaceEnd: 23,
    });
  });
});

describe('context-refs filters', () => {
  const paths = ['src/lib/api.ts', 'src/hooks/useChat.ts', 'server/index.ts'];

  it('ranks file suggestions by basename match', () => {
    expect(filterFileSuggestions(paths, 'useChat')).toEqual(['src/hooks/useChat.ts']);
  });

  it('lists folder prefixes from file tree', () => {
    const folders = filterFolderSuggestions(paths, 'src');
    expect(folders).toContain('src');
    expect(folders).toContain('src/hooks');
  });
});

describe('expandContextRefs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('prepends a context block before the user message', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ diff: '+added line' }), { status: 200 }),
    );

    const result = await expandContextRefs('fix @diff please', {
      workspaceRoot: '/tmp/repo',
    });

    expect(result.expanded).toContain('<context>');
    expect(result.expanded).toContain('### Git diff');
    expect(result.expanded).toContain('fix @diff please');
    expect(result.warnings).toEqual([]);
  });

  it('records warnings when expansion prerequisites are missing', async () => {
    const result = await expandContextRefs('@file:missing.ts', {});
    expect(result.expanded).toBe('@file:missing.ts');
    expect(result.warnings.some((w) => w.includes('no workspace'))).toBe(true);
  });
});
