import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationSearch } from '@/hooks/useConversationSearch';
import { searchConversations, type SearchResult } from '@/lib/db';

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, searchConversations: vi.fn() };
});

const searchConversationsMock = vi.mocked(searchConversations);

const result = (messageId: string): SearchResult => ({
  conversationId: 'conv-1',
  messageId,
  role: 'user',
  text: 'hello world',
  snippet: 'hello world',
  timestamp: '2026-01-01T00:00:00.000Z',
});

afterEach(() => {
  vi.useRealTimers();
  searchConversationsMock.mockReset();
});

describe('useConversationSearch', () => {
  it('debounces the query by 300ms and trims it', async () => {
    vi.useFakeTimers();
    searchConversationsMock.mockResolvedValue([result('m1')]);

    const { result: hook } = renderHook(() => useConversationSearch());
    act(() => hook.current.setQuery('  deploy  '));

    expect(hook.current.query).toBe('  deploy  ');
    expect(searchConversationsMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(searchConversationsMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(searchConversationsMock).toHaveBeenCalledTimes(1);
    expect(searchConversationsMock).toHaveBeenCalledWith('deploy');
    expect(hook.current.results).toEqual([result('m1')]);
    expect(hook.current.loading).toBe(false);
    expect(hook.current.error).toBeNull();
  });

  it('clears results immediately when the query becomes empty', async () => {
    vi.useFakeTimers();
    searchConversationsMock.mockResolvedValue([result('m1')]);

    const { result: hook } = renderHook(() => useConversationSearch());
    act(() => hook.current.setQuery('deploy'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(hook.current.results).toHaveLength(1);

    act(() => hook.current.setQuery(''));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(hook.current.results).toEqual([]);
    expect(searchConversationsMock).toHaveBeenCalledTimes(1); // no search for empty query
  });

  it('discards stale results from an out-of-order response', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: SearchResult[]) => void;
    let resolveSecond!: (value: SearchResult[]) => void;
    searchConversationsMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const { result: hook } = renderHook(() => useConversationSearch());
    act(() => hook.current.setQuery('alpha'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    act(() => hook.current.setQuery('beta'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Newer search resolves first…
    await act(async () => {
      resolveSecond([result('m-beta')]);
    });
    expect(hook.current.results).toEqual([result('m-beta')]);

    // …then the stale first search resolves — it must be ignored.
    await act(async () => {
      resolveFirst([result('m-alpha')]);
    });
    expect(hook.current.results).toEqual([result('m-beta')]);
  });

  it('surfaces search errors and resets them on the next query', async () => {
    vi.useFakeTimers();
    searchConversationsMock.mockRejectedValueOnce(new Error('indexed db exploded'));

    const { result: hook } = renderHook(() => useConversationSearch());
    act(() => hook.current.setQuery('deploy'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(hook.current.error).toBe('indexed db exploded');
    expect(hook.current.results).toEqual([]);

    searchConversationsMock.mockResolvedValueOnce([result('m1')]);
    act(() => hook.current.setQuery('other'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(hook.current.error).toBeNull();
    expect(hook.current.results).toEqual([result('m1')]);
  });
});
