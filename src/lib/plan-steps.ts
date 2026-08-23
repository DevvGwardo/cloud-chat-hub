import type { PlanStep } from '@/stores/chat-store';

/** Glyph for a plan step status: ✔ done, ⠋ in flight, □ pending. */
export function planStepGlyph(status: PlanStep['status']): string {
  switch (status) {
    case 'completed':
      return '✔';
    case 'in_progress':
      return '⠋';
    default:
      return '□';
  }
}

/** Row classes per status: completed = crossed out + dim, in-progress = cyan bold. */
export function planStepRowClass(status: PlanStep['status']): string {
  switch (status) {
    case 'completed':
      return 'text-muted-foreground/50 line-through';
    case 'in_progress':
      return 'text-cyan-400 font-semibold';
    default:
      return 'text-muted-foreground/60';
  }
}

/** Markdown header naming a plan, e.g. "## Implementation Plan". */
const PLAN_HEADER_RE = /(?:^|\n)\s*#{1,6}\s+[^\n]*\bplan\b[^\n]*$/im;
/** A "Plan:" / "**Plan** —" label line. */
const PLAN_LABEL_RE = /(?:^|\n)\s*(?:\*\*)?plan(?:\*\*)?\s*[:\-—]/im;
/** Bullet or numbered list item at line start. */
const LIST_ITEM_RE = /(?:^|\n)\s*(?:[*-]|\d+[.)])\s+\S/g;

/**
 * Heuristic for "this assistant text is an implementation plan" — used by the
 * plan-gate flow to decide when to park the finished plan-mode response for
 * user consent. True when the text carries a markdown header naming a plan, a
 * "Plan:" label, or a structured list of at least two items (the plan-mode
 * system prompt asks for a header like "## Implementation Plan"). Pure helper
 * so the gate logic in useChat stays testable without a render.
 */
export function looksLikePlanText(text: string): boolean {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return false;
  }
  const body = text.trim();
  if (PLAN_HEADER_RE.test(body) || PLAN_LABEL_RE.test(body)) {
    return true;
  }
  const items = body.match(LIST_ITEM_RE) ?? [];
  return items.length >= 2;
}
