import { describe, it, expect } from 'vitest';
import { respondCallToRail } from './respondCallToRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc } from '../scenarios';

const program = getProgram('word');
const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
const doc = initialMockDoc('word');
const call = (cards: unknown[], guideLine = 'One click and your work is safe.') =>
  respondCallToRail({ seq: 'word.save', cards, guideLine }, entities, doc, 1000);
const ok = (r: ReturnType<typeof call>) => { if ('error' in r) throw new Error(r.error); return r; };

describe('respondCallToRail — the honest mapper', () => {
  it('maps a valid sequence: orient auto-done, first actionable card active, band solid', () => {
    const r = ok(call([
      { t: 'orient', text: 'Nothing saved yet.' },
      { t: 'do', verb: 'click', target: 'Save button', text: 'Click the Save button.', result: 'The title bar reads Saved.' },
      { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'Shows Saved.' },
    ]));
    expect(r.rail.seq).toBe('word.save');
    expect(r.rail.cards[0].state).toBe('done');            // orient is context, never a gate
    expect(r.rail.activeIndex).toBe(1);
    expect(r.rail.cards[1].entityId).toBe('word-2');
    expect(r.rail.cards[1].band).toBe('solid');
    expect(r.rail.guideLine).toBe('One click and your work is safe.');
  });

  it('unresolvable target → hollow band, NOT an error (deliberate divergence from teaching)', () => {
    const r = ok(call([{ t: 'do', verb: 'click', target: 'Transition handle', text: 'Click it.', result: 'It moves.' }]));
    expect(r.rail.cards[0].band).toBe('hollow');
    expect(r.rail.cards[0].entityId).toBeNull();
  });

  it('over-budget action text demotes to WHY, never deleted', () => {
    const long = 'Click the Save button which you will find in the upper left area of the ribbon next to its sibling Save As control'; // >90
    const r2 = ok(call([{ t: 'do', verb: 'click', target: 'Save button', text: long, result: 'Saved.' }]));
    expect(r2.rail.cards[0].text!.length).toBeLessThanOrEqual(90);
    expect(r2.rail.cards[0].why).toContain('sibling Save As');
  });

  it('unknown card type fails the WHOLE call as data', () => {
    const r = call([{ t: 'nag', text: 'hi' }]);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/card type/i);
  });

  it('DO with a non-vocabulary verb fails the whole call', () => {
    const r = call([{ t: 'do', verb: 'defenestrate', target: 'Save button', text: 'x', result: 'y' }]);
    expect(r).toHaveProperty('error');
  });

  it('CHECK auto with an unknown predicate path fails the whole call (honesty over helpfulness)', () => {
    const r = call([{ t: 'check', verify: 'auto', expect: { path: 'frobnicated', equals: true }, text: 'x' }]);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toMatch(/frobnicated/);
  });

  it('recap over 3 lines fails; 3 lines pass with per-line budget demotion intact', () => {
    expect(call([{ t: 'recap', lines: ['a', 'b', 'c', 'd'] }])).toHaveProperty('error');
    const r = ok(call([{ t: 'recap', lines: ['You saved the doc.', 'Save As makes a copy.', 'The ribbon holds both.'] }]));
    expect(r.rail.cards[0].lines).toHaveLength(3);
  });

  it('missing guideLine or empty cards fails the whole call', () => {
    expect(respondCallToRail({ seq: 's', cards: [] , guideLine: 'x'}, entities, doc, 0)).toHaveProperty('error');
    expect(respondCallToRail({ seq: 's', cards: [{ t: 'answer', text: 'hi' }] }, entities, doc, 0)).toHaveProperty('error');
  });

  it('ANSWER card maps with tightest budget and optional entity binding', () => {
    const r = ok(call([{ t: 'answer', text: 'That is the Save button.', target: 'Save button' }]));
    expect(r.rail.cards[0].entityId).toBe('word-2');
    expect(r.rail.activeIndex).toBe(0);
  });
});
