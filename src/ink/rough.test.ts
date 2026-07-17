// src/ink/rough.test.ts
import { describe, it, expect } from 'vitest';
import { seedFrom, roughLine, roughRect, roughEllipse, roughArc, roughArrowhead, INK_OPTS } from './rough';

// Every number that appears in a d string.
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
// Displacement budget from the spec (§5.3): bow .35 + jitter .25 + overshoot .8 < 1.5.
const BUDGET = 1.5;

describe('rough ink — deterministic hand-drawn paths (spec §3)', () => {
  it('INK_OPTS is the confident-marker table', () => {
    expect(INK_OPTS).toEqual({ bow: 0.35, jitter: 0.25, overshoot: 0.8, passes: 1 });
  });
  it('same id + geometry → byte-identical d; different ids differ', () => {
    const a1 = roughLine(10, 10, 60, 40, seedFrom('c1'));
    const a2 = roughLine(10, 10, 60, 40, seedFrom('c1'));
    const b = roughLine(10, 10, 60, 40, seedFrom('c2'));
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
  });
  it('line coordinates stay within the segment bbox + budget', () => {
    const d = roughLine(10, 20, 60, 20, seedFrom('x'));
    const ns = nums(d);
    for (let i = 0; i < ns.length; i += 2) {
      expect(ns[i]).toBeGreaterThanOrEqual(10 - BUDGET);
      expect(ns[i]).toBeLessThanOrEqual(60 + BUDGET);
      expect(ns[i + 1]).toBeGreaterThanOrEqual(20 - BUDGET);
      expect(ns[i + 1]).toBeLessThanOrEqual(20 + BUDGET);
    }
  });
  it('rect coordinates stay within box + budget and the path has four sides', () => {
    const d = roughRect(10, 10, 30, 20, seedFrom('n1'));
    expect((d.match(/M /g) ?? []).length).toBe(4); // four strokes, hand-drawn corners
    for (const [i, v] of nums(d).entries()) {
      if (i % 2 === 0) { expect(v).toBeGreaterThanOrEqual(10 - BUDGET); expect(v).toBeLessThanOrEqual(40 + BUDGET); }
      else { expect(v).toBeGreaterThanOrEqual(10 - BUDGET); expect(v).toBeLessThanOrEqual(30 + BUDGET); }
    }
  });
  it('ellipse loop closes: last point within 1.5 of first', () => {
    const d = roughEllipse(50, 50, 20, 10, seedFrom('e1'));
    const ns = nums(d);
    const [fx, fy] = [ns[0], ns[1]];
    const [lx, ly] = [ns[ns.length - 2], ns[ns.length - 1]];
    expect(Math.hypot(lx - fx, ly - fy)).toBeLessThan(1.5);
  });
  it('arc keeps its endpoints within jitter+overshoot of the given ones', () => {
    const d = roughArc(10, 30, 35, 10, 60, 30, seedFrom('a1'));
    const ns = nums(d);
    expect(Math.hypot(ns[0] - 10, ns[1] - 30)).toBeLessThan(BUDGET);
    expect(Math.hypot(ns[ns.length - 2] - 60, ns[ns.length - 1] - 30)).toBeLessThan(BUDGET);
  });
  it('arrowhead: two flicks, each ending at the tip (± jitter)', () => {
    const d = roughArrowhead(50, 50, 0, seedFrom('h1'));
    expect((d.match(/M /g) ?? []).length).toBe(2);
    const ns = nums(d);
    // each flick's LAST coordinate pair is the tip
    const segs = d.split('M ').filter(Boolean);
    for (const seg of segs) {
      const sn = (seg.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(Math.hypot(sn[sn.length - 2] - 50, sn[sn.length - 1] - 50)).toBeLessThan(0.6);
    }
  });
  it('passes: 2 emits a second stroke for every primitive', () => {
    const o = { ...INK_OPTS, passes: 2 as const };
    const one = roughLine(0, 0, 10, 0, seedFrom('p'), INK_OPTS);
    const two = roughLine(0, 0, 10, 0, seedFrom('p'), o);
    expect((two.match(/M /g) ?? []).length).toBe(2 * (one.match(/M /g) ?? []).length);
  });
});
