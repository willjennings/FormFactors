import { describe, it, expect } from 'vitest';
import { projectTeaching } from './projectTeaching';
import { initialTeachingState, reduce } from '../teaching/teachingStore';

const seq = { type: 'teach.sequence' as const, title: 'Save your document', taskKey: 'word.save', posture: 'guide' as const,
  steps: [
    { entityId: 'word-1' as any, subgoal: 'Find your tools', instruction: 'Click the Home ribbon.' },
    { entityId: 'word-2' as any, subgoal: 'Save your work', instruction: 'Click Save.' },
  ] };

describe('projectTeaching', () => {
  it('projects an active sequence to a rail of DO cards', () => {
    const t = reduce(initialTeachingState(), seq, 0);
    const rail = projectTeaching(t)!;
    expect(rail.seq).toBe('word.save');
    expect(rail.cards).toHaveLength(2);
    expect(rail.cards[0]).toMatchObject({ t: 'do', entityId: 'word-1', band: 'solid', state: 'active', subgoal: 'Find your tools', text: 'Click the Home ribbon.' });
    expect(rail.activeIndex).toBe(0);
  });
  it('maps done steps to done cards and returns null with no sequence', () => {
    let t = reduce(initialTeachingState(), seq, 0);
    t = reduce(t, { type: 'user.stepAction', entityId: 'word-1' as any }, 1);
    expect(projectTeaching(t)!.cards[0].state).toBe('done');
    expect(projectTeaching(initialTeachingState())).toBeNull();
  });
});
