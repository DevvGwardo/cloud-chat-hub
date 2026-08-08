import React, { useCallback, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useHermesStore } from '@/stores/hermes-store';
import { postAcpApproval } from '@/lib/hermes-api';
import { cn } from '@/lib/utils';

/**
 * Inline banner for ACP permission requests: the real hermes-agent paused a
 * risky tool (edit, terminal, …) and is waiting on the user's decision. The
 * choice is POSTed to the bridge, which resolves the agent's parked request.
 */
export const AcpApprovalBanner: React.FC = () => {
  const pending = useHermesStore((state) => state.pendingAcpApproval);
  const setPendingAcpApproval = useHermesStore((state) => state.setPendingAcpApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (optionId: 'allow_once' | 'allow_session' | 'allow_always' | 'deny') => {
      if (!pending) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await postAcpApproval(pending.approval_id, optionId);
        setPendingAcpApproval(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to send decision');
      } finally {
        setBusy(false);
      }
    },
    [pending, setPendingAcpApproval],
  );

  if (!pending) {
    return null;
  }

  const headline = pending.summary || pending.excerpt || pending.tool || 'Hermes is waiting for approval.';
  const detail = pending.summary && pending.excerpt && pending.excerpt !== pending.summary
    ? pending.excerpt
    : null;
  const options = pending.options ?? [];
  const hasSession = options.some((o) => o.option_id === 'allow_session');
  const hasAlways = options.some((o) => o.option_id === 'allow_always');

  return (
    <div className="mt-2" data-testid="acp-approval-banner">
      <div className="rounded-[20px] border border-border/60 bg-background/90 shadow-[0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <div className="flex items-start gap-3 px-3 py-3 sm:px-4">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/45 text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Approval required
              </span>
              {pending.tool && (
                <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[11px] text-foreground">
                  {pending.tool}
                </span>
              )}
            </div>

            <p className="mt-2 text-sm font-medium leading-6 text-foreground">
              {headline}
            </p>

            {detail && (
              <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
                {detail}
              </p>
            )}

            {error && (
              <p className="mt-1.5 text-[11px] text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => decide('allow_once')}
                disabled={busy}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                  'border-border/60 bg-background/70 text-foreground hover:bg-muted',
                  busy && 'opacity-60',
                )}
              >
                Allow once
              </button>
              {hasSession && (
                <button
                  type="button"
                  onClick={() => decide('allow_session')}
                  disabled={busy}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                    'border-border/60 bg-background/70 text-foreground hover:bg-muted',
                    busy && 'opacity-60',
                  )}
                >
                  Allow for session
                </button>
              )}
              {hasAlways && (
                <button
                  type="button"
                  onClick={() => decide('allow_always')}
                  disabled={busy}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                    'border-border/60 bg-background/70 text-foreground hover:bg-muted',
                    busy && 'opacity-60',
                  )}
                >
                  Allow always
                </button>
              )}
              <button
                type="button"
                onClick={() => decide('deny')}
                disabled={busy}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                  'border-destructive/40 bg-background/70 text-destructive hover:bg-destructive/10',
                  busy && 'opacity-60',
                )}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
