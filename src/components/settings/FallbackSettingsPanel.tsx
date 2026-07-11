import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Shield, Trash2 } from 'lucide-react';
import {
  fetchFallbackProviders,
  updateFallbackProviders,
  type FallbackProvider,
} from '@/lib/hermes-api';
import { useHermesProviders } from '@/hooks/useHermesProviders';
import { cn } from '@/lib/utils';

/**
 * Settings card for Hermes fallback_providers chain.
 * Tried in order when the primary model hits rate-limits / 5xx / connection errors.
 */
export function FallbackSettingsPanel({
  fieldLabelClass,
  settingsCardClass,
  textInputClass,
}: {
  fieldLabelClass: string;
  settingsCardClass: string;
  textInputClass: string;
}) {
  const { providers } = useHermesProviders(true);
  const credentialed = providers.filter((p) => p.id !== 'moa' && p.credentialed && p.models.length > 0);
  const [chain, setChain] = useState<FallbackProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChain(await fetchFallbackProviders());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fallback chain');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const cleaned = chain.filter((e) => e.provider && e.model);
      setChain(await updateFallbackProviders(cleaned));
      setStatus('Fallback chain saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fallback chain');
    } finally {
      setSaving(false);
    }
  };

  const updateAt = (index: number, patch: Partial<FallbackProvider>) => {
    setChain((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
    setStatus(null);
  };

  return (
    <div className={cn(settingsCardClass, 'space-y-3 px-5 py-5')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn(fieldLabelClass, 'flex items-center gap-1.5')}>
            <Shield className="h-3.5 w-3.5 text-primary/80" />
            Fallback Providers
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tried in order when the primary model fails (rate-limit, overload, connection errors).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground"
          title="Reload"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {status && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400">
          {status}
        </div>
      )}

      {loading && chain.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {chain.length === 0 && (
            <p className="text-xs text-muted-foreground">No fallbacks configured — primary only.</p>
          )}
          {chain.map((entry, i) => {
            const models = credentialed.find((p) => p.id === entry.provider)?.models || [];
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-5 text-[10px] font-mono text-muted-foreground/60">{i + 1}.</span>
                <select
                  value={entry.provider}
                  onChange={(e) => {
                    const provider = e.target.value;
                    const nextModels = credentialed.find((p) => p.id === provider)?.models || [];
                    updateAt(i, { provider, model: nextModels[0] || '' });
                  }}
                  className={cn(textInputClass, 'h-8 text-xs flex-1')}
                >
                  <option value="">Provider</option>
                  {credentialed.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  value={entry.model}
                  onChange={(e) => updateAt(i, { model: e.target.value })}
                  className={cn(textInputClass, 'h-8 text-xs flex-[1.3]')}
                >
                  <option value="">Model</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m.split('/').pop() || m}</option>
                  ))}
                  {entry.model && !models.includes(entry.model) && (
                    <option value={entry.model}>{entry.model}</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => setChain((prev) => prev.filter((_, j) => j !== i))}
                  className="p-1 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => {
                const first = credentialed[0];
                setChain((prev) => [
                  ...prev,
                  {
                    provider: first?.id || '',
                    model: first?.models[0] || '',
                  },
                ]);
              }}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" />
              Add fallback
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save chain
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
