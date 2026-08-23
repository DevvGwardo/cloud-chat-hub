import { describe, it, expect } from 'vitest';
import {
  formatToolDuration,
  getCommandDisplayPrefix,
  parseToolCallEvent,
  reduceToolCallRecords,
  splitToolOutputHeadTail,
} from '@/hooks/useChat';
import type { ToolCallRecords } from '@/stores/hermes-store';

describe('parseToolCallEvent', () => {
  it('rejects non-objects and events without a call_id', () => {
    expect(parseToolCallEvent(null)).toBeNull();
    expect(parseToolCallEvent('tool_call_begin')).toBeNull();
    expect(parseToolCallEvent({ type: 'tool_call_begin' })).toBeNull();
    expect(parseToolCallEvent({ type: 'tool_call_begin', call_id: 42 })).toBeNull();
  });

  it('parses a begin event with its ts', () => {
    expect(parseToolCallEvent({ type: 'tool_call_begin', call_id: 'c1', name: 'run_command', ts: 123 })).toEqual({
      type: 'tool_call_begin',
      call_id: 'c1',
      name: 'run_command',
      ts: 123,
    });
  });

  it('rejects a begin without a name', () => {
    expect(parseToolCallEvent({ type: 'tool_call_begin', call_id: 'c1' })).toBeNull();
  });

  it('parses a delta event (append-only chunk)', () => {
    expect(parseToolCallEvent({ type: 'tool_call_delta', call_id: 'c1', output: 'chunk' })).toEqual({
      type: 'tool_call_delta',
      call_id: 'c1',
      output: 'chunk',
    });
  });

  it('parses an end event with exit code and truncation info', () => {
    expect(parseToolCallEvent({
      type: 'tool_call_end',
      call_id: 'c1',
      name: 'run_command',
      success: false,
      exit_code: 1,
      duration_ms: 3200,
      output_truncated: true,
      output_truncated_lines: 41,
    })).toEqual({
      type: 'tool_call_end',
      call_id: 'c1',
      name: 'run_command',
      success: false,
      exit_code: 1,
      duration_ms: 3200,
      output_truncated: true,
      output_truncated_lines: 41,
    });
  });
});

describe('reduceToolCallRecords', () => {
  const begin = { type: 'tool_call_begin', call_id: 'c1', name: 'run_command', ts: 1 };

  it('applies begin → delta → end lifecycle', () => {
    let records: ToolCallRecords = {};
    records = reduceToolCallRecords(records, begin);
    expect(records.c1).toMatchObject({ name: 'run_command', status: 'running', output: '' });

    records = reduceToolCallRecords(records, { type: 'tool_call_delta', call_id: 'c1', output: 'line 1\n' });
    records = reduceToolCallRecords(records, { type: 'tool_call_delta', call_id: 'c1', output: 'line 2' });
    expect(records.c1.output).toBe('line 1\nline 2');
    expect(records.c1.outputChunks).toEqual(['line 1\n', 'line 2']);

    records = reduceToolCallRecords(records, {
      type: 'tool_call_end',
      call_id: 'c1',
      name: 'run_command',
      success: true,
      exit_code: 0,
      duration_ms: 1200,
      output_truncated: false,
      output_truncated_lines: 0,
    });
    expect(records.c1.status).toBe('completed');
    expect(records.c1.exitCode).toBe(0);
    expect(records.c1.durationMs).toBe(1200);
    expect(records.c1.output).toBe('line 1\nline 2');
  });

  it('marks a failed end with exit code and truncation numbers', () => {
    let records: ToolCallRecords = {};
    records = reduceToolCallRecords(records, begin);
    records = reduceToolCallRecords(records, {
      type: 'tool_call_end',
      call_id: 'c1',
      name: 'run_command',
      success: false,
      exit_code: 2,
      duration_ms: 900,
      output_truncated: true,
      output_truncated_lines: 500,
    });
    expect(records.c1.status).toBe('failed');
    expect(records.c1.exitCode).toBe(2);
    expect(records.c1.outputTruncated).toBe(true);
    expect(records.c1.outputTruncatedLines).toBe(500);
  });

  it('is idempotent for a duplicate begin while running', () => {
    let records: ToolCallRecords = {};
    records = reduceToolCallRecords(records, begin);
    const afterDuplicate = reduceToolCallRecords(records, begin);
    expect(afterDuplicate).toBe(records); // same reference — no change
  });

  it('ignores deltas after the call finished', () => {
    let records: ToolCallRecords = {};
    records = reduceToolCallRecords(records, begin);
    records = reduceToolCallRecords(records, {
      type: 'tool_call_end', call_id: 'c1', name: 'run_command',
      success: true, exit_code: 0, duration_ms: 10, output_truncated: false, output_truncated_lines: 0,
    });
    const after = reduceToolCallRecords(records, { type: 'tool_call_delta', call_id: 'c1', output: 'late' });
    expect(after).toBe(records);
    expect(records.c1.output).toBe('');
  });

  it('returns the same reference for unknown events (cheap no-op)', () => {
    const records: ToolCallRecords = {};
    expect(reduceToolCallRecords(records, { type: 'nope' })).toBe(records);
    expect(reduceToolCallRecords(records, null)).toBe(records);
  });

  it('synthesizes a record for an end without a begin (snapshot replay)', () => {
    const records = reduceToolCallRecords({}, {
      type: 'tool_call_end', call_id: 'c9', name: 'execute_python',
      success: false, exit_code: 1, duration_ms: 500, output_truncated: false, output_truncated_lines: 0,
    });
    expect(records.c9).toMatchObject({ name: 'execute_python', status: 'failed', exitCode: 1 });
  });
});

describe('formatToolDuration', () => {
  it('formats sub-minute durations with one decimal in seconds', () => {
    expect(formatToolDuration(3200)).toBe('3.2s');
    expect(formatToolDuration(0)).toBe('0.0s');
    expect(formatToolDuration(59999)).toBe('60.0s');
  });

  it('formats minute+ durations as mm:ss', () => {
    expect(formatToolDuration(60_000)).toBe('1:00');
    expect(formatToolDuration(65_000)).toBe('1:05');
    expect(formatToolDuration(3 * 60_000 + 7_000)).toBe('3:07');
  });

  it('handles invalid input gracefully', () => {
    expect(formatToolDuration(Number.NaN)).toBe('');
    expect(formatToolDuration(-5)).toBe('');
  });
});

describe('splitToolOutputHeadTail', () => {
  it('returns the full output when it fits', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const split = splitToolOutputHeadTail(text);
    expect(split.head).toBe(text);
    expect(split.tail).toBe('');
    expect(split.hiddenLines).toBe(0);
    expect(split.totalLines).toBe(20);
  });

  it('keeps the first 12 and last 8 lines with an exact hidden count', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const split = splitToolOutputHeadTail(text);
    expect(split.totalLines).toBe(50);
    expect(split.hiddenLines).toBe(30);
    expect(split.head).toBe(Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'));
    expect(split.tail).toBe(Array.from({ length: 8 }, (_, i) => `line ${42 + i}`).join('\n'));
  });

  it('respects custom head/tail line counts', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const split = splitToolOutputHeadTail(text, { headLines: 5, tailLines: 3 });
    expect(split.hiddenLines).toBe(22);
    expect(split.head.split('\n')).toHaveLength(5);
    expect(split.tail.split('\n')).toHaveLength(3);
  });

  it('clamps degenerate line counts to at least 1', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const split = splitToolOutputHeadTail(text, { headLines: 0, tailLines: 0 });
    expect(split.hiddenLines).toBe(28);
  });
});

describe('getCommandDisplayPrefix', () => {
  it('keeps the first two argv tokens', () => {
    expect(getCommandDisplayPrefix('npm run test -- --watch')).toBe('npm run');
    expect(getCommandDisplayPrefix('rm -rf /tmp/x')).toBe('rm -rf');
  });

  it('caps the prefix length', () => {
    const long = `${'a'.repeat(50)} ${'b'.repeat(50)}`;
    expect(getCommandDisplayPrefix(long, 20).length).toBe(20);
  });

  it('handles empty input', () => {
    expect(getCommandDisplayPrefix('')).toBe('');
    expect(getCommandDisplayPrefix('   ')).toBe('');
  });
});
