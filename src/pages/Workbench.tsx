import React, { useState } from 'react';
import { PanelProvider } from '@/contexts/PanelContext';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { useSettingsStore, type ThemeMode } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/db';
import type { ToolCallRecords } from '@/stores/hermes-store';

/**
 * Component Workbench — isolated renders of the chat surface's building
 * blocks (composer, message bubbles, welcome) for design review without
 * clicking through the full app. Dev-only route: /workbench.
 *
 * Not covered here (need live backends): context-ref autocomplete results,
 * command suggestions from the bridge catalog, voice input, image upload.
 */

type Section = 'composer' | 'messages' | 'welcome';

const SECTIONS: Array<{ id: Section; label: string }> = [
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
          {section === 'composer' && <ComposerSection />}
          {section === 'messages' && <MessagesSection />}
          {section === 'welcome' && <WelcomeSection />}
        </main>
      </div>
    </PanelProvider>
  );
}
