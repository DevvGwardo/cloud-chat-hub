export interface ComputerUseFrameEvent {
  tool: string;
  status: 'running' | 'completed';
  action: string;
  image?: string;
}

export interface ComputerUseDockState {
  active: boolean;
  expanded: boolean;
  action: string | null;
  status: 'running' | 'completed' | 'idle';
  image: string | null;
  stepCount: number;
  permissionsHint: string | null;
}

export const INITIAL_COMPUTER_USE_DOCK_STATE: ComputerUseDockState = {
  active: false,
  expanded: false,
  action: null,
  status: 'idle',
  image: null,
  stepCount: 0,
  permissionsHint: null,
};

const COMPUTER_USE_TOOLS = new Set(['computer_use', 'computer']);

export function isComputerUseToolName(tool: string | null | undefined): boolean {
  if (!tool) return false;
  return COMPUTER_USE_TOOLS.has(tool.toLowerCase());
}

export function parseComputerUseFrame(value: unknown): ComputerUseFrameEvent | null {
  if (!value || typeof value !== 'object') return null;
  const frame = value as Record<string, unknown>;
  const tool = typeof frame.tool === 'string' ? frame.tool : '';
  if (!isComputerUseToolName(tool)) return null;
  const action = typeof frame.action === 'string' ? frame.action.trim() : '';
  if (!action) return null;
  const status = frame.status === 'completed' ? 'completed' : 'running';
  const image = typeof frame.image === 'string' && frame.image.startsWith('data:image/')
    ? frame.image
    : undefined;
  return { tool, status, action, ...(image ? { image } : {}) };
}

export function parseComputerUseActionFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const action = typeof parsed.action === 'string' ? parsed.action : '';
    if (!action) return null;
    const parts = [action.replace(/_/g, ' ')];
    if (typeof parsed.app === 'string' && parsed.app.trim()) parts.push(parsed.app);
    if (typeof parsed.mode === 'string' && parsed.mode.trim()) parts.push(parsed.mode);
    if (parsed.element != null) parts.push(`#${String(parsed.element)}`);
    return parts.join(' · ');
  } catch {
    return trimmed.slice(0, 60);
  }
}

export function isComputerUseFrameData(
  value: unknown,
): value is { type: 'computer_use_frame'; frame: ComputerUseFrameEvent } {
  if (!value || typeof value !== 'object') return false;
  if ((value as { type?: unknown }).type !== 'computer_use_frame') return false;
  return parseComputerUseFrame((value as { frame?: unknown }).frame) !== null;
}

export function reduceComputerUseDockState(
  state: ComputerUseDockState,
  update: {
    toolActivity?: { tool: string; status: 'running' | 'completed'; input: string };
    frame?: ComputerUseFrameEvent | null;
    streamEnded?: boolean;
    permissionsHint?: string | null;
    userExpanded?: boolean;
    userCollapsed?: boolean;
  },
): ComputerUseDockState {
  if (update.streamEnded) {
    return { ...INITIAL_COMPUTER_USE_DOCK_STATE };
  }

  let next = state;

  if (update.permissionsHint !== undefined) {
    next = { ...next, permissionsHint: update.permissionsHint };
  }

  if (update.userExpanded) {
    next = { ...next, expanded: true };
  }
  if (update.userCollapsed) {
    next = { ...next, expanded: false };
  }

  const activity = update.toolActivity;
  if (activity && isComputerUseToolName(activity.tool)) {
    const action = parseComputerUseActionFromInput(activity.input) ?? activity.tool;
    next = {
      ...next,
      active: true,
      expanded: activity.status === 'running' ? true : next.expanded,
      action,
      status: activity.status,
      stepCount: activity.status === 'running' ? next.stepCount + 1 : next.stepCount,
    };
  }

  const frame = update.frame;
  if (frame) {
    next = {
      ...next,
      active: true,
      expanded: true,
      action: frame.action,
      status: frame.status,
      image: frame.image ?? next.image,
      stepCount: frame.status === 'running' ? next.stepCount + 1 : next.stepCount,
    };
  }

  return next;
}

export function shouldShowComputerUseDock(state: ComputerUseDockState, isStreaming: boolean): boolean {
  return state.active && (isStreaming || state.status === 'running' || !!state.image);
}
