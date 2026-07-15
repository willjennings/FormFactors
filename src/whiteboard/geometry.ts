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

/**
 * Where the from→to segment first enters `box` ([ymin,xmin,ymax,xmax]) — the slab method.
 * Falls back to the raw endpoint if the segment starts inside the box (overlapping nodes)
 * or never enters it (fail-soft; the renderer just draws center-to-center as before).
 */
export function clipSegmentToBoxEdge(
  from: { x: number; y: number }, to: { x: number; y: number }, box: [number, number, number, number],
): { x: number; y: number } {
  const [ymin, xmin, ymax, xmax] = box;
  const dx = to.x - from.x, dy = to.y - from.y;
  const tx = dx === 0 ? [-Infinity, Infinity] : [(xmin - from.x) / dx, (xmax - from.x) / dx].sort((p, q) => p - q);
  const ty = dy === 0 ? [-Infinity, Infinity] : [(ymin - from.y) / dy, (ymax - from.y) / dy].sort((p, q) => p - q);
  const tEnter = Math.max(tx[0], ty[0]);
  const tExit = Math.min(tx[1], ty[1]);
  if (tEnter <= 0 || tEnter > 1 || tEnter > tExit) return to; // starts inside, or never enters
  return { x: from.x + tEnter * dx, y: from.y + tEnter * dy };
}

/**
 * Endpoints for a connector, or null if either key is unresolved (fail-soft). The `to` end
 * is clipped to the destination node's box edge so the arrowhead isn't occluded by the
 * opaque node fill (M2).
 */
export function connectorEnds(
  marks: WbMark[], c: Extract<WbMark, { kind: 'connector' }>,
): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const a = nodeByKey(marks, c.from), b = nodeByKey(marks, c.to);
  if (!a || !b) return null;
  const from = { x: a.x, y: a.y };
  return { from, to: clipSegmentToBoxEdge(from, { x: b.x, y: b.y }, nodeBox(b)) };
}
