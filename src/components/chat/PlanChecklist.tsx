import { useChatStore } from '@/stores/chat-store';
import { planStepGlyph, planStepRowClass } from '@/lib/plan-steps';

/**
 * Live plan checklist driven by the `planSteps` slice of the chat store
 * (backend `plan_update` events). Completed steps are crossed out and dim,
 * the in-progress step is cyan + bold, pending steps are dim. When a raw
 * `planGatePrompt` is set it renders above the list. Self-contained: no props.
 */
export const PlanChecklist: React.FC = () => {
  const planSteps = useChatStore((state) => state.planSteps);
  const planGatePrompt = useChatStore((state) => state.planGatePrompt);

  if (!planSteps || planSteps.length === 0) {
    return planGatePrompt ? (
      <div className="rounded-lg border border-[#2F2F2F] bg-[hsl(var(--card))]/60 px-3 py-2.5">
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{planGatePrompt}</p>
      </div>
    ) : null;
  }

  return (
    <div className="rounded-lg border border-[#2F2F2F] bg-[hsl(var(--card))]/60 px-3 py-2.5">
      {planGatePrompt && (
        <p
          className="mb-2 line-clamp-3 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground/70"
          title={planGatePrompt}
        >
          {planGatePrompt}
        </p>
      )}
      <ul className="space-y-1">
        {planSteps.map((step, index) => (
          <li
            key={`${step.status}-${index}`}
            className={`flex items-start gap-2 text-[12px] leading-snug ${planStepRowClass(step.status)}`}
            aria-label={`Plan step ${index + 1}: ${step.step} (${step.status})`}
          >
            <span
              className="mt-[1px] shrink-0 font-mono text-[11px]"
              aria-hidden="true"
            >
              {planStepGlyph(step.status)}
            </span>
            <span className="min-w-0 flex-1">{step.step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
