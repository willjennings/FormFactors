import { describe, it, expect } from 'vitest';
import { serializeGoalState } from './serialize';
import { initialGoalState, reduce } from './goalStore';

describe('serializeGoalState', () => {
  it('returns null when no goal is active', () => {
    expect(serializeGoalState(initialGoalState())).toBeNull();
  });
  it('reports objective, N-of-M done, and the next pending step', () => {
    let s = reduce(initialGoalState(), { type: 'goal.set', objective: 'Ship it', steps: [
      { label: 'Write', verb: 'edit_content' }, { label: 'Save', verb: 'save_file' }] });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content' });
    const out = serializeGoalState(s)!;
    expect(out).toContain('objective "Ship it"');
    expect(out).toContain('1 of 2 steps done');
    expect(out).toContain('Next pending: "Save"');
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });
  it('says the goal is complete when all steps are done', () => {
    let s = reduce(initialGoalState(), { type: 'goal.set', objective: 'x', steps: [{ label: 'Save', verb: 'save_file' }] });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(serializeGoalState(s)!).toContain('Next pending: none (goal complete)');
  });
});
