import type { PendingProposal } from '@/lib/proposed-changes';

export type ApprovalScope = 'session' | 'always';
export type ApprovalKey = string; // `${toolName}:${targetHash}`

export interface ApprovalPolicy {
  key: ApprovalKey;
  scope: ApprovalScope;
  createdAt: number;
  /**
   * Policy kind — 'path' (legacy default: a hashed proposal/repo path set) or
   * 'prefix' (always-allow a shell command prefix, matching argv[0..n]).
   * Optional so existing persisted policies keep working unchanged.
   */
  kind?: 'path' | 'prefix';
  /** Tool name the prefix rule applies to (prefix policies only). */
  tool?: string;
  /** Command prefix (argv[0..n], e.g. `npm run`) matched (prefix policies only). */
  commandPrefix?: string;
}

/** Small stable string hash (djb2). Not cryptographic. */
export function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  // unsigned hex
  return (hash >>> 0).toString(16);
}

/**
 * Approval key for a repo proposal. We hash the sorted set of plan file paths
 * so the same set of files requested by the same tool reuses its approval.
 */
export function getProposalApprovalKey(proposal: PendingProposal): ApprovalKey {
  const paths = proposal.plan
    .map((item) => item.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .sort()
    .join('|');
  return `propose_changes:${djb2Hash(paths)}`;
}

/**
 * Approval key for a command-prefix policy. Prefixes are hashed per tool so
 * `npm run` for the terminal tool is distinct from a same-named prefix of a
 * different tool.
 */
export function getCommandPrefixApprovalKey(tool: string, commandPrefix: string): ApprovalKey {
  return `prefix:${tool}:${djb2Hash(commandPrefix)}`;
}

/**
 * True when a prefix policy covers a command: the policy must be kind
 * 'prefix', match the tool (when constrained), and the command must start
 * with the stored argv[0..n] prefix.
 */
export function matchesCommandPrefixPolicy(
  policy: ApprovalPolicy,
  tool: string,
  command: string,
): boolean {
  if (policy.kind !== 'prefix' || !policy.commandPrefix) {
    return false;
  }
  if (policy.tool && policy.tool !== tool) {
    return false;
  }
  return typeof command === 'string' && command.startsWith(policy.commandPrefix);
}

export function matchApprovalPolicy(
  key: ApprovalKey,
  sessionPolicies: ApprovalPolicy[],
  alwaysPolicies: ApprovalPolicy[],
): ApprovalPolicy | null {
  const match =
    sessionPolicies.find((p) => p.key === key) ??
    alwaysPolicies.find((p) => p.key === key);
  return match ?? null;
}

/**
 * Look up a command-prefix policy for a tool call. Falls back to the
 * key-based match for path policies.
 */
export function matchToolApprovalPolicy(
  tool: string,
  command: string | undefined,
  sessionPolicies: ApprovalPolicy[],
  alwaysPolicies: ApprovalPolicy[],
): ApprovalPolicy | null {
  if (typeof command === 'string' && command.trim()) {
    for (const policy of [...sessionPolicies, ...alwaysPolicies]) {
      if (matchesCommandPrefixPolicy(policy, tool, command)) {
        return policy;
      }
    }
  }
  return null;
}
