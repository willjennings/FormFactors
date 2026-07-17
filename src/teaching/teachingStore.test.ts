import { describe, it, expect } from 'vitest';
import { initialTeachingState, reduce } from './teachingStore';
import type { EntityId } from '../entities/registry';
import type { TeachingEvent } from './types';

const id = (s: string) => s as EntityId;
const SEQ: TeachingEvent = {
  type: 'teach.sequence', title: 'Save a file', taskKey: 'word.save', posture: 'guide',
  steps: [
    { entityId: id('word-2'), subgoal: 'Open the save action', instruction: 'Click the Save button.' },
    { entityId: id('word-4'), subgoal: 'Confirm the document', instruction: 'Click the document body.' },
  ],
};
const start = (ev: TeachingEvent = SEQ, st = initialTeachingState()) => reduce(st, ev, 1000);

describe('teach.sequence', () => {
  it('starts at step 0 active with soft-block on at fade 0', () => {
    const st = start();
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.steps[0].state).toBe('active');
    expect(st.sequence!.softBlock).toBe(true);
  });
  it('soft-block is off when competence >= 1 (fade 1)', () => {
    const st0 = { ...initialTeachingState(), competence: { 'word.save': 1 } };
    expect(start(SEQ, st0).sequence!.softBlock).toBe(false);
  });
});

describe('advancement rules', () => {
  it('guide: teach.stepAdvance advances any step', () => {
    let st = start();
    st = reduce(st, { type: 'teach.stepAdvance' }, 1100);
    expect(st.sequence!.activeIndex).toBe(1);
    expect(st.sequence!.steps[0].state).toBe('done');
  });
  it('teach: stepAdvance works ONLY on step 0 (the worked example)', () => {
    let st = start({ ...SEQ, posture: 'teach' });
    st = reduce(st, { type: 'teach.stepAdvance' }, 1100);          // step 0 → ok
    expect(st.sequence!.activeIndex).toBe(1);
    st = reduce(st, { type: 'teach.stepAdvance' }, 1200);          // step 1 → no-op
    expect(st.sequence!.activeIndex).toBe(1);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-4') }, 1300); // learner acts
    expect(st.sequence!.activeIndex).toBeNull();                   // completed
  });
  it('completion increments competence and clears reveal', () => {
    let st = start();
    st = reduce({ ...st, revealRequested: true }, { type: 'user.stepAction', entityId: id('word-2') }, 1100);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-4') }, 1200);
    expect(st.competence['word.save']).toBe(1);
    expect(st.revealRequested).toBe(false);
  });
});

describe('soft-block and path tolerance', () => {
  it('off-target action at fade 0 blocks: counter + lastBlocked, no advance', () => {
    let st = start();
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-3') }, 1100);
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.blockedAttempts).toBe(1);
    expect(st.sequence!.lastBlocked).toEqual({ entityId: 'word-3', at: 1100 });
  });
  it('off-target with softBlock false is ignored (no block, no advance)', () => {
    let st = start(SEQ, { ...initialTeachingState(), competence: { 'word.save': 1 } });
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-3') }, 1100);
    expect(st.sequence!.blockedAttempts).toBe(0);
    expect(st.sequence!.activeIndex).toBe(0);
  });
  it('pause holds the sequence; actions ignored while paused; resume restores', () => {
    let st = start();
    st = reduce(st, { type: 'user.pause' }, 1100);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1200);
    expect(st.sequence!.activeIndex).toBe(0);
    st = reduce(st, { type: 'user.resume' }, 1300);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1400);
    expect(st.sequence!.activeIndex).toBe(1);
  });
  it('dismiss clears the sequence without competence credit', () => {
    let st = start();
    st = reduce(st, { type: 'user.dismiss' }, 1100);
    expect(st.sequence).toBeNull();
    expect(st.competence['word.save']).toBeUndefined();
  });
});

describe('highlights, relations, clear, reveal', () => {
  it('highlight appends with timestamp; clear empties all', () => {
    let st = reduce(initialTeachingState(), { type: 'teach.highlight', entityId: id('word-2'), note: 'save' }, 1000);
    st = reduce(st, { type: 'teach.relate', relations: [{ from: id('word-2'), to: id('word-4'), label: 'writes to' }] }, 1100);
    expect(st.highlights).toHaveLength(1);
    expect(st.relations).toHaveLength(1);
    st = reduce(st, { type: 'teach.clear' }, 1200);
    expect(st.highlights).toHaveLength(0);
    expect(st.relations).toHaveLength(0);
    expect(st.sequence).toBeNull();
  });
  it('user.reveal sets revealRequested; next advance clears it', () => {
    let st = start();
    st = reduce(st, { type: 'user.reveal' }, 1100);
    expect(st.revealRequested).toBe(true);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1200);
    expect(st.revealRequested).toBe(false);
  });
});
