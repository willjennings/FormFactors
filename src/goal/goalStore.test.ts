import { describe, it, expect } from 'vitest';
import { initialGoalState, reduce, nextPendingStep, isStepDone } from './goalStore';

const setEvent = {
  type: 'goal.set' as const, objective: 'Get the report ready to send',
  steps: [
    { label: 'Write it', verb: 'edit_content' },
    { label: 'Make the title bold', verb: 'format_content' },
    { label: 'Save it', verb: 'save_file' },
  ],
};

describe('goalStore.reduce', () => {
  it('goal.set stamps sequential ids, all pending, sets objective', () => {
    const s = reduce(initialGoalState(), setEvent);
    expect(s.objective).toBe('Get the report ready to send');
    expect(s.steps.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    expect(s.nextId).toBe(4);
  });

  it('goal.actionCommitted marks the FIRST pending step whose verb matches, and nothing on no match', () => {
    let s = reduce(initialGoalState(), setEvent);
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(isStepDone(s, '3')).toBe(true);
    expect(isStepDone(s, '1')).toBe(false);
    const before = s;
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'photo_edit' }); // no matching step
    expect(s).toEqual(before);
  });

  it('goal.actionCommitted respects target when a step specifies one', () => {
    let s = reduce(initialGoalState(), {
      type: 'goal.set', objective: 'x',
      steps: [{ label: 'A1', verb: 'edit_content', target: 'Cell A1' }, { label: 'B2', verb: 'edit_content', target: 'Cell B2' }],
    });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content', target: 'Cell B2' });
    expect(isStepDone(s, '1')).toBe(false); // A1 untouched
    expect(isStepDone(s, '2')).toBe(true);  // B2 matched by target
  });

  it('goal.stepDone marks by id; goal.clear resets but keeps nextId monotonic', () => {
    let s = reduce(initialGoalState(), setEvent);
    s = reduce(s, { type: 'goal.stepDone', id: '2' });
    expect(isStepDone(s, '2')).toBe(true);
    s = reduce(s, { type: 'goal.clear' });
    expect(s.objective).toBeNull();
    expect(s.steps).toEqual([]);
    expect(s.nextId).toBe(4); // not reset
  });

  it('nextPendingStep returns the first !done step or null', () => {
    let s = reduce(initialGoalState(), setEvent);
    expect(nextPendingStep(s)?.id).toBe('1');
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content' });
    expect(nextPendingStep(s)?.id).toBe('2');
  });
});
