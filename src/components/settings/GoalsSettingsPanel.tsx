import { useCallback, useEffect, useState } from 'react';
import { Flag, Loader2, Save } from 'lucide-react';
import { fetchGoalsConfig, updateGoalsConfig, type GoalsConfig } from '@/lib/hermes-api';
import { cn } from '@/lib/utils';

export function GoalsSettingsPanel({
  fieldLabelClass,
  settingsCardClass,
  textInputClass,
}: {
  fieldLabelClass: string;
  settingsCardClass: string;
  textInputClass: string;
}) {
  const [config, setConfig] = useState<GoalsConfig>({ max_turns: 20, enabled: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await fetchGoalsConfig());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load goals config');
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
      setConfig(await updateGoalsConfig(config));
      setStatus('Goals config saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(settingsCardClass, 'space-y-3 px-5 py-5')}>
      <div>
        <p className={cn(fieldLabelClass, 'flex items-center gap-1.5')}>
          <Flag className="h-3.5 w-3.5 text-primary/80" />
          Goals
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ralph-loop standing objectives. Use <span className="font-mono text-[11px]">/goal</span> in
          chat; max turns caps auto-continue.
        </p>
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

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm text-foreground">Goals enabled</div>
              <div className="text-xs text-muted-foreground">Allow standing objectives</div>
            </div>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
              className="rounded border-border"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Max turns</span>
            <input
              type="number"
              min={1}
              max={200}
              value={config.max_turns}
              onChange={(e) =>
                setConfig((c) => ({ ...c, max_turns: Math.max(1, Math.min(200, Number(e.target.value) || 20)) }))
              }
              className={cn(textInputClass, 'h-8 text-xs font-mono w-28')}
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
