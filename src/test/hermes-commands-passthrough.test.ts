import { describe, expect, it, vi } from 'vitest';
import { COMPRESS_CONTEXT_MESSAGE, findCommand } from '@/lib/hermes-commands';

describe('hermes agent command passthrough', () => {
  it.each(['moa', 'goal', 'rollback'] as const)(
    '/%s has no local handler (forwards to Hermes)',
    (name) => {
      const cmd = findCommand(name);
      expect(cmd).toBeDefined();
      expect(cmd?.kind).toBe('agent');
      expect(cmd?.handler).toBeUndefined();
    },
  );
});

describe('/compress local handler', () => {
  it('invokes compressContext callback', async () => {
    const cmd = findCommand('compress');
    expect(cmd?.handler).toBeDefined();

    let invoked = false;
    const result = await cmd!.handler!('', {
      setActiveSubTab: () => {},
      setActiveTab: () => {},
      setMiniBrowserOpen: () => {},
      setMiniBrowserUrl: () => {},
      compressContext: () => {
        invoked = true;
      },
    });

    expect(invoked).toBe(true);
    expect(result).toBe('Compressing context...');
  });

  it('uses the standardized compress prompt text', () => {
    expect(COMPRESS_CONTEXT_MESSAGE.toLowerCase()).toContain('compress');
    expect(COMPRESS_CONTEXT_MESSAGE).toContain('/compress');
  });
});

describe('/resume local handler', () => {
  const baseContext = {
    setActiveSubTab: () => {},
    setActiveTab: () => {},
    setMiniBrowserOpen: () => {},
    setMiniBrowserUrl: () => {},
  };

  it('invokes resumeSession callback with no args for most recent', async () => {
    const cmd = findCommand('resume');
    expect(cmd?.handler).toBeDefined();

    const resumeSession = vi.fn().mockResolvedValue('Attached Hermes session "Fix auth" (sess-abc…). Next message continues that session.');
    const result = await cmd!.handler!('', {
      ...baseContext,
      resumeSession,
    });

    expect(resumeSession).toHaveBeenCalledWith(undefined);
    expect(result).toContain('Attached Hermes session');
  });

  it('passes session id args to resumeSession', async () => {
    const cmd = findCommand('resume');
    const resumeSession = vi.fn().mockResolvedValue('Attached Hermes session "Fix auth" (sess-abc123). Next message continues that session.');
    await cmd!.handler!('sess-abc123', {
      ...baseContext,
      resumeSession,
    });

    expect(resumeSession).toHaveBeenCalledWith('sess-abc123');
  });

  it('returns callback unavailable when resumeSession is missing', async () => {
    const cmd = findCommand('resume');
    const result = await cmd!.handler!('', baseContext);
    expect(result).toBe('This command is not available in the current context.');
  });

  it('surfaces resumeSession errors', async () => {
    const cmd = findCommand('resume');
    const result = await cmd!.handler!('missing', {
      ...baseContext,
      resumeSession: vi.fn().mockRejectedValue(new Error('No Hermes session found matching "missing"')),
    });
    expect(result).toBe('No Hermes session found matching "missing"');
  });
});
