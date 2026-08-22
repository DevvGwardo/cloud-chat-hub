/**
 * Workbench blueprint data — a structured snapshot of the Spark project:
 * stack, module inventory, improvement-loop progress, and QA ledger.
 *
 * SOURCES OF TRUTH (kept in sync by hand when they change; the numbers here
 * were measured against the working tree on 2026-08-22):
 * - docs/HANDOFF.md   — slice timeline + gate history (improvement loop)
 * - docs/SLICE.md     — the currently-spec'd slice
 * - docs/qa-audit.md  — QA findings ledger
 * - docs/overnight-backlog.md — overnight feature backlog
 *
 * Counts marked "live" are computed at runtime from Vite's import.meta.glob,
 * so they can't drift. Everything else is a curated snapshot.
 */

// ── Live counts (computed at runtime — cannot drift) ──────────────────────

const srcModules = import.meta.glob('/src/**/*.{ts,tsx}', { eager: false });
const bridgeTests = import.meta.glob('/hermes-bridge/test_*.py', {
  query: '?raw',
  import: 'default',
});

function countByDirectory(paths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    const match = p.match(/^\/src\/(?:components\/)?([^/]+)\//);
    const key = match ? `components/${match[1]}` : p.split('/')[2] || 'src root';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export const LIVE_COUNTS = (() => {
  const allSrc = Object.keys(srcModules).filter((p) => !/\.test\.(ts|tsx)$/.test(p));
  const frontendSuites = Object.keys(import.meta.glob('/src/test/*.test.{ts,tsx}')).length;
  const serverSuites = Object.keys(import.meta.glob('/server/__tests__/*.test.ts')).length;
  return {
    totalModules: allSrc.length,
    bridgeTestFiles: Object.keys(bridgeTests).length,
    frontendSuites,
    serverSuites,
  };
})();

export const MODULE_INVENTORY = (() => {
  const paths = Object.keys(srcModules).filter((p) => !/\.test\.(ts|tsx)$/.test(p) && !/\/test\//.test(p));
  const components = countByDirectory(paths.filter((p) => p.startsWith('/src/components/')));
  return {
    components,
    hooks: paths.filter((p) => p.startsWith('/src/hooks/')).length,
    stores: paths.filter((p) => p.startsWith('/src/stores/')).length,
    lib: paths.filter((p) => p.startsWith('/src/lib/')).length,
    pages: paths.filter((p) => p.startsWith('/src/pages/')).length,
    contexts: paths.filter((p) => p.startsWith('/src/contexts/')).length,
    mobile: paths.filter((p) => p.startsWith('/src/mobile/')).length,
  };
})();

// ── Stack map ──────────────────────────────────────────────────────────────

export interface StackLayer {
  id: string;
  name: string;
  tech: string;
  role: string;
  /** Dev ports / entry points. */
  entry: string;
}

export const STACK: StackLayer[] = [
  {
    id: 'electron',
    name: 'Electron shell',
    tech: 'Electron + electron-vite',
    role: 'Windows desktop app: tray, auto-updater, OAuth (OpenRouter), embedded server, bridge lifecycle',
    entry: 'npm run dev:electron · electron/',
  },
  {
    id: 'frontend',
    name: 'Frontend',
    tech: 'React 19 + TypeScript + Vite + Tailwind',
    role: 'Chat surface, sidebar sub-tabs (18 Hermes panels), settings, kanban, rooms, mobile shell (/m)',
    entry: ':8080 · src/',
  },
  {
    id: 'server',
    name: 'API server',
    tech: 'Express + tsx/tsup',
    role: 'Chat proxy + agent loop, approval engine, GitHub integration, kanban/team orchestrators, tunnels, transcribe',
    entry: ':3001 · server/',
  },
  {
    id: 'bridge',
    name: 'Hermes bridge',
    tech: 'Python FastAPI',
    role: 'Bridge to the Hermes agent: ACP transport (real agent), agent-loop fallback, gateway runs, MoA, provider routing',
    entry: ':3002 · hermes-bridge/',
  },
];

// ── Sidebar sub-tabs (the app's feature surface) ───────────────────────────

export const SIDEBAR_TABS = [
  'Overview', 'Threads', 'Queue', 'Sessions', 'Profiles', 'Cron', 'Memories',
  'Skills', 'Usage', 'Logs', 'Images', 'MCP', 'Board', 'Tasks', 'Rooms',
  'Teams', 'Webhooks', 'Pairing', 'System',
] as const;

// ── Distribution ───────────────────────────────────────────────────────────

/** Windows-only: no Apple Developer license, so no signed/notarized macOS builds. */
export const DISTRIBUTION = {
  platform: 'Windows 10/11 (x64)',
  installer: 'NSIS installer (Spark-<version>-win.exe)',
  signing: 'Authenticode when WIN_CSC_LINK is configured; unsigned otherwise',
  autoUpdate: 'GitHub releases (private repo, CLOUDCHAT_UPDATE_TOKEN)',
} as const;

// ── Improvement-loop progress ──────────────────────────────────────────────

export interface SliceRecord {
  n: number;
  title: string;
  kind: 'perf' | 'lint' | 'tests' | 'defect';
  /** Test-count delta for the frontend suite (npm test), if any. */
  npmDelta?: number;
  /** Test-count delta for the bridge suite (pytest), if any. */
  pyDelta?: number;
  commit?: string;
}

/** Curated from docs/HANDOFF.md Decision log (32 slices, one day of loop runs). */
export const SLICES: SliceRecord[] = [
  { n: 1, title: 'useMemo members in SwarmRoomPanel/useRoomChat', kind: 'perf', commit: '19f6d10' },
  { n: 2, title: 'Stable reload deps in MCP panels', kind: 'lint', commit: undefined },
  { n: 3, title: 'Missing stable deps across chat hooks', kind: 'lint', commit: undefined },
  { n: 4, title: 'exhaustive-deps class fully cleared', kind: 'lint', commit: undefined },
  { n: 5, title: 'Motion presets split; dead exports removed', kind: 'lint', commit: 'ad2b673' },
  { n: 6, title: 'Lint burn-down to ZERO warnings', kind: 'lint', commit: undefined },
  { n: 7, title: 'Provider-routing regression tests', kind: 'tests', npmDelta: 2, commit: undefined },
  { n: 8, title: 'Approval-engine edge cases', kind: 'tests', npmDelta: 7 },
  { n: 9, title: 'Room messages memoization', kind: 'perf' },
  { n: 10, title: 'cwd-OSError guards + httpx stub fix', kind: 'defect', pyDelta: 3 },
  { n: 11, title: 'Worktree edge cases', kind: 'tests', pyDelta: 14 },
  { n: 12, title: 'Gateway error extraction + parity edges', kind: 'tests', pyDelta: 13 },
  { n: 13, title: 'ACP transport test suite', kind: 'tests', pyDelta: 19 },
  { n: 14, title: 'Adapter helpers + module-clobber lesson', kind: 'tests', pyDelta: 11 },
  { n: 15, title: 'Bridge events translation + plan-mode None crash', kind: 'defect', pyDelta: 20 },
  { n: 16, title: 'Run-command PermissionError crash fix', kind: 'defect', pyDelta: 11 },
  { n: 17, title: 'Request-validation envelopes', kind: 'tests', pyDelta: 8 },
  { n: 18, title: 'Fallback-chain + base_url validation guards', kind: 'tests', pyDelta: 11 },
  { n: 19, title: 'Goals/tool-search config edges', kind: 'tests', pyDelta: 13 },
  { n: 20, title: 'Checkpoint garbage-files_changed crash fix', kind: 'defect', pyDelta: 14 },
  { n: 21, title: 'Delegation live path traversal guards', kind: 'tests', pyDelta: 16 },
  { n: 22, title: 'Cursor composer bridge health probes', kind: 'tests', pyDelta: 8 },
  { n: 23, title: 'Messaging platforms config/OAuth builders', kind: 'tests', pyDelta: 14 },
  { n: 24, title: 'Kanban tools contract pins', kind: 'tests', pyDelta: 18 },
  { n: 25, title: 'Team tools delegation contracts', kind: 'tests', pyDelta: 20 },
  { n: 26, title: 'MCP telemetry sanitization + snapshots', kind: 'tests', pyDelta: 15 },
  { n: 27, title: 'Brain cache circuit breaker', kind: 'tests', pyDelta: 18 },
  { n: 28, title: 'Challenge review-exercise behavior pins', kind: 'tests', pyDelta: 14 },
  { n: 29, title: 'Challenge script exercise pins (2 defects corrected)', kind: 'tests', pyDelta: 18 },
  { n: 30, title: 'Pricing rule precedence + cost math', kind: 'tests', pyDelta: 19 },
  { n: 31, title: 'MCP tool-loop integration + run_agent clobber pin', kind: 'defect', pyDelta: 7 },
  { n: 32, title: 'Computer-use frames pipeline coverage', kind: 'tests', pyDelta: 21, commit: 'ec3ba90' },
];

export interface GateSnapshot {
  label: string;
  lintWarnings: number;
  npmTests: number;
  pyTests?: number;
}

/** Frontend baseline → today (bridge numbers where recorded). */
export const GATE_HISTORY: GateSnapshot[] = [
  { label: 'Baseline', lintWarnings: 42, npmTests: 820 },
  { label: 'Slice 6', lintWarnings: 0, npmTests: 820 },
  { label: 'Slice 8', lintWarnings: 0, npmTests: 829 },
  { label: 'Slice 32', lintWarnings: 0, npmTests: 829, pyTests: 687 },
  { label: 'Today', lintWarnings: 0, npmTests: 829, pyTests: 679 },
];

/** Defects found and fixed by the loop (the "seven real defects" list). */
export const DEFECTS_FIXED = [
  'httpx stub missing exception classes broke combined test runs',
  'filter_toolsets_for_plan_mode(None) raised TypeError',
  'run-command PermissionError crashed instead of hinting',
  'gateway error-text gaps in runs rejection paths',
  'checkpoint listing crashed on garbage files_changed values',
  'hermes_adapter import clobbers sys.modules["run_agent"]',
  'stale provider pins routed nous sessions to OpenRouter (fixed post-loop)',
] as const;

// ── QA audit ledger ────────────────────────────────────────────────────────

export interface QaSurface {
  surface: string;
  status: 'done';
  findings: { blocker: number; high: number; med: number; low: number };
}

export const QA_SURFACES: QaSurface[] = [
  { surface: 'Chat core', status: 'done', findings: { blocker: 0, high: 0, med: 2, low: 6 } },
  { surface: 'Sidebar', status: 'done', findings: { blocker: 0, high: 0, med: 1, low: 4 } },
  { surface: 'Settings', status: 'done', findings: { blocker: 0, high: 0, med: 1, low: 2 } },
  { surface: 'Setup + Onboarding', status: 'done', findings: { blocker: 0, high: 0, med: 1, low: 3 } },
  { surface: 'Terminal', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 2 } },
  { surface: 'Browser + Preview', status: 'done', findings: { blocker: 0, high: 0, med: 1, low: 2 } },
  { surface: 'GitHub', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 1 } },
  { surface: 'Kanban + Workflow', status: 'done', findings: { blocker: 0, high: 0, med: 1, low: 1 } },
  { surface: 'Rooms + MCP', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 2 } },
  { surface: 'Mobile surfaces', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 1 } },
  { surface: 'Layout + Electron', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 0 } },
  { surface: 'UI primitives', status: 'done', findings: { blocker: 0, high: 0, med: 0, low: 0 } },
];

/** MED items deferred to human review (from qa-audit.md). */
export const QA_DEFERRED = [
  // Fixed since the audit:
  // - Sidebar thread search → ConversationSearchBar wired into ChatSidebar
  // - Composer Attach button → file input + paste upload wired
  // - User-message Edit → onEdit={handleEditAction} wired in ChatArea
  'Settings → Knowledge tab shows fabricated mock data with dead buttons (needs product decision: real backend or cut the tab)',
] as const;

/**
 * QA findings fixed after the audit — kept visible so the workbench reflects
 * current state, not just the historical ledger.
 */
export const QA_FIXED_SINCE_AUDIT = [
  'Sidebar thread search — ConversationSearchBar wired into ChatSidebar',
  'Composer Attach button — file input + paste-to-upload wired',
  'User-message Edit — onEdit={handleEditAction} wired in ChatArea',
  '"Rename thread" window.prompt() (Electron no-op) — inline rename in header menus',
  'Settings modal dialog semantics — role/aria-modal, Escape, focus trap, focus restore',
  'Toast announcements — always-mounted aria-live region with alert role for errors',
] as const;

/** Overnight backlog: 6 shipped, queue empty. */
export const OVERNIGHT_BACKLOG = { done: 6, open: 0 } as const;

// ── Docs & specs ───────────────────────────────────────────────────────────

export const DOCS_INDEX = [
  { path: 'docs/HANDOFF.md', role: 'Improvement-loop shared memory: decisions, raw gate results, slice records' },
  { path: 'docs/SLICE.md', role: 'The currently-spec\'d slice (architect writes, builder executes)' },
  { path: 'docs/LOOP_PROMPT.md', role: 'The loop\'s constitution: ground rules + per-cycle procedure' },
  { path: 'docs/qa-audit.md', role: 'QA audit ledger: 12 surfaces audited, 41 findings logged' },
  { path: 'docs/overnight-backlog.md', role: 'Overnight feature backlog: 6/6 shipped, queue empty' },
  { path: 'docs/BETA-TESTING.md', role: 'Beta testing notes' },
  { path: 'docs/hermes-alignment-phase6-plan.md', role: 'Hermes alignment plan' },
  { path: 'docs/superpowers/', role: 'Design specs + plans (Electron design, provider design, parity)' },
] as const;
