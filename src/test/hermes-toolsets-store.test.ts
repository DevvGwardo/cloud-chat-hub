import { describe, expect, it } from 'vitest';
import { useHermesStore } from '@/stores/hermes-store';

describe('hermes-store toolset defaults', () => {
  it('merges persisted toolsets with new clarify and context_engine keys', () => {
    const merged = useHermesStore.persist.getOptions().merge?.(
      {
        toolsets: {
          web: true,
          browser: false,
          vision: true,
          computer: true,
          terminal: true,
          files: true,
          code_execution: true,
          delegation: false,
        },
      },
      useHermesStore.getState(),
    );

    expect(merged?.toolsets.clarify).toBe(true);
    expect(merged?.toolsets.context_engine).toBe(false);
    expect(merged?.toolsets.video).toBe(false);
    expect(merged?.toolsets.video_gen).toBe(false);
    expect(merged?.toolsets.browser).toBe(false);
    expect(merged?.toolsets.delegation).toBe(false);
  });

  it('includes clarify and context_engine in enabled toolsets when toggled on', () => {
    useHermesStore.setState({
      toolsets: {
        web: false,
        browser: false,
        vision: false,
        computer: false,
        terminal: false,
        files: false,
        code_execution: false,
        delegation: false,
        clarify: true,
        context_engine: true,
      },
    });

    const enabled = useHermesStore.getState().getEnabledToolsets();
    expect(enabled).toContain('clarify');
    expect(enabled).toContain('context_engine');
  });

  it('includes video toolsets when toggled on', () => {
    useHermesStore.setState({
      toolsets: {
        web: false,
        browser: false,
        vision: false,
        computer: false,
        terminal: false,
        files: false,
        code_execution: false,
        delegation: false,
        clarify: false,
        context_engine: false,
        video: true,
        video_gen: true,
      },
    });

    const enabled = useHermesStore.getState().getEnabledToolsets();
    expect(enabled).toContain('video');
    expect(enabled).toContain('video_gen');
  });
});
