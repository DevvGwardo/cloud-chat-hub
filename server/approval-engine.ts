// ─── Server-side approval engine for non-ACP tools ───────────────────────────
// Gates server-executed tools on the streamText path (run_command,
// execute_python, write_file, repo write tools) with per-conversation policy
// rules and a real per-tool approval flow:
//
//   safe command  → allow silently (Codex-style read-only allowlist)
//   policy rule   → allow (session / prefix / once)
//   else          → park the execution, emit an `approval_request` custom
//                   field, await the client decision (POST /api/hermes/
//                   approvals/:id) with APPROVAL_TIMEOUT_MS, then proceed or
//                   return a structured "error:" message to the model.
//
// Policy state is in-memory and keyed by conversationId. Entries are cleaned
// up on conversation delete (chat-store route) and capped LRU-ish at
// MAX_CONVERSATIONS to avoid leaks.

import { randomUUID } from 'crypto';
import { APPROVAL_TIMEOUT_MS } from './config';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApprovalDecision = 'approved' | 'approved_for_session' | 'denied' | 'timed_out' | 'abort';

/** Outcome the tool execute handler acts on. */
export type AuthorizeOutcome = 'approved' | 'denied' | 'timed_out' | 'abort';

export const APPROVAL_AVAILABLE_DECISIONS = [
  'approved',
  'approved_for_session',
  'denied',
  'timed_out',
  'abort',
] as const;

export interface PolicyRule {
  kind: 'once' | 'session' | 'prefix';
  tool: string;
  /** When set, the rule only matches commands starting with this prefix. */
  commandPrefix?: string;
  /** Epoch ms; expired rules are ignored and pruned. */
  expiresAt?: number;
}

export interface ApprovalRequestPayload {
  type: 'approval_request';
  approval_id: string;
  tool: string;
  command?: string;
  cwd?: string;
  reason: string;
  available_decisions: readonly ['approved', 'approved_for_session', 'denied', 'timed_out', 'abort'];
}

export interface AuthorizeInput {
  conversationId: string;
  tool: string;
  /** Raw command string (run_command) or tool-specific payload shown in the modal. */
  command?: string;
  /** Working directory shown in the modal. */
  cwd?: string;
  /** Human-readable reason shown in the modal. */
  reason: string;
  /** Conversation auto-approve (e.g. `auto_approve` body flag). */
  autoApprove?: boolean;
  /** Emit the approval_request custom field to the client. */
  emit: (payload: ApprovalRequestPayload) => void;
}

// ─── Read-only command allowlist (Codex-inspired) ────────────────────────────

const SAFE_READ_ONLY_COMMANDS = new Set([
  'cat',
  'ls',
  'grep',
  'head',
  'tail',
  'pwd',
  'wc',
  'find',
  'rg',
  'git',
]);

/** `find` flags that mutate the filesystem (or run arbitrary commands). */
const FIND_VETO_FLAGS = ['-exec', '-execdir', '-ok', '-okdir', '-delete'];

/** `git` subcommands that are read-only. */
const GIT_SAFE_SUBCOMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch']);

/** `git` flags that mutate refs/branches. */
const GIT_VETO_FLAGS = new Set([
  '-d',
  '-D',
  '-m',
  '-f',
  '--force',
  '--delete',
  '-u',
  '--set-upstream',
  '--set-upstream-to',
  '-b',
  '--branch',
]);

function isFindVetoFlag(flag: string): boolean {
  return FIND_VETO_FLAGS.some((veto) => flag === veto || flag.startsWith(veto));
}

/**
 * Classify a pre-tokenized command as read-only-safe.
 *
 * `argv[0]` must be an allowlisted command; `find` may not carry
 * -exec/-execdir/-ok/-okdir/-delete; `git` must be a read-only subcommand
 * (status|log|diff|show|branch) without mutating flags.
 */
export function isSafeCommand(argv: string[]): boolean {
  if (!Array.isArray(argv) || argv.length === 0) {
    return false;
  }

  const [command, ...args] = argv.map((arg) => arg.trim()).filter(Boolean);
  if (!command || !SAFE_READ_ONLY_COMMANDS.has(command)) {
    return false;
  }

  if (command === 'find') {
    return !args.some((arg) => arg.startsWith('-') && isFindVetoFlag(arg));
  }

  if (command === 'git') {
    // Bare `git` prints help — harmless.
    if (args.length === 0) {
      return true;
    }
    const subcommand = args[0];
    if (!GIT_SAFE_SUBCOMMANDS.has(subcommand)) {
      return false;
    }
    return !args.some((arg) => arg.startsWith('-') && GIT_VETO_FLAGS.has(arg));
  }

  return true;
}

/** Shell metacharacters that make a command unsafe (redirects, subshells, pipes…). */
const UNSAFE_SHELL_TOKENS = new Set(['(', ')', '<', '>', '<<', '>>', '2>']);
const SEGMENT_OPERATORS = new Set(['&&', '||', ';', '|']);

/**
 * Lightweight shell tokenizer that respects single/double quotes and
 * backslash escapes. Returns words and operator tokens; any token containing
 * a backtick or `$(`/`${` (command substitution / variable expansion with
 * side effects) is a red flag that the caller must reject.
 */
export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  const pushWord = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  while (i < command.length) {
    const ch = command[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < command.length) {
        current += command[i + 1];
        i += 2;
        continue;
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += command[i + 1];
      i += 2;
      continue;
    }

    if (ch === '&' && command[i + 1] === '&') {
      pushWord();
      tokens.push('&&');
      i += 2;
      continue;
    }
    if (ch === '|' && command[i + 1] === '|') {
      pushWord();
      tokens.push('||');
      i += 2;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '(' || ch === ')' || ch === '<' || ch === '>') {
      pushWord();
      tokens.push(ch);
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      pushWord();
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }
  pushWord();
  return tokens;
}

function hasCommandSubstitution(tokens: string[]): boolean {
  return tokens.some(
    (token) => token.includes('`') || token.includes('$(') || token.includes('${'),
  );
}

/**
 * Classify a raw shell command line (the `run_command` payload) as
 * read-only-safe. Supports simple composed chains of only-safe commands
 * joined with `&&`, `||`, `;`, or `|`. Rejects redirects, subshells, command
 * substitution, and any segment whose first word is not allowlisted.
 */
export function isSafeCommandString(command: string): boolean {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return false;
  }

  const tokens = tokenizeShellCommand(command);
  if (hasCommandSubstitution(tokens)) {
    return false;
  }
  if (tokens.some((token) => UNSAFE_SHELL_TOKENS.has(token))) {
    return false;
  }

  // Split into segments on chain operators; every segment must be safe.
  let segment: string[] = [];
  const segments: string[][] = [];
  for (const token of tokens) {
    if (SEGMENT_OPERATORS.has(token)) {
      segments.push(segment);
      segment = [];
    } else {
      segment.push(token);
    }
  }
  segments.push(segment);

  const nonEmptySegments = segments.filter((part) => part.length > 0);
  if (nonEmptySegments.length === 0) {
    return false;
  }

  return nonEmptySegments.every((part) => isSafeCommand(part));
}

// ─── Policy store ────────────────────────────────────────────────────────────

const MAX_CONVERSATIONS = 500;

interface PendingApprovalEntry {
  conversationId: string;
  tool: string;
  command?: string;
  settle: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

export class ApprovalPolicyStore {
  private rulesByConversation = new Map<string, PolicyRule[]>();
  private autoApproveByConversation = new Map<string, boolean>();
  private pending = new Map<string, PendingApprovalEntry>();
  /** LRU-ish order, least recently used first. */
  private lastUsed: string[] = [];

  private touch(conversationId: string): void {
    const index = this.lastUsed.indexOf(conversationId);
    if (index !== -1) {
      this.lastUsed.splice(index, 1);
    }
    this.lastUsed.push(conversationId);

    while (this.lastUsed.length > MAX_CONVERSATIONS) {
      const evicted = this.lastUsed.shift();
      if (evicted) {
        this.cleanupConversation(evicted);
      }
    }
  }

  /** Insert a policy rule for a conversation. */
  addRule(conversationId: string, rule: PolicyRule): void {
    this.touch(conversationId);
    const rules = this.rulesByConversation.get(conversationId) ?? [];
    rules.push(rule);
    this.rulesByConversation.set(conversationId, rules);
  }

  /** Set/unset per-conversation auto-approve (all tools in that conversation). */
  setAutoApprove(conversationId: string, enabled: boolean): void {
    this.touch(conversationId);
    if (enabled) {
      this.autoApproveByConversation.set(conversationId, true);
    } else {
      this.autoApproveByConversation.delete(conversationId);
    }
  }

  isAutoApproved(conversationId: string): boolean {
    return this.autoApproveByConversation.get(conversationId) === true;
  }

  /** Drop all state for a conversation and settle any parked approvals. */
  cleanupConversation(conversationId: string): void {
    this.rulesByConversation.delete(conversationId);
    this.autoApproveByConversation.delete(conversationId);
    for (const [approvalId, entry] of this.pending) {
      if (entry.conversationId === conversationId) {
        this.settlePending(approvalId, 'abort');
      }
    }
    const index = this.lastUsed.indexOf(conversationId);
    if (index !== -1) {
      this.lastUsed.splice(index, 1);
    }
  }

  private settlePending(approvalId: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.settled) {
      return;
    }
    entry.settled = true;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.settle(decision);
  }

  /**
   * Resolve a parked approval from POST /api/hermes/approvals/:id.
   * `approved_for_session` additionally inserts a session rule for the same
   * tool + command prefix; `approved` with `reason === 'prefix'` (the client's
   * "Always for prefix" ladder step) inserts a durable prefix rule that
   * auto-approves future commands starting with the same prefix. Plain
   * `approved` stays a one-shot approval. Returns false when the approval is
   * unknown/expired.
   */
  resolveApproval(
    approvalId: string,
    decision: 'approved' | 'approved_for_session' | 'denied',
    reason?: string,
  ): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return false;
    }
    if (decision === 'approved_for_session') {
      this.addRule(entry.conversationId, {
        kind: 'session',
        tool: entry.tool,
        commandPrefix: entry.command,
      });
    } else if (
      decision === 'approved' &&
      reason === 'prefix' &&
      typeof entry.command === 'string' &&
      entry.command.trim().length > 0
    ) {
      this.addRule(entry.conversationId, {
        kind: 'prefix',
        tool: entry.tool,
        commandPrefix: entry.command,
      });
    }
    this.settlePending(approvalId, decision);
    return true;
  }

  /** Number of conversations currently tracked (test/observability helper). */
  get conversationCount(): number {
    return this.lastUsed.length;
  }

  /** Test-only: wipe all state. */
  resetForTests(): void {
    for (const approvalId of Array.from(this.pending.keys())) {
      this.settlePending(approvalId, 'abort');
    }
    this.rulesByConversation.clear();
    this.autoApproveByConversation.clear();
    this.lastUsed = [];
  }

  private matchesRule(rule: PolicyRule, tool: string, command?: string): boolean {
    if (rule.tool !== tool) {
      return false;
    }
    if (rule.expiresAt !== undefined && Date.now() > rule.expiresAt) {
      return false;
    }
    if (rule.commandPrefix !== undefined) {
      if (!command || !command.startsWith(rule.commandPrefix)) {
        return false;
      }
    }
    return true;
  }

  /** Consume a matching rule for a tool call; removes `once` rules. */
  private consumeRule(conversationId: string, tool: string, command?: string): boolean {
    const rules = this.rulesByConversation.get(conversationId);
    if (!rules || rules.length === 0) {
      return false;
    }
    const now = Date.now();
    const remaining: PolicyRule[] = [];
    let matched = false;
    for (const rule of rules) {
      if (rule.expiresAt !== undefined && now > rule.expiresAt) {
        continue; // expired — prune
      }
      if (!matched && this.matchesRule(rule, tool, command)) {
        matched = true;
        if (rule.kind !== 'once') {
          remaining.push(rule); // session/prefix rules persist
        }
        continue;
      }
      remaining.push(rule);
    }
    if (remaining.length > 0) {
      this.rulesByConversation.set(conversationId, remaining);
    } else {
      this.rulesByConversation.delete(conversationId);
    }
    return matched;
  }

  /**
   * Decision flow for a tool execute handler:
   *   1. conversation auto-approve → approved (silent)
   *   2. safe command (read-only allowlist) → approved (silent)
   *   3. matching session/prefix/once policy rule → approved (once consumed)
   *   4. otherwise park the execution: emit `approval_request`, await the
   *      client decision with APPROVAL_TIMEOUT_MS → deny on timeout/denied.
   */
  async authorize(input: AuthorizeInput): Promise<AuthorizeOutcome> {
    this.touch(input.conversationId);

    if (input.autoApprove || this.isAutoApproved(input.conversationId)) {
      return 'approved';
    }

    if (this.isSafeToolCall(input.tool, input.command)) {
      return 'approved';
    }

    if (this.consumeRule(input.conversationId, input.tool, input.command)) {
      return 'approved';
    }

    return this.parkForApproval(input);
  }

  private isSafeToolCall(tool: string, command?: string): boolean {
    // Only shell commands can be classified against the read-only allowlist;
    // execute_python / repo write tools are never "safe" by themselves.
    if (tool === 'run_command' && typeof command === 'string') {
      return isSafeCommandString(command);
    }
    return false;
  }

  private parkForApproval(input: AuthorizeInput): Promise<AuthorizeOutcome> {
    return new Promise<AuthorizeOutcome>((resolve) => {
      const approvalId = randomUUID();
      const entry: PendingApprovalEntry = {
        conversationId: input.conversationId,
        tool: input.tool,
        command: input.command,
        settle: (decision: ApprovalDecision) => {
          resolve(decision === 'approved' || decision === 'approved_for_session' ? 'approved' : decision);
        },
        timer: setTimeout(() => {
          this.settlePending(approvalId, 'timed_out');
        }, APPROVAL_TIMEOUT_MS),
        settled: false,
      };
      this.pending.set(approvalId, entry);

      const payload: ApprovalRequestPayload = {
        type: 'approval_request',
        approval_id: approvalId,
        tool: input.tool,
        ...(input.command !== undefined ? { command: input.command } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        reason: input.reason,
        available_decisions: APPROVAL_AVAILABLE_DECISIONS,
      };

      try {
        input.emit(payload);
      } catch {
        // The data stream may already be closed — treat as a denial so the
        // tool call does not hang forever.
        this.settlePending(approvalId, 'abort');
      }
    });
  }
}

/** Shared store for the whole server process. */
export const approvalPolicyStore = new ApprovalPolicyStore();
