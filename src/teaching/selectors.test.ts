import { describe, it, expect } from 'vitest';
import { fadeLevel, activeStep, visibleScaffold, blockedEntityIds, blockedElementNumbers } from './selectors';
import { initialTeachingState, reduce } from './teachingStore';
import type { EntityId } from '../entities/registry';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc } from '../scenarios';

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
  it('blockedElementNumbers: scrimmed leaves as numeric ids; program chrome and the target excluded', () => {
    const program = getProgram('word');
    const entities = buildEntities(program, initialMockDoc('word'), {}, { items: program.images.map((img, i) => ({ id: `word-${img.id}`, bbox: { ymin: i, xmin: 0, ymax: i + 1, xmax: 1 } })) });
    let st = reduce(initialTeachingState(), { type: 'teach.sequence', title: 't', taskKey: 'k', posture: 'guide',
      steps: [{ entityId: 'word-2' as any, subgoal: 's', instruction: 'i' }] }, 0);
    expect(blockedElementNumbers(st, entities).sort()).toEqual([3, 4]); // ui leaf 3 + content 4; chrome 1 excluded; target 2 excluded
    expect(blockedElementNumbers(initialTeachingState(), entities)).toEqual([]);
  });
  it('blockedElementNumbers excludes slide sub-entities (only top-level numbers)', () => {
    const program = getProgram('powerpoint');
    // Two slides → sub-entities powerpoint-slide-1 and powerpoint-slide-2 are produced.
    // slide-2 would split('-').pop() = "2" = Number(2), colliding with top-level element 2 (New Slide button).
    const doc: import('../scenarios').MockDoc = { kind: 'powerpoint', slides: ['Title slide', 'Slide 2'], transition: undefined, saved: false };
    const entities = buildEntities(program, doc, {}, { items: program.images.map((img) => ({ id: `powerpoint-${img.id}`, bbox: { ymin: img.id, xmin: 0, ymax: img.id + 1, xmax: 1 } })) });
    // Sequence targets element 2 (New Slide button); at fade=0 it soft-blocks the rest.
    const st = reduce(initialTeachingState(), { type: 'teach.sequence', title: 't', taskKey: 'k', posture: 'guide',
      steps: [{ entityId: 'powerpoint-2' as any, subgoal: 's', instruction: 'i' }] }, 0);
    const blocked = blockedElementNumbers(st, entities);
    // Without !e.sub, powerpoint-slide-2 leaks through and Number("2")=2 appears in blocked,
    // colliding with the target element number — this test must fail without the fix.
    expect(blocked).not.toContain(2);             // target element must never be in the blocked set
    expect(blocked.every(n => n >= 1 && n <= 4)).toBe(true); // only top-level element numbers
    expect(blocked).not.toContain(NaN);
    // Elements 3 and 4 are the non-target, non-chrome top-level leaves.
    expect(blocked.sort()).toEqual([3, 4]);
  });
});
