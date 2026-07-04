import { describe, it, expect } from 'vitest';
import { buildRailDemo } from './demoRail';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc, applyAction } from '../scenarios';
import { initialRailState, reduceRail, railComplete } from './railStore';

describe('rail demo', () => {
  const program = getProgram('word');
  const entities = buildEntities(program, {}, { items: program.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
  it('drives the real mapper+store to completion via element click and doc change', () => {
    const doc = initialMockDoc('word');
    const rail = buildRailDemo(program, entities, doc, 0)!;
    let s = reduceRail(initialRailState(), { type: 'rail.set', rail }, 0);
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 1);
    s = reduceRail(s, { type: 'doc.changed', doc: applyAction(doc, 'save_file', {}) }, 2);
    // After check passes the trailing recap becomes ACTIVE (not auto-completed); any user
    // action advances past it.
    s = reduceRail(s, { type: 'user.elementAction', entityId: 'word-2' }, 3);
    expect(railComplete(s)).toBe(true);
  });
  it('returns a rail for every program (never null on the shipped programs)', () => {
    for (const id of ['word', 'excel', 'powerpoint', 'photo'] as const) {
      const p = getProgram(id);
      const es = buildEntities(p, {}, { items: p.images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })) });
      expect(buildRailDemo(p, es, initialMockDoc(id), 0)).not.toBeNull();
    }
  });
});
