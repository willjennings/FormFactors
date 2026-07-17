# Hand-Drawn Agent Ink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent's drawn marks (whiteboard, annotations, teaching arcs/rings) render as deterministic hand-sketched strokes with handwritten labels, changing nothing but pixels.

**Architecture:** One new pure module `src/ink/rough.ts` generates SVG path `d` strings from a seeded PRNG keyed on each mark's id. The three render layers swap their geometric primitives for rough paths; stores, tools, serializers, hints, and geometry helpers are untouched.

**Tech Stack:** React + SVG (existing), TypeScript, vitest, Tailwind v4 `@theme`, Google Fonts (Caveat).

## Global Constraints (from spec §3/§5)

- **Render-only**: no change to any file in `src/whiteboard/{store,tools,serialize,geometry}.ts`, `src/annotations/{annotationStore,annotateTools,serialize,geometry}.ts`, `src/teaching/{teachingStore,teachTools,selectors,serialize*}.ts`, or any hint string. A diff touching a serializer is wrong.
- **Deterministic**: no `Math.random`, no `Date.now()` anywhere in `src/ink/`. Same mark id + geometry → byte-identical `d` string.
- `INK_OPTS = { bow: 0.35, jitter: 0.25, overshoot: 0.8, passes: 1 }` (viewBox units, "confident marker"). Total displacement budget: **under 1.5 viewBox units**.
- Ink colors unchanged: agent indigo `rgb(99,102,241)`, teach-highlight amber, user graphite untouched.
- Plain SVG paths + webfont only — **no SVG filters** (vision-snapshot fidelity, spec §5.2).
- Chrome stays crisp: numbered badges, step-label pill, ✓ dots, scrims, toasts, fade-2 prompt keep current styling.
- Lettering: Caveat, only on drawn-mark labels, `fontSize` 3.2 (was 2.4–2.6).
- Gate for every task: `npx tsc --noEmit && npm test`; tasks touching TSX also run `npm run build`.

---

### Task 1: `src/ink/rough.ts` — deterministic rough-path generators (TDD)

**Files:**
- Create: `src/ink/rough.ts`
- Test: `src/ink/rough.test.ts`

**Interfaces:**
- Consumes: nothing (pure, zero deps).
- Produces (used verbatim by Tasks 2–4):
  - `INK_OPTS: InkOpts` where `interface InkOpts { bow: number; jitter: number; overshoot: number; passes: 1 | 2 }`
  - `seedFrom(id: string): number`
  - `roughLine(x1: number, y1: number, x2: number, y2: number, seed: number, o?: InkOpts): string`
  - `roughRect(x: number, y: number, w: number, h: number, seed: number, o?: InkOpts): string`
  - `roughEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, o?: InkOpts): string`
  - `roughArc(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, seed: number, o?: InkOpts): string`
  - `roughArrowhead(tipX: number, tipY: number, angle: number, seed: number, o?: InkOpts): string`
  - All return SVG path `d` strings in the caller's coordinate space (layers pass viewBox 0..100 values).

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ink/rough.test.ts`
Expected: FAIL — Cannot find module './rough' (collect error).

- [ ] **Step 3: Write the implementation**

```ts
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
    // overlap the loop slightly past 2π so the ends visibly cross (hand-drawn close)
    for (let i = 0; i <= N + 1; i++) {
      const a = start + (i / N) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx + j(rnd, o.jitter), cy + Math.sin(a) * ry + j(rnd, o.jitter)]);
    }
    let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
    }
    return d;
  }, seed, o);
}

export function roughArc(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, seed: number, o: InkOpts = INK_OPTS): string {
  return withPasses((rnd) => {
    const sx = x1 + j(rnd, o.jitter), sy = y1 + j(rnd, o.jitter);
    const ex = x2 + j(rnd, o.jitter), ey = y2 + j(rnd, o.jitter);
    const qx = cx + j(rnd, o.bow * 3), qy = cy + j(rnd, o.bow * 3);
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
```

Note for the implementer: `roughArrowhead` with `passes: 1` contains two `M` (two flicks) — that is why its test asserts `2` and the passes test asserts a doubling relative to whatever one pass emits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ink/rough.test.ts` → all pass. Then `npx tsc --noEmit && npm test` → suite green.

- [ ] **Step 5: Commit**

```bash
git add src/ink/rough.ts src/ink/rough.test.ts
git commit -m "feat(ink): deterministic rough-path generators (seeded, pure) — hand-drawn ink core"
```

---

### Task 2: Caveat font + WhiteboardMarks hand ink

**Files:**
- Modify: `index.css` (font import + theme var, ~lines 1–8)
- Modify: `src/whiteboard/WhiteboardMarks.tsx` (full rewrite of render, 47 lines)

**Interfaces:**
- Consumes (Task 1): `seedFrom`, `roughLine`, `roughRect`, `roughEllipse`, `roughArrowhead` — signatures above.
- Produces: the `font-ink` Tailwind utility (via `--font-ink` theme var) used by Tasks 3–4.

- [ ] **Step 1: Add Caveat to the font import and theme**

In `index.css`, change the `@import url(...)` line to append `&family=Caveat:wght@400..700` before `&display=swap`:

```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Inter:wght@400;700&family=Roboto+Mono:ital,wght@0,100..700;1,100..700&family=Caveat:wght@400..700&display=swap');
```

And add to the `@theme` block:

```css
  --font-ink: "Caveat", cursive;
```

- [ ] **Step 2: Rewrite WhiteboardMarks with rough paths**

Replace the full body of `src/whiteboard/WhiteboardMarks.tsx` with:

```tsx
import React from 'react';
import type { WhiteboardState, WbMark } from './types';
import { nodeBox, connectorEnds } from './geometry';
import { seedFrom, roughLine, roughRect, roughEllipse, roughArrowhead } from '../ink/rough';

const pct = (v: number) => v / 10; // 0-1000 → percent (viewBox 0..100)
const INK = 'rgb(99,102,241)';

export function WhiteboardMarks({ state }: { state: WhiteboardState }) {
  const nodes = state.marks.filter((m): m is Extract<WbMark, { kind: 'node' }> => m.kind === 'node');
  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      {/* connectors first (under nodes) */}
      {state.marks.map((m) => {
        if (m.kind !== 'connector') return null;
        const ends = connectorEnds(state.marks, m);
        if (!ends) return null;
        const x1 = pct(ends.from.x), y1 = pct(ends.from.y), x2 = pct(ends.to.x), y2 = pct(ends.to.y);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return (
          <g key={m.id} stroke={INK} fill="none" strokeWidth="0.4" strokeLinecap="round" vectorEffect="non-scaling-stroke">
            <path d={roughLine(x1, y1, x2, y2, seedFrom(m.id))} vectorEffect="non-scaling-stroke" />
            <path d={roughArrowhead(x2, y2, angle, seedFrom(m.id + '/head'))} vectorEffect="non-scaling-stroke" />
            {m.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1} textAnchor="middle" fontSize={3.2} stroke="none" className="fill-indigo-500 font-ink">{m.label}</text>}
          </g>
        );
      })}
      {nodes.map((n) => {
        const [ymin, xmin, ymax, xmax] = nodeBox(n);
        const x = pct(xmin), y = pct(ymin), w = pct(xmax - xmin), h = pct(ymax - ymin);
        return (
          <g key={n.key}>
            {/* crisp fill inset behind the rough stroke keeps text readable over other marks */}
            {n.shape === 'ellipse'
              ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.max(0, w / 2 - 0.4)} ry={Math.max(0, h / 2 - 0.4)} fill="var(--card-bg)" />
              : <rect x={x + 0.4} y={y + 0.4} width={Math.max(0, w - 0.8)} height={Math.max(0, h - 0.8)} rx={1.5} fill="var(--card-bg)" />}
            <path
              d={n.shape === 'ellipse'
                ? roughEllipse(x + w / 2, y + h / 2, w / 2, h / 2, seedFrom(n.key))
                : roughRect(x, y, w, h, seedFrom(n.key))}
              fill="none" stroke={INK} strokeWidth="0.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <text x={x + w / 2} y={y + h / 2 + 0.8} textAnchor="middle" fontSize={3.2} className="fill-[var(--text-primary)] font-ink">{n.text}</text>
          </g>
        );
      })}
      {state.marks.map((m) => m.kind === 'label'
        ? <text key={m.id} x={pct(m.x)} y={pct(m.y)} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{m.text}</text>
        : null)}
    </svg>
  );
}
```

(The `wb-arrow` `<marker>` defs block is deleted — arrowheads are now per-instance rough paths.)

- [ ] **Step 3: Gate**

Run: `npx tsc --noEmit && npm test && npm run build` → all green (this file has no unit tests; the suite guards against import breakage).

- [ ] **Step 4: Visual check**

Run the dev server if not already running (`npx vite --port 3001 --strictPort`), open `http://localhost:3001/?whiteboard=1`, and confirm: nodes draw as wobbling rects/ellipses with readable Caveat text, connectors bow slightly and end in two-flick arrowheads, nothing shimmers on re-render (hover/resize).

- [ ] **Step 5: Commit**

```bash
git add index.css src/whiteboard/WhiteboardMarks.tsx
git commit -m "feat(ink): whiteboard marks in hand-drawn ink + Caveat lettering"
```

---

### Task 3: AnnotationLayer hand ink

**Files:**
- Modify: `src/annotations/AnnotationLayer.tsx:47-101` (the SVG return block only — reducer/demo wiring above it untouched)

**Interfaces:**
- Consumes (Tasks 1–2): `seedFrom`, `roughLine`, `roughRect`, `roughEllipse`, `roughArc`, `roughArrowhead`; the `font-ink` class.

- [ ] **Step 1: Swap the SVG body**

Replace the `return (...)` block's SVG contents (keep the wrapper div and `defs` REMOVED — delete the `ann-arrowhead` marker defs) with:

```tsx
  return (
    <div className="absolute inset-0 z-[55] pointer-events-none" data-annotation-layer>
      <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {state.annotations.map((a) => {
          if (a.kind === 'arrow') {
            const bf = bboxOf(entities, a.from), bt = bboxOf(entities, a.to);
            if (!bf || !bt) return null;
            const p = center(bf), q = center(bt);
            const mx = (pct(p.x) + pct(q.x)) / 2, my = (pct(p.y) + pct(q.y)) / 2 - 6;
            const angle = Math.atan2(pct(q.y) - my, pct(q.x) - mx); // approach direction from ctrl → tip
            return (
              <g key={a.id} stroke={INK} fill="none" strokeWidth="0.4" strokeLinecap="round">
                <path d={roughArc(pct(p.x), pct(p.y), mx, my, pct(q.x), pct(q.y), seedFrom(a.id))} vectorEffect="non-scaling-stroke" />
                <path d={roughArrowhead(pct(q.x), pct(q.y), angle, seedFrom(a.id + '/head'))} vectorEffect="non-scaling-stroke" />
                {a.label && <text x={mx} y={my - 1} textAnchor="middle" fontSize={3.2} stroke="none" className="fill-indigo-500 font-ink">{a.label}</text>}
              </g>
            );
          }
          if (a.kind === 'shape') {
            const u = unionBbox(a.targets.map((t) => bboxOf(entities, t)).filter((b): b is NonNullable<typeof b> => b !== null));
            if (!u) return null;
            const x = pct(u[1]) - 1, y = pct(u[0]) - 1, w = pct(u[3] - u[1]) + 2, h = pct(u[2] - u[0]) + 2;
            const d = a.shape === 'circle'
              ? roughEllipse(x + w / 2, y + h / 2, w / 2, h / 2, seedFrom(a.id))
              : a.shape === 'box'
                ? roughRect(x, y, w, h, seedFrom(a.id))
                : [roughLine(x, y, x - 1.5, y, seedFrom(a.id)),
                   roughLine(x - 1.5, y, x - 1.5, y + h, seedFrom(a.id + '/2')),
                   roughLine(x - 1.5, y + h, x, y + h, seedFrom(a.id + '/3'))].join(' ');
            return (
              <g key={a.id}>
                <path d={d} fill="none" stroke={INK} strokeWidth="0.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {a.label && <text x={x + w / 2} y={y - 1} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{a.label}</text>}
              </g>
            );
          }
          // label
          const b = bboxOf(entities, a.anchor);
          if (!b) return null;
          const anchor = placementPoint(b, a.placement);
          const dy = a.placement === 'top' ? -4 : a.placement === 'bottom' ? 4 : 0;
          const dx = a.placement === 'left' ? -6 : a.placement === 'right' ? 6 : 0;
          const lx = pct(anchor.x) + dx, ly = pct(anchor.y) + dy;
          return (
            <g key={a.id}>
              <path d={roughLine(pct(anchor.x), pct(anchor.y), lx, ly, seedFrom(a.id))} fill="none" stroke={INK} strokeWidth="0.3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <text x={lx} y={ly} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{a.text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
```

Add to the imports at the top of the file:

```ts
import { seedFrom, roughLine, roughRect, roughEllipse, roughArc, roughArrowhead } from '../ink/rough';
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit && npm test && npm run build` → green.

- [ ] **Step 3: Visual check**

Open `http://localhost:3001/?illustrate=1`: arrows are wobbled curves with flick heads, circles/boxes/brackets read sketched, labels in Caveat.

- [ ] **Step 4: Commit**

```bash
git add src/annotations/AnnotationLayer.tsx
git commit -m "feat(ink): annotation arrows/shapes/labels in hand-drawn ink"
```

---

### Task 4: TeachingLayer hand ink (relate arcs + highlight rings)

**Files:**
- Modify: `src/teaching/TeachingLayer.tsx` (three regions: highlights ~92–99, relate SVG ~102–118, active-step ring ~132–151). Badges, ✓ dots, scrim, toast, pill, fade-2 prompt UNCHANGED.

**Interfaces:**
- Consumes: `seedFrom`, `roughRect`, `roughArc` from `../ink/rough`; `font-ink` class.

- [ ] **Step 1: Add a local RoughRing helper + import**

At the top of the file add the import, and below the `pct` helper add:

```tsx
import { seedFrom, roughRect, roughArc } from '../ink/rough';

/** Rough-ink rectangle drawn just inside its positioned parent div (replaces CSS ring-4).
 *  The parent keeps the glow shadow; this draws the hand stroke. */
function RoughRing({ seedId, color }: { seedId: string; color: string }) {
  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d={roughRect(2, 4, 96, 92, seedFrom(seedId))} fill="none" stroke={color}
            strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
```

- [ ] **Step 2: Swap the ad-hoc highlight ring**

Replace the highlight div (currently `ring-4 ring-amber-400/80 …`):

```tsx
      {state.highlights.map((h, i) => {
        const b = box(h.entityId);
        return b && (
          <div key={i} className="absolute rounded-xl shadow-[0_0_24px_rgba(251,191,36,0.5)] transition-all" style={b}>
            <RoughRing seedId={`hl/${h.entityId}`} color="rgb(251,191,36)" />
            {h.note && <span className="absolute -top-2 left-2 px-1.5 rounded bg-amber-400 text-[10px] font-bold text-black">{h.note}</span>}
          </div>
        );
      })}
```

- [ ] **Step 3: Swap the relate arcs**

In the relations SVG map, replace the `<path d={\`M … Q …\`} …>` with (label font also changes):

```tsx
              <path d={roughArc(cx(a), cy(a), mx, my - 8, cx(b2), cy(b2), seedFrom(`rel/${r.from}/${r.to}`))}
                    fill="none" stroke="rgb(99,102,241)" strokeWidth="0.4" strokeDasharray="1.2 0.8"
                    strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <text x={mx} y={my} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{r.label}</text>
```

- [ ] **Step 4: Swap the active-step ring**

In the active-step catcher block, replace the ring classes with a RoughRing child (badge + label spans stay exactly as they are):

```tsx
            return (
              <div className="absolute rounded-xl pointer-events-none" style={b}>
                {showRing && <RoughRing seedId={`step/${step.entityId}`} color="var(--accent-color)" />}
                {showRing && <div className="absolute inset-0 rounded-xl shadow-[0_0_28px_rgba(99,102,241,0.45)]" />}
                {scaffold.markers && seq.activeIndex !== null && (
                  <span className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-[var(--accent-color)] text-white text-sm font-bold flex items-center justify-center shadow">
                    {seq.activeIndex + 1}
                  </span>
                )}
                {scaffold.labels && (
                  <span className="absolute -bottom-7 left-0 px-2 py-0.5 rounded-md bg-[var(--card-bg)] border border-[var(--card-border)] text-[11px] font-mono whitespace-nowrap shadow-sm">
                    {seq.activeIndex !== null ? seq.activeIndex + 1 : ''} · {step.subgoal} — {step.instruction}
                  </span>
                )}
              </div>
            );
```

- [ ] **Step 5: Gate**

Run: `npx tsc --noEmit && npm test && npm run build` → green. (TeachingLayer has no jsdom render test — house pattern; the demo drive in Task 5 is the render proof.)

- [ ] **Step 6: Commit**

```bash
git add src/teaching/TeachingLayer.tsx
git commit -m "feat(ink): teaching relate arcs + highlight/step rings in hand-drawn ink"
```

---

### Task 5: Demo drives + perception spot-check (verification, no code)

**Files:** none (fixes discovered here go through the review loop).

- [ ] **Step 1: Full gate** — `npx tsc --noEmit && npm test && npm run build`.
- [ ] **Step 2: Drive all four surfaces** in the browser (`npx vite --port 3001 --strictPort`; port 3000 belongs to another project):
  - `?whiteboard=1` — rough nodes/connectors/labels;
  - `?illustrate=1` — rough arrows/shapes/labels;
  - `?teach=1` — rough highlight ring, step ring (badges/pill/toast still crisp), relate arcs;
  - sketch → beautify flow (`?sketch=1`-style: open sketch panel, draw, beautify) — agent marks land rough beside graphite user strokes, clearly two different inks.
  Screenshot each; confirm no shimmer on re-render and text is legible.
- [ ] **Step 3: Perception spot-check** — with the teach demo showing marks, verify the vision-frame snapshot (DebugDrawer world-state / frame view) shows the same rough marks as the screen (spec §5.2).
- [ ] **Step 4: Report** — screenshots + any findings; log deviations in the ledger.

---

## Self-review notes

- **Spec coverage:** §3 module → Task 1; §2 surfaces table → Tasks 2/3/4 (beautify inherits via WhiteboardMarks, Task 2); §4 lettering → Task 2 Step 1 + fontSize/`font-ink` swaps in Tasks 2–4; §5 invariants → Global Constraints (render-only file list is explicit); §6 testing → Task 1 tests + Task 5 drives; §7 rollout order matches task order.
- **Type consistency:** all rough* signatures in Tasks 2–4 match Task 1's Produces block; `seedFrom(string)` everywhere; `InkOpts` only referenced in Task 1.
- **Placeholder scan:** none — every code step carries complete code.
- **Known judgment areas (not hidden):** Task 2's crisp-fill inset (0.4) is a taste call the visual check may tune; Task 4's `RoughRing` inset (2,4,96,92) likewise. Reviewers should treat small constant tweaks after the visual check as in-scope.
