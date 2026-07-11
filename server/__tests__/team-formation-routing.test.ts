import { describe, expect, it } from 'vitest'
import { analyzeTask } from '../team-formation'
import {
  resolveExecutionBackend,
  STRATEGY_BACKEND_MAP,
} from '../team-formation-routing'

const agents = [
  { name: 'alice', displayName: 'Alice', expertise: ['frontend', 'react'] },
  { name: 'bob', displayName: 'Bob', expertise: ['backend', 'python'] },
  { name: 'carol', displayName: 'Carol', expertise: ['testing', 'jest'] },
]

describe('resolveExecutionBackend', () => {
  it('maps single_agent to agent_loop', () => {
    const formation = analyzeTask('Fix button color', agents)
    const route = resolveExecutionBackend(formation)
    expect(route.backend).toBe('agent_loop')
    expect(route.strategy).toBe('single_agent')
    expect(route.reason).toContain('agent_loop')
  })

  it('maps swarm to fleet_swarm', () => {
    const formation = analyzeTask('swarm on everything', agents)
    const route = resolveExecutionBackend(formation)
    expect(route.backend).toBe('fleet_swarm')
    expect(route.strategy).toBe('swarm')
    expect(route.reason).toContain('fleet_swarm')
  })

  it('maps pipeline to review_pipeline', () => {
    const formation = analyzeTask('design the system, implement the code, test the changes', agents)
    const route = resolveExecutionBackend(formation)
    expect(route.backend).toBe('review_pipeline')
    expect(route.strategy).toBe('pipeline')
    expect(route.reason).toContain('review_pipeline')
  })

  it('maps specialist_team to team_fanout', () => {
    const formation = analyzeTask('Build frontend and backend API with tests', agents)
    const route = resolveExecutionBackend(formation)
    expect(route.backend).toBe('team_fanout')
    expect(route.strategy).toBe('specialist_team')
  })

  it('maps pair_programming to team_fanout', () => {
    const formation = analyzeTask('refactor the auth module and review the changes', agents)
    const route = resolveExecutionBackend(formation)
    expect(route.backend).toBe('team_fanout')
    expect(route.strategy).toBe('pair_programming')
  })

  it('teamMode forces team_fanout for single_agent', () => {
    const formation = analyzeTask('Fix button color', agents)
    const route = resolveExecutionBackend(formation, { teamMode: true })
    expect(route.backend).toBe('team_fanout')
    expect(route.reason).toContain('teamMode')
  })

  it('teamMode does not override swarm → fleet_swarm', () => {
    const formation = analyzeTask('swarm everything', agents)
    const route = resolveExecutionBackend(formation, { teamMode: true })
    expect(route.backend).toBe('fleet_swarm')
  })

  it('teamMode does not override pipeline → review_pipeline', () => {
    const formation = analyzeTask('plan the sprint, build the feature, review the PR', agents)
    const route = resolveExecutionBackend(formation, { teamMode: true })
    expect(route.backend).toBe('review_pipeline')
  })
})

describe('STRATEGY_BACKEND_MAP', () => {
  it('defines expected strategy → backend mappings', () => {
    expect(STRATEGY_BACKEND_MAP.single_agent).toBe('agent_loop')
    expect(STRATEGY_BACKEND_MAP.pair_programming).toBe('team_fanout')
    expect(STRATEGY_BACKEND_MAP.specialist_team).toBe('team_fanout')
    expect(STRATEGY_BACKEND_MAP.swarm).toBe('fleet_swarm')
    expect(STRATEGY_BACKEND_MAP.pipeline).toBe('review_pipeline')
  })
})
