import { logger } from './lib/logger';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

import { teamCoordinator } from './team-coordinator';
import { analyzeTask } from './team-formation';
import {
  resolveExecutionBackend,
  type ExecutionBackend,
  type ExecutionRoute,
} from './team-formation-routing';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ActiveTask {
  cardId: string;
  conversationId: string;
  startedAt: number;
}

export interface OrchestratorStatus {
  enabled: boolean;
  activeTasks: ActiveTask[];
  maxConcurrent: number;
  stats: { completed: number; failed: number; startedAt: number | null };
};

export type QueueCardStatus = 'queued' | 'running' | 'done' | 'review' | 'blocked' | 'failed';

export interface QueueCard {
  id: string;
  title: string;
  spec: string;
  acceptanceCriteria: string[];
  assignedWorker: string | null;
  status: QueueCardStatus;
  startedAt?: number;
  completedAt?: number;
  reportSummary?: string;
}

export interface QueueState {
  queued: QueueCard[];
  running: QueueCard[];
  completed: QueueCard[];
  stats: { completed: number; failed: number };
  enabled: boolean;
}

interface CardRecord {
  id: string;
  title: string;
  status: string;
  spec: string;
  acceptanceCriteria: string[];
  teamMode?: boolean;
}

// ─── Orchestrator Singleton ─────────────────────────────────────────────────

const API_BASE = process.env.CLOUDCHAT_API_BASE || 'http://localhost:3001';

// ─── Agent lifecycle limits ────────────────────────────────────────────────

// Hard cap on how long a single kanban agent subprocess may run before it is
// killed (crashed or hung agents must not occupy a maxConcurrent slot forever).
const MAX_AGENT_RUNTIME_MS = Number(process.env.KANBAN_AGENT_MAX_RUNTIME_MS) || 2 * 60 * 60 * 1000;
// Stale activeTasks entries (no live child, card stuck in 'running') are reaped
// after this TTL and reconciled against the kanban board.
const ACTIVE_TASK_TTL_MS = Number(process.env.KANBAN_ACTIVE_TASK_TTL_MS) || 6 * 60 * 60 * 1000;
// Cap buffered agent stdout/stderr (head/tail window) so a chatty agent can't
// accumulate unbounded strings in memory.
const MAX_AGENT_LOG_BYTES = 64 * 1024;

const state = {
  activeTasks: new Map<string, ActiveTask>(),
  enabled: false,
  maxConcurrent: Number(process.env.KANBAN_MAX_CONCURRENT_TASKS) || 3,
  pollInterval: Number(process.env.KANBAN_POLL_INTERVAL_MS) || 5000,
  isProcessing: false,
  intervalId: null as ReturnType<typeof setInterval> | null,
  stats: { completed: 0, failed: 0, startedAt: null as number | null },
  // cardId → spawned agent subprocess, tracked so cancelTask/timeouts can kill it.
  children: new Map<string, ChildProcess>(),
};

// Cards whose agent was intentionally terminated (cancel/timeout kill) — their
// close handler must not treat the kill as a crash and mark the card failed.
const cancelledChildren = new Set<string>();

/** SIGTERM a child, escalating to SIGKILL if it ignores the signal. */
function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return; // already exited
  try {
    child.kill('SIGTERM');
  } catch {
    return; // process already gone
  }
  const grace = setTimeout(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, 5000);
  grace.unref?.();
}

/**
 * Append to a capped log buffer keeping a head/tail window. Once truncated,
 * the head window is dropped and the tail stays fresh so the end of the
 * agent's output (usually the most useful part) remains readable.
 */
function appendCappedLog(current: string, chunk: string, maxBytes: number): string {
  if (current.length >= maxBytes) {
    return current.slice(-(maxBytes / 2)) + chunk;
  }
  const next = current + chunk;
  if (next.length <= maxBytes) return next;
  const head = Math.floor(maxBytes / 2);
  const tail = maxBytes - head - 64;
  return `${next.slice(0, head)}\n...[truncated ${next.length - maxBytes} bytes]...\n${next.slice(-tail)}`;
}

// ─── Card fetcher ──────────────────────────────────────────────────────────

async function fetchCards(status: string): Promise<CardRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/api/hermes/kanban?status=${encodeURIComponent(status)}`);
    if (!res.ok) return [];
    const data = await res.json() as { cards?: CardRecord[] };
    return data.cards ?? [];
  } catch {
    return [];
  }
}

async function updateCardStatus(cardId: string, status: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/hermes/kanban/${cardId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createConversation(title: string, systemPrompt?: string, tags?: string[]): Promise<string | null> {
  const id = randomUUID();
  try {
    const body: Record<string, unknown> = {
      id,
      title,
      provider: 'hermes',
      model: 'default',
      systemPrompt: systemPrompt || '',
      tags: tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const res = await fetch(`${API_BASE}/functions/v1/chat-store/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok ? id : null;
  } catch {
    return null;
  }
}

// ─── System prompt builder ─────────────────────────────────────────────────

function buildKanbanTaskPrompt(card: CardRecord): string {
  const lines = [
    'You are working on a Kanban task card. Use the kanban tools to read card details and report progress.',
    '',
    `Title: ${card.title}`,
  ];

  if (card.spec?.trim()) {
    lines.push('', 'Spec:', card.spec.trim());
  }

  if (card.acceptanceCriteria?.length > 0) {
    lines.push('', 'Acceptance criteria:');
    for (const c of card.acceptanceCriteria) {
      lines.push(`- ${c}`);
    }
  }

  lines.push(
    '',
    'Available kanban tools:',
    '- kanban_show — read the full card details and status',
    '- kanban_complete — mark the task as done with a summary of what was accomplished',
    '- kanban_block — mark the task as blocked with a reason explaining what\'s needed',
    '- kanban_heartbeat — signal you\'re still working during long operations',
    '- kanban_comment — append progress notes without changing status',
    '',
    'When you complete the task, call kanban_complete with a summary of what was accomplished.',
  );

  return lines.join('\n');
}

// ─── Completion detection ─────────────────────────────────────────────────

async function detectCompletions(): Promise<void> {
  if (state.activeTasks.size === 0) return;

  // Fetch all running cards from the API
  const runningCards = await fetchCards('running');
  const runningIds = new Set(runningCards.map((c) => c.id));
  const cardById = new Map((await fetchCards('')).map((c) => [c.id, c]));

  // Find tracked cards that are no longer running (moved by the agent)
  for (const [cardId, _task] of state.activeTasks) {
    if (!runningIds.has(cardId)) {
      // Card was moved out of running by the agent's kanban_update_status call
      state.activeTasks.delete(cardId);

      // Try to determine the final status
      const card = cardById.get(cardId);
      const finalStatus = card?.status || 'unknown';

      if (finalStatus === 'done') {
        state.stats.completed++;
      } else if (finalStatus === 'blocked') {
        state.stats.failed++;
      }

      logger.info(
        `[orchestrator] Card "${cardId.slice(0, 12)}..." completed → ${finalStatus} (freed slot)`,
      );
    }
  }
}

// ─── Stale task reaper ─────────────────────────────────────────────────────

/**
 * Reap activeTasks entries that have outlived ACTIVE_TASK_TTL_MS — crashed,
 * hung, or orphaned agents leave cards 'running' forever and leak a
 * maxConcurrent slot. Entries are reconciled against the kanban board:
 * a card that already left 'running' is freed and its final transition counted
 * once; a card still 'running' with no live agent is killed/marked failed.
 */
async function reapStaleTasks(): Promise<void> {
  if (state.activeTasks.size === 0) return;

  const now = Date.now();
  const stale = Array.from(state.activeTasks.entries()).filter(
    ([, task]) => now - task.startedAt > ACTIVE_TASK_TTL_MS,
  );
  if (stale.length === 0) return;

  const cardById = new Map((await fetchCards('')).map((c) => [c.id, c]));

  for (const [cardId, _task] of stale) {
    const status = cardById.get(cardId)?.status;

    if (status && status !== 'running') {
      // Agent finished but the slot was never released — count the transition now.
      state.activeTasks.delete(cardId);
      if (status === 'done') {
        state.stats.completed++;
      } else if (status === 'blocked' || status === 'failed') {
        state.stats.failed++;
      }
      logger.warn(
        `[orchestrator] Reaped stale task ${cardId.slice(0, 12)}... (final status ${status})`,
      );
      continue;
    }

    // Still running (or unknown): the agent is gone or hung — kill any leftover
    // child and mark the card failed so the slot frees and the card surfaces.
    const child = state.children.get(cardId);
    if (child) terminateChild(child);
    state.activeTasks.delete(cardId);
    state.stats.failed++;
    updateCardStatus(cardId, 'failed').catch(() => {});
    logger.warn(
      `[orchestrator] Reaped stale task ${cardId.slice(0, 12)}... (running > ${ACTIVE_TASK_TTL_MS}ms) — marked failed`,
    );
  }
}

// ─── Poll tick ──────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (state.isProcessing || !state.enabled) return;
  state.isProcessing = true;

  try {
    // Check if any tracked cards have been moved out of 'running' by the agent
    await detectCompletions();
    // Free slots held by crashed/hung/orphaned agents
    await reapStaleTasks();

    const readyCards = await fetchCards('ready');
    const available = state.maxConcurrent - state.activeTasks.size;

    if (available <= 0 || readyCards.length === 0) return;

    const toDispatch = readyCards
      .filter((card) => !state.activeTasks.has(card.id))
      .slice(0, available);

    for (const card of toDispatch) {
      try {
        // Build system prompt from card
        const systemPrompt = buildKanbanTaskPrompt(card);

        // Create a conversation to track the task
        const conversationId = await createConversation(
          `[Task] ${card.title}`,
          systemPrompt,
          ['kanban-task'],
        );
        if (!conversationId) {
          logger.warn(`[orchestrator] Failed to create conversation for card ${card.id}`);
          continue;
        }

        // Re-check after the await — dispatchCard or a concurrent tick may have
        // claimed this card while createConversation was in flight.
        if (state.activeTasks.has(card.id)) continue;

        // Claim the slot synchronously so concurrent paths skip this card.
        state.activeTasks.set(card.id, {
          cardId: card.id,
          conversationId,
          startedAt: Date.now(),
        });

        // Mark card as running. Only spawn if the PATCH actually succeeded —
        // a failed PATCH means the claim didn't stick (e.g. another process
        // moved the card) and spawning would risk a duplicate agent.
        const claimed = await updateCardStatus(card.id, 'running');
        if (!claimed) {
          state.activeTasks.delete(card.id);
          logger.warn(
            `[orchestrator] Failed to mark card "${card.title}" (${card.id}) running — leaving for retry`,
          );
          continue;
        }

        // Re-check after the await — a cancel may have freed the claim while
        // the PATCH was in flight; don't spawn an agent for a cancelled card.
        if (!state.activeTasks.has(card.id)) continue;

        logger.info(
          `[orchestrator] Dispatched card "${card.title}" (${card.id}) → conversation ${conversationId}`,
        );

        // Route by formation strategy → execution backend
        const taskText = `${card.title} ${card.spec ?? ''}`;
        const formation = analyzeTask(taskText, []);
        const route = resolveExecutionBackend(formation, { teamMode: card.teamMode });
        void dispatchByRoute(card, route, formation).catch((err) => {
          logger.error(`[orchestrator] Dispatch failed for card ${card.id} (${route.backend}), reverting:`, err);
          state.activeTasks.delete(card.id);
          updateCardStatus(card.id, 'ready').catch(() => {});
        });
      } catch (err) {
        logger.error(`[orchestrator] Failed to dispatch card ${card.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        // Roll back: remove from active tasks, set card back to ready
        state.activeTasks.delete(card.id);
        await updateCardStatus(card.id, 'ready').catch(() => {});
      }
    }
  } finally {
    state.isProcessing = false;
  }
}

// ─── Background agent runner ────────────────────────────────────────────────

// Resolve scripts directory relative to project root. Works for both tsx (live)
// and bundled Electron (where import.meta.url points to out/main/index.js).
const SCRIPTS_DIR = (() => {
  // Check if we're running from source (tsx) or bundle (Electron)
  const sourceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scripts');
  if (fs.existsSync(sourceDir)) return sourceDir;
  // Fallback: bundle path — go up from out/main/ to project root
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'scripts');
})();

/**
 * Spawn a background kanban agent process for a specific card.
 * The agent runs via the Python runner script which loads HermesAgentAdapter
 * (real Hermes agent) and processes the card autonomously.
 * The agent uses kanban_tools (kanban_read_current_card, kanban_update_status,
 * kanban_append_report) to report progress back to the kanban API.
 */
interface SpawnKanbanAgentOptions {
  useWorktree?: boolean;
  executionBackend?: ExecutionBackend;
}

async function spawnKanbanAgent(cardId: string, options: SpawnKanbanAgentOptions = {}): Promise<void> {
  const useWorktree = options.useWorktree === true;
  const executionBackend = options.executionBackend;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const venvDir = process.env.HERMES_BRIDGE_VENV || (() => {
    const candidates = [
      path.join(repoRoot, 'hermes-bridge', '.venv'),
      path.join(repoRoot, 'hermes-bridge', 'venv'),
      path.join(SCRIPTS_DIR, '..', '..', 'hermes-bridge', '.venv'),
      path.join(SCRIPTS_DIR, '..', '..', 'hermes-bridge', 'venv'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.join(repoRoot, 'hermes-bridge', 'venv'); // fallback
  })();
  const pythonBin = path.join(venvDir, 'bin', 'python3');
  const scriptPath = path.join(SCRIPTS_DIR, 'run-kanban-agent.py');

  if (!fs.existsSync(scriptPath)) {
    logger.error(`[orchestrator] Kanban agent runner script not found: ${scriptPath}`);
    return;
  }

  const child = spawn(pythonBin, [scriptPath], {
    env: {
      ...process.env,
      KANBAN_CARD_ID: cardId,
      CLOUDCHAT_API_BASE: API_BASE,
      ...(useWorktree || process.env.HERMES_WORKTREE === '1' ? { HERMES_WORKTREE: '1' } : {}),
      ...(executionBackend ? { FORMATION_EXECUTION_BACKEND: executionBackend } : {}),
      ...(executionBackend === 'review_pipeline' ? { HERMES_EXECUTION_MODE: 'swarm' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  state.children.set(cardId, child);

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data: Buffer) => {
    stdout = appendCappedLog(stdout, data.toString(), MAX_AGENT_LOG_BYTES);
  });

  child.stderr.on('data', (data: Buffer) => {
    stderr = appendCappedLog(stderr, data.toString(), MAX_AGENT_LOG_BYTES);
  });

  // Watchdog: kill agents that exceed the runtime limit so a hung agent can't
  // occupy a maxConcurrent slot (or re-complete a card) forever.
  let timedOut = false;
  const runtimeTimer = setTimeout(() => {
    timedOut = true;
    logger.error(
      `[orchestrator] Kanban agent for card ${cardId.slice(0, 12)}... exceeded ${MAX_AGENT_RUNTIME_MS}ms runtime limit — terminating`,
    );
    terminateChild(child);
  }, MAX_AGENT_RUNTIME_MS);
  runtimeTimer.unref?.();

  child.on('close', (code: number | null) => {
    clearTimeout(runtimeTimer);
    state.children.delete(cardId);

    const wasCancelled = cancelledChildren.has(cardId);
    cancelledChildren.delete(cardId);

    const exitCode = code ?? -1;

    if (timedOut) {
      logger.error(`[orchestrator] Kanban agent for card ${cardId.slice(0, 12)}... killed after exceeding runtime limit`);
    } else if (exitCode !== 0 && !wasCancelled) {
      logger.error(`[orchestrator] Kanban agent for card ${cardId.slice(0, 12)}... exited with code ${exitCode}`);
      if (stderr) logger.error(`[orchestrator] stderr: ${stderr.slice(0, 500)}`);
    } else if (exitCode === 0) {
      logger.info(`[orchestrator] Kanban agent for card ${cardId.slice(0, 12)}... completed successfully`);
    }

    // Log brief stdout summary
    const stdoutLines = stdout.trim().split('\n').filter(l => l.includes('[kanban-runner]'));
    for (const line of stdoutLines) {
      logger.info(line);
    }

    // Abrupt termination (timeout kill or crash) that wasn't a user cancel:
    // reconcile with the board before touching the card. If it's still
    // 'running' with no live agent, free the slot and mark it failed so it
    // doesn't leak a maxConcurrent slot forever; if it already left 'running'
    // (e.g. the agent completed the card right before dying), leave the board
    // alone and let detectCompletions free the slot and count the transition.
    if ((timedOut || (exitCode !== 0 && !wasCancelled)) && state.activeTasks.has(cardId)) {
      void (async () => {
        try {
          const cards = await fetchCards('');
          const card = cards.find((c) => c.id === cardId);
          if (!card || card.status === 'running') {
            state.activeTasks.delete(cardId);
            state.stats.failed++;
            updateCardStatus(cardId, 'failed').catch(() => {});
          }
        } catch {
          state.activeTasks.delete(cardId);
          state.stats.failed++;
        }
      })();
    }
  });

  child.on('error', (err: Error) => {
    logger.error(`[orchestrator] Failed to spawn kanban agent: ${err.message}`);
  });
}

// ─── Formation-routed dispatch ──────────────────────────────────────────────

async function dispatchAsFleetSwarm(card: CardRecord, formation: ReturnType<typeof analyzeTask>): Promise<void> {
  const goal = [card.title, card.spec].filter((s) => s && String(s).trim()).join(': ');
  const body: Record<string, unknown> = { goal };
  if (formation.recommendedAgents?.length) {
    body.workers = formation.recommendedAgents;
  }

  logger.info(
    `[orchestrator] Routing card "${card.title}" (${card.id.slice(0, 12)}...) → fleet_swarm`,
  );

  const res = await fetch(`${API_BASE}/api/hermes/kanban/swarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Fleet swarm create failed (${res.status})`);
  }

  await fetch(`${API_BASE}/api/hermes/kanban/${card.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'done',
      reportPath: 'Delegated to Hermes fleet swarm graph',
    }),
  });
  state.activeTasks.delete(card.id);
  state.stats.completed++;

  logger.info(`[orchestrator] Fleet swarm created for card "${card.title}"`);
}

async function dispatchByRoute(
  card: CardRecord,
  route: ExecutionRoute,
  formation: ReturnType<typeof analyzeTask>,
  options?: SpawnKanbanAgentOptions,
): Promise<void> {
  logger.info(
    `[orchestrator] Card "${card.title}" strategy=${route.strategy} → backend=${route.backend} (${route.reason})`,
  );

  switch (route.backend) {
    case 'fleet_swarm':
      await dispatchAsFleetSwarm(card, formation);
      return;
    case 'review_pipeline':
      void spawnKanbanAgent(card.id, { ...options, executionBackend: 'review_pipeline' });
      return;
    case 'team_fanout':
      await dispatchAsTeam(card);
      return;
    case 'agent_loop':
    default:
      void spawnKanbanAgent(card.id, options);
      return;
  }
}

// ─── Team dispatch helper ───────────────────────────────────────────────────

/**
 * Dispatch a kanban card as a multi-agent team.
 * Falls back to single-agent dispatch on failure.
 */
async function dispatchAsTeam(card: CardRecord): Promise<void> {
  try {
    // Create the team
    const team = await teamCoordinator.createTeam(card);

    // Decompose the task into subtasks
    const subtasks = await teamCoordinator.decomposeTask(card);

    // Assign subtasks to agents
    const assigned = teamCoordinator.assignSubtasks(subtasks, team.agents);
    team.subtasks = assigned;

    // Dispatch the team
    await teamCoordinator.dispatchTeam(team.id);

    logger.info(
      `[orchestrator] Team dispatched for card "${card.title}" — ${team.agents.length} agents, ${assigned.length} subtasks`,
    );
  } catch (err) {
    logger.error(`[orchestrator] Team dispatch failed for card ${card.id}, falling back to single agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
    // Graceful degradation: fall back to single-agent
    if (card.id) {
      void spawnKanbanAgent(card.id).catch(() => {});
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const taskOrchestrator = {
  start(): void {
    if (state.enabled) return;
    state.enabled = true;
    state.stats.startedAt = Date.now();
    state.intervalId = setInterval(() => void tick(), state.pollInterval);
    // Fire first tick immediately
    void tick();
    logger.info(`[orchestrator] Started (maxConcurrent=${state.maxConcurrent}, poll=${state.pollInterval}ms)`);
  },

  stop(): void {
    state.enabled = false;
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    logger.info('[orchestrator] Stopped');
  },

  getStatus(): OrchestratorStatus {
    return {
      enabled: state.enabled,
      activeTasks: Array.from(state.activeTasks.values()),
      maxConcurrent: state.maxConcurrent,
      stats: { ...state.stats },
    };
  },

  async dispatchNow(): Promise<{ dispatched: number }> {
    const before = state.activeTasks.size;
    await tick();
    return { dispatched: state.activeTasks.size - before };
  },

  /**
   * Dispatch a specific kanban card as a background agent task.
   * Spawns a Python subprocess that runs the Hermes AIAgent with
   * kanban tools. Does NOT create a chat panel or use any chat UI.
   */
  async dispatchCard(cardId: string, options?: { useWorktree?: boolean }): Promise<{ ok: boolean; error?: string }> {
    // Already running in this process — treat as success
    if (state.activeTasks.has(cardId)) {
      return { ok: true };
    }

    try {
      // Fetch the card
      const allCards = await fetchCards('');
      const card = allCards.find((c) => c.id === cardId);
      if (!card) {
        return { ok: false, error: 'Card not found' };
      }

      // Card is already running (dispatched by another process) — ack without
      // spawning and without tracking: we didn't dispatch it, so claiming a
      // maxConcurrent slot for it could leak the slot forever.
      if (card.status === 'running') {
        return { ok: true };
      }

      // Build system prompt
      const systemPrompt = buildKanbanTaskPrompt(card);

      // Create a conversation to track the task
      const conversationId = await createConversation(
        `[Task] ${card.title}`,
        systemPrompt,
        ['kanban-task'],
      );
      if (!conversationId) {
        return { ok: false, error: 'Failed to create conversation' };
      }

      // Re-check after the await — a tick or another dispatch may have claimed
      // this card while createConversation was in flight.
      if (state.activeTasks.has(cardId)) {
        return { ok: true };
      }

      // Claim the slot synchronously so concurrent paths skip this card.
      state.activeTasks.set(cardId, {
        cardId,
        conversationId,
        startedAt: Date.now(),
      });

      // Mark card as running. Only spawn if the PATCH actually succeeded.
      const claimed = await updateCardStatus(cardId, 'running');
      if (!claimed) {
        state.activeTasks.delete(cardId);
        logger.warn(`[orchestrator] Failed to mark card ${cardId.slice(0, 12)}... running — skipping dispatch`);
        return { ok: false, error: 'Failed to mark card as running' };
      }

      // Re-check after the await — a cancel may have freed the claim while the
      // PATCH was in flight; don't spawn an agent for a cancelled card.
      if (!state.activeTasks.has(cardId)) {
        return { ok: true };
      }

      // Route by formation strategy → execution backend
      const taskText = `${card.title} ${card.spec ?? ''}`;
      const formation = analyzeTask(taskText, []);
      const route = resolveExecutionBackend(formation, { teamMode: card.teamMode });
      void dispatchByRoute(card, route, formation, { useWorktree: options?.useWorktree === true }).catch((err) => {
        logger.error(`[orchestrator] Dispatch failed for card ${cardId} (${route.backend}), reverting:`, err);
        state.activeTasks.delete(cardId);
        updateCardStatus(cardId, 'ready').catch(() => {});
      });

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`[orchestrator] Failed to dispatch card ${cardId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // Roll back
      state.activeTasks.delete(cardId);
      await updateCardStatus(cardId, 'ready');
      return { ok: false, error: msg };
    }
  },

  async handleCardCompletion(cardId: string, cardStatus: 'review' | 'done' | 'blocked'): Promise<boolean> {
    const task = state.activeTasks.get(cardId);
    if (!task) return false;

    state.activeTasks.delete(cardId);

    if (cardStatus === 'done') {
      state.stats.completed++;
    } else if (cardStatus === 'blocked') {
      state.stats.failed++;
    }

    return true;
  },

    /**
   * Get full queue state with enriched card details.
   * Returns categorized cards (queued/ready, running, completed) with
   * kanban card data joined with orchestrator state.
   */
  async getQueueState(): Promise<QueueState> {
    // Fetch all kanban cards
    let allCards: unknown[] = [];
    try {
      const res = await fetch(`${API_BASE}/api/hermes/kanban`);
      if (res.ok) {
        const data = await res.json();
        allCards = data.cards ?? [];
      }
    } catch {
      // fallback to empty
    }

    // Build lookup map
    const cardMap = new Map<string, unknown>();
    for (const card of allCards) {
      const c = card as Record<string, unknown>;
      cardMap.set(c.id as string, card);
    }

    const queuedCards: QueueCard[] = [];
    const runningCards: QueueCard[] = [];
    const completedCards: QueueCard[] = [];
    const now = Date.now();
    // Stats are derived from the kanban board itself — this is a read endpoint
    // and must not mutate global state (counting every poll inflated the
    // counters unboundedly).
    let completed = 0;
    let failed = 0;

    for (const card of allCards) {
      const c = card as Record<string, unknown>;
      const status = c.status as string;
      const activeTask = state.activeTasks.get(c.id as string);
      const isRunning = status === 'running' || activeTask !== undefined;

      const queueCard: QueueCard = {
        id: c.id as string,
        title: (c.title as string) || 'Untitled',
        spec: (c.spec as string) || '',
        acceptanceCriteria: Array.isArray(c.acceptanceCriteria) ? c.acceptanceCriteria : [],
        assignedWorker: (c.assignedWorker as string) || null,
        status: 'queued',
        reportSummary: (c.reportPath as string) || undefined,
      };

      if (status === 'ready') {
        queueCard.status = 'queued';
        queuedCards.push(queueCard);
      } else if (isRunning) {
        queueCard.status = 'running';
        queueCard.startedAt = activeTask?.startedAt ?? now;
        runningCards.push(queueCard);
      } else if (status === 'done' || status === 'review') {
        queueCard.status = status as QueueCardStatus;
        queueCard.completedAt = (c.updatedAt as number) || now;
        completedCards.push(queueCard);
        if (status === 'done') completed++;
      } else if (status === 'blocked' || status === 'failed') {
        queueCard.status = status as QueueCardStatus;
        queueCard.completedAt = (c.updatedAt as number) || now;
        completedCards.push(queueCard);
        failed++;
      }
    }

    // Sort queued by updatedAt (oldest first), running by startedAt, completed by completedAt (newest first)
    const sortBy = (arr: QueueCard[], key: 'startedAt' | 'completedAt' | undefined, asc: boolean) => {
      return arr.sort((a, b) => {
        const aVal = key ? (a[key] ?? 0) : 0;
        const bVal = key ? (b[key] ?? 0) : 0;
        return asc ? aVal - bVal : bVal - aVal;
      });
    };

    return {
      queued: sortBy(queuedCards, undefined, true),
      running: sortBy(runningCards, 'startedAt', true),
      completed: sortBy(completedCards, 'completedAt', false).slice(0, 20), // keep last 20
      stats: { completed, failed },
      enabled: state.enabled,
    };
  },

async cancelTask(cardId: string): Promise<boolean> {
    const task = state.activeTasks.get(cardId);
    if (!task) return false;

    state.activeTasks.delete(cardId);

    // Terminate the spawned agent (if any) so a "cancelled" agent can't keep
    // running commands or re-complete the card. The child's close handler
    // removes it from the children map.
    const child = state.children.get(cardId);
    if (child) {
      cancelledChildren.add(cardId);
      terminateChild(child);
    }

    await updateCardStatus(cardId, 'ready');
    return true;
  },
};
