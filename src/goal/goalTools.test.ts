import { describe, it, expect } from 'vitest';
import { GOAL_TOOLS, goalCallToEvent, validateSuggestion } from './goalTools';
import { initialGoalState, reduce } from './goalStore';

describe('GOAL_TOOLS', () => {
  it('exposes set_goal and suggest_next', () => {
    expect(GOAL_TOOLS.map((t) => t.name)).toEqual(['set_goal', 'suggest_next']);
  });
});

describe('goalCallToEvent', () => {
  it('maps set_goal to a goal.set event', () => {
    const r = goalCallToEvent({ name: 'set_goal', args: { objective: 'Ship it', steps: [{ label: 'Save', verb: 'save_file' }] } });
    expect(r).toEqual({ kind: 'set', event: { type: 'goal.set', objective: 'Ship it', steps: [{ label: 'Save', verb: 'save_file', target: undefined }] } });
  });
  it('maps suggest_next to a suggest proposal', () => {
    const r = goalCallToEvent({ name: 'suggest_next', args: { label: 'Share it', why: 'it is saved', verb: 'share', target: 'editor' } });
    expect(r).toEqual({ kind: 'suggest', proposal: { kind: 'suggest', label: 'Share it', why: 'it is saved', verb: 'share', target: 'editor' } });
  });
  it('errors on missing objective / empty steps / missing label', () => {
    expect(goalCallToEvent({ name: 'set_goal', args: { steps: [] } })).toHaveProperty('error');
    expect(goalCallToEvent({ name: 'set_goal', args: { objective: 'x', steps: [] } })).toHaveProperty('error');
    expect(goalCallToEvent({ name: 'suggest_next', args: {} })).toHaveProperty('error');
  });
});

describe('validateSuggestion', () => {
  const active = reduce(initialGoalState(), { type: 'goal.set', objective: 'Ship it', steps: [{ label: 'Save it', verb: 'save_file' }] });

  it('rejects a suggestion when no goal is active', () => {
    const r = validateSuggestion(initialGoalState(), { kind: 'suggest', label: 'Save it' });
    expect(typeof r).toBe('string');
  });
  it('rejects a suggestion that names an already-done step', () => {
    const done = reduce(active, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(typeof validateSuggestion(done, { kind: 'suggest', label: 'Save it', verb: 'save_file' })).toBe('string');
  });
  it('accepts a valid next-step suggestion (returns null)', () => {
    expect(validateSuggestion(active, { kind: 'suggest', label: 'Share it', verb: 'share' })).toBeNull();
  });
});
