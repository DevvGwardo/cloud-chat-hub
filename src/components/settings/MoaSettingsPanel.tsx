import { useCallback, useEffect, useState } from 'react';
import { Layers, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  fetchMoaConfig,
  updateMoaConfig,
  type MoaConfig,
  type MoaPreset,
  type MoaModelRef,
} from '@/lib/hermes-api';
import { useHermesProviders } from '@/hooks/useHermesProviders';
import { cn } from '@/lib/utils';

const emptyRef = (): MoaModelRef => ({ provider: '', model: '' });

function slotLabel(ref: MoaModelRef | undefined): string {
  if (!ref?.model) return '—';
  return ref.provider ? `${ref.provider}:${ref.model}` : ref.model;
}

/**
 * Compact Mixture-of-Agents preset editor for Settings.
 * Reads/writes ~/.hermes/config.yaml via the bridge `/moa` API.
 */
export function MoaSettingsPanel({
  fieldLabelClass,
  settingsCardClass,
  textInputClass,
}: {
  fieldLabelClass: string;
  settingsCardClass: string;
  textInputClass: string;
}) {
  const { providers } = useHermesProviders(true);
  const [config, setConfig] = useState<MoaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<MoaPreset | null>(null);
  /** Original preset key while editing — used to delete on rename. */
  const [editingKey, setEditingKey] = useState<string>('');
  const [makeDefault, setMakeDefault] = useState(false);

  const credentialed = providers.filter(
    (p) => p.id !== 'moa' && p.credentialed && p.models.length > 0,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMoaConfig();
      setConfig(next);
      const names = next.preset_names.length
        ? next.preset_names
        : Object.keys(next.presets);
      const pick = names.includes(next.default_preset)
        ? next.default_preset
        : names[0] || '';
      setSelected(pick);
      setEditingKey(pick);
      setMakeDefault(pick === next.default_preset);
      setDraft(pick && next.presets[pick] ? { ...next.presets[pick], name: pick } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MoA config');
      setConfig(null);
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectPreset = (name: string) => {
    setSelected(name);
    setEditingKey(name);
    setMakeDefault(config?.default_preset === name);
    setStatus(null);
    if (config?.presets[name]) {
      setDraft({ ...config.presets[name], name });
    }
  };

  const updateDraft = (patch: Partial<MoaPreset>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setStatus(null);
  };

  const updateRef = (index: number, patch: Partial<MoaModelRef>) => {
    if (!draft) return;
    const refs = [...(draft.reference_models || [])];
    refs[index] = { ...refs[index], ...patch };
    updateDraft({ reference_models: refs });
  };

  const addRef = () => {
    if (!draft) return;
    updateDraft({ reference_models: [...(draft.reference_models || []), emptyRef()] });
  };

  const removeRef = (index: number) => {
    if (!draft) return;
    const refs = (draft.reference_models || []).filter((_, i) => i !== index);
    updateDraft({ reference_models: refs.length ? refs : [emptyRef()] });
  };

  const save = async () => {
    if (!draft?.name?.trim()) {
      setError('Preset name is required');
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const nextName = draft.name.trim();
      const renamed = Boolean(editingKey && editingKey !== nextName);
      // Rename: upsert new key, then delete the old one (backend is upsert-only).
      if (renamed) {
        await updateMoaConfig({
          ...(makeDefault || config?.default_preset === editingKey
            ? { default_preset: nextName }
            : {}),
          preset: {
            ...draft,
            name: nextName,
            enabled: draft.enabled !== false,
            reference_models: (draft.reference_models || []).filter((r) => r.model?.trim()),
            aggregator: draft.aggregator || emptyRef(),
            fanout: draft.fanout || 'per_iteration',
          },
        });
        const next = await updateMoaConfig({
          preset: { name: editingKey, delete: true } as MoaPreset & { delete: true },
        });
        setConfig(next);
        setSelected(nextName);
        setEditingKey(nextName);
        setMakeDefault(next.default_preset === nextName);
        setDraft(
          next.presets[nextName] ? { ...next.presets[nextName], name: nextName } : draft,
        );
      } else {
        const next = await updateMoaConfig({
          ...(makeDefault ? { default_preset: nextName } : {}),
          preset: {
            ...draft,
            name: nextName,
            enabled: draft.enabled !== false,
            reference_models: (draft.reference_models || []).filter((r) => r.model?.trim()),
            aggregator: draft.aggregator || emptyRef(),
            fanout: draft.fanout || 'per_iteration',
          },
        });
        setConfig(next);
        setSelected(nextName);
        setEditingKey(nextName);
        setMakeDefault(next.default_preset === nextName);
        setDraft(
          next.presets[nextName] ? { ...next.presets[nextName], name: nextName } : draft,
        );
      }
      setStatus('Saved to Hermes config');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MoA config');
    } finally {
      setSaving(false);
    }
  };

  const createPreset = () => {
    const existing = new Set([
      ...(config?.preset_names || []),
      ...Object.keys(config?.presets || {}),
    ]);
    let name = 'fast';
    let i = 2;
    while (existing.has(name)) {
      name = `fast-${i}`;
      i += 1;
    }
    const base = {
      name,
      enabled: true,
      reference_models: [emptyRef()],
      aggregator: emptyRef(),
      fanout: 'user_turn' as const,
      reference_max_tokens: 600,
      max_tokens: 4096,
    };
    // Prefer first credentialed model for a sensible default
    const first = credentialed[0];
    if (first?.models[0]) {
      base.reference_models = [{ provider: first.id, model: first.models[0] }];
      base.aggregator = { provider: first.id, model: first.models[0] };
    }
    setSelected(base.name);
    setEditingKey('');
    setMakeDefault(false);
    setDraft(base);
    setStatus(null);
  };

  const deletePreset = async () => {
    if (!draft?.name || !config) return;
    if (Object.keys(config.presets).length <= 1) {
      setError('Cannot delete the last MoA preset');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updateMoaConfig({
        preset: { ...draft, delete: true },
      });
      setConfig(next);
      const nextName = next.default_preset || next.preset_names[0] || '';
      setSelected(nextName);
      setDraft(nextName && next.presets[nextName] ? { ...next.presets[nextName], name: nextName } : null);
      setStatus(`Deleted “${draft.name}”`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete preset');
    } finally {
      setSaving(false);
    }
  };

  const providerOptions = credentialed.map((p) => (
    <option key={p.id} value={p.id}>{p.name}</option>
  ));

  const modelOptions = (providerId: string) => {
    const p = credentialed.find((x) => x.id === providerId);
    return (p?.models || []).map((m) => (
      <option key={m} value={m}>{m.split('/').pop() || m}</option>
    ));
  };

  return (
    <div className={cn(settingsCardClass, 'space-y-3 px-5 py-5')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn(fieldLabelClass, 'flex items-center gap-1.5')}>
            <Layers className="h-3.5 w-3.5 text-primary/80" />
            Mixture of Agents
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Parallel advisor models brief an aggregator that keeps tools. Pick a preset
            from the model menu as <span className="font-mono text-[11px]">MoA · name</span>.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground"
            title="Reload"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={createPreset}
            className="rounded-md border border-border/60 p-1.5 text-muted-foreground hover:text-foreground"
            title="New preset"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {loading && !config && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading MoA config…
        </div>
      )}

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

      {config && Object.keys(config.presets).length === 0 && !draft && (
        <div className="text-xs text-muted-foreground space-y-2">
          <p>No MoA presets configured yet.</p>
          <button
            type="button"
            onClick={createPreset}
            className="text-xs text-primary hover:underline"
          >
            Create a preset
          </button>
        </div>
      )}

      {(Object.keys(config?.presets || {}).length > 0 || draft) && (
        <div className="space-y-3">
          {Object.keys(config?.presets || {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(config!.presets).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => selectPreset(name)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] font-mono transition-colors',
                    selected === name
                      ? 'border-primary/50 bg-primary/10 text-foreground'
                      : 'border-border/50 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {name}
                  {config!.default_preset === name && (
                    <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                      default
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {draft && (
            <div className="space-y-3 rounded-lg border border-border/40 bg-background/40 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</span>
                  <input
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value.replace(/\s+/g, '-').toLowerCase() })}
                    className={cn(textInputClass, 'h-8 text-xs font-mono')}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Fan-out</span>
                  <select
                    value={draft.fanout || 'per_iteration'}
                    onChange={(e) => updateDraft({ fanout: e.target.value as MoaPreset['fanout'] })}
                    className={cn(textInputClass, 'h-8 text-xs')}
                  >
                    <option value="per_iteration">Every tool iteration</option>
                    <option value="user_turn">Once per user turn</option>
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                  className="rounded border-border"
                />
                Make default MoA preset
              </label>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Reference advisors
                  </span>
                  <button type="button" onClick={addRef} className="text-[11px] text-primary hover:underline">
                    + add
                  </button>
                </div>
                {(draft.reference_models || []).map((ref, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select
                      value={ref.provider}
                      onChange={(e) => {
                        const provider = e.target.value;
                        const models = credentialed.find((p) => p.id === provider)?.models || [];
                        updateRef(i, { provider, model: models[0] || '' });
                      }}
                      className={cn(textInputClass, 'h-8 text-xs flex-1')}
                    >
                      <option value="">Provider</option>
                      {providerOptions}
                    </select>
                    <select
                      value={ref.model}
                      onChange={(e) => updateRef(i, { model: e.target.value })}
                      className={cn(textInputClass, 'h-8 text-xs flex-[1.4]')}
                    >
                      <option value="">Model</option>
                      {modelOptions(ref.provider)}
                      {ref.model && !(credentialed.find((p) => p.id === ref.provider)?.models || []).includes(ref.model) && (
                        <option value={ref.model}>{ref.model}</option>
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeRef(i)}
                      className="p-1 text-muted-foreground hover:text-red-400"
                      title="Remove advisor"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Aggregator (acting model)
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={draft.aggregator?.provider || ''}
                    onChange={(e) => {
                      const provider = e.target.value;
                      const models = credentialed.find((p) => p.id === provider)?.models || [];
                      updateDraft({
                        aggregator: { provider, model: models[0] || '' },
                      });
                    }}
                    className={cn(textInputClass, 'h-8 text-xs flex-1')}
                  >
                    <option value="">Provider</option>
                    {providerOptions}
                  </select>
                  <select
                    value={draft.aggregator?.model || ''}
                    onChange={(e) =>
                      updateDraft({
                        aggregator: {
                          provider: draft.aggregator?.provider || '',
                          model: e.target.value,
                        },
                      })
                    }
                    className={cn(textInputClass, 'h-8 text-xs flex-[1.4]')}
                  >
                    <option value="">Model</option>
                    {modelOptions(draft.aggregator?.provider || '')}
                    {draft.aggregator?.model &&
                      !(credentialed.find((p) => p.id === draft.aggregator?.provider)?.models || []).includes(
                        draft.aggregator.model,
                      ) && (
                        <option value={draft.aggregator.model}>{draft.aggregator.model}</option>
                      )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Advisor max tokens
                  </span>
                  <input
                    type="number"
                    min={0}
                    placeholder="600"
                    value={draft.reference_max_tokens ?? ''}
                    onChange={(e) =>
                      updateDraft({
                        reference_max_tokens: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className={cn(textInputClass, 'h-8 text-xs font-mono')}
                  />
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={draft.enabled !== false}
                    onChange={(e) => updateDraft({ enabled: e.target.checked })}
                    className="rounded border-border"
                  />
                  <span className="text-xs text-muted-foreground">
                    Enabled (off = aggregator alone)
                  </span>
                </label>
              </div>

              <div className="rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground font-mono">
                { (draft.reference_models || []).map((r, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {slotLabel(r)}
                  </span>
                ))}
                {' → '}
                <span className="text-foreground/80">{slotLabel(draft.aggregator)}</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void deletePreset()}
                  disabled={saving || Object.keys(config?.presets || {}).length <= 1}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save preset
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
