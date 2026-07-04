import { describe, it, expect } from 'vitest';
import { initialRailState, reduceRail, visibleCards, railComplete } from './railStore';
import { respondCallToRail } from './respondCallToRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc, applyAction } from '../scenarios';

const program = getProgram('word');
const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
const doc = initialMockDoc('word');
const rail = () => {
  const r = respondCallToRail({ seq: 'word.save', guideLine: 'Safe in one click.', cards: [
    { t: 'orient', text: 'Nothing saved yet.' },
    { t: 'do', verb: 'click', target: 'Save button', text: 'Click Save.', result: 'Title bar reads Saved.' },
    { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'Shows Saved.' },
    { t: 'recap', lines: ['Saved.'] },
  ] }, entities, doc, 0);
  if ('error' in r) throw new Error(r.error);
  return r.rail;
};

describe('railStore', () => {
  it('element action on the bound entity advances the DO card; wrong entity does not', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-3' }, 1);
    expect(s.rail!.activeIndex).toBe(1);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 2);
    expect(s.rail!.cards[1].state).toBe('done');
    expect(s.rail!.activeIndex).toBe(2);
  });

  it('auto-CHECK passes on doc.changed; trailing RECAP is active (not complete); user action completes the rail', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc: applyAction(doc, 'save_file', {}) }, 2);
    expect(s.rail!.cards[2].state).toBe('done');
    expect(s.rail!.activeIndex).toBe(3);   // recap is now ACTIVE, not auto-completed
    expect(railComplete(s)).toBe(false);
    // Any user action advances past the glanceable recap → complete
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 3);
    expect(railComplete(s)).toBe(true);
  });

  it('auto-CHECK failure renders failed and does NOT advance', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc }, 2);   // still unsaved
    expect(s.rail!.cards[2].state).toBe('failed');
    expect(s.rail!.activeIndex).toBe(2);
  });

  it('dismiss clears; why/flip toggles are per-index; unknown events no-op (never throws)', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.whyToggle', index: 1 }, 1);
    expect(s.openWhy).toBe(1);
    s = reduceRail(s, { type: 'user.flip', index: 1 }, 2);
    expect(s.flipped).toContain(1);
    s = reduceRail(s, { type: 'rail.dismiss' }, 3);
    expect(s.rail).toBeNull();
    expect(reduceRail(s, { type: 'user.checkConfirm' }, 4)).toEqual(s);
  });

  it('visibleCards windows to 3±1 around the active card with stubs and dims', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    const v = visibleCards(s);
    expect(v.length).toBeLessThanOrEqual(4);
    expect(v.find(x => x.index === 1)!.mode).toBe('active');
    expect(v.find(x => x.index === 0)!.mode).toBe('stub');
    expect(v.find(x => x.index === 2)!.mode).toBe('dimmed');
  });

  it('a failed auto-CHECK re-evaluates and passes on a later doc.changed (retry path)', () => {
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail: rail() }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc }, 2);                       // still unsaved → failed
    expect(s.rail!.cards[2].state).toBe('failed');
    s = reduceRail(s, { type: 'doc.changed', doc: applyAction(doc, 'save_file', {}) }, 3);
    expect(s.rail!.cards[2].state).toBe('done');                              // failed must not block re-evaluation
    expect(s.rail!.activeIndex).toBe(3);                                      // recap is now ACTIVE
    expect(railComplete(s)).toBe(false);
    // user.checkConfirm also advances past non-gating active card
    s = reduceRail(s, { type: 'user.checkConfirm' }, 4);
    expect(railComplete(s)).toBe(true);
  });

  it('an ANSWER-only rail renders its card active, not as a stub', () => {
    const r = respondCallToRail({ seq: 'answer', guideLine: 'Here you go.', cards: [
      { t: 'answer', text: 'That is the Save button.' },
    ] }, entities, doc, 0);
    if ('error' in r) throw new Error(r.error);
    const s = reduceRail(initialRailState(), { type: 'rail.set', rail: r.rail }, 0);
    const v = visibleCards(s);
    expect(v[0].mode).toBe('active');
    expect(railComplete(s)).toBe(false);
  });

  it('rail.set alone never flips railComplete', () => {
    // A rail with only non-gating cards should have its first card ACTIVE, not complete.
    const r = respondCallToRail({ seq: 'answer', guideLine: 'Here you go.', cards: [
      { t: 'answer', text: 'That is the Save button.' },
      { t: 'recap', lines: ['Identified.'] },
    ] }, entities, doc, 0);
    if ('error' in r) throw new Error(r.error);
    const s = reduceRail(initialRailState(), { type: 'rail.set', rail: r.rail }, 0);
    expect(railComplete(s)).toBe(false);
    expect(s.rail!.activeIndex).not.toBeNull();
  });
});
