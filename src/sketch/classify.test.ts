import { describe, it, expect } from 'vitest';
import { classify } from './classify';
import type { XY } from './types';

// Walk a rectangle's perimeter (100,100)→(300,100)→(300,200)→(100,200)→ back, 10 pts/side.
const rectWalk = (): XY[] => {
  const pts: XY[] = [];
  for (let i = 0; i <= 10; i++) pts.push({ x: 100 + i * 20, y: 100 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 300, y: 100 + i * 10 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 300 - i * 20, y: 200 });
  for (let i = 1; i <= 9; i++) pts.push({ x: 100, y: 200 - i * 10 }); // stops 10 short: near-closed
  return pts;
};
// A circle r=80 around (500,500), 36 samples, endpoint ~closed.
const circleWalk = (): XY[] =>
  Array.from({ length: 37 }, (_, i) => {
    const t = (i / 36) * 2 * Math.PI;
    return { x: 500 + 80 * Math.cos(t), y: 500 + 80 * Math.sin(t) };
  });
// A straight diagonal, 20 samples.
const straight = (): XY[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 25, y: 100 + i * 12.5 }));
// A straight shaft then a drawn arrowhead (two sharp reversals at the tip).
const arrowStroke = (): XY[] => [
  ...Array.from({ length: 19 }, (_, i) => ({ x: 100 + i * 21, y: 500 })), // shaft → (478,500)
  { x: 500, y: 500 },           // tip
  { x: 465, y: 485 },           // up-back
  { x: 500, y: 500 },           // back to tip (reversal 1)
  { x: 465, y: 515 },           // down-back (reversal 2)
];
// A genuine zigzag scribble.
const zigzag = (): XY[] =>
  Array.from({ length: 30 }, (_, i) => ({ x: 200 + i * 15, y: 400 + (i % 2 ? 60 : -60) }));

describe('classify — five kinds, scribble is the honest default', () => {
  it('a near-closed rectangular walk is a box with its bbox', () => {
    const c = classify(rectWalk());
    expect(c.kind).toBe('box');
    expect(c.bbox).toEqual([100, 100, 200, 300]);
  });
  it('a circular walk is an ellipse', () => {
    expect(classify(circleWalk()).kind).toBe('ellipse');
  });
  it('a straight open stroke is a line with from/to at the chord ends', () => {
    const c = classify(straight());
    expect(c.kind).toBe('line');
    if (c.kind === 'line') {
      expect(c.from).toEqual({ x: 100, y: 100 });
      expect(c.to).toEqual({ x: 600, y: 350 });
    }
  });
  it('a straight shaft with a sharply-reversing tail is an arrow pointing at the tip', () => {
    const c = classify(arrowStroke());
    expect(c.kind).toBe('arrow');
    if (c.kind === 'arrow') expect(c.to.x).toBeGreaterThan(c.from.x);
  });
  it('a zigzag is a scribble (under-claim, never a lie)', () => {
    expect(classify(zigzag()).kind).toBe('scribble');
  });
  it('pathological input never throws: duplicate points → scribble', () => {
    const dup = Array.from({ length: 10 }, () => ({ x: 400, y: 400 }));
    expect(classify(dup).kind).toBe('scribble');
  });
  it('a tremor stroke (tiny path length) is a scribble, never a confident shape', () => {
    const tiny = [ {x:400,y:400},{x:401,y:400},{x:401,y:400.01},{x:400,y:400.01},{x:400,y:400} ];
    expect(classify(tiny).kind).toBe('scribble');
  });
  it('empty input yields a finite zero bbox, not Infinity', () => {
    const c = classify([]);
    expect(c.kind).toBe('scribble');
    expect(c.bbox).toEqual([0, 0, 0, 0]);
  });
});
