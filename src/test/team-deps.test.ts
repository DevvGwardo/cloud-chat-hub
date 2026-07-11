import { describe, expect, it } from 'vitest';
import { resolveDependencyIds, depsSatisfied, type Subtask } from '../../server/team-coordinator';

describe('team dependency resolution', () => {
  it('maps dependency titles to subtask ids', () => {
    const a: Subtask = {
      id: 'id-a',
      title: 'Plan',
      description: '',
      assignedTo: null,
      dependencies: [],
      status: 'pending',
      result: null,
    };
    const b: Subtask = {
      id: 'id-b',
      title: 'Implement',
      description: '',
      assignedTo: null,
      dependencies: ['Plan'],
      status: 'pending',
      result: null,
    };
    const resolved = resolveDependencyIds([a, b]);
    expect(resolved[1].dependencies).toEqual(['id-a']);
  });

  it('treats unmet deps as not satisfied', () => {
    const all: Subtask[] = [
      {
        id: 'id-a',
        title: 'Plan',
        description: '',
        assignedTo: null,
        dependencies: [],
        status: 'pending',
        result: null,
      },
      {
        id: 'id-b',
        title: 'Implement',
        description: '',
        assignedTo: null,
        dependencies: ['id-a'],
        status: 'pending',
        result: null,
      },
    ];
    expect(depsSatisfied(all[1], all)).toBe(false);
    all[0].status = 'done';
    expect(depsSatisfied(all[1], all)).toBe(true);
  });
});
