import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Monitor, ShieldAlert } from 'lucide-react';
import {
  shouldShowComputerUseDock,
  type ComputerUseDockState,
} from '@/lib/computer-use-dock';

interface ComputerUseDockProps {
  state: ComputerUseDockState;
  isStreaming: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

export function ComputerUseDock({ state, isStreaming, onExpand, onCollapse }: ComputerUseDockProps) {
  const visible = shouldShowComputerUseDock(state, isStreaming);
  const permissionsHint = state.permissionsHint;

  const headerLabel = useMemo(() => {
    if (state.status === 'running') return 'Computer use · live';
    if (state.image) return 'Computer use · frame';
    return 'Computer use';
  }, [state.image, state.status]);

  if (!visible) return null;

  return (
    <div
      className="mb-2 overflow-hidden rounded-lg border border-border/60 bg-[hsl(var(--frame-bg))]/95 shadow-sm motion-safe:animate-fade-in-up motion-reduce:animate-none"
      data-testid="computer-use-dock"
    >
      <button
        type="button"
        onClick={() => (state.expanded ? onCollapse() : onExpand())}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-75 hover:bg-muted/20"
        aria-expanded={state.expanded}
      >
        <Monitor className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        <span className="text-[11px] font-medium tracking-tight text-foreground/90">{headerLabel}</span>
        {state.action ? (
          <span className="truncate font-mono text-[10px] text-muted-foreground/70">{state.action}</span>
        ) : null}
        {state.status === 'running' ? (
          <span className="relative ml-1 flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
        ) : null}
        <div className="ml-auto shrink-0">
          {state.expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {state.expanded ? (
        <div className="border-t border-border/40 px-3 py-2">
          <div className="flex items-start gap-3">
            {state.image ? (
              <img
                src={state.image}
                alt="Latest computer use frame"
                className="h-20 w-32 shrink-0 rounded border border-border/50 object-cover object-left-top bg-black/40"
              />
            ) : (
              <div className="flex h-20 w-32 shrink-0 items-center justify-center rounded border border-dashed border-border/50 bg-muted/10 text-[10px] text-muted-foreground/60">
                No frame yet
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[11px] text-foreground/85">
                {state.action ?? 'Waiting for computer_use action…'}
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                {state.image
                  ? 'Screenshot from the latest computer_use result (capture or capture_after).'
                  : 'Running state streams via tool events. Screenshots need agent-loop + capture_after on mutating actions; gateway /v1/runs has no screenshot payloads today.'}
              </p>
              {permissionsHint ? (
                <p className="flex items-start gap-1.5 text-[10px] text-amber-400/90">
                  <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{permissionsHint}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
