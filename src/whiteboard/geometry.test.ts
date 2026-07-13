import { describe, it, expect } from 'vitest';
import { nodeBox, nodeByKey, connectorEnds, NODE_W, NODE_H } from './geometry';
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
  it('connectorEnds resolves both node centers', () => {
    expect(connectorEnds(marks, { kind: 'connector', id: '1', from: 'a', to: 'b' }))
      .toEqual({ from: { x: 300, y: 200 }, to: { x: 700, y: 600 } });
  });
  it('connectorEnds returns null when either key is missing (fail-soft)', () => {
    expect(connectorEnds(marks, { kind: 'connector', id: '1', from: 'a', to: 'gone' })).toBeNull();
    expect(connectorEnds(marks, { kind: 'connector', id: '1', from: 'gone', to: 'b' })).toBeNull();
  });
});
