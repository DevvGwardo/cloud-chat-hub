import { type ProviderProps, type StepType } from '@reactour/tour';
import { TourStep } from './TourStep';

export const appTourSteps: StepType[] = [
  {
    selector: '[data-tour="threads-list"]',
    // The target is a flex-1, full-height container, so auto-placement puts the
    // popover above it and it clips off the top of the window. Anchor it to the
    // right of the sidebar, vertically centered on the (tall) list, instead.
    position: 'right',
    content: (
      <TourStep
        title="Threads, grouped by project"
        body="Your conversations live here — automatically grouped into collapsible sections by the GitHub repo each thread is working on. Pinned threads stay on top."
      />
    ),
  },
  {
    selector: '[data-tour="repo-footer"]',
    // Sits at the very bottom of the sidebar — place the popover above it so it
    // doesn't clip off the bottom edge.
    position: 'top',
    content: (
      <TourStep
        title="Connect GitHub"
        body="Attach a repository so the agent can read and edit real code. If you haven't added a token yet, this takes you straight to GitHub settings to connect."
      />
    ),
  },
  {
    selector: '[data-tour="subtab-nav"]',
    position: 'right',
    content: (
      <TourStep
        title="Board, Sessions & more"
        body={
          <>
            Switch between Threads, the <span className="font-medium text-[hsl(var(--text-primary))]">Board</span> (a
            full Kanban view of your tasks that can open fullscreen), Sessions, and other tools right here.
          </>
        }
      />
    ),
  },
  {
    selector: '[data-tour="composer"]',
    // Bottom-anchored input bar — keep the popover above it.
    position: 'top',
    content: (
      <TourStep
        title="Build something"
        body={
          <>
            Describe what you want and hand it off. Toggle <span className="font-medium text-[hsl(var(--text-primary))]">Plan</span>{' '}
            mode for read-only exploration, or open the terminal and mini-browser from the top bar.
          </>
        }
      />
    ),
  },
];

// Theme the popover + mask to match the dark, high-contrast aesthetic.
export const tourStyles: NonNullable<ProviderProps['styles']> = {
  popover: (base) => ({
    ...base,
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    borderRadius: 14,
    border: '1px solid hsl(var(--border))',
    // Subtle top-rim highlight + deep ambient shadow for modern, lifted depth.
    boxShadow: '0 1px 0 0 hsl(var(--primary) / 0.12) inset, 0 18px 50px -12px rgba(0,0,0,0.6)',
    padding: '14px 16px 14px',
    maxWidth: 320,
    '--reactour-accent': 'hsl(var(--primary))',
  }),
  maskArea: (base) => ({ ...base, rx: 12 }),
  maskWrapper: (base) => ({ ...base, color: 'rgba(0,0,0,0.62)' }),
  badge: (base) => ({
    ...base,
    background: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
    fontSize: 11,
  }),
  dot: (base, state) => ({
    ...base,
    background: state?.current ? 'hsl(var(--primary))' : 'hsl(var(--border))',
    border: 'none',
  }),
  close: (base) => ({ ...base, color: 'hsl(var(--muted-foreground))', top: 10, right: 10, width: 9, height: 9 }),
};
