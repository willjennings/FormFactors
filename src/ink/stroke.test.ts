import { describe, it, expect } from 'vitest';
import { seedFrom } from './rough';
import { inkLine, inkQuad, inkRect, inkEllipse, inkArrowhead, STROKE_WIDTH } from './stroke';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const xs = (d: string) => nums(d).filter((_, i) => i % 2 === 0);
const ys = (d: string) => nums(d).filter((_, i) => i % 2 === 1);

// Envelope: spec §3.1's invariant is centerline displacement + HALF width ≤ 1.5 — so no
// outline coordinate may leave the input bbox by more than 1.5 units (final review tightened
// this from the earlier, looser 1.5 + full width).
const ENV = 1.5;
void STROKE_WIDTH; // still asserted implicitly: width ≤ ~0.9 keeps the envelope satisfiable

describe('ink v2 — variable-width outline polygons (spec §3.1)', () => {
  it('deterministic: same seed byte-identical, different seeds differ', () => {
    const a1 = inkLine(10, 10, 60, 40, seedFrom('c1'));
    const a2 = inkLine(10, 10, 60, 40, seedFrom('c1'));
    const b = inkLine(10, 10, 60, 40, seedFrom('c2'));
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
  });
  it('emits a CLOSED filled polygon (ends with Z), not a stroked line', () => {
    expect(inkLine(0, 0, 30, 0, seedFrom('z'))).toMatch(/Z\s*$/);
  });
  it('line outline stays within the segment bbox + envelope', () => {
    const d = inkLine(10, 20, 60, 20, seedFrom('x'));
    for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(10 - ENV); expect(x).toBeLessThanOrEqual(60 + ENV); }
    for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(20 - ENV); expect(y).toBeLessThanOrEqual(20 + ENV); }
  });
  it('varies width: entry taper is thinner than the body', () => {
    // For a horizontal line the polygon's vertical spread near the start must be smaller
    // than near the middle (taper-in), and the terminal end at least body-width (pooling).
    const d = inkLine(0, 50, 60, 50, seedFrom('w'));
    const n = nums(d);
    const pts: [number, number][] = [];
    for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    const spreadNear = (x0: number) => {
      const near = pts.filter(([x]) => Math.abs(x - x0) < 4).map(([, y]) => y);
      return near.length >= 2 ? Math.max(...near) - Math.min(...near) : 0;
    };
    expect(spreadNear(2)).toBeLessThan(spreadNear(30));
    expect(spreadNear(58)).toBeGreaterThanOrEqual(spreadNear(30) * 0.8);
  });
  it('aspect compensation: with aspect=2 a VERTICAL stroke is half as wide in x-units', () => {
    const iso = inkLine(50, 10, 50, 60, seedFrom('a'), { aspect: 1 });
    const wide = inkLine(50, 10, 50, 60, seedFrom('a'), { aspect: 2 });
    const spread = (d: string) => Math.max(...xs(d)) - Math.min(...xs(d));
    // Same seed, same geometry: only the x-offsets shrink. Allow slack for wobble.
    expect(spread(wide)).toBeLessThan(spread(iso) * 0.75);
  });
  it('quad follows the control-point shape and stays in its hull + envelope', () => {
    const d = inkQuad(10, 30, 35, 10, 60, 30, seedFrom('q'));
    for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(10 - ENV); expect(y).toBeLessThanOrEqual(30 + ENV); }
    for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(10 - ENV); expect(x).toBeLessThanOrEqual(60 + ENV); }
  });
  it('rect: four closed side-strokes, corners within overshoot budget', () => {
    const d = inkRect(10, 10, 30, 20, seedFrom('r'));
    expect((d.match(/Z/g) ?? []).length).toBe(4);
    for (const [i, v] of nums(d).entries()) {
      if (i % 2 === 0) { expect(v).toBeGreaterThanOrEqual(10 - ENV); expect(v).toBeLessThanOrEqual(40 + ENV); }
      else { expect(v).toBeGreaterThanOrEqual(10 - ENV); expect(v).toBeLessThanOrEqual(30 + ENV); }
    }
  });
  it('ellipse: one closed loop, points on the ring not the center', () => {
    const d = inkEllipse(50, 50, 20, 10, seedFrom('e'));
    expect(d).toMatch(/Z\s*$/);
    // No polygon point should sit near the center (it is an outline ring, not a blob).
    const n = nums(d);
    for (let i = 0; i < n.length; i += 2) {
      const dist = Math.hypot((n[i] - 50) / 20, (n[i + 1] - 50) / 10);
      expect(dist).toBeGreaterThan(0.6);
    }
  });
  it('arrowhead: two flick polygons anchored at the tip', () => {
    const d = inkArrowhead(50, 50, 0, seedFrom('h'));
    expect((d.match(/Z/g) ?? []).length).toBe(2);
    const n = nums(d);
    let minDist = Infinity;
    for (let i = 0; i < n.length; i += 2) minDist = Math.min(minDist, Math.hypot(n[i] - 50, n[i + 1] - 50));
    expect(minDist).toBeLessThan(0.8); // some outline point sits at the tip
  });
});
