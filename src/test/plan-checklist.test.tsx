import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlanChecklist } from '@/components/chat/PlanChecklist';
import { looksLikePlanText, planStepGlyph, planStepRowClass } from '@/lib/plan-steps';
import { useChatStore, type PlanStep } from '@/stores/chat-store';

beforeEach(() => {
  useChatStore.setState({ planSteps: null, planGatePrompt: null });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ planSteps: null, planGatePrompt: null });
});

describe('planStepGlyph / planStepRowClass', () => {
  it('maps statuses to glyphs', () => {
    expect(planStepGlyph('completed')).toBe('✔');
    expect(planStepGlyph('in_progress')).toBe('⠋');
    expect(planStepGlyph('pending')).toBe('□');
  });

  it('maps statuses to row classes', () => {
    expect(planStepRowClass('completed')).toContain('line-through');
    expect(planStepRowClass('completed')).toContain('text-muted-foreground/50');
    expect(planStepRowClass('in_progress')).toContain('text-cyan-400');
    expect(planStepRowClass('in_progress')).toContain('font-semibold');
    expect(planStepRowClass('pending')).toContain('text-muted-foreground/60');
    expect(planStepRowClass('pending')).not.toContain('line-through');
  });
});

describe('looksLikePlanText (plan-gate detector)', () => {
  it('accepts a markdown plan header', () => {
    expect(looksLikePlanText('## Implementation Plan\n\n1. Refactor retry\n2. Add tests')).toBe(true);
    expect(looksLikePlanText('Some intro\n\n### Plan\n\n- step one\n- step two')).toBe(true);
  });

  it('accepts a "Plan:" label line', () => {
    expect(looksLikePlanText('Plan: rewrite the approval engine')).toBe(true);
    expect(looksLikePlanText('**Plan** — swap the transport')).toBe(true);
  });

  it('accepts a structured list of at least two items', () => {
    expect(looksLikePlanText('- explore\n- propose')).toBe(true);
    expect(looksLikePlanText('1. a\n2. b\n3. c')).toBe(true);
  });

  it('rejects casual prose without plan markers', () => {
    expect(looksLikePlanText('I could not find anything worth changing.')).toBe(false);
    expect(looksLikePlanText('The repo looks clean and well tested.')).toBe(false);
    expect(looksLikePlanText('')).toBe(false);
    expect(looksLikePlanText('   ')).toBe(false);
  });

  it('rejects a single bullet (not a plan)', () => {
    expect(looksLikePlanText('- just one note')).toBe(false);
  });
});

describe('PlanChecklist', () => {
  const steps: PlanStep[] = [
    { step: 'Write the integration test', status: 'completed' },
    { step: 'Run the full suite', status: 'in_progress' },
    { step: 'Open the pull request', status: 'pending' },
  ];

  it('renders nothing when there is no plan and no prompt', () => {
    const { container } = render(<PlanChecklist />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the prompt alone when there are no steps', () => {
    useChatStore.setState({ planGatePrompt: 'Proposed plan for the retry logic.' });
    render(<PlanChecklist />);
    expect(screen.getByText('Proposed plan for the retry logic.')).toBeTruthy();
  });

  it('renders the checklist with per-status styling', () => {
    useChatStore.setState({ planSteps: steps, planGatePrompt: 'Proposed plan for the retry logic.' });
    const { container } = render(<PlanChecklist />);

    // Prompt sits above the list.
    expect(screen.getByText('Proposed plan for the retry logic.')).toBeTruthy();

    // All three step texts render.
    expect(screen.getByText('Write the integration test')).toBeTruthy();
    expect(screen.getByText('Run the full suite')).toBeTruthy();
    expect(screen.getByText('Open the pull request')).toBeTruthy();

    // Glyphs render per status.
    const glyphs = Array.from(container.querySelectorAll('li span[aria-hidden="true"]')).map((el) => el.textContent);
    expect(glyphs).toEqual(['✔', '⠋', '□']);

    // Completed row is crossed out, in-progress row is cyan + bold.
    const completedRow = screen.getByLabelText(/Plan step 1: Write the integration test \(completed\)/);
    expect(completedRow.className).toContain('line-through');
    const inProgressRow = screen.getByLabelText(/Plan step 2: Run the full suite \(in_progress\)/);
    expect(inProgressRow.className).toContain('text-cyan-400');
    expect(inProgressRow.className).toContain('font-semibold');
  });
});
