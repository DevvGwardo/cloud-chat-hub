import { describe, expect, it } from 'vitest';
import {
  formatFallbackSwitchToast,
  formatMissingRepoFileError,
  isFallbackSwitchData,
  parseFallbackSwitchDelta,
  synthesizeToolInvocationsForPersistence,
} from '@/hooks/chat-utils';

describe('chat-utils fallback switch', () => {
  it('parses structured fallback_switch deltas', () => {
    expect(parseFallbackSwitchDelta({ provider: 'openai', model: 'gpt-4.1-mini' })).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
  });

  it('rejects in-progress switch payloads without provider/model', () => {
    expect(parseFallbackSwitchDelta({ type: 'fallback_switch' })).toBeNull();
    expect(parseFallbackSwitchDelta(null)).toBeNull();
  });

  it('formats toast copy', () => {
    expect(formatFallbackSwitchToast({ provider: 'deepseek', model: 'deepseek-v4-flash' })).toBe(
      'Switched to deepseek/deepseek-v4-flash',
    );
  });

  it('recognizes normalized proxy data items', () => {
    expect(
      isFallbackSwitchData({ type: 'fallback_switch', provider: 'openrouter', model: 'anthropic/claude-sonnet-4' }),
    ).toBe(true);
    expect(isFallbackSwitchData({ type: 'agent_status', status: { label: 'x' } })).toBe(false);
  });
});

describe('chat-utils repo path recovery', () => {
  it('prefers examples from the same top-level area for missing repo paths', () => {
    const message = formatMissingRepoFileError('server/agent-loop.ts', [
      'README.md',
      'server/src/index.ts',
      'server/src/routes/cards.ts',
      'server/src/routes/metrics.ts',
    ]);

    expect(message).toContain('server/src/index.ts');
    expect(message).toContain('server/src/routes/cards.ts');
    expect(message).not.toContain('- README.md');
  });

  it('surfaces exact nested matches for guessed directory-like paths', () => {
    const message = formatMissingRepoFileError('server/routes', [
      'README.md',
      'server/src/index.ts',
      'server/src/routes/cards.ts',
      'server/src/routes/metrics.ts',
    ]);

    expect(message).toContain('Possible matches:');
    expect(message).toContain('server/src/routes/cards.ts');
  });
});

describe('chat-utils synthesized tool persistence', () => {
  it('carries structured enrichment (exitCode/durationMs/success) through persistence', () => {
    const invocations = synthesizeToolInvocationsForPersistence([
      {
        tool: 'run_command',
        status: 'completed',
        input: 'npm run build',
        output: 'built',
        exitCode: 1,
        durationMs: 2345,
        success: false,
      },
    ]);
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation.state).toBe('result');
    expect(invocation.result).toMatchObject({
      output: 'built',
      exitCode: 1,
      durationMs: 2345,
      success: false,
    });
  });

  it('omits enrichment fields when the activity has none (legacy streams)', () => {
    const invocations = synthesizeToolInvocationsForPersistence([
      { tool: 'run_command', status: 'completed', input: 'ls', output: 'src' },
    ]);
    expect(invocations[0].result).toEqual({ output: 'src' });
    expect(invocations[0].result).not.toHaveProperty('exitCode');
    expect(invocations[0].result).not.toHaveProperty('durationMs');
  });
});
