# User Sketch Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user draws rough strokes on the whiteboard panel; the agent perceives them via deterministic geometry classification serialized as a `[SKETCH]` hint, converses about them, and (milestone 2) offers a witnessed `wb_beautify` sketch→diagram transform. Spec: `docs/superpowers/specs/2026-07-15-sketch-surface-design.md`.

**Architecture:** New self-contained `src/sketch/` subsystem beside `src/whiteboard/` — pure `classify` (geometry heuristics), pure `sketchStore` reducer, pure `serialize` ([SKETCH] hint), a `SketchLayer` SVG pointer-capture component composed into the existing `WhiteboardPanel`, and a `wb_beautify` validation module. **The ownership boundary is the store boundary**: the agent has no tools that touch strokes; the only bridge is the witnessed beautify swap. Both layers share the whiteboard's 0–1000 plane (viewBox `0 0 100 100`, `preserveAspectRatio="none"`, `pct = v/10`).

**Tech Stack:** React 19 + TypeScript, vitest (node env — JSX verified by tsc+suite+build, no DOM harness), SVG polylines, the existing `makeChangeGate` dedup pattern from `src/teaching/teachingState.ts`.

## Global Constraints

- **Never over-claim perception** (spec §11): the hint carries "You see measured geometry only — you cannot read drawn words." verbatim; the prompt must not imply the model can see pixels.
- **User ink is user-owned** (spec §11): no agent path deletes/mutates strokes except the confirmed beautify swap. `wb_clear` never touches strokes; `MAX_MARKS` never counts strokes.
- **Scribble is the default verdict** (spec §11): every ambiguous classification falls to `scribble`; bias thresholds toward under-claiming.
- **Beautify is unconditionally witnessed** (spec §11): no autonomy level auto-commits it; decline changes nothing.
- **No silent truncation** (spec §3/§8): the 64-stroke cap drop is stated in the hint; taps (<3 points or path <8 units) are dropped at the reducer.
- Constants verbatim (spec §4): `CLOSE_GAP_RATIO 0.15` · `SHAPE_FIT_RATIO 0.30` · `LINE_DEV_RATIO 0.10` · `ARROW_TAIL 0.25` · `ARROW_ANGLE_DEG 90` · `MIN_POINTS 3` · `MIN_PATH_LEN 8` · `MAX_STROKES 64`. Exact threshold *tuning* may move during TDD; the five-kind vocabulary and scribble-default may not.
- **Tool routing gotcha:** `App.tsx` routes tools by prefix — `fc.name.startsWith('wb_')` hits `wbCallToEvent` (App.tsx ~1321), which would reject `wb_beautify` as unknown. The beautify branch MUST be checked before the `wb_` prefix branch.
- Tests: `npx vitest run <file>`; full gate `npx tsc --noEmit && npm test` (+ `npm run build` for JSX tasks). TDD every pure module.
- Commit style `feat(sketch):` / `fix(sketch):` + trailers:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JLnWySYQtTUjkZfgHRNjGw
```

---

### Task 1: `types.ts` + `classify.ts` — the geometry heart (TDD)

**Files:**
- Create: `src/sketch/types.ts`, `src/sketch/classify.ts`
- Test: `src/sketch/classify.test.ts`

**Interfaces:**
- Produces: `classify(points: XY[]): Classified` and all exported constants; `XY`, `Classified`, `Stroke`, `SketchEvent`, `SketchState` types. Task 2's reducer calls `classify` on every accepted stroke; Task 5 reads `Classified` kinds.

- [ ] **Step 1: Create `src/sketch/types.ts`** (types first — the test imports them):

```ts
// User sketch strokes on the whiteboard's 0-1000 plane. The agent has NO tools that touch
// these — ownership is the store boundary (spec §2); the one bridge is the witnessed beautify.
export type XY = { x: number; y: number };

export type Classified =
  | { kind: 'box' | 'ellipse' | 'scribble'; bbox: [number, number, number, number] } // [ymin,xmin,ymax,xmax]
  | { kind: 'line' | 'arrow'; bbox: [number, number, number, number]; from: XY; to: XY };

export interface Stroke { id: string; points: XY[]; classified: Classified }

export type SketchEvent =
  | { type: 'sketch.strokeAdd'; points: XY[] }         // complete stroke, on pointer-up
  | { type: 'sketch.clear' }                           // user's clear button
  | { type: 'sketch.replace'; removeIds: string[] };   // beautify commit ONLY (post-confirm)

export interface SketchState { strokes: Stroke[]; nextId: number; droppedAtCap: number }
```

- [ ] **Step 2: Write the failing tests** — create `src/sketch/classify.test.ts`. Fixtures are generated parametrically so they're deterministic and legible:

```ts
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
});
```

- [ ] **Step 3: Run to verify RED**: `npx vitest run src/sketch/classify.test.ts` → FAIL (`classify` module missing).

- [ ] **Step 4: Implement `src/sketch/classify.ts`**:

```ts
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
```

- [ ] **Step 5: Run to verify GREEN**: `npx vitest run src/sketch/classify.test.ts` → 6 passed. If a fixture fails on a threshold (not a bug), tune the CONSTANT, never special-case the fixture — and keep the scribble-default bias.
- [ ] **Step 6: Full gate + commit**

```bash
npx tsc --noEmit && npm test
git add src/sketch/types.ts src/sketch/classify.ts src/sketch/classify.test.ts
git commit -m "feat(sketch): types + pure stroke classification — box/ellipse/line/arrow, scribble default (TDD)"
```

---

### Task 2: `sketchStore.ts` + `serialize.ts` (TDD)

**Files:**
- Create: `src/sketch/sketchStore.ts`, `src/sketch/serialize.ts`
- Test: `src/sketch/sketchStore.test.ts`, `src/sketch/serialize.test.ts`

**Interfaces:**
- Consumes: `classify`, `pathLength`, `MIN_POINTS`, `MIN_PATH_LEN` from `./classify`; types from `./types`.
- Produces: `initialSketchState(): SketchState` · `reduce(state, event): SketchState` · `MAX_STROKES = 64` · `serializeSketch(state): string | null`. Tasks 3–5 consume all of these.

- [ ] **Step 1: Write the failing store tests** — create `src/sketch/sketchStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialSketchState, reduce, MAX_STROKES } from './sketchStore';
import type { XY } from './types';

const line = (n = 0): XY[] => Array.from({ length: 8 }, (_, i) => ({ x: 100 + n + i * 30, y: 200 }));

describe('sketchStore', () => {
  it('strokeAdd classifies and assigns deterministic ids', () => {
    const st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    expect(st.strokes).toHaveLength(1);
    expect(st.strokes[0].id).toBe('s1');
    expect(st.strokes[0].classified.kind).toBe('line');
  });
  it('drops taps: <3 points or path <8 units', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    st = reduce(st, { type: 'sketch.strokeAdd', points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 }] });
    expect(st.strokes).toHaveLength(0);
  });
  it('caps at MAX_STROKES, dropping the oldest and counting the drop', () => {
    let st = initialSketchState();
    for (let i = 0; i < MAX_STROKES + 2; i++) st = reduce(st, { type: 'sketch.strokeAdd', points: line(i) });
    expect(st.strokes).toHaveLength(MAX_STROKES);
    expect(st.strokes[0].id).toBe('s3'); // s1, s2 dropped
    expect(st.droppedAtCap).toBe(2);
  });
  it('clear empties strokes (user-only affordance)', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    st = reduce(st, { type: 'sketch.clear' });
    expect(st.strokes).toHaveLength(0);
    expect(st.droppedAtCap).toBe(0);
  });
  it('replace removes exactly the named ids; unknown ids are a no-op (fail-soft)', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: line(200) });
    const after = reduce(st, { type: 'sketch.replace', removeIds: ['s1', 'zzz'] });
    expect(after.strokes.map((s) => s.id)).toEqual(['s2']);
  });
});
```

- [ ] **Step 2: Verify RED**: `npx vitest run src/sketch/sketchStore.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/sketch/sketchStore.ts`**:

```ts
// Pure reducer over the user's strokes. The agent has no tools that reach this store;
// sketch.replace exists solely for the WITNESSED beautify commit (spec §2/§7).
import type { SketchState, SketchEvent, Stroke } from './types';
import { classify, pathLength, MIN_POINTS, MIN_PATH_LEN } from './classify';

export const MAX_STROKES = 64;

export function initialSketchState(): SketchState {
  return { strokes: [], nextId: 1, droppedAtCap: 0 };
}

export function reduce(state: SketchState, event: SketchEvent): SketchState {
  switch (event.type) {
    case 'sketch.strokeAdd': {
      if (event.points.length < MIN_POINTS || pathLength(event.points) < MIN_PATH_LEN) return state; // a tap, not a stroke
      const stroke: Stroke = { id: `s${state.nextId}`, points: event.points, classified: classify(event.points) };
      const strokes = [...state.strokes, stroke];
      const over = strokes.length - MAX_STROKES;
      return {
        strokes: over > 0 ? strokes.slice(over) : strokes,
        nextId: state.nextId + 1,
        droppedAtCap: state.droppedAtCap + Math.max(0, over),
      };
    }
    case 'sketch.clear':
      return { strokes: [], nextId: state.nextId, droppedAtCap: 0 };
    case 'sketch.replace':
      return { ...state, strokes: state.strokes.filter((s) => !event.removeIds.includes(s.id)) };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Verify GREEN**: `npx vitest run src/sketch/sketchStore.test.ts` → 5 passed.

- [ ] **Step 5: Write the failing serialize tests** — create `src/sketch/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialSketchState, reduce } from './sketchStore';
import { serializeSketch } from './serialize';
import type { XY } from './types';

const rect = (): XY[] => {
  const pts: XY[] = [];
  for (let i = 0; i <= 10; i++) pts.push({ x: 200 + i * 20, y: 300 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 400, y: 300 + i * 10 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 400 - i * 20, y: 400 });
  for (let i = 1; i <= 9; i++) pts.push({ x: 200, y: 400 - i * 10 });
  return pts;
};
const zig = (): XY[] => Array.from({ length: 30 }, (_, i) => ({ x: 500 + i * 10, y: 600 + (i % 2 ? 50 : -50) }));

describe('serializeSketch', () => {
  it('is null for an empty sketch (no hint sent)', () => {
    expect(serializeSketch(initialSketchState())).toBeNull();
  });
  it('describes shapes with ids, groups scribbles, and states the honesty floor', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: rect() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: zig() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: zig().map((p) => ({ x: p.x, y: p.y + 200 })) });
    const s = serializeSketch(st)!;
    expect(s).toMatch(/^\[SKETCH\]/);
    expect(s).toContain('a box at (300,350) ~200×100 (s1)');
    expect(s).toContain('2 scribbles (s2, s3)');
    expect(s).toContain('You see measured geometry only — you cannot read drawn words.');
    expect(s).toContain('DO NOT acknowledge');
  });
  it('mentions the cap drop when strokes were discarded (no silent truncation)', () => {
    const st = { ...initialSketchState(), strokes: [], droppedAtCap: 0 };
    let full = reduce(st, { type: 'sketch.strokeAdd', points: rect() });
    full = { ...full, droppedAtCap: 3 };
    expect(serializeSketch(full)).toContain('3 oldest strokes were dropped at the 64-stroke cap');
  });
});
```

- [ ] **Step 6: Verify RED**: `npx vitest run src/sketch/serialize.test.ts` → FAIL.

- [ ] **Step 7: Implement `src/sketch/serialize.ts`**:

```ts
// The model's ONLY view of the sketch (spec §5): measured geometry as text, deduped by the
// caller via makeChangeGate. Never claims more than classify measured.
import type { SketchState, Stroke } from './types';
import { MAX_STROKES } from './sketchStore';

const r = Math.round;

function describe(s: Stroke): string {
  const c = s.classified;
  const [ymin, xmin, ymax, xmax] = c.bbox;
  const cx = r((xmin + xmax) / 2), cy = r((ymin + ymax) / 2);
  const w = r(xmax - xmin), h = r(ymax - ymin);
  switch (c.kind) {
    case 'box': return `a box at (${cx},${cy}) ~${w}×${h} (${s.id})`;
    case 'ellipse': return `an ellipse at (${cx},${cy}) ~${w}×${h} (${s.id})`;
    case 'line': return `a line from (${r(c.from.x)},${r(c.from.y)}) to (${r(c.to.x)},${r(c.to.y)}) (${s.id})`;
    case 'arrow': return `an arrow from (${r(c.from.x)},${r(c.from.y)}) to (${r(c.to.x)},${r(c.to.y)}) (${s.id})`;
    case 'scribble': return ''; // grouped below
  }
}

export function serializeSketch(state: SketchState): string | null {
  if (!state.strokes.length) return null;
  const shaped = state.strokes.filter((s) => s.classified.kind !== 'scribble').map(describe);
  const scribbles = state.strokes.filter((s) => s.classified.kind === 'scribble');
  const parts = [...shaped];
  if (scribbles.length === 1) parts.push(`1 scribble (${scribbles[0].id})`);
  if (scribbles.length > 1) parts.push(`${scribbles.length} scribbles (${scribbles.map((s) => s.id).join(', ')})`);
  const capNote = state.droppedAtCap > 0
    ? ` ${state.droppedAtCap} oldest strokes were dropped at the ${MAX_STROKES}-stroke cap.` : '';
  return `[SKETCH] The user has drawn on the whiteboard: ${parts.join('; ')}.${capNote} You see measured geometry only — you cannot read drawn words. DO NOT acknowledge this update.]`;
}
```

- [ ] **Step 8: Verify GREEN**, then full gate + commit:

```bash
npx vitest run src/sketch/serialize.test.ts
npx tsc --noEmit && npm test
git add src/sketch/sketchStore.ts src/sketch/serialize.ts src/sketch/sketchStore.test.ts src/sketch/serialize.test.ts
git commit -m "feat(sketch): pure store (tap-drop, honest cap) + [SKETCH] serializer with geometry-only floor (TDD)"
```

---

### Task 3: `SketchLayer` + panel composition + `?sketch=1` demo

**Files:**
- Create: `src/sketch/SketchLayer.tsx`, `src/sketch/demo.ts`
- Modify: `src/whiteboard/WhiteboardPanel.tsx` (full rewrite below), `src/whiteboard/WhiteboardMarks.tsx:11` (add `pointer-events-none`), `src/shell/MenuBar.tsx` (PenLine toggle), `src/App.tsx` (state + mounting + demo)
- Test: none new (JSX; verified by tsc + suite + build + the demo)

**Interfaces:**
- Consumes: `initialSketchState`/`reduce` (Task 2), `Stroke`/`XY` (Task 1).
- Produces: `SketchLayer({ strokes, onStroke })`; `WhiteboardPanel` with new props `{ state, sketch, open, onClear, onClearSketch, onStroke, demoCaption? }`; `buildSketchDemo(): XY[][]`; App state `sketch`/`sketchDispatch` + `boardOpen` that Tasks 4–5 use.

- [ ] **Step 1: Create `src/sketch/SketchLayer.tsx`**:

```tsx
import React, { useRef, useState } from 'react';
import type { Stroke, XY } from './types';

const pct = (v: number) => v / 10; // 0-1000 → viewBox 0..100 (same transform as WhiteboardMarks)
const USER_INK = 'rgb(107,114,128)'; // graphite gray — the third ink, distinct from agent inks

/** Pointer-capture + render layer for USER strokes. Sits UNDER WhiteboardMarks (agent ink
 *  annotates over the user's sketch); marks are pointer-events-none so ink can start anywhere. */
export function SketchLayer({ strokes, onStroke }: { strokes: Stroke[]; onStroke: (points: XY[]) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef<XY[] | null>(null);
  const [livePoints, setLivePoints] = useState<XY[] | null>(null);

  const toPlane = (e: React.PointerEvent): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 1000 };
  };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = [toPlane(e)];
    setLivePoints(drawingRef.current.slice());
  };
  const move = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current.push(toPlane(e));
    setLivePoints(drawingRef.current.slice());
  };
  const up = () => {
    if (drawingRef.current) onStroke(drawingRef.current);
    drawingRef.current = null;
    setLivePoints(null);
  };

  const poly = (points: XY[], key: string, faint = false) => (
    <polyline
      key={key}
      points={points.map((p) => `${pct(p.x)},${pct(p.y)}`).join(' ')}
      fill="none" stroke={USER_INK} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"
      vectorEffect="non-scaling-stroke" opacity={faint ? 0.6 : 0.9}
    />
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full cursor-crosshair"
      style={{ touchAction: 'none' }}
      viewBox="0 0 100 100" preserveAspectRatio="none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    >
      {strokes.map((s) => poly(s.points, s.id))}
      {livePoints && poly(livePoints, 'live', true)}
    </svg>
  );
}
```

- [ ] **Step 2: Add `pointer-events-none` to the marks svg** — in `src/whiteboard/WhiteboardMarks.tsx:11` change:

```tsx
    <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
```
to
```tsx
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
```
(Nothing in it is interactive; this lets ink start over agent marks per spec §6. The overlay surface renders the same component — unaffected, it was never interactive.)

- [ ] **Step 3: Rewrite `src/whiteboard/WhiteboardPanel.tsx`** (the panel must now open EMPTY for sketching — the old `if (!state.marks.length) return null` is why the spec's user-initiated loop needs `open`):

```tsx
import React from 'react';
import { X, Eraser } from 'lucide-react';
import type { WhiteboardState } from './types';
import type { SketchState, XY } from '../sketch/types';
import { WhiteboardMarks } from './WhiteboardMarks';
import { SketchLayer } from '../sketch/SketchLayer';

// Board-mode surface: agent marks + the user's sketch layer in one 0-1000 space.
// Visibility: any content, or explicitly opened (MenuBar pen toggle / ?sketch=1).
export function WhiteboardPanel({ state, sketch, open, onClear, onClearSketch, onStroke, demoCaption }: {
  state: WhiteboardState; sketch: SketchState; open: boolean;
  onClear: () => void; onClearSketch: () => void; onStroke: (points: XY[]) => void;
  demoCaption?: string | null;
}) {
  if (!open && !state.marks.length && !sketch.strokes.length) return null;
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-[min(680px,88vw)] h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--card-border)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Whiteboard</span>
        <div className="flex items-center gap-2">
          <button aria-label="Clear sketch" disabled={!sketch.strokes.length}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            onClick={onClearSketch}><Eraser size={13} /></button>
          <button aria-label="Clear whiteboard" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClear}><X size={13} /></button>
        </div>
      </div>
      <div className="relative w-full h-[calc(100%-2rem)]">
        <SketchLayer strokes={sketch.strokes} onStroke={onStroke} />
        <WhiteboardMarks state={state} />
      </div>
      {demoCaption && (
        <div className="absolute bottom-0 inset-x-0 px-3 py-1 text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--card-bg)]/90 border-t border-[var(--card-border)] truncate" title={demoCaption}>
          {demoCaption}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/sketch/demo.ts`** (recorded strokes for the no-key demo — a box, an arrow, a scribble, generated parametrically like the test fixtures):

```ts
// ?sketch=1 demo strokes: replayed through the REAL store so the demo proves the actual
// classification + serialization path with no model (spec §9).
import type { XY } from './types';

export function buildSketchDemo(): XY[][] {
  const box: XY[] = [];
  for (let i = 0; i <= 10; i++) box.push({ x: 150 + i * 20, y: 250 });
  for (let i = 1; i <= 10; i++) box.push({ x: 350, y: 250 + i * 12 });
  for (let i = 1; i <= 10; i++) box.push({ x: 350 - i * 20, y: 370 });
  for (let i = 1; i <= 9; i++) box.push({ x: 150, y: 370 - i * 12 });
  const arrow: XY[] = [
    ...Array.from({ length: 19 }, (_, i) => ({ x: 380 + i * 21, y: 310 })),
    { x: 780, y: 310 }, { x: 745, y: 295 }, { x: 780, y: 310 }, { x: 745, y: 325 },
  ];
  const scribble: XY[] = Array.from({ length: 24 }, (_, i) => ({ x: 430 + i * 12, y: 600 + (i % 2 ? 45 : -45) }));
  return [box, arrow, scribble];
}
```

- [ ] **Step 5: Wire App.tsx.** Four additions, anchored on existing code:

(a) Imports (beside the whiteboard imports at App.tsx ~78-81):

```ts
import { initialSketchState, reduce as sketchReduce } from './sketch/sketchStore';
import { serializeSketch } from './sketch/serialize';
import { buildSketchDemo } from './sketch/demo';
```

(b) State (beside `const [whiteboard, whiteboardDispatch] = useReducer(...)` at ~601, and a demo flag beside `whiteboardDemoMode` at ~422):

```ts
const sketchDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sketch');
// …
const [sketch, sketchDispatch] = useReducer(sketchReduce, undefined, initialSketchState);
const [boardOpen, setBoardOpen] = useState(sketchDemoMode);
```

(c) Replace the `<WhiteboardPanel …/>` mount (~2865) with:

```tsx
{whiteboardMode === 'board' && (
  <WhiteboardPanel
    state={whiteboard} sketch={sketch} open={boardOpen}
    onClear={() => whiteboardDispatch({ type: 'wb.clear' })}
    onClearSketch={() => sketchDispatch({ type: 'sketch.clear' })}
    onStroke={(points) => sketchDispatch({ type: 'sketch.strokeAdd', points })}
    demoCaption={sketchDemoMode ? serializeSketch(sketch) : null}
  />
)}
```

(d) Demo driver (below the whiteboard demo driver, mirroring its StrictMode-safe pattern at ~2708): replay `buildSketchDemo()` strokes one per 900ms through `sketchDispatch` when `sketchDemoMode`:

```tsx
const sketchDemoPlayed = useRef(false);
useEffect(() => {
  if (!sketchDemoMode || sketchDemoPlayed.current) return;
  sketchDemoPlayed.current = true;
  const strokes = buildSketchDemo();
  strokes.forEach((points, i) => setTimeout(() => sketchDispatch({ type: 'sketch.strokeAdd', points }), 600 + i * 900));
}, []);
```

- [ ] **Step 6: MenuBar pen toggle** — in `src/shell/MenuBar.tsx`: add `PenLine` to the lucide import, an `onSketchBoard: () => void` prop, and this button between the ramble button and the theme toggle:

```tsx
<Tip label="Sketch board"><Button size="icon44" aria-label="Sketch board" onClick={onSketchBoard}><PenLine size={16} /></Button></Tip>
```

In `src/App.tsx` extend the `<MenuBar …/>` call (one line, ~2796) with:

```tsx
onSketchBoard={() => setBoardOpen((o) => !o)}
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit && npm test && npm run build`, then run the demo: `npx vite --port 3001 --strictPort` (background) → open `http://localhost:3001/?sketch=1` → the board opens, three strokes appear one by one, and the footer caption reads the real `[SKETCH]` text naming a box, an arrow, and a scribble. Kill the server after.

- [ ] **Step 8: Commit**

```bash
git add src/sketch/SketchLayer.tsx src/sketch/demo.ts src/whiteboard/WhiteboardPanel.tsx src/whiteboard/WhiteboardMarks.tsx src/shell/MenuBar.tsx src/App.tsx
git commit -m "feat(sketch): SketchLayer + panel composition (open-empty, dual clears, pen toggle) + ?sketch=1 demo"
```

---

### Task 4: Live wiring — the `[SKETCH]` hint + prompt section

**Files:**
- Modify: `src/App.tsx` (hint effect), `src/prompt/instructions.ts` (sketch section)
- Test: `src/prompt/instructions.test.ts` (append)

**Interfaces:**
- Consumes: `serializeSketch` (already imported in Task 3), `makeChangeGate` from `./teaching/teachingState` (already imported in App).
- Produces: the live `[SKETCH]` channel; the prompt contract Task 5's beautify relies on.

- [ ] **Step 1: Write the failing prompt test** — append inside the existing teaching-posture test loop in `src/prompt/instructions.test.ts` (the `for (const s of [honest, confident])` block):

```ts
      // Sketch surface: the model's only view is [SKETCH]; user ink is user-owned.
      expect(s).toMatch(/\[SKETCH\]/);
      expect(s).toMatch(/cannot read (drawn )?words/i);
      expect(s).toMatch(/never (clear|erase|delete).*(sketch|strokes)/i);
```

- [ ] **Step 2: Verify RED**: `npx vitest run src/prompt/instructions.test.ts` → FAIL.

- [ ] **Step 3: Add the prompt section** — in `src/prompt/instructions.ts`, directly after the whiteboard section (search for the `wb_node` paragraph) add:

```
The user can SKETCH rough strokes on the whiteboard. Your only view of their sketch is the [SKETCH] update: measured geometry (boxes, ellipses, lines, arrows, scribbles with positions) — you cannot read drawn words, and if asked about one, say so honestly. Their ink is theirs: you have no tool that clears or edits it — never claim you can, and never call wb_clear expecting it to erase their sketch (it only clears YOUR marks).
```

- [ ] **Step 4: Verify GREEN**: `npx vitest run src/prompt/instructions.test.ts` → all pass.

- [ ] **Step 5: Add the hint effect** — in `src/App.tsx`, directly below the whiteboard hint effect (~2700), mirroring it exactly (gate ref beside `wbHintGateRef` — find its `useRef(makeChangeGate())` declaration and add a sibling):

```ts
const sketchHintGateRef = useRef(makeChangeGate());
// …below the whiteboard hint effect:
// Sketch perception: the user's strokes, measured — the model's only view of the sketch.
useEffect(() => {
  if (!isLive || whiteboardMode !== 'board') return;
  const hint = serializeSketch(sketch);
  if (sketchHintGateRef.current(hint) && hint) {
    providerRef.current?.sendTextHint(hint);
  }
}, [isLive, sketch, whiteboardMode]);
```

- [ ] **Step 6: Full gate + commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/App.tsx src/prompt/instructions.ts src/prompt/instructions.test.ts
git commit -m "feat(sketch): live [SKETCH] hint (deduped, board mode) + prompt section — geometry-only floor, user-owned ink (TDD)"
```

---

### Task 5: Milestone 2 — witnessed `wb_beautify`

**Files:**
- Create: `src/sketch/beautify.ts`, `src/sketch/BeautifyCard.tsx`
- Modify: `src/App.tsx` (tool registration, routing branch BEFORE `wb_`, pending state + card mount + Esc), `src/prompt/instructions.ts` (one beautify sentence), `src/prompt/instructions.test.ts`
- Test: `src/sketch/beautify.test.ts`

**Interfaces:**
- Consumes: `wbCallToEvent` from `../whiteboard/tools`, `WbEvent` from `../whiteboard/types`, `SketchState` (Task 1/2).
- Produces: `BEAUTIFY_TOOL: VoiceTool` · `validateBeautifyCall(args, sketch): { removeIds: string[]; events: WbEvent[]; summary: string } | { error: string }` · `BeautifyCard` component.

- [ ] **Step 1: Write the failing tests** — create `src/sketch/beautify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateBeautifyCall, BEAUTIFY_TOOL } from './beautify';
import { initialSketchState, reduce } from './sketchStore';
import type { XY } from './types';

const line = (n = 0): XY[] => Array.from({ length: 8 }, (_, i) => ({ x: 100 + n + i * 30, y: 200 }));
const sketchWith2 = () => {
  let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
  return reduce(st, { type: 'sketch.strokeAdd', points: line(300) });
};

describe('wb_beautify validation (errors are data; nothing partial)', () => {
  it('declares the tool', () => {
    expect(BEAUTIFY_TOOL.name).toBe('wb_beautify');
  });
  it('valid proposal → removeIds + wb events + a human summary', () => {
    const r = validateBeautifyCall({
      strokeIds: ['s1', 's2'],
      marks: [
        { kind: 'node', key: 'a', x: 300, y: 200, text: 'Start', shape: 'box' },
        { kind: 'node', key: 'b', x: 700, y: 200, text: 'End', shape: 'box' },
        { kind: 'connector', from: 'a', to: 'b' },
      ],
    }, sketchWith2());
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.removeIds).toEqual(['s1', 's2']);
      expect(r.events).toHaveLength(3);
      expect(r.summary).toBe('Replace 2 strokes with 2 nodes + 1 connector?');
    }
  });
  it('a stale strokeId fails the WHOLE call, naming the live ids', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1', 's9'], marks: [{ kind: 'node', key: 'a', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2());
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('s9');
    expect((r as { error: string }).error).toContain('Live stroke ids: s1, s2');
  });
  it('an invalid mark fails the whole call with the wb validation error', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1'], marks: [{ kind: 'node', key: '', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2());
    expect((r as { error: string }).error).toContain('wb_node needs a key');
  });
  it('empty strokeIds or marks → error (a beautify must do both halves)', () => {
    expect(validateBeautifyCall({ strokeIds: [], marks: [] }, sketchWith2())).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Verify RED**: `npx vitest run src/sketch/beautify.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/sketch/beautify.ts`**:

```ts
// The one bridge across the ownership boundary (spec §7): the model proposes, the app
// validates (errors-as-data, nothing partial), the USER confirms on a witness card.
import type { VoiceTool } from '../voice/types';
import type { WbEvent } from '../whiteboard/types';
import { wbCallToEvent } from '../whiteboard/tools';
import type { SketchState } from './types';

export const BEAUTIFY_TOOL: VoiceTool = {
  name: 'wb_beautify',
  description: 'Offer to replace some of the USER\'s sketched strokes (ids from [SKETCH]) with your structured whiteboard marks. The user sees a confirmation card first — nothing is replaced without their yes.',
  parameters: {
    type: 'object',
    properties: {
      strokeIds: { type: 'array', items: { type: 'string' }, description: 'The stroke ids to replace, from [SKETCH].' },
      marks: { type: 'array', items: { type: 'object', properties: {
        kind: { type: 'string', enum: ['node', 'connector', 'label'] },
        key: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
        text: { type: 'string' }, shape: { type: 'string', enum: ['box', 'ellipse'] },
        from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' },
      }, required: ['kind'] }, description: 'The structured marks to draw instead.' },
    },
    required: ['strokeIds', 'marks'],
  },
};

const KIND_TO_TOOL: Record<string, string> = { node: 'wb_node', connector: 'wb_connect', label: 'wb_label' };

export function validateBeautifyCall(
  args: any, sketch: SketchState,
): { removeIds: string[]; events: WbEvent[]; summary: string } | { error: string } {
  const strokeIds: string[] = Array.isArray(args?.strokeIds) ? args.strokeIds.map(String) : [];
  const marks: any[] = Array.isArray(args?.marks) ? args.marks : [];
  if (!strokeIds.length || !marks.length) return { error: 'wb_beautify needs both strokeIds (from [SKETCH]) and marks.' };
  const live = new Set(sketch.strokes.map((s) => s.id));
  const stale = strokeIds.filter((id) => !live.has(id));
  if (stale.length) {
    return { error: `Unknown stroke id(s): ${stale.join(', ')}. Live stroke ids: ${sketch.strokes.map((s) => s.id).join(', ') || 'none'}.` };
  }
  const events: WbEvent[] = [];
  const counts: Record<string, number> = {};
  for (const m of marks) {
    const tool = KIND_TO_TOOL[m?.kind];
    if (!tool) return { error: `Unknown mark kind "${m?.kind}" — use node, connector, or label.` };
    const mapped = wbCallToEvent({ name: tool, args: m });
    if ('error' in mapped) return { error: mapped.error };
    events.push(mapped);
    counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  }
  const what = Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' + ');
  return { removeIds: strokeIds, events, summary: `Replace ${strokeIds.length} stroke${strokeIds.length > 1 ? 's' : ''} with ${what}?` };
}
```

- [ ] **Step 4: Verify GREEN**: `npx vitest run src/sketch/beautify.test.ts` → 5 passed.

- [ ] **Step 5: Create `src/sketch/BeautifyCard.tsx`**:

```tsx
import React from 'react';
import { Button } from '../ui/Button';

/** The witness card for wb_beautify — unconditionally shown; nothing swaps without Confirm. */
export function BeautifyCard({ summary, onConfirm, onCancel }: {
  summary: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg px-4 py-3 w-80" role="dialog" aria-label="Beautify sketch">
      <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-secondary)] mb-1">Beautify sketch</div>
      <p className="text-sm text-[var(--text-primary)]">{summary}</p>
      <p className="text-[11px] text-[var(--text-secondary)] mt-1">The preview is on the board. Your strokes are only replaced if you confirm.</p>
      <div className="flex gap-2 mt-3 justify-end">
        <Button size="sm" variant="outline" onClick={onCancel}>Keep my sketch</Button>
        <Button size="sm" onClick={onConfirm}>Replace</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire App.tsx.** Five anchored additions:

(a) Imports:

```ts
import { BEAUTIFY_TOOL, validateBeautifyCall } from './sketch/beautify';
import { BeautifyCard } from './sketch/BeautifyCard';
import { initialWhiteboardState as wbInitial } from './whiteboard/store'; // if not already imported under this name — it IS imported as initialWhiteboardState at ~79; reuse that
```

(b) Tool registration — in the `voiceTools` useMemo (~320), append `BEAUTIFY_TOOL` to the array:

```ts
() => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS, ...WB_TOOLS, BEAUTIFY_TOOL, ...TEACH_TOOLS],
```

(c) Pending state + a sketch snapshot ref (the tool handler runs in a callback — mirror the `teachingSnapshotRef` pattern):

```ts
const [pendingBeautify, setPendingBeautify] = useState<{ removeIds: string[]; events: WbEvent[]; summary: string } | null>(null);
const pendingBeautifyRef = useRef<typeof pendingBeautify>(null);
useEffect(() => { pendingBeautifyRef.current = pendingBeautify; }, [pendingBeautify]);
const sketchSnapshotRef = useRef(sketch);
useEffect(() => { sketchSnapshotRef.current = sketch; }, [sketch]);
```

(d) Routing — in `handleVoiceToolCall`, add this branch BEFORE the `else if (fc.name.startsWith('wb_'))` branch (~1321) — the prefix router would otherwise reject it:

```ts
    } else if (fc.name === 'wb_beautify') {
      // Witnessed sketch→diagram swap: validate everything up front (errors are data,
      // nothing partial), then show the card — the swap NEVER happens without the user's yes.
      const v = validateBeautifyCall(fc.args, sketchSnapshotRef.current);
      if ('error' in v) {
        addLog('tool', `Tool Call: wb_beautify REJECTED — ${v.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: v.error });
      } else {
        setPendingBeautify(v);
        addLog('tool', 'Tool Call: wb_beautify — awaiting user consent');
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, witnessed: true, note: 'Shown to the user for confirmation — NOT applied yet. Do not claim it happened.' });
      }
```

(e) Card mount + handlers + preview + Esc. Mount beside the `<WhiteboardPanel …/>` (Task 3, ~2865); the preview renders the proposed marks provisionally by reducing them into a throwaway state:

```tsx
{whiteboardMode === 'board' && pendingBeautify && (
  <BeautifyCard
    summary={pendingBeautify.summary}
    onConfirm={() => {
      sketchDispatch({ type: 'sketch.replace', removeIds: pendingBeautify.removeIds });
      pendingBeautify.events.forEach((ev) => whiteboardDispatch(ev));
      providerRef.current?.sendTextHint('[SYSTEM: the user CONFIRMED the beautify — their strokes were replaced with your marks. Do not re-call the tool; do not acknowledge.]');
      setPendingBeautify(null);
    }}
    onCancel={() => {
      providerRef.current?.sendTextHint('[SYSTEM: the user DECLINED the beautify — their sketch is unchanged. Do not re-call the tool unless they ask.]');
      setPendingBeautify(null);
    }}
  />
)}
```

Preview: inside the `WhiteboardPanel` mount, pass a preview state instead of `whiteboard` while pending, by computing above the JSX:

```ts
const wbWithPreview = pendingBeautify
  ? pendingBeautify.events.reduce((s, ev) => wbReduce(s, ev), whiteboard)
  : whiteboard;
```

and use `state={wbWithPreview}` in the panel (the proposed marks render in normal ink alongside the still-present strokes — the strokes only vanish on confirm; that juxtaposition IS the before/after).

Esc precedence — in the keyboard handler's Escape chain (~1962-1967), add before `pendingGoalRef`:

```ts
        if (pendingBeautifyRef.current) { providerRef.current?.sendTextHint('[SYSTEM: the user DECLINED the beautify — their sketch is unchanged. Do not re-call the tool unless they ask.]'); setPendingBeautify(null); return; }
```

- [ ] **Step 7: Prompt + test.** In `src/prompt/instructions.ts`, append one sentence to the Task 4 sketch section:

```
When your structured version of their sketch would help, call wb_beautify with the stroke ids and your marks — it is witnessed; never claim the swap happened until the system confirms it.
```

In `src/prompt/instructions.test.ts` add to the same loop:

```ts
      expect(s).toContain('wb_beautify');
```

Run `npx vitest run src/prompt/instructions.test.ts` (RED before the prompt edit, GREEN after — do the test edit first).

- [ ] **Step 8: Full gate + commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add src/sketch/beautify.ts src/sketch/beautify.test.ts src/sketch/BeautifyCard.tsx src/App.tsx src/prompt/instructions.ts src/prompt/instructions.test.ts
git commit -m "feat(sketch): witnessed wb_beautify — validate-all-or-error, preview on board, confirm-gated swap (TDD)"
```

---

### Task 6: Final gate + owed smoke report

**Files:** none new.

- [ ] **Step 1: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Demo re-check** — `npx vite --port 3001 --strictPort` (background) → `http://localhost:3001/?sketch=1`: board opens, three strokes replay, footer shows the `[SKETCH]` text (box + arrow + scribble). Draw one stroke by hand over the demo strokes — it appears in graphite and the caption updates. Kill the server.

- [ ] **Step 3: Commit anything outstanding, then report** — no commit if clean. Report to the user that the spec §9 LIVE smoke is owed (needs a key): draw a rough flow → "what did I draw?" → answer matches the hint vocabulary and admits it cannot read drawn words; `wb_beautify` round-trip (propose → preview + card → confirm swaps / decline keeps, Esc declines).

---

## Self-review notes

- **Spec coverage:** §2 modules → Tasks 1-3 + 5 (`beautify.ts` was listed under §7); §3 state → Task 1/2 (incl. tap-drop, cap+`droppedAtCap`, replace fail-soft); §4 classification + constants → Task 1; §5 hint + honesty floor + ids → Tasks 2/4; §6 input/rendering (panel-only, under-marks, graphite, clear button, plane transform) → Task 3 (plus the `open` prop the spec implied but didn't spell out — the old panel returned null when empty, which would have made user-initiated sketching impossible; MenuBar pen toggle added as the opener); §7 beautify (validate-all, preview, card, atomic-from-the-user's-view swap, decline/Esc) → Task 5; §8 error rows → Tasks 1/2/5; §9 testing (pure TDD + `?sketch=1` + owed live smoke) → Tasks 1-3, 6; §10 build order followed.
- **Type consistency:** `Classified` kinds match between `classify.ts`, `serialize.ts` describe(), and the beautify tool's vocabulary; `validateBeautifyCall(args, sketch)` consumes `SketchState` from Task 1; `WhiteboardPanel` new props match the App mount in Tasks 3 and 5 (`state={wbWithPreview}`); `wbReduce` is already imported in App (~79) as `reduce as wbReduce`.
- **Known judgment calls (flagged for reviewers, not hidden):** the beautify ack is `success:true, witnessed:true` with an explicit "NOT applied yet" note — same honesty posture as goal confirm cards; the preview intentionally renders proposed marks in normal ink next to the still-present strokes rather than a tint (juxtaposition is the before/after; a tint would need WhiteboardMarks changes out of scope).
