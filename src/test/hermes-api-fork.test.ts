import { afterEach, describe, expect, it, vi } from 'vitest';
import { forkHermesSession } from '@/lib/hermes-api';

function mockJsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status: ok ? status : status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('forkHermesSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /sessions/:id/fork and returns the forked session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse(
        {
          object: 'hermes.session',
          session: { id: 'fork-1', parent_session_id: 'src-1', title: 'Alt' },
        },
        true,
        201,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await forkHermesSession('src-1', { title: 'Alt' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/sessions/src-1/fork');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Alt' });
    expect(result.session.id).toBe('fork-1');
    expect(result.session.parent_session_id).toBe('src-1');
  });

  it('sends an empty body when no title is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ object: 'hermes.session', session: { id: 'fork-2' } }, true, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    await forkHermesSession('src-2');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({});
  });
});
