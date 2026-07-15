import { describe, it, expect } from 'vitest';
import { nodeBox, nodeByKey, connectorEnds, clipSegmentToBoxEdge, NODE_W, NODE_H } from './geometry';
import type { WbMark } from './types';

const marks: WbMark[] = [
  { kind: 'node', key: 'a', x: 300, y: 200, text: 'A', shape: 'box' },
  { kind: 'node', key: 'b', x: 700, y: 600, text: 'B', shape: 'box' },
];

describe('whiteboard geometry', () => {
  it('nodeBox centers a NODE_W×NODE_H box on (x,y)', () => {
    expect(nodeBox({ x: 300, y: 200 })).toEqual([200 - NODE_H / 2, 300 - NODE_W / 2, 200 + NODE_H / 2, 300 + NODE_W / 2]);
  });
  it('nodeByKey finds the node or null', () => {
    expect(nodeByKey(marks, 'b')?.text).toBe('B');
    expect(nodeByKey(marks, 'zzz')).toBeNull();
  });
  it('connectorEnds starts at the source center and STOPS AT THE DESTINATION BOX EDGE (M2: arrowhead visible)', () => {
    const ends = connectorEnds(marks, { kind: 'connector', id: '1', from: 'a', to: 'b' })!;
    expect(ends.from).toEqual({ x: 300, y: 200 });
    // Destination box for b(700,600) is [565, 610, 635, 790]; the a→b segment enters it
    // on the top edge (y = 565): t = (565-200)/400 = 0.9125 → x = 300 + 0.9125*400 = 665.
    expect(ends.to.y).toBeCloseTo(565, 5);
    expect(ends.to.x).toBeCloseTo(665, 5);
  });
  it('connectorEnds returns null when either key is missing (fail-soft)', () => {
    expect(connectorEnds(marks, { kind: 'connector', id: '1', from: 'a', to: 'gone' })).toBeNull();
    expect(connectorEnds(marks, { kind: 'connector', id: '1', from: 'gone', to: 'b' })).toBeNull();
  });
});

describe('clipSegmentToBoxEdge', () => {
  const box: [number, number, number, number] = [465, 410, 535, 590]; // nodeBox({x:500,y:500})
  it('clips a horizontal approach to the left edge', () => {
    expect(clipSegmentToBoxEdge({ x: 100, y: 500 }, { x: 500, y: 500 }, box)).toEqual({ x: 410, y: 500 });
  });
  it('clips a vertical approach to the top edge', () => {
    expect(clipSegmentToBoxEdge({ x: 500, y: 100 }, { x: 500, y: 500 }, box)).toEqual({ x: 500, y: 465 });
  });
  it('clips a diagonal approach to whichever edge it hits first', () => {
    const p = clipSegmentToBoxEdge({ x: 0, y: 0 }, { x: 500, y: 500 }, box);
    expect(p.y).toBeCloseTo(465, 5); // enters through the top edge (y-slab entry is later)
    expect(p.x).toBeCloseTo(465, 5);
  });
  it('falls back to the raw endpoint when the segment starts inside the box (overlapping nodes)', () => {
    expect(clipSegmentToBoxEdge({ x: 490, y: 500 }, { x: 500, y: 500 }, box)).toEqual({ x: 500, y: 500 });
  });
});
