// Pure whiteboard geometry (0-1000 plane space). Node boxes centered on (x,y); connectors resolve
// their endpoints from node centers by key.
import type { WbMark } from './types';

export const NODE_W = 180;
export const NODE_H = 70;

const clamp = (v: number) => Math.max(0, Math.min(1000, v));

/** A NODE_W×NODE_H box centered on (x,y), as [ymin,xmin,ymax,xmax], clamped to 0-1000. */
export function nodeBox(n: { x: number; y: number }): [number, number, number, number] {
  return [clamp(n.y - NODE_H / 2), clamp(n.x - NODE_W / 2), clamp(n.y + NODE_H / 2), clamp(n.x + NODE_W / 2)];
}

export function nodeByKey(marks: WbMark[], key: string): Extract<WbMark, { kind: 'node' }> | null {
  const n = marks.find((m) => m.kind === 'node' && m.key === key);
  return n && n.kind === 'node' ? n : null;
}

/** Endpoints (node centers) for a connector, or null if either key is unresolved (fail-soft). */
export function connectorEnds(
  marks: WbMark[], c: Extract<WbMark, { kind: 'connector' }>,
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const a = nodeByKey(marks, c.from), b = nodeByKey(marks, c.to);
  if (!a || !b) return null;
  return { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } };
}
