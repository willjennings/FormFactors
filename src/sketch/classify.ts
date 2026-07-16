// Deterministic stroke classification (spec §4). Every constant is exported and every branch
// has a fixture. Anything ambiguous is 'scribble' — the honest under-claim.
import type { XY, Classified } from './types';

export const CLOSE_GAP_RATIO = 0.15;
export const SHAPE_FIT_RATIO = 0.30;
export const LINE_DEV_RATIO = 0.10;
export const ARROW_TAIL = 0.25;
export const ARROW_ANGLE_DEG = 90;
export const MIN_POINTS = 3;
export const MIN_PATH_LEN = 8;

const dist = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(points: XY[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

export function bboxOf(points: XY[]): [number, number, number, number] {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)];
}

/** Perpendicular distance from p to the segment a→b (falls back to dist(p,a) when degenerate). */
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Angle (degrees) between consecutive movement vectors; 180 = full reversal. Zero vectors skip. */
function turnAngle(v1: XY, v2: XY): number {
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function straightEnough(points: XY[]): boolean {
  const a = points[0], b = points[points.length - 1];
  const chord = dist(a, b);
  if (chord === 0) return false;
  const maxDev = Math.max(...points.map((p) => segDist(p, a, b)));
  return maxDev < LINE_DEV_RATIO * chord;
}

export function classify(points: XY[]): Classified {
  const bbox = bboxOf(points);
  if (points.length < MIN_POINTS) return { kind: 'scribble', bbox };
  const len = pathLength(points);
  if (len === 0) return { kind: 'scribble', bbox };
  const first = points[0], last = points[points.length - 1];

  // 1. Closed → box vs ellipse vs scribble by perimeter fit (spec §4.2).
  if (dist(first, last) < CLOSE_GAP_RATIO * len) {
    const [ymin, xmin, ymax, xmax] = bbox;
    const w = xmax - xmin, h = ymax - ymin;
    if (w <= 0 || h <= 0) return { kind: 'scribble', bbox };
    const rectPerim = 2 * (w + h);
    const a = w / 2, b = h / 2; // Ramanujan ellipse-perimeter approximation
    const ellPerim = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    const rectErr = Math.abs(len - rectPerim) / rectPerim;
    const ellErr = Math.abs(len - ellPerim) / ellPerim;
    if (Math.min(rectErr, ellErr) > SHAPE_FIT_RATIO) return { kind: 'scribble', bbox };
    return { kind: rectErr <= ellErr ? 'box' : 'ellipse', bbox };
  }

  // 2. Arrow: a straight SHAFT (head excluded from the straightness test — a drawn head
  //    deviates from the chord by its own size) + ≥2 sharp reversals in the tail.
  const shaftEnd = Math.max(2, Math.floor(points.length * (1 - ARROW_TAIL)));
  const shaft = points.slice(0, shaftEnd);
  if (shaft.length >= 2 && straightEnough(shaft)) {
    let reversals = 0;
    for (let i = Math.max(1, shaftEnd - 1); i < points.length - 1; i++) {
      const v1 = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
      const v2 = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y };
      if (turnAngle(v1, v2) > ARROW_ANGLE_DEG) reversals++;
    }
    if (reversals >= 2) {
      return { kind: 'arrow', bbox, from: first, to: shaft[shaft.length - 1] };
    }
  }

  // 3. Line: the WHOLE stroke is straight.
  if (straightEnough(points)) return { kind: 'line', bbox, from: first, to: last };

  // 4. Everything else: honest scribble.
  return { kind: 'scribble', bbox };
}
