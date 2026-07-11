import { useState } from 'react';
import { Loader2, PackageOpen, Play } from 'lucide-react';
import { clawMigrate } from '@/lib/hermes-api';
import { cn } from '@/lib/utils';

export function OpenClawMigratePanel({
  fieldLabelClass,
  settingsCardClass,
}: {
  fieldLabelClass: string;
  settingsCardClass: string;
}) {
  const [report, setReport] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [migrateSecrets, setMigrateSecrets] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await clawMigrate({
        dry_run: !apply,
        migrate_secrets: migrateSecrets,
        yes: apply,
      });
      setReport(res.report || (res.ok ? 'Done.' : 'Migration failed'));
      if (!res.ok) setError('Migration reported failure — see report');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(settingsCardClass, 'space-y-3 px-5 py-5')}>
      <div>
        <p className={cn(fieldLabelClass, 'flex items-center gap-1.5')}>
          <PackageOpen className="h-3.5 w-3.5 text-primary/80" />
          OpenClaw → Hermes
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Import settings, memories, and skills from <span className="font-mono text-[11px]">~/.openclaw</span>.
          Always dry-run first.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={migrateSecrets}
          onChange={(e) => setMigrateSecrets(e.target.checked)}
          className="rounded border-border"
        />
        Include secrets (API keys / bot tokens)
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Dry-run preview
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Apply OpenClaw migration into Hermes? A backup is created by default.')) {
              void run(true);
            }
          }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Apply migration
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}
      {report && (
        <pre className="max-h-48 overflow-auto rounded-md border border-border/40 bg-muted/20 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
          {report}
        </pre>
      )}
    </div>
  );
}
