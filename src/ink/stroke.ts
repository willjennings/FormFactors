// Ink v2 — variable-width outline polygons (spec §3.1; research synthesis
// docs/superpowers/research/2026-07-17-ink-rendering-synthesis.md).
//
// Every serious ink renderer studied (Paper 53 patents, perfect-freehand, Google ink)
// models a stroke as a variable-width REGION, not a uniform-width line. With no live
// pressure/velocity, the profile is SIMULATED: taper-in at the start, seeded ±10% body
// drift, slight pooling at the terminal end (Paper 53: width ∝ 1/speed — pens stop at
// ends). Wobble is phase-coherent (matplotlib Sketch) rather than per-point-independent.
// Deterministic like v1: geometry + seed in, byte-identical path out. Plain filled paths —
// no filters, no blend modes (vision-snapshot fidelity, spec §5.2).
import { mulberry32 } from './rough';

export const STROKE_WIDTH = 0.7; // full body width, in viewBox-VERTICAL units

export interface StrokeOpts {
  width: number;
  /** Container width/height ratio. The mark layers stretch a square viewBox non-uniformly
   *  (preserveAspectRatio="none"), which would make polygon width direction-dependent —
   *  offsets are computed in aspect-corrected space so on-screen width is uniform. */
  aspect: number;
  /** 'body': taper-in + terminal pool (shafts, sides). 'flick': fat at start, tapers to a
   *  point (arrowhead flicks — a fast whip stroke thins as it leaves the tip). */
  profile: 'body' | 'flick';
  jitter: number;   // phase-coherent wobble amplitude (viewBox units, pre-ramp)
  overshoot: number;
}

export const BODY: StrokeOpts = { width: STROKE_WIDTH, aspect: 1, profile: 'body', jitter: 0.22, overshoot: 0.6 };

const f = (n: number) => n.toFixed(2);
const j = (rnd: () => number, amt: number) => (rnd() * 2 - 1) * amt;

type P = [number, number];

/** Hard cap on resampled points per stroke: a pathological aspect (transient zero-height
 *  container → huge width/height ratio) once ballooned ONE 2-point line into a megabyte-scale
 *  path and could OOM the tab (probe 2026-07-17). The step widens instead; the wobble gets
 *  sparser on absurd geometry, which is exactly the honest degradation. */
const MAX_RESAMPLE_POINTS = 48;

/** Resample a polyline at ~`step` spacing (arc length), keeping endpoints. */
function resample(pts: P[], step: number): P[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  step = Math.max(step, total / MAX_RESAMPLE_POINTS);
  const out: P[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [qx, qy] = pts[i];
    const seg = Math.hypot(qx - px, qy - py);
    if (seg === 0) continue;
    let t = (step - carry) / seg;
    while (t <= 1) {
      out.push([px + (qx - px) * t, py + (qy - py) * t]);
      t += step / seg;
    }
    carry = (carry + seg) % step;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out.length >= 3 ? out : [pts[0], [(pts[0][0] + last[0]) / 2, (pts[0][1] + last[1]) / 2], last];
}

/** Simulated-pressure width profile with 3-tap smoothing (perfect-freehand radius shape,
 *  Paper 53 terminal pooling, Microsoft 0.25/0.5/0.25 kernel). */
function widths(n: number, rnd: () => number, o: StrokeOpts): number[] {
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    let v: number;
    if (o.profile === 'flick') {
      v = o.width * (1.1 - 0.95 * t); // fat at the tip end, whips down to a point
    } else {
      const tin = Math.min(1, t / 0.18);                       // entry taper
      const pool = t > 0.9 ? 1 + 1.5 * (t - 0.9) : 1;          // terminal pooling (≤1.15×)
      v = o.width * (tin * (2 - tin)) * pool;                  // smoothstep-ish ease
    }
    w.push(Math.max(0.02, v * (1 + j(rnd, 0.1))));             // seeded ±10% drift
  }
  const s = w.slice();
  for (let i = 1; i < n - 1; i++) s[i] = 0.25 * w[i - 1] + 0.5 * w[i] + 0.25 * w[i + 1];
  return s;
}

/** Midpoint-smoothed Q chain through pts (shared trick: rough.js/Excalidraw/Google). */
function qChain(pts: P[]): string {
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ` Q ${f(pts[i][0])} ${f(pts[i][1])} ${f((pts[i][0] + pts[i + 1][0]) / 2)} ${f((pts[i][1] + pts[i + 1][1]) / 2)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${f(last[0])} ${f(last[1])}`;
  return d;
}

/**
 * Centerline → closed variable-width polygon path. Geometry is transformed into
 * aspect-corrected space (x·aspect) so normals and widths are screen-uniform, then back.
 */
export function inkStroke(points: P[], seed: number, o: StrokeOpts = BODY): string {
  const rnd = mulberry32(seed);
  // Defensive clamp: aspect comes from measured layout (useAspect) and a mid-transition
  // container can report absurd ratios; unbounded aspect scales the resample length without
  // limit (probe 2026-07-17: aspect=1e9 OOM-crashed the process from one call).
  const a = Math.min(20, Math.max(0.05, o.aspect || 1));
  const pts = resample(points.map(([x, y]) => [x * a, y] as P), 1.5);
  const n = pts.length;
  // Length-scaled roughness ramp (rough.js): short strokes keep full wobble, long calm down.
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const ramp = total < 20 ? 1 : total > 50 ? 0.4 : 1 - 0.6 * (total - 20) / 30;
  // Phase-coherent wobble along normals (matplotlib Sketch).
  let phase = rnd() * Math.PI * 2;
  const normals: P[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[Math.max(0, i - 1)];
    const [qx, qy] = pts[Math.min(n - 1, i + 1)];
    const len = Math.hypot(qx - px, qy - py) || 1;
    normals.push([-(qy - py) / len, (qx - px) / len]);
    if (i > 0 && i < n - 1) {
      phase += 0.5 + rnd() * 0.6;
      const amp = Math.sin(phase) * o.jitter * ramp;
      pts[i] = [pts[i][0] + normals[i][0] * amp, pts[i][1] + normals[i][1] * amp];
    }
  }
  const w = widths(n, rnd, o);
  const left: P[] = [], right: P[] = [];
  for (let i = 0; i < n; i++) {
    const h = w[i] / 2;
    left.push([pts[i][0] + normals[i][0] * h, pts[i][1] + normals[i][1] * h]);
    right.push([pts[i][0] - normals[i][0] * h, pts[i][1] - normals[i][1] * h]);
  }
  const outline = [...left, ...right.reverse()];
  // Back to layer space.
  const out = outline.map(([x, y]) => [x / a, y] as P);
  return `${qChain(out)} Z`;
}

/** Sample a quadratic bezier into a polyline. */
function quadPts(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, steps = 16): P[] {
  const pts: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
  }
  return pts;
}

/** v1's bowed line as an ink polygon: overshoot the ends, bow the middle, fill the region. */
export function inkLine(x1: number, y1: number, x2: number, y2: number, seed: number, o: Partial<StrokeOpts> = {}): string {
  const opts = { ...BODY, ...o };
  const rnd = mulberry32(seed);
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / L, dy = (y2 - y1) / L, nx = -dy, ny = dx;
  const os = opts.overshoot * (0.3 + 0.7 * rnd());
  const sx = x1 - dx * os * 0.4, sy = y1 - dy * os * 0.4;
  const ex = x2 + dx * os * 0.6, ey = y2 + dy * os * 0.6;
  const bow = j(rnd, 0.35) * Math.min(1, L / 10) * 2;
  const cx = (sx + ex) / 2 + nx * bow, cy = (sy + ey) / 2 + ny * bow;
  return inkStroke(quadPts(sx, sy, cx, cy, ex, ey), seed + 7, opts);
}

export function inkQuad(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, seed: number, o: Partial<StrokeOpts> = {}): string {
  const opts = { ...BODY, ...o };
  const rnd = mulberry32(seed);
  return inkStroke(quadPts(x1 + j(rnd, 0.2), y1 + j(rnd, 0.2), cx + j(rnd, 0.6), cy + j(rnd, 0.6), x2 + j(rnd, 0.2), y2 + j(rnd, 0.2)), seed + 7, opts);
}

export function inkRect(x: number, y: number, w: number, h: number, seed: number, o: Partial<StrokeOpts> = {}): string {
  return [
    inkLine(x, y, x + w, y, seed, o),
    inkLine(x + w, y, x + w, y + h, seed + 1, o),
    inkLine(x + w, y + h, x, y + h, seed + 2, o),
    inkLine(x, y + h, x, y, seed + 3, o),
  ].join(' ');
}

export function inkEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, o: Partial<StrokeOpts> = {}): string {
  const opts = { ...BODY, ...o };
  const rnd = mulberry32(seed);
  const N = 20;
  const start = rnd() * Math.PI * 2;
  const pts: P[] = [];
  for (let i = 0; i <= N + 1; i++) { // slight past-2π overlap: hand-drawn close
    const ang = start + (i / N) * Math.PI * 2;
    pts.push([cx + Math.cos(ang) * rx, cy + Math.sin(ang) * ry]);
  }
  return inkStroke(pts, seed + 7, opts);
}

/** Two flick strokes meeting at the tip — fat at the tip, whipping down to a point. */
export function inkArrowhead(tipX: number, tipY: number, angle: number, seed: number, o: Partial<StrokeOpts> = {}): string {
  const opts = { ...BODY, ...o, profile: 'flick' as const, width: (o.width ?? STROKE_WIDTH) * 0.9 };
  const rnd = mulberry32(seed);
  const len = 1.8;
  const flick = (spread: number, s: number) => {
    const ang = angle + Math.PI + spread + j(rnd, 0.1);
    const bx = tipX + Math.cos(ang) * len, by = tipY + Math.sin(ang) * len;
    return inkStroke([[tipX, tipY], [(tipX + bx) / 2 + j(rnd, 0.2), (tipY + by) / 2 + j(rnd, 0.2)], [bx, by]], seed + s, opts);
  };
  return `${flick(0.5, 11)} ${flick(-0.5, 13)}`;
}
