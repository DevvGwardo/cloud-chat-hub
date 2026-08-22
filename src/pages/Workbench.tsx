import React, { useState } from 'react';
import { PanelProvider } from '@/contexts/PanelContext';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/db';
import type { ToolCallRecords } from '@/stores/hermes-store';
import {
  STACK,
  SIDEBAR_TABS,
  SLICES,
  type SliceRecord,
  GATE_HISTORY,
  DEFECTS_FIXED,
  QA_SURFACES,
  QA_DEFERRED,
  QA_FIXED_SINCE_AUDIT,
  OVERNIGHT_BACKLOG,
  DOCS_INDEX,
  LIVE_COUNTS,
  MODULE_INVENTORY,
} from './workbench-data';

/**
 * Component Workbench — isolated renders of the chat surface's building
 * blocks (composer, message bubbles, welcome) for design review without
 * clicking through the full app. Dev-only route: /workbench.
 *
 * Not covered here (need live backends): context-ref autocomplete results,
 * command suggestions from the bridge catalog, voice input, image upload.
 */

type Section = 'blueprint' | 'progress' | 'composer' | 'messages' | 'welcome';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'progress', label: 'Progress' },
  { id: 'composer', label: 'Composer' },
  { id: 'messages', label: 'Messages' },
  { id: 'welcome', label: 'Welcome' },
];

// ── Sample data ────────────────────────────────────────────────────────────

function msg(id: string, role: 'user' | 'assistant', content: string, timestamp = '10:42 AM'): Message {
  return { id, conversationId: 'workbench', role, content, timestamp };
}

const USER_MSG = msg('wb-u1', 'user', 'Fix the failing login test and add a regression case for expired sessions');

const ASSISTANT_TEXT = msg('wb-a1', 'assistant', [
  'The login test was failing because the mock clock never advanced past the session TTL.',
  '',
  'I updated `auth.test.ts` to use fake timers and added the expired-session regression:',
  '',
  '```ts',
  "it('rejects a session older than the TTL', () => {",
  '  vi.advanceTimersByTime(SESSION_TTL + 1);',
  '  expect(validateSession(token)).toBeNull();',
  '});',
  '```',
  '',
  'Both tests pass — 829/829 green.',
].join('\n'));

const TOOL_INVOCATION_DONE = {
  toolCallId: 'wb-t1',
  toolName: 'edit_repo_file',
  args: { path: 'src/auth.test.ts' },
  state: 'result' as const,
  result: { ok: true },
};

const TOOL_INVOCATION_FAILED = {
  toolCallId: 'wb-t2',
  toolName: 'run_command',
  args: { command: 'npm test -- --filter auth' },
  state: 'result' as const,
  result: 'Error: expected 200, received 401',
};

const TOOL_RECORDS = {
  'wb-t1': {
    callId: 'wb-t1',
    name: 'edit_repo_file',
    status: 'completed' as const,
    outputChunks: [],
    output: 'Applied 2 hunks to src/auth.test.ts',
    exitCode: 0,
    durationMs: 1840,
    outputTruncated: false,
    outputTruncatedLines: 0,
  },
  'wb-t2': {
    callId: 'wb-t2',
    name: 'run_command',
    status: 'failed' as const,
    outputChunks: [],
    output: 'Error: expected 200, received 401',
    exitCode: 1,
    durationMs: 920,
    outputTruncated: false,
    outputTruncatedLines: 0,
  },
} satisfies ToolCallRecords;

const ASSISTANT_WITH_TOOLS = msg('wb-a2', 'assistant', 'Done — both tests pass now.');

const ASSISTANT_PARTS = [
  {
    type: 'reasoning' as const,
    reasoning:
      'The failing test asserts a 200 on login, but the mock session store returns the cached token without checking TTL. The fix: advance the fake clock past SESSION_TTL before the assertion, then add a dedicated regression test for the expired path.',
  },
  { type: 'tool-invocation' as const, toolInvocation: TOOL_INVOCATION_DONE },
  { type: 'text' as const, text: 'Both tests pass — 829/829 green.' },
];

const FAILED_TOOL_PARTS = [
  { type: 'tool-invocation' as const, toolInvocation: TOOL_INVOCATION_FAILED },
  { type: 'text' as const, text: 'The command failed — the auth filter name changed in the vitest config. Retrying with the right pattern.' },
];

// ── Blueprint section ──────────────────────────────────────────────────────

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 px-3 py-2.5">
      <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function BlueprintSection() {
  const inv = MODULE_INVENTORY;
  const componentDirs = Object.entries(inv.components).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCard title="At a glance">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <Stat value={STACK.length} label="Stack layers" />
          <Stat value={SIDEBAR_TABS.length} label="Sidebar panels" />
          <Stat value={LIVE_COUNTS.totalModules} label="Source modules" />
          <Stat value={LIVE_COUNTS.frontendSuites + LIVE_COUNTS.serverSuites} label="JS test suites" />
          <Stat value={LIVE_COUNTS.bridgeTestFiles} label="Bridge test files" />
          <Stat value="v1.0.0-beta.8" label="Version" />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Stack">
        <div className="space-y-2">
          {STACK.map((layer) => (
            <div key={layer.id} className="rounded-lg border border-border/50 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">{layer.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{layer.entry}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-primary/80">{layer.tech}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{layer.role}</p>
            </div>
          ))}
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Feature surface — Hermes sidebar sub-tabs">
        <div className="flex flex-wrap gap-1.5">
          {SIDEBAR_TABS.map((tab) => (
            <span
              key={tab}
              className="rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              {tab}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          18 panels driven by <code className="font-mono">HERMES_SUB_TABS</code> in ChatSidebar — each backed by a
          Hermes*Panel component and a bridge endpoint.
        </p>
      </WorkbenchCard>

      <WorkbenchCard title="Module inventory (live counts)">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">hooks</span>
            <span className="font-mono tabular-nums">{inv.hooks}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">stores</span>
            <span className="font-mono tabular-nums">{inv.stores}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">lib</span>
            <span className="font-mono tabular-nums">{inv.lib}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">pages</span>
            <span className="font-mono tabular-nums">{inv.pages}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">contexts</span>
            <span className="font-mono tabular-nums">{inv.contexts}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">mobile</span>
            <span className="font-mono tabular-nums">{inv.mobile}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {componentDirs.map(([dir, count]) => (
            <span key={dir} className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {dir.replace('components/', '')}: {count}
            </span>
          ))}
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Docs index">
        <div className="space-y-1.5">
          {DOCS_INDEX.map((doc) => (
            <div key={doc.path} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
              <code className="shrink-0 font-mono text-[11px] text-primary/80">{doc.path}</code>
              <span className="text-[11px] text-muted-foreground">{doc.role}</span>
            </div>
          ))}
        </div>
      </WorkbenchCard>
    </div>
  );
}

// ── Progress section ───────────────────────────────────────────────────────

const KIND_STYLES: Record<SliceRecord['kind'], string> = {
  perf: 'bg-sky-500/15 text-sky-400',
  lint: 'bg-violet-500/15 text-violet-400',
  tests: 'bg-emerald-500/15 text-emerald-400',
  defect: 'bg-red-500/15 text-red-400',
};

const KIND_LABEL: Record<SliceRecord['kind'], string> = {
  perf: 'perf',
  lint: 'lint',
  tests: 'tests',
  defect: 'defect',
};

function ProgressSection() {
  const first = GATE_HISTORY[0];
  const last = GATE_HISTORY[GATE_HISTORY.length - 1];
  const pyFirst = GATE_HISTORY.find((g) => g.pyTests !== undefined)?.pyTests ?? 0;
  const pyLast = last.pyTests ?? 0;
  const totalPyDelta = SLICES.reduce((sum, s) => sum + (s.pyDelta ?? 0), 0);
  const defectCount = SLICES.filter((s) => s.kind === 'defect').length;

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCard title="Improvement loop — outcome">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={`${first.lintWarnings} → ${last.lintWarnings}`} label="Lint warnings" />
          <Stat value={`${first.npmTests} → ${last.npmTests}`} label="JS tests" />
          <Stat value={`${pyFirst || '—'} → ${pyLast || '—'}`} label="Bridge tests" />
          <Stat value={defectCount} label="Real defects fixed" />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          32 slices in one day (2026-08-22), each spec'd → built → gate-verified → recorded in
          <code className="mx-1 font-mono">docs/HANDOFF.md</code>. Bridge suite grew
          +{totalPyDelta} tests across the loop; seven real defects found and fixed.
          The eighth (stale provider pins → OpenRouter 400s) landed after the loop stopped.
        </p>
      </WorkbenchCard>

      <WorkbenchCard title="Gate history">
        <div className="space-y-1.5">
          {GATE_HISTORY.map((gate) => (
            <div key={gate.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/30 px-3 py-2 text-xs">
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{gate.label}</span>
              <span className="text-muted-foreground">
                lint <span className={cn('font-mono tabular-nums', gate.lintWarnings === 0 && 'text-emerald-400')}>{gate.lintWarnings}</span>
              </span>
              <span className="text-muted-foreground">
                js tests <span className="font-mono tabular-nums text-foreground">{gate.npmTests}</span>
              </span>
              {gate.pyTests !== undefined && (
                <span className="text-muted-foreground">
                  py tests <span className="font-mono tabular-nums text-foreground">{gate.pyTests}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </WorkbenchCard>

      <WorkbenchCard title={`Slice timeline (${SLICES.length} slices)`}>
        <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {SLICES.map((slice) => (
            <div key={slice.n} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
              <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/60">
                #{slice.n}
              </span>
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', KIND_STYLES[slice.kind])}>
                {KIND_LABEL[slice.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">{slice.title}</span>
              {slice.pyDelta !== undefined && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-emerald-400/80">+{slice.pyDelta} py</span>
              )}
              {slice.npmDelta !== undefined && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-emerald-400/80">+{slice.npmDelta} js</span>
              )}
              {slice.commit && (
                <code className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/60 sm:inline">{slice.commit}</code>
              )}
            </div>
          ))}
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Defects found & fixed by the loop">
        <ol className="list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
          {DEFECTS_FIXED.map((defect, i) => (
            <li key={i} className="leading-relaxed">{defect}</li>
          ))}
        </ol>
      </WorkbenchCard>

      <WorkbenchCard title="QA audit ledger — 12 surfaces, all audited">
        <div className="space-y-1.5">
          {QA_SURFACES.map((surface) => {
            const total = surface.findings.med + surface.findings.low;
            return (
              <div key={surface.surface} className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-foreground/90">{surface.surface}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {total === 0 ? 'clean' : `${surface.findings.med} med · ${surface.findings.low} low`}
                </span>
                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
                  audited
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400/80">
            Fixed since the audit
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {QA_FIXED_SINCE_AUDIT.map((item, i) => (
              <li key={i} className="leading-relaxed">{item}</li>
            ))}
          </ul>
        </div>
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Deferred to human review (MED)
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-muted-foreground">
            {QA_DEFERRED.map((item, i) => (
              <li key={i} className="leading-relaxed">{item}</li>
            ))}
          </ul>
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Overnight backlog">
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded bg-emerald-500/15 px-2 py-1 font-mono text-[11px] text-emerald-400">
            {OVERNIGHT_BACKLOG.done}/{OVERNIGHT_BACKLOG.done + OVERNIGHT_BACKLOG.open} shipped
          </span>
          <span className="text-muted-foreground">
            {OVERNIGHT_BACKLOG.open === 0 ? 'Queue empty — every backlog item shipped with a proving test.' : `${OVERNIGHT_BACKLOG.open} items remaining`}
          </span>
        </div>
      </WorkbenchCard>
    </div>
  );
}

// ── Section shells ─────────────────────────────────────────────────────────

function ComposerSection() {
  const [value, setValue] = useState('Fix the failing login test');

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCard title="Composer · idle">
        <div className="mx-auto w-full max-w-[720px] pb-2">
          <ChatInput
            value={value}
            onChange={setValue}
            onSend={() => {}}
            isStreaming={false}
          />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Composer · streaming">
        <div className="mx-auto w-full max-w-[720px] pb-2">
          <ChatInput
            value="Add a regression test for expired sessions"
            onChange={() => {}}
            onSend={() => {}}
            onStop={() => {}}
            isStreaming
            toolCallCount={3}
            agentStatusLabel="Editing src/auth.test.ts"
            streamStartedAt={Date.now() - 42_000}
          />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Composer · disabled">
        <div className="mx-auto w-full max-w-[720px] pb-2">
          <ChatInput
            value=""
            onChange={() => {}}
            onSend={() => {}}
            isStreaming={false}
            disabled
            disabledPlaceholder="Another panel is streaming on this profile"
          />
        </div>
      </WorkbenchCard>
    </div>
  );
}

function MessagesSection() {
  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCard title="User message (chip elevation)">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <MessageBubble
            message={USER_MSG}
            onEdit={() => {}}
          />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Assistant · text + code block">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <MessageBubble message={ASSISTANT_TEXT} onRegenerate={() => {}} />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Assistant · reasoning + quiet tool row">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <MessageBubble
            message={ASSISTANT_WITH_TOOLS}
            parts={ASSISTANT_PARTS}
            toolCallRecords={{ 'wb-a2': TOOL_RECORDS['wb-t1'] }}
          />
        </div>
      </WorkbenchCard>

      <WorkbenchCard title="Assistant · failed tool + retry">
        <div className="mx-auto max-w-[720px] px-4 py-3">
          <MessageBubble
            message={ASSISTANT_WITH_TOOLS}
            parts={FAILED_TOOL_PARTS}
            toolCallRecords={{ 'wb-a2': TOOL_RECORDS['wb-t2'] }}
            onRetryTool={() => {}}
          />
        </div>
      </WorkbenchCard>
    </div>
  );
}

function WelcomeSection() {
  return (
    <WorkbenchCard title="Welcome screen (empty conversation)">
      <div className="h-[560px] overflow-hidden rounded-lg border border-border/40">
        <WelcomeScreen />
      </div>
    </WorkbenchCard>
  );
}

// ── Shell ──────────────────────────────────────────────────────────────────

function WorkbenchCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card/40 p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ThemeSwitch() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const modes: ThemeMode[] = ['light', 'dark'];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 p-0.5">
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => setTheme(mode)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
            theme === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

const WORKBENCH_PANEL_ID = 'workbench';

export default function Workbench() {
  const [section, setSection] = useState<Section>('composer');

  return (
    <PanelProvider value={WORKBENCH_PANEL_ID}>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-background/90 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-semibold text-muted-foreground">workbench</span>
            <nav className="flex items-center gap-1">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    section === s.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </div>
          <ThemeSwitch />
        </header>

        <main className="mx-auto max-w-[900px] px-4 py-6">
          {section === 'blueprint' && <BlueprintSection />}
          {section === 'progress' && <ProgressSection />}
          {section === 'composer' && <ComposerSection />}
          {section === 'messages' && <MessagesSection />}
          {section === 'welcome' && <WelcomeSection />}
        </main>
      </div>
    </PanelProvider>
  );
}
