// Shared helpers for parsing tool-activity payloads and keying tool
// invocations. Kept in one module so every consumer agrees on the same
// fallbacks (divergent local copies previously produced mismatched keys when
// deduping the same invocation).

interface ToolInvocationLike {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
}

/**
 * Parse a tool activity's raw input string into an args object. Valid JSON
 * objects pass through; anything else (including non-object JSON) falls back
 * to `{ input: trimmed }` so callers still get the raw payload.
 */
export function parseToolActivityInput(input: string): Record<string, unknown> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { input: trimmed };
  } catch {
    return { input: trimmed };
  }
}

/**
 * Stable dedup key for a tool invocation. Prefers the toolCallId when present
 * (streamed parts carry it), then falls back to a path/filename/batch digest
 * so partial-call and result parts of the same invocation still collide.
 */
export function getToolInvocationKey(
  invocation: ToolInvocationLike,
  fallbackIndex: number,
): string {
  if (invocation.toolCallId) {
    return invocation.toolCallId;
  }

  const path = typeof invocation.args?.path === 'string' ? invocation.args.path : '';
  const filename = typeof invocation.args?.filename === 'string' ? invocation.args.filename : '';
  const batchPaths = Array.isArray(invocation.args?.changes)
    ? invocation.args.changes
        .map((change) =>
          change && typeof change === 'object'
            ? `${typeof change.action === 'string' ? change.action : ''}:${typeof change.path === 'string' ? change.path : ''}`
            : '',
        )
        .join('|')
    : '';

  return `${invocation.toolName}:${path}:${filename}:${batchPaths || fallbackIndex}`;
}
