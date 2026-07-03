import { describe, it, expect } from 'vitest';
import { fadeLevel, activeStep, visibleScaffold, blockedEntityIds } from './selectors';
import { initialTeachingState, reduce } from './teachingStore';
import type { EntityId } from '../entities/registry';

const id = (s: string) => s as EntityId;
const seq = (competence: Record<string, number> = {}) =>
  reduce({ ...initialTeachingState(), competence }, {
    type: 'teach.sequence', title: 'T', taskKey: 'k', posture: 'guide',
    steps: [{ entityId: id('a'), subgoal: 'S', instruction: 'I.' }],
  }, 1000);

describe('selectors', () => {
  it('fadeLevel derives from competence, capped at 2', () => {
    expect(fadeLevel(initialTeachingState(), 'k')).toBe(0);
    expect(fadeLevel({ ...initialTeachingState(), competence: { k: 1 } }, 'k')).toBe(1);
    expect(fadeLevel({ ...initialTeachingState(), competence: { k: 7 } }, 'k')).toBe(2);
  });
  it('activeStep returns the active step or null', () => {
    expect(activeStep(initialTeachingState())).toBeNull();
    expect(activeStep(seq())!.subgoal).toBe('S');
  });
  it('visibleScaffold: fade 0 → markers+labels+block; fade 1 → highlightOnly; fade 2 → promptOnly', () => {
    expect(visibleScaffold(seq())).toMatchObject({ markers: true, labels: true, block: true, highlightOnly: false, promptOnly: false });
    expect(visibleScaffold(seq({ k: 1 }))).toMatchObject({ markers: false, block: false, highlightOnly: true });
    expect(visibleScaffold(seq({ k: 2 }))).toMatchObject({ highlightOnly: false, promptOnly: true });
  });
  it('reveal restores full scaffold at any fade', () => {
    const st = { ...seq({ k: 2 }), revealRequested: true };
    expect(visibleScaffold(st)).toMatchObject({ markers: true, labels: true, promptOnly: false });
  });
  it('blockedEntityIds = all tiles except the target when blocking, else empty', () => {
    expect(blockedEntityIds(seq(), [id('a'), id('b'), id('c')])).toEqual(['b', 'c']);
    expect(blockedEntityIds(seq({ k: 1 }), [id('a'), id('b')])).toEqual([]);
    expect(blockedEntityIds(initialTeachingState(), [id('a')])).toEqual([]);
  });
});
