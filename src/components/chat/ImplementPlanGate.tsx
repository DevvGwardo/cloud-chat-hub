import { useChatStore } from '@/stores/chat-store';

interface ImplementPlanGateProps {
  /** Called with `clearContext` when the user opts to implement the plan. */
  onImplement: (clearContext: boolean) => void;
  /** Called when the user chooses to stay in plan mode. */
  onCancel: () => void;
}

/**
 * Plan-implementation gate shown while the backend has an active
 * `planGatePrompt` (i.e. the assistant proposed a plan and is waiting for
 * consent before touching the codebase). Renders nothing when no prompt is
 * pending. Self-contained: it only reads the store and forwards the user's
 * choice through its props — it never calls useChat itself.
 */
export const ImplementPlanGate: React.FC<ImplementPlanGateProps> = ({ onImplement, onCancel }) => {
  const planGatePrompt = useChatStore((state) => state.planGatePrompt);

  if (!planGatePrompt) return null;

  return (
    <div
      className="rounded-lg border border-[#2F2F2F] bg-[hsl(var(--card))] px-3 py-3"
      role="group"
      aria-label="Implement this plan?"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-foreground">Implement this plan?</p>
          <p
            className="mt-0.5 line-clamp-1 whitespace-pre-wrap text-[11px] text-muted-foreground/70"
            title={planGatePrompt}
          >
            {planGatePrompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onImplement(false)}
            className="rounded-[8px] border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors duration-100 hover:bg-primary/20"
          >
            Yes, implement
          </button>
          <button
            onClick={() => onImplement(true)}
            className="rounded-[8px] border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-400/90 transition-colors duration-100 hover:bg-amber-500/20"
            title="Clears the current context window before implementing"
          >
            Clear context &amp; implement
          </button>
          <button
            onClick={() => onCancel()}
            className="rounded-[8px] border border-[#2F2F2F] bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors duration-100 hover:bg-[hsl(var(--muted))]/50 hover:text-foreground"
          >
            No, stay in plan mode
          </button>
        </div>
      </div>
    </div>
  );
};
