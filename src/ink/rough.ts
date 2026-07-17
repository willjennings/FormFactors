// src/ink/rough.ts
// Deterministic hand-drawn SVG path generators (spec 2026-07-17-hand-drawn-ink §3).
// PURE: no Math.random, no Date.now — the wobble for a mark is a function of its id and
// geometry only, so renders never shimmer and tests pin exact strings. All outputs are
// path `d` strings in the caller's coordinate space (the layers pass viewBox 0..100).

export interface InkOpts { bow: number; jitter: number; overshoot: number; passes: 1 | 2 }
/** "Confident marker": slight bow, small jitter, corner overshoot, single pass. */
export const INK_OPTS: InkOpts = { bow: 0.35, jitter: 0.25, overshoot: 0.8, passes: 1 };

/** FNV-1a string hash → PRNG seed. */
export function seedFrom(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(2);
/** signed jitter in [-amt, +amt] */
const j = (rnd: () => number, amt: number) => (rnd() * 2 - 1) * amt;

function onePassLine(x1: number, y1: number, x2: number, y2: number, rnd: () => number, o: InkOpts): string {
  const L = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / L, dy = (y2 - y1) / L;   // unit direction
  const nx = -dy, ny = dx;                         // unit normal
  const os = o.overshoot * (0.3 + 0.7 * rnd());    // overshoot amount, scaled 0.3–1×
  const sx = x1 - dx * os * 0.4 + j(rnd, o.jitter), sy = y1 - dy * os * 0.4 + j(rnd, o.jitter);
  const ex = x2 + dx * os * 0.6 + j(rnd, o.jitter), ey = y2 + dy * os * 0.6 + j(rnd, o.jitter);
  const bow = j(rnd, o.bow) * Math.min(1, L / 10) * 2;
  const cx = (sx + ex) / 2 + nx * bow, cy = (sy + ey) / 2 + ny * bow;
  return `M ${f(sx)} ${f(sy)} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`;
}

function withPasses(gen: (rnd: () => number) => string, seed: number, o: InkOpts): string {
  const rnd = mulberry32(seed);
  const first = gen(rnd);
  if (o.passes === 1) return first;
  return `${first} ${gen(rnd)}`; // second pass continues the same PRNG stream → differs
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => onePassLine(x1, y1, x2, y2, rnd, o), seed, o);
}

export function roughRect(x: number, y: number, w: number, h: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => [
    onePassLine(x, y, x + w, y, rnd, o),
    onePassLine(x + w, y, x + w, y + h, rnd, o),
    onePassLine(x + w, y + h, x, y + h, rnd, o),
    onePassLine(x, y + h, x, y, rnd, o),
  ].join(' '), seed, o);
}

export function roughEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => {
    const N = 12;
    const start = rnd() * Math.PI * 2;
    const pts: [number, number][] = [];
    // the loop returns to within jitter of its start; the final control point is the
    // natural overlap point past 2π (hand-drawn close, not a snapped Z)
    for (let i = 0; i <= N + 1; i++) {
      const a = start + (i / N) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx + j(rnd, o.jitter), cy + Math.sin(a) * ry + j(rnd, o.jitter)]);
    }
    let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
    }
    // Close the loop near-but-not-exactly at the start (organic closure)
    const last = pts[pts.length - 1];
    d += ` Q ${f(last[0])} ${f(last[1])} ${f(pts[0][0] + j(rnd, o.jitter))} ${f(pts[0][1] + j(rnd, o.jitter))}`;
    return d;
  }, seed, o);
}

export function roughArc(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => {
    const sx = x1 + j(rnd, o.jitter), sy = y1 + j(rnd, o.jitter);
    const ex = x2 + j(rnd, o.jitter), ey = y2 + j(rnd, o.jitter);
    const qx = cx + j(rnd, o.bow * 2), qy = cy + j(rnd, o.bow * 2);
    return `M ${f(sx)} ${f(sy)} Q ${f(qx)} ${f(qy)} ${f(ex)} ${f(ey)}`;
  }, seed, o);
}

/** Two flick strokes meeting at the tip — replaces filled <marker> triangles. */
export function roughArrowhead(tipX: number, tipY: number, angle: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => {
    const len = 1.6;
    const flick = (spread: number) => {
      const a = angle + Math.PI + spread + j(rnd, 0.1);
      const bx = tipX + Math.cos(a) * len, by = tipY + Math.sin(a) * len;
      const cxp = (bx + tipX) / 2 + j(rnd, o.bow), cyp = (by + tipY) / 2 + j(rnd, o.bow);
      return `M ${f(bx + j(rnd, o.jitter))} ${f(by + j(rnd, o.jitter))} Q ${f(cxp)} ${f(cyp)} ${f(tipX + j(rnd, 0.2))} ${f(tipY + j(rnd, 0.2))}`;
    };
    return `${flick(0.5)} ${flick(-0.5)}`;
  }, seed, o);
}
