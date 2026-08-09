import { useEffect, useState } from 'react';
import { searchConversations, type SearchResult } from '@/lib/db';

/**
 * Debounced conversation search state. The query prop updates immediately;
 * `results` only refresh after the user pauses typing (300ms by default).
 * Out-of-order responses are discarded so a slow older search can't clobber
 * a newer one.
 */
export function useConversationSearch(debounceMs = 300) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchConversations(debouncedQuery)
      .then((next) => {
        if (!cancelled) setResults(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResults([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  return { query, setQuery, results, loading, error };
}
