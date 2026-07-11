import { describe, expect, it } from 'vitest';
import {
  INITIAL_COMPUTER_USE_DOCK_STATE,
  isComputerUseToolName,
  parseComputerUseActionFromInput,
  parseComputerUseFrame,
  reduceComputerUseDockState,
  shouldShowComputerUseDock,
} from '@/lib/computer-use-dock';

describe('computer-use-dock', () => {
  it('detects computer use tool names', () => {
    expect(isComputerUseToolName('computer_use')).toBe(true);
    expect(isComputerUseToolName('browser')).toBe(false);
  });

  it('parses SSE computer_use_frame payloads', () => {
    const frame = parseComputerUseFrame({
      tool: 'computer_use',
      status: 'completed',
      action: 'capture · som · Safari',
      image: 'data:image/png;base64,abc',
    });
    expect(frame).toEqual({
      tool: 'computer_use',
      status: 'completed',
      action: 'capture · som · Safari',
      image: 'data:image/png;base64,abc',
    });
  });

  it('parses running frames without image', () => {
    const frame = parseComputerUseFrame({
      tool: 'computer_use',
      status: 'running',
      action: 'click · Notes · #2',
    });
    expect(frame).toEqual({
      tool: 'computer_use',
      status: 'running',
      action: 'click · Notes · #2',
    });
  });

  it('derives action labels from tool input JSON', () => {
    expect(
      parseComputerUseActionFromInput(JSON.stringify({ action: 'click', element: 2, app: 'Notes' })),
    ).toBe('click · Notes · #2');
  });

  it('opens dock on running computer_use activity', () => {
    const next = reduceComputerUseDockState(INITIAL_COMPUTER_USE_DOCK_STATE, {
      toolActivity: {
        tool: 'computer_use',
        status: 'running',
        input: JSON.stringify({ action: 'capture', mode: 'som' }),
      },
    });
    expect(next.active).toBe(true);
    expect(next.expanded).toBe(true);
    expect(next.action).toContain('capture');
    expect(shouldShowComputerUseDock(next, true)).toBe(true);
  });

  it('opens dock on running frame SSE without image', () => {
    const next = reduceComputerUseDockState(INITIAL_COMPUTER_USE_DOCK_STATE, {
      frame: {
        tool: 'computer_use',
        status: 'running',
        action: 'click · Safari · #1',
      },
    });
    expect(next.active).toBe(true);
    expect(next.status).toBe('running');
    expect(next.image).toBeNull();
    expect(shouldShowComputerUseDock(next, true)).toBe(true);
  });

  it('stores ephemeral frames without persistence hooks', () => {
    const withFrame = reduceComputerUseDockState(INITIAL_COMPUTER_USE_DOCK_STATE, {
      frame: {
        tool: 'computer_use',
        status: 'completed',
        action: 'capture · vision',
        image: 'data:image/png;base64,xyz',
      },
    });
    expect(withFrame.image).toBe('data:image/png;base64,xyz');
    const cleared = reduceComputerUseDockState(withFrame, { streamEnded: true });
    expect(cleared).toEqual(INITIAL_COMPUTER_USE_DOCK_STATE);
  });
});
