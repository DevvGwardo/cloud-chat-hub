import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchResults,
  buildSearchSnippet,
  searchConversations,
  type Conversation,
  type Message,
} from '@/lib/db';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const conversation = (id: string, title: string): Conversation => ({
  id,
  title,
  provider: 'hermes',
  model: 'claude-opus-4',
  systemPrompt: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
});

const message = (id: string, conversationId: string, role: Message['role'], content: string, timestamp: string): Message => ({
  id,
  conversationId,
  role,
  content,
  timestamp,
});

describe('buildSearchSnippet', () => {
  it('wraps the first match in a radius with ellipses when truncated', () => {
    const text = `${'word '.repeat(30)}deploy target ${'word '.repeat(30)}`.trim();
    const snippet = buildSearchSnippet(text, 'deploy');
    expect(snippet).not.toBeNull();
    expect(snippet).toContain('deploy');
    expect(snippet!.startsWith('…')).toBe(true);
    expect(snippet!.endsWith('…')).toBe(true);
    expect(snippet!.length).toBeLessThan(text.length);
  });

  it('returns the whole text when it fits inside the radius', () => {
    const text = 'short message about deploy';
    expect(buildSearchSnippet(text, 'deploy')).toBe('short message about deploy');
  });

  it('collapses whitespace/newlines for display', () => {
    const snippet = buildSearchSnippet('line one\n\nline two deploy here', 'deploy');
    expect(snippet).toBe('line one line two deploy here');
  });

  it('returns null when there is no match or an empty query', () => {
    expect(buildSearchSnippet('nothing here', 'deploy')).toBeNull();
    expect(buildSearchSnippet('deploy', '')).toBeNull();
    expect(buildSearchSnippet('', 'deploy')).toBeNull();
  });

  it('matches case-insensitively', () => {
    expect(buildSearchSnippet('DEPLOY the build', 'deploy')).toContain('DEPLOY');
  });
});

describe('buildSearchResults', () => {
  const messages = [
    message('m1', 'conv-1', 'user', 'The build is failing on the deploy step', '2026-01-01T00:00:00.000Z'),
    message('m2', 'conv-1', 'assistant', 'Look at the deploy pipeline logs', '2026-01-01T00:00:10.000Z'),
    message('m3', 'conv-1', 'system', 'system prompt mentioning deploy', '2026-01-01T00:00:20.000Z'),
    message('m4', 'conv-2', 'user', 'Any plans for the weekend deploy?', '2026-01-02T00:00:00.000Z'),
  ];

  it('drops non-matching and system messages, ranks by earliest match', () => {
    const results = buildSearchResults(messages, 'deploy');
    expect(results.map((r) => r.messageId)).toEqual(['m2', 'm4', 'm1']);
    expect(results[0]).toMatchObject({
      conversationId: 'conv-1',
      messageId: 'm2',
      role: 'assistant',
      timestamp: '2026-01-01T00:00:10.000Z',
    });
    expect(results[0].snippet).toContain('deploy');
  });

  it('respects the limit', () => {
    expect(buildSearchResults(messages, 'deploy', 2)).toHaveLength(2);
    expect(buildSearchResults(messages, 'deploy', 0)).toHaveLength(1); // never returns empty for a match
  });

  it('is case-insensitive and trims the query', () => {
    expect(buildSearchResults(messages, '  DEPLOY ')).toHaveLength(3);
  });

  it('returns [] for an empty query', () => {
    expect(buildSearchResults(messages, '')).toEqual([]);
    expect(buildSearchResults(messages, '   ')).toEqual([]);
  });

  it('tie-breaks equal match positions by recency', () => {
    const samePosition = [
      message('old', 'conv-1', 'user', 'deploy first thing', '2026-01-01T00:00:00.000Z'),
      message('new', 'conv-2', 'user', 'deploy first thing', '2026-01-02T00:00:00.000Z'),
    ];
    const results = buildSearchResults(samePosition, 'deploy');
    expect(results.map((r) => r.messageId)).toEqual(['new', 'old']);
  });
});

describe('searchConversations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds matches across conversations through the server backend', async () => {
    const conv1 = conversation('conv-1', 'Debugging session');
    const conv2 = conversation('conv-2', 'Release notes');
    const messagesByConv: Record<string, Message[]> = {
      'conv-1': [
        message('m1', 'conv-1', 'user', 'The build is failing on the deploy step', '2026-01-01T00:00:00.000Z'),
        message('m2', 'conv-1', 'assistant', 'Look at the deploy pipeline logs', '2026-01-01T00:00:10.000Z'),
      ],
      'conv-2': [
        message('m3', 'conv-2', 'user', 'Any plans for the weekend deploy?', '2026-01-02T00:00:00.000Z'),
        message('m4', 'conv-2', 'user', 'Unrelated note about cookies', '2026-01-02T00:00:05.000Z'),
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/functions/v1/health')) {
        return jsonResponse(200, { ok: true });
      }
      if (url.endsWith('/functions/v1/chat-store/conversations') || url.endsWith('/functions/v1/chat-store/conversations?includeArchived=1')) {
        return jsonResponse(200, { conversations: [conv1, conv2] });
      }
      const match = url.match(/\/functions\/v1\/chat-store\/conversations\/([^/]+)\/messages$/);
      if (match) {
        return jsonResponse(200, { messages: messagesByConv[match[1]] ?? [] });
      }
      return jsonResponse(404, { error: 'not found' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchConversations('deploy');
    expect(results.map((r) => r.messageId)).toEqual(['m2', 'm3', 'm1']);
    expect(results[0].conversationId).toBe('conv-1');
    expect(results[0].role).toBe('assistant');
    expect(results[0].snippet).toContain('deploy');
  });

  it('returns [] for an empty query without touching the backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchConversations('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully in legacy mode without IndexedDB (jsdom)', async () => {
    // Fresh module instance so the backend-mode cache starts at 'unknown';
    // health reports failure → legacy mode. jsdom has no indexedDB, so the
    // local scan is skipped and the result is an empty list, not a throw.
    vi.resetModules();
    const fetchMock = vi.fn(async () => jsonResponse(404, { error: 'not found' }));
    vi.stubGlobal('fetch', fetchMock);
    const { searchConversations: freshSearch } = await import('@/lib/db');
    await expect(freshSearch('deploy')).resolves.toEqual([]);
  });
});
