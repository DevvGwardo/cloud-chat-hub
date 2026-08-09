// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApprovalPolicyStore,
  isSafeCommand,
  isSafeCommandString,
  tokenizeShellCommand,
} from '../approval-engine';

describe('approval engine: read-only command allowlist', () => {
  it('allows read-only commands', () => {
    expect(isSafeCommand(['ls', '-la'])).toBe(true);
    expect(isSafeCommand(['cat', 'file.txt'])).toBe(true);
    expect(isSafeCommand(['grep', '-rn', 'foo', 'src'])).toBe(true);
    expect(isSafeCommand(['head', '-20', 'file'])).toBe(true);
    expect(isSafeCommand(['tail', '-f', 'log'])).toBe(true);
    expect(isSafeCommand(['pwd'])).toBe(true);
    expect(isSafeCommand(['wc', '-l', 'file'])).toBe(true);
    expect(isSafeCommand(['rg', 'pattern', '.'])).toBe(true);
    expect(isSafeCommand(['git'])).toBe(true);
    expect(isSafeCommand(['git', 'status'])).toBe(true);
    expect(isSafeCommand(['git', 'log', '--oneline', '-10'])).toBe(true);
    expect(isSafeCommand(['git', 'diff', 'HEAD'])).toBe(true);
    expect(isSafeCommand(['git', 'show', 'abc123'])).toBe(true);
    expect(isSafeCommand(['git', 'branch'])).toBe(true);
  });

  it('rejects mutating commands', () => {
    expect(isSafeCommand(['rm', '-rf', '/'])).toBe(false);
    expect(isSafeCommand(['mv', 'a', 'b'])).toBe(false);
    expect(isSafeCommand(['touch', 'x'])).toBe(false);
    expect(isSafeCommand(['echo', 'hi'])).toBe(false);
    expect(isSafeCommand(['sudo', 'ls'])).toBe(false);
    expect(isSafeCommand([''])).toBe(false);
    expect(isSafeCommand([])).toBe(false);
    expect(isSafeCommand(['python3', '-c', 'x'])).toBe(false);
  });

  it('vetoes find flags that mutate or execute', () => {
    expect(isSafeCommand(['find', '.', '-name', '*.ts'])).toBe(true);
    expect(isSafeCommand(['find', '.', '-name', '*.ts', '-delete'])).toBe(false);
    expect(isSafeCommand(['find', '.', '-exec', 'rm', '{}', ';'])).toBe(false);
    expect(isSafeCommand(['find', '.', '-execdir', 'sh', '-c', 'x'])).toBe(false);
    expect(isSafeCommand(['find', '.', '-ok', 'rm', '{}', ';'])).toBe(false);
  });

  it('rejects git subcommands that mutate', () => {
    expect(isSafeCommand(['git', 'push'])).toBe(false);
    expect(isSafeCommand(['git', 'commit', '-m', 'x'])).toBe(false);
    expect(isSafeCommand(['git', 'checkout', 'main'])).toBe(false);
    expect(isSafeCommand(['git', 'reset', '--hard'])).toBe(false);
    expect(isSafeCommand(['git', 'branch', '-D', 'foo'])).toBe(false);
    expect(isSafeCommand(['git', 'branch', '-m', 'old', 'new'])).toBe(false);
    expect(isSafeCommand(['git', 'diff', '--force'])).toBe(false);
  });

  it('classifies composed chains of only-safe commands', () => {
    expect(isSafeCommandString('ls -la && grep foo src')).toBe(true);
    expect(isSafeCommandString('cat a.txt | head -5')).toBe(true);
    expect(isSafeCommandString('pwd; git status; wc -l package.json')).toBe(true);
    expect(isSafeCommandString("grep -E 'foo|bar' file || wc -l file")).toBe(true);
  });

  it('rejects chains containing a mutating command', () => {
    expect(isSafeCommandString('ls && rm -rf /')).toBe(false);
    expect(isSafeCommandString('git log | grep foo; touch x')).toBe(false);
  });

  it('rejects redirects, subshells and command substitution', () => {
    expect(isSafeCommandString('cat file > out')).toBe(false);
    expect(isSafeCommandString('cat file >> out')).toBe(false);
    expect(isSafeCommandString('ls 2>/dev/null')).toBe(false);
    expect(isSafeCommandString('(ls)')).toBe(false);
    expect(isSafeCommandString('ls; (cat x)')).toBe(false);
    expect(isSafeCommandString('ls `rm -rf /`')).toBe(false);
    expect(isSafeCommandString('ls $(rm -rf /)')).toBe(false);
    expect(isSafeCommandString('grep foo ${BAR} file')).toBe(false);
  });

  it('respects quotes when splitting chains', () => {
    expect(tokenizeShellCommand("grep -E 'a && b' file | head")).toEqual([
      'grep', '-E', 'a && b', 'file', '|', 'head',
    ]);
    expect(isSafeCommandString("grep -E 'a && b' file | head")).toBe(true);
  });
});

describe('approval engine: policy store', () => {
  let store: ApprovalPolicyStore;

  beforeEach(() => {
    store = new ApprovalPolicyStore();
  });

  afterEach(() => {
    store.resetForTests();
  });

  const noopEmit = () => {};

  it('allows safe commands silently without emitting an approval request', async () => {
    const emitted: unknown[] = [];
    const outcome = await store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'git status',
      reason: 'run',
      emit: (payload) => emitted.push(payload),
    });
    expect(outcome).toBe('approved');
    expect(emitted).toHaveLength(0);
  });

  it('requires approval for non-safe commands and parks the execution', async () => {
    let parkedPayload: { approval_id?: string } | null = null;
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'rm -rf /tmp/x',
      reason: 'run destructive command',
      emit: (payload) => {
        parkedPayload = payload;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parkedPayload).not.toBeNull();
    const captured = parkedPayload as { approval_id?: string; type?: string } | null;
    expect(captured?.approval_id).toBeDefined();
    expect(captured).toMatchObject({
      type: 'approval_request',
      tool: 'run_command',
      command: 'rm -rf /tmp/x',
      reason: 'run destructive command',
      available_decisions: ['approved', 'approved_for_session', 'denied', 'timed_out', 'abort'],
    });

    const delivered = store.resolveApproval(captured!.approval_id!, 'approved');
    expect(delivered).toBe(true);
    await expect(outcomePromise).resolves.toBe('approved');
  });

  it('denies when the client denies', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'execute_python',
      command: 'python3 -c "print(1)"',
      reason: 'run python',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.resolveApproval(approvalId, 'denied');
    await expect(outcomePromise).resolves.toBe('denied');
  });

  it('settles parked approvals as abort on conversation cleanup', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'execute_python',
      command: 'python3 -c "print(1)"',
      reason: 'run python',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(approvalId.length).toBeGreaterThan(0);
    // cleanupConversation settles parked approvals as 'abort' (deny-like).
    store.cleanupConversation('conv-1');
    await expect(outcomePromise).resolves.toBe('abort');
  });

  it('inserts a session rule for approved_for_session', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'rm -rf /tmp/x',
      reason: 'run',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.resolveApproval(approvalId, 'approved_for_session');
    await expect(outcomePromise).resolves.toBe('approved');

    // Same command now allowed silently by the session rule.
    const emitted: unknown[] = [];
    await expect(
      store.authorize({
        conversationId: 'conv-1',
        tool: 'run_command',
        command: 'rm -rf /tmp/x',
        reason: 'run',
        emit: (payload) => emitted.push(payload),
      }),
    ).resolves.toBe('approved');
    expect(emitted).toHaveLength(0);

    // A different command still requires approval.
    const emitted2: unknown[] = [];
    const p2 = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'rm -rf /tmp/y',
      reason: 'run',
      emit: (payload) => emitted2.push(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emitted2).toHaveLength(1);
    store.resetForTests();
    await expect(p2).resolves.toBe('abort');
  });

  it('honors prefix rules', async () => {
    store.addRule('conv-1', { kind: 'prefix', tool: 'edit_repo_file', commandPrefix: 'src/components/' });
    const emitted: unknown[] = [];
    await expect(
      store.authorize({
        conversationId: 'conv-1',
        tool: 'edit_repo_file',
        command: 'src/components/Button.tsx',
        reason: 'edit',
        emit: (payload) => emitted.push(payload),
      }),
    ).resolves.toBe('approved');
    expect(emitted).toHaveLength(0);

    // A path outside the prefix still requires approval.
    const emitted2: unknown[] = [];
    const parked = store.authorize({
      conversationId: 'conv-1',
      tool: 'edit_repo_file',
      command: 'src/pages/Home.tsx',
      reason: 'edit',
      emit: (payload) => emitted2.push(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emitted2).toHaveLength(1);
    store.resetForTests();
    await expect(parked).resolves.toBe('abort');
  });

  it('inserts a durable prefix rule for approved + reason "prefix"', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'npm run build -- --watch',
      reason: 'run',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.resolveApproval(approvalId, 'approved', 'prefix');
    await expect(outcomePromise).resolves.toBe('approved');

    // Future commands sharing the prefix are auto-approved silently…
    const emitted: unknown[] = [];
    await expect(
      store.authorize({
        conversationId: 'conv-1',
        tool: 'run_command',
        command: 'npm run build -- --watch --verbose',
        reason: 'run',
        emit: (payload) => emitted.push(payload),
      }),
    ).resolves.toBe('approved');
    expect(emitted).toHaveLength(0);

    // …a different command still requires approval.
    const emitted2: unknown[] = [];
    const parked = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'npm run test',
      reason: 'run',
      emit: (payload) => emitted2.push(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emitted2).toHaveLength(1);
    store.resetForTests();
    await expect(parked).resolves.toBe('abort');
  });

  it('does not insert a prefix rule when the parked command is missing', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'write_file',
      reason: 'write',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.resolveApproval(approvalId, 'approved', 'prefix');
    await expect(outcomePromise).resolves.toBe('approved');

    // No rule was inserted: the same tool call still parks again.
    const emitted: unknown[] = [];
    const parked = store.authorize({
      conversationId: 'conv-1',
      tool: 'write_file',
      reason: 'write',
      emit: (payload) => emitted.push(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emitted).toHaveLength(1);
    store.resetForTests();
    await expect(parked).resolves.toBe('abort');
  });

  it('keeps plain approved as a one-shot approval (no rule inserted)', async () => {
    let approvalId = '';
    const outcomePromise = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'rm -rf /tmp/x',
      reason: 'run',
      emit: (payload) => {
        approvalId = payload.approval_id;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.resolveApproval(approvalId, 'approved', 'user said go');
    await expect(outcomePromise).resolves.toBe('approved');

    const emitted: unknown[] = [];
    const parked = store.authorize({
      conversationId: 'conv-1',
      tool: 'run_command',
      command: 'rm -rf /tmp/x',
      reason: 'run',
      emit: (payload) => emitted.push(payload),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(emitted).toHaveLength(1);
    store.resetForTests();
    await expect(parked).resolves.toBe('abort');
  });

  it('honors conversation auto-approve', async () => {
    store.setAutoApprove('conv-1', true);
    const emitted: unknown[] = [];
    await expect(
      store.authorize({
        conversationId: 'conv-1',
        tool: 'execute_python',
        command: 'python3 -c "print(1)"',
        reason: 'run',
        emit: (payload) => emitted.push(payload),
      }),
    ).resolves.toBe('approved');
    expect(emitted).toHaveLength(0);
  });

  it('honors per-call autoApprove (e.g. continuing an approved proposal)', async () => {
    const emitted: unknown[] = [];
    await expect(
      store.authorize({
        conversationId: 'conv-1',
        tool: 'edit_repo_file',
        command: 'src/App.tsx',
        reason: 'edit',
        autoApprove: true,
        emit: (payload) => emitted.push(payload),
      }),
    ).resolves.toBe('approved');
    expect(emitted).toHaveLength(0);
  });

  it('rejects unknown approvals on resolve', () => {
    expect(store.resolveApproval('missing', 'approved')).toBe(false);
  });

  it('caps the number of tracked conversations (LRU-ish eviction)', async () => {
    // Park one approval per conversation, then exceed the cap by touching
    // more conversations; evicted conversations' approvals settle as 'abort'.
    const outcomes: Promise<string>[] = [];
    for (let i = 0; i < 3; i += 1) {
      outcomes.push(
        store.authorize({
          conversationId: `conv-${i}`,
          tool: 'execute_python',
          command: 'x',
          reason: 'r',
          emit: noopEmit,
        }),
      );
    }
    // Simulate many conversations being touched; eviction kicks in past 500.
    for (let i = 3; i < 520; i += 1) {
      store.addRule(`conv-${i}`, { kind: 'session', tool: 'read_file' });
    }
    expect(store.conversationCount).toBeLessThanOrEqual(500);
    // Parked approvals for evicted conversations settle (abort) — no hang.
    const settled = await Promise.all(outcomes);
    expect(settled.every((outcome) => outcome === 'abort')).toBe(true);
  });
});
