import { fetchHermesAgentCommands, HermesApiError, type HermesAgentCommand } from './hermes-api';

export interface CommandContext {
  setActiveSubTab: (tab: 'overview' | 'threads' | 'queue' | 'chats' | 'cron' | 'memories' | 'skills' | 'usage') => void;
  setActiveTab: (tab: 'chat' | 'github' | 'analyzer' | 'knowledge') => void;
  setMiniBrowserOpen: (open: boolean) => void;
  setMiniBrowserUrl: (url: string) => void;
  setMiniBrowserDocked?: (docked: boolean) => void;
  setRightSidebarHidden?: (hidden: boolean) => void;
  newConversation?: () => void;
  setConversationForPanel?: (panelId: string, conversationId: string | null) => void;
  openPanel?: (conversationId: string | null) => void;
  resetSession?: () => void;
  stopAgent?: () => void;
  renameConversation?: (title: string) => void;
  retryMessage?: () => void;
  undoMessage?: () => void;
  approveCommand?: () => void;
  denyCommand?: () => void;
  compressContext?: () => void;
  resumeSession?: (sessionId?: string) => Promise<string>;
}

function callbackUnavailable(): string {
  return 'This command is not available in the current context.';
}

/** Mirrors hermes-bridge/hermes_ops.py build_compress_user_message(). */
export const COMPRESS_CONTEXT_MESSAGE =
  'Please run context compression now using your /compress capability ' +
  '(or equivalent compression tool). Summarize older turns and free context ' +
  'while preserving task-critical facts, open todos, and recent tool results. ' +
  'Confirm when compression is complete.';

// 'local' = handled locally in CloudChat (intercepted, runs a handler).
// 'skill' = a hermes-agent skill; sent to the bridge, which expands & runs it.
// 'forwarded' = inserted into the composer and forwarded as raw slash text.
export type HermesCommandKind = 'local' | 'skill' | 'forwarded';

export interface HermesCommand {
  name: string;
  description: string;
  usage: string;
  kind: HermesCommandKind;
  category?: string;
  aliases?: string[];
  // Only local commands carry a handler; skill/forwarded commands are sent
  // to the bridge instead of being intercepted.
  handler?: (args: string, context: CommandContext) => Promise<string>;
}

const COMMANDS: HermesCommand[] = [
  {
    name: 'overview',
    description: 'Open the Hermes overview tab',
    usage: '/overview',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('overview');
      return 'Switched to Overview tab.';
    },
  },
  {
    name: 'cron',
    description: 'Manage cron jobs',
    usage: '/cron list | /cron create <schedule> <prompt> | /cron pause <id> | /cron resume <id> | /cron delete <id>',
    kind: 'local',
    handler: async (args, context) => {
      context.setActiveSubTab('cron');
      const parts = args.trim().split(/\s+/);
      const action = parts[0]?.toLowerCase();

      if (!action) {
        return 'Switched to Cron tab. Use /cron list to see jobs.';
      }

      switch (action) {
        case 'list':
          return 'Switched to Cron tab. Listing cron jobs...';
        case 'create':
          return 'Switched to Cron tab. Use the Cron tab UI to create a new job.';
        case 'pause':
          return `Switched to Cron tab. Pausing cron job ${parts[1] || ''}...`;
        case 'resume':
          return `Switched to Cron tab. Resuming cron job ${parts[1] || ''}...`;
        case 'delete':
          return `Switched to Cron tab. Deleting cron job ${parts[1] || ''}...`;
        default:
          return `Unknown cron action: ${action}. Available: list, create, pause, resume, delete`;
      }
    },
  },
  {
    name: 'memories',
    description: 'Open the Hermes memories editor',
    usage: '/memories',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('memories');
      return 'Switched to Memories tab.';
    },
  },
  {
    name: 'skills',
    description: 'Open the Hermes skills browser',
    usage: '/skills',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('skills');
      return 'Switched to Skills tab.';
    },
  },
  {
    name: 'usage',
    description: 'Open the Hermes usage dashboard',
    usage: '/usage',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('usage');
      return 'Switched to Usage tab.';
    },
  },
  {
    name: 'sessions',
    description: 'Switch to Sessions tab',
    usage: '/sessions',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('chats');
      return 'Switched to Sessions tab.';
    },
  },
  {
    name: 'chats',
    description: 'Switch to Sessions tab',
    usage: '/chats',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('chats');
      return 'Switched to Sessions tab.';
    },
  },
  {
    name: 'threads',
    description: 'Switch to Threads tab',
    usage: '/threads',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('threads');
      return 'Switched to Threads tab.';
    },
  },
  {
    name: 'queue',
    description: 'Open the Hermes queue monitor',
    usage: '/queue',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveSubTab('queue');
      return 'Switched to Queue tab.';
    },
  },
  {
    name: 'github',
    description: 'Switch to GitHub tab',
    usage: '/github',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveTab('github');
      return 'Switched to GitHub tab.';
    },
  },
  {
    name: 'analyzer',
    description: 'Switch to Analyzer tab',
    usage: '/analyzer',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveTab('analyzer');
      return 'Switched to Analyzer tab.';
    },
  },
  {
    name: 'knowledge',
    description: 'Switch to Knowledge tab',
    usage: '/knowledge',
    kind: 'local',
    handler: async (_args, context) => {
      context.setActiveTab('knowledge');
      return 'Switched to Knowledge tab.';
    },
  },
  {
    name: 'browse',
    description: 'Open the mini-browser with a URL',
    usage: '/browse <url>',
    kind: 'local',
    handler: async (args, context) => {
      const url = args.trim();
      if (!url) {
        return 'Usage: /browse <url>';
      }

      let resolvedUrl = url;
      if (!/^https?:\/\//i.test(resolvedUrl)) {
        resolvedUrl = `https://${resolvedUrl}`;
      }

      context.setMiniBrowserUrl(resolvedUrl);
      context.setMiniBrowserDocked?.(true);
      context.setRightSidebarHidden?.(false);
      context.setMiniBrowserOpen(true);
      return `Opening ${resolvedUrl} in mini-browser.`;
    },
  },
  {
    name: 'new',
    description: 'Start a new conversation',
    usage: '/new',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.newConversation) return callbackUnavailable();
      context.newConversation();
      return 'Starting new conversation.';
    },
  },
  {
    name: 'reset',
    description: 'Reset the current conversation session',
    usage: '/reset',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.resetSession) return callbackUnavailable();
      context.resetSession();
      return 'Conversation session reset.';
    },
  },
  {
    name: 'stop',
    description: 'Stop the running agent',
    usage: '/stop',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.stopAgent) return callbackUnavailable();
      context.stopAgent();
      return 'Agent stopped.';
    },
  },
  {
    name: 'title',
    description: 'Set the conversation title',
    usage: '/title <name>',
    kind: 'local',
    handler: async (args, context) => {
      const title = args.trim();
      if (!title) return 'Usage: /title <name>';
      if (!context.renameConversation) return callbackUnavailable();
      context.renameConversation(title);
      return `Conversation renamed to "${title}".`;
    },
  },
  {
    name: 'retry',
    description: 'Retry the last message',
    usage: '/retry',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.retryMessage) return callbackUnavailable();
      context.retryMessage();
      return 'Retrying last message.';
    },
  },
  {
    name: 'undo',
    description: 'Remove the last exchange',
    usage: '/undo',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.undoMessage) return callbackUnavailable();
      context.undoMessage();
      return 'Last exchange removed.';
    },
  },
  {
    name: 'approve',
    description: 'Approve the pending dangerous command',
    usage: '/approve',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.approveCommand) return callbackUnavailable();
      context.approveCommand();
      return 'Approved.';
    },
  },
  {
    name: 'deny',
    description: 'Deny the pending dangerous command',
    usage: '/deny',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.denyCommand) return callbackUnavailable();
      context.denyCommand();
      return 'Denied.';
    },
  },
  {
    name: 'compress',
    description: 'Manually trigger context compression',
    usage: '/compress',
    kind: 'local',
    handler: async (_args, context) => {
      if (!context.compressContext) return callbackUnavailable();
      context.compressContext();
      return 'Compressing context...';
    },
  },
  {
    name: 'moa',
    description: 'Forward a prompt to Hermes MoA execution',
    usage: '/moa <prompt>',
    kind: 'forwarded',
  },
  {
    name: 'goal',
    description: 'Forward a standing-goal command to Hermes',
    usage: '/goal <objective>',
    kind: 'forwarded',
  },
  {
    name: 'rollback',
    description: 'Forward a checkpoint restore command to Hermes',
    usage: '/rollback [number]',
    kind: 'forwarded',
  },
  {
    name: 'resume',
    description: 'Attach a Hermes session so the next message continues it',
    usage: '/resume [session-id]',
    kind: 'local',
    handler: async (args, context) => {
      if (!context.resumeSession) return callbackUnavailable();
      try {
        return await context.resumeSession(args.trim() || undefined);
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to resume session.';
      }
    },
  },
  {
    name: 'help',
    description: 'List available Hermes commands',
    usage: '/help',
    kind: 'local',
    handler: async () => {
      const labelForKind: Record<HermesCommandKind, string> = {
        local: 'local',
        skill: 'skill-expanded',
        forwarded: 'forwarded',
      };
      const lines = allCommands().map(
        (cmd) => `  ${cmd.usage.split('|')[0].trim()}  — ${cmd.description} [${labelForKind[cmd.kind]}]`
      );
      return 'Hermes Commands:\n' + lines.join('\n');
    },
  },
];

export { COMMANDS };

let DYNAMIC_COMMANDS: HermesCommand[] = [];
let agentCommandsResolved = false;
let agentCommandsInflight: Promise<void> | null = null;

function normalizeDynamicCommand(command: HermesAgentCommand): HermesCommand {
  return {
    ...command,
    kind: command.kind === 'skill' ? 'skill' : 'forwarded',
  };
}

export function setHermesAgentCommands(commands: HermesAgentCommand[]): void {
  const localNames = new Set(COMMANDS.map((c) => c.name));
  const seen = new Set<string>();
  DYNAMIC_COMMANDS = commands
    .map(normalizeDynamicCommand)
    .filter((c) => {
      if (localNames.has(c.name) || seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
  agentCommandsResolved = true;
}

export function agentCommandsAlreadyLoaded(): boolean {
  return agentCommandsResolved;
}

export function ensureHermesAgentCommandsLoaded(): Promise<void> {
  if (agentCommandsResolved) return Promise.resolve();
  if (agentCommandsInflight) return agentCommandsInflight;

  agentCommandsInflight = (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const commands = await fetchHermesAgentCommands();
        if (commands.length) setHermesAgentCommands(commands);
        agentCommandsResolved = true;
        return;
      } catch (err) {
        if (err instanceof HermesApiError && err.status >= 400 && err.status < 500) {
          agentCommandsResolved = true;
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    agentCommandsResolved = true;
  })();

  void agentCommandsInflight.finally(() => {
    agentCommandsInflight = null;
  });

  return agentCommandsInflight;
}

function allCommands(): HermesCommand[] {
  return DYNAMIC_COMMANDS.length ? [...COMMANDS, ...DYNAMIC_COMMANDS] : COMMANDS;
}

export function parseCommand(
  input: string
): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }

  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1),
  };
}

export function findCommand(name: string): HermesCommand | undefined {
  return allCommands().find(
    (cmd) => cmd.name === name || cmd.aliases?.includes(name)
  );
}

export function filterCommands(partial: string): HermesCommand[] {
  const query = partial.toLowerCase().replace(/^\//, '');
  const commands = allCommands();
  if (!query) return commands;
  return commands.filter(
    (cmd) =>
      cmd.name.startsWith(query) ||
      cmd.aliases?.some((a) => a.startsWith(query)) ||
      cmd.description.toLowerCase().includes(query)
  );
}

export const SUBTAB_NAV_COMMANDS = new Set([
  'overview', 'cron', 'memories', 'skills', 'usage', 'sessions', 'chats', 'threads', 'queue',
]);

export function commandTakesArgs(cmd: HermesCommand): boolean {
  return cmd.usage.includes('<');
}

export function describeCommandExecution(cmd: HermesCommand): string {
  switch (cmd.kind) {
    case 'local':
      return 'Runs inside CloudChat immediately';
    case 'skill':
      return 'Expanded by the Hermes bridge before agent execution';
    case 'forwarded':
    default:
      return 'Forwarded to Hermes as raw slash text';
  }
}
