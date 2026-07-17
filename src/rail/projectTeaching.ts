import type { TeachingState } from '../teaching/types';
import type { Rail, RailCard } from './types';

/** Read-only projection: the teaching sequence IS a rail of DO cards (grammar §5).
 *  The teaching store stays untouched — one grammar, two sources, one renderer. */
export function projectTeaching(t: TeachingState): Rail | null {
  const seq = t.sequence;
  if (!seq) return null;
  const cards: RailCard[] = seq.steps.map((step) => ({
    t: 'do', band: 'solid', entityId: step.entityId as string,
    subgoal: step.subgoal, text: step.instruction,
    state: step.state === 'active' ? 'active' : step.state === 'pending' ? 'pending' : 'done',
  }));
  return { seq: seq.taskKey, cards, activeIndex: seq.activeIndex, startedAt: 0 };
}
