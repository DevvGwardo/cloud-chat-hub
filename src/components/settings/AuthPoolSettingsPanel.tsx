import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import {
  addAuthPoolApiKey,
  fetchAuthPool,
  removeAuthPoolCredential,
  resetAuthPoolProvider,
  type AuthPoolProvider,
} from '@/lib/hermes-api';
import { cn } from '@/lib/utils';

/**
 * Manage Hermes credential pool (~/.hermes/auth.json) via `hermes auth` proxy.
 * Secrets are never returned — only masked_key (••••last4).
 */
export function AuthPoolSettingsPanel({
  fieldLabelClass,
  settingsCardClass,
}: {
  fieldLabelClass: string;
  settingsCardClass: string;
}) {
  const [providers, setProviders] = useState<AuthPoolProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuthPool();
      const nextProviders = Array.isArray(data.providers) ? data.providers : [];
      setProviders(nextProviders);
      if (!nextProviders.some((item) => item.provider === provider) && nextProviders[0]?.provider) {
        setProvider(nextProviders[0].provider);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credential pool');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    const trimmedProvider = provider.trim();
    const trimmedApiKey = apiKey.trim();
    if (!trimmedProvider || !trimmedApiKey) {
      setError('Provider and API key are required');
      return;
    }
    setBusy('add');
    setError(null);
    setStatus(null);
    try {
      const res = await addAuthPoolApiKey(trimmedProvider, trimmedApiKey, label.trim() || undefined);
      if (!res.ok) throw new Error(res.output || 'Add failed');
      setStatus(`Added ${trimmedProvider} API key`);
      setApiKey('');
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async (provider: string) => {
    setBusy(`reset:${provider}`);
    setError(null);
    setStatus(null);
    try {
      const res = await resetAuthPoolProvider(provider);
      if (!res.ok) throw new Error(res.output || 'Reset failed');
      setStatus(`Reset exhaustion for ${provider}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (provider: string, target: string | number, label: string) => {
    if (!window.confirm(`Remove credential "${label}" from ${provider}?`)) return;
    setBusy(`remove:${provider}:${target}`);
    setError(null);
    setStatus(null);
    try {
      const res = await removeAuthPoolCredential(provider, target);
      if (!res.ok) throw new Error(res.output || 'Remove failed');
      setStatus(`Removed ${provider} credential`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(null);
    }
  };

  const providerOptions = providers.map((item) => item.provider);
  const knownOptions = providerOptions.length > 0 ? providerOptions : ['openrouter', 'anthropic', 'openai', 'google'];

  return (
    <div className={cn(settingsCardClass, 'space-y-3 px-5 py-5')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn(fieldLabelClass, 'flex items-center gap-1.5')}>
            <KeyRound className="h-3.5 w-3.5 text-primary/80" />
            Credential Pool
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pooled API keys in <span className="font-mono text-[11px]">~/.hermes/auth.json</span>.
            OAuth/browser login still happens in terminal:{' '}
            <span className="font-mono text-[11px]">hermes auth add &lt;provider&gt;</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="rounded-lg border border-border/50 bg-white/[0.02] p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          <Plus className="h-3.5 w-3.5 text-primary/80" />
          Add API key
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Provider</span>
            <input
              list="auth-pool-provider-options"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground"
              placeholder="openrouter"
            />
            <datalist id="auth-pool-provider-options">
              {knownOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] text-muted-foreground">API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground"
              placeholder="sk-..."
            />
          </label>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-[11px] text-muted-foreground">Label (optional)</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground"
              placeholder="Work key"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy === 'add' || !provider.trim() || !apiKey.trim()}
            className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {busy === 'add' ? 'Adding…' : 'Add key'}
          </button>
        </div>
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

      {loading && providers.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : providers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pooled credentials yet. Add an API key above, or run{' '}
          <span className="font-mono text-[11px]">hermes auth add openrouter --type api-key</span>{' '}
          in a terminal.
        </p>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.provider} className="rounded-lg border border-border/50 bg-white/[0.02] p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">{p.provider}</span>
                    {p.active_provider && (
                      <span className="rounded border border-primary/20 bg-primary/10 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-primary">
                        Active
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {p.credential_count} key{p.credential_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  {p.status_error && (
                    <p className="text-[11px] text-red-400/80 truncate">{p.status_error}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy === `reset:${p.provider}`}
                  onClick={() => void handleReset(p.provider)}
                  className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title="Clear exhaustion / rate-limit status"
                >
                  {busy === `reset:${p.provider}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Reset
                </button>
              </div>

              <div className="space-y-1">
                {p.credentials.map((c) => {
                  const removeKey = `remove:${p.provider}:${c.index}`;
                  return (
                    <div
                      key={`${p.provider}-${c.index}-${c.id ?? c.label}`}
                      className="flex items-center gap-2 rounded-md border border-border/40 px-2 py-1.5 text-xs"
                    >
                      <span className="w-4 font-mono text-[10px] text-muted-foreground/70">
                        #{c.index}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-foreground">{c.label}</span>
                          {c.active && (
                            <span className="text-[9px] text-primary">in use</span>
                          )}
                          {c.exhausted && (
                            <span className="text-[9px] text-amber-500">exhausted</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="font-mono">{c.masked_key}</span>
                          <span>{c.auth_type}</span>
                          {c.request_count > 0 && <span>{c.request_count} reqs</span>}
                        </div>
                        {c.last_error_message && (
                          <p className="truncate text-[10px] text-red-400/70">{c.last_error_message}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busy === removeKey}
                        onClick={() => void handleRemove(p.provider, c.id ?? c.index, c.label)}
                        className="p-1 text-muted-foreground hover:text-red-400 disabled:opacity-50"
                        title="Remove credential"
                      >
                        {busy === removeKey ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
