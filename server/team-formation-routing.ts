/**
 * team-formation-routing.ts — Map analyzeTask() strategies to execution backends.
 *
 * Phase 9.4: formation intelligence must change runtime behavior, not only logs.
 */

import type { FormationResult } from './team-formation.js';

export type FormationStrategy = FormationResult['strategy'];

/** Runtime dispatch target for a kanban card or team task. */
export type ExecutionBackend =
  | 'agent_loop'       // single kanban agent subprocess (one worker/card)
  | 'team_fanout'      // team-coordinator multi-profile fan-out
  | 'fleet_swarm'      // Hermes kanban swarm graph (hermes_ops / API)
  | 'review_pipeline'; // single agent with architect→implementor→reviewer hint

export interface ExecutionRoute {
  backend: ExecutionBackend;
  strategy: FormationStrategy;
  reason: string;
}

export interface ResolveExecutionBackendOptions {
  /** Explicit team mode on the card forces team_fanout unless strategy is swarm/pipeline. */
  teamMode?: boolean;
}

/**
 * Map a formation analysis result to the execution backend that should run the task.
 */
export function resolveExecutionBackend(
  formation: FormationResult,
  options?: ResolveExecutionBackendOptions,
): ExecutionRoute {
  const teamMode = options?.teamMode === true;
  const strategy = formation.strategy;

  if (strategy === 'swarm') {
    return {
      backend: 'fleet_swarm',
      strategy,
      reason: `strategy=swarm → fleet_swarm (Hermes kanban swarm graph)`,
    };
  }

  if (strategy === 'pipeline') {
    return {
      backend: 'review_pipeline',
      strategy,
      reason: `strategy=pipeline → review_pipeline (architect→implementor→reviewer execution hint)`,
    };
  }

  if (strategy === 'single_agent' && !teamMode) {
    return {
      backend: 'agent_loop',
      strategy,
      reason: `strategy=single_agent → agent_loop (single kanban worker)`,
    };
  }

  if (strategy === 'pair_programming') {
    return {
      backend: 'team_fanout',
      strategy,
      reason: `strategy=pair_programming → team_fanout (2-profile team dispatch)`,
    };
  }

  if (strategy === 'specialist_team') {
    return {
      backend: 'team_fanout',
      strategy,
      reason: `strategy=specialist_team → team_fanout (multi-profile kanban fan-out)`,
    };
  }

  // teamMode on an otherwise single-agent task
  return {
    backend: 'team_fanout',
    strategy,
    reason: teamMode
      ? `teamMode=true → team_fanout (overrides single_agent)`
      : `strategy=${strategy} → team_fanout`,
  };
}

/** Human-readable strategy → backend table for logs and tests. */
export const STRATEGY_BACKEND_MAP: Record<FormationStrategy, ExecutionBackend> = {
  single_agent: 'agent_loop',
  pair_programming: 'team_fanout',
  specialist_team: 'team_fanout',
  swarm: 'fleet_swarm',
  pipeline: 'review_pipeline',
};
