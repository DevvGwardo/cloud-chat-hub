import { describe, expect, it } from 'vitest';
import { normalizeHermesAgentLoopPayload } from '../lib/hermes';

describe('normalizeHermesAgentLoopPayload', () => {
  it('passes through approval_request events from the ACP transport', () => {
    const payload = JSON.stringify({
      id: 'chatcmpl-acp-test',
      choices: [{
        index: 0,
        delta: {
          approval_request: {
            approval_id: 'acp-123-1',
            session_id: 'sess-1',
            tool: 'Approve edit: /tmp/x.txt',
            kind: 'edit',
            summary: 'Approve edit: /tmp/x.txt',
            excerpt: '{"tool":"write_file","arguments":{}}',
            options: [{ option_id: 'allow_once', name: 'Allow edit' }, { option_id: 'deny', name: 'Deny' }],
          },
        },
        finish_reason: null,
      }],
    });

    const normalized = normalizeHermesAgentLoopPayload(payload);
    expect(normalized).not.toBeNull();
    const approval = normalized!.data.find((d) => d.type === 'approval_request');
    expect(approval).toBeDefined();
    expect(approval).toMatchObject({
      type: 'approval_request',
      approval_id: 'acp-123-1',
      tool: 'Approve edit: /tmp/x.txt',
    });
  });

  it('passes through tool_activity and agent_status unchanged', () => {
    const payload = JSON.stringify({
      choices: [{
        index: 0,
        delta: {
          tool_activity: { tool: 'terminal: ls', status: 'running', input: '', output: null },
          agent_status: { phase: 'starting', label: 'Starting', elapsed_ms: 0 },
        },
        finish_reason: null,
      }],
    });

    const normalized = normalizeHermesAgentLoopPayload(payload);
    expect(normalized).not.toBeNull();
    const tool = normalized!.data.find((d) => d.type === 'hermes_tool_activity');
    expect(tool).toMatchObject({ type: 'hermes_tool_activity', activity: { tool: 'terminal: ls', status: 'running' } });
    const status = normalized!.data.find((d) => d.type === 'agent_status');
    expect(status).toMatchObject({ type: 'agent_status', status: { phase: 'starting' } });
  });

  it('returns null on malformed JSON', () => {
    expect(normalizeHermesAgentLoopPayload('not-json')).toBeNull();
  });
});
