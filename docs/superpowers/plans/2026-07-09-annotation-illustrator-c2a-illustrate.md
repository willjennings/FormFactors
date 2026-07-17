# Annotation Illustrator (C2a-illustrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent an entity-anchored illustrator's toolkit — arrows, circles/boxes/brackets, and labels it draws on real UI to demystify steps — rendering into the C2a seam (perceived for free) and live-wired to the model.

**Architecture:** A new self-contained `src/annotations/` subsystem (pure types + store + geometry + tool-mapper + serializer + demo, plus an `AnnotationLayer.tsx` SVG renderer) mounted as a second child of the existing `instructionLayerRef` seam next to `TeachingLayer`. Every mark is anchored to a `resolveEchoedTarget` entity (unresolvable → whole call fails). Live wiring adds `ANNOTATE_TOOLS` to `voiceTools` and routes `annotate_*` calls through the pure mapper; a deduped `[ANNOTATIONS]` text hint reuses C2a's `makeChangeGate`.

**Tech Stack:** React 19 (`useReducer`), TypeScript, Vitest (node env — pure tests only, no jsdom), SVG rendering, the existing `VoiceTool`/`sendTextHint`/`sendToolResponse` channels.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-annotation-illustrator-design.md`. Every task's requirements implicitly include it.
- **Entity-anchored + honest:** every mark resolves target *names* via `resolveEchoedTarget`; any unresolvable target fails the WHOLE call (no partial annotation) — identical contract to `teachCallToEvent`. Marks with no measured bbox render nothing (no throw).
- **Deterministic ids:** the reducer stamps `id` from a monotonic `nextId` counter — NO `Math.random`/`Date.now` in any pure module (tests + replay-safety).
- **Cap:** `MAX_ANNOTATIONS = 8`; `annotate.add` drops the oldest past the cap; `annotate.clear` empties but keeps `nextId` monotonic.
- **Mount in the seam, don't touch C2a:** `AnnotationLayer` mounts inside `instructionLayerRef` next to `TeachingLayer`; no changes to `TeachingLayer`, the teaching reducer/selectors, or C2a's perception plumbing.
- **Text channel parity:** `serializeAnnotations` returns `null` when empty; names via `displayName` (fall back to raw id, never blank); the block ends `DO NOT acknowledge this message.]`; sent gated on `isLive && entities.length > 0` through a dedicated `annotationHintGateRef` (reusing C2a's `makeChangeGate`).
- **Node test env:** no jsdom/@testing-library — all tests are pure functions; `AnnotationLayer.tsx` rendering is verified by tsc/build + the `?illustrate=1` demo (human smoke).
- **Coordinate space:** bboxes are `[ymin,xmin,ymax,xmax]` in 0–1000; the renderer converts to `%` via `pct(v) = v/10`.

---

### Task 1: Annotation types + store (pure)

**Files:**
- Create: `src/annotations/types.ts`, `src/annotations/annotationStore.ts`
- Test: `src/annotations/annotationStore.test.ts`

**Interfaces:**
- Consumes: `EntityId` from `../entities/registry`.
- Produces: `Annotation`, `AnnotationShape`, `LabelPlacement`, `AnnotationSpec`, `AnnotationEvent`, `AnnotationState` (types); `initialAnnotationState()`, `reduce(state, event)`, `MAX_ANNOTATIONS` (store).

- [ ] **Step 1: Write the failing test**

Create `src/annotations/annotationStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialAnnotationState, reduce, MAX_ANNOTATIONS } from './annotationStore';
import type { AnnotationSpec } from './types';
import type { EntityId } from '../entities/registry';

const arrowSpec = (from: string, to: string): AnnotationSpec =>
  ({ kind: 'arrow', from: from as EntityId, to: to as EntityId });

describe('annotationStore.reduce', () => {
  it('stamps sequential ids and appends on add', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('a', 'b') });
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('c', 'd') });
    expect(s.annotations.map((a) => a.id)).toEqual(['1', '2']);
    expect(s.nextId).toBe(3);
    expect(s.annotations[0]).toMatchObject({ kind: 'arrow', from: 'a', to: 'b' });
  });

  it('drops the oldest past the cap', () => {
    let s = initialAnnotationState();
    for (let i = 0; i < MAX_ANNOTATIONS + 3; i++) {
      s = reduce(s, { type: 'annotate.add', spec: arrowSpec(`x${i}`, `y${i}`) });
    }
    expect(s.annotations.length).toBe(MAX_ANNOTATIONS);
    // oldest three dropped → first surviving is the 4th added (from 'x3')
    expect(s.annotations[0]).toMatchObject({ from: 'x3' });
    // ids keep climbing monotonically
    expect(s.annotations[s.annotations.length - 1].id).toBe(String(MAX_ANNOTATIONS + 3));
  });

  it('clear empties annotations but keeps nextId monotonic', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('a', 'b') });
    s = reduce(s, { type: 'annotate.clear' });
    expect(s.annotations).toEqual([]);
    expect(s.nextId).toBe(2); // not reset — next id never collides with a prior one
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('c', 'd') });
    expect(s.annotations[0].id).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/annotations/annotationStore.test.ts`
Expected: FAIL — cannot resolve `./annotationStore`.

- [ ] **Step 3: Write the types**

Create `src/annotations/types.ts`:

```ts
// The declarative annotation model for the agent-as-illustrator toolkit (C2a-illustrate).
// Every mark is anchored to a resolved entity id; the reducer stamps a deterministic id.
import type { EntityId } from '../entities/registry';

export type AnnotationShape = 'circle' | 'box' | 'bracket';
export type LabelPlacement = 'top' | 'bottom' | 'left' | 'right';

interface Base { id: string; label?: string }

export type Annotation =
  | (Base & { kind: 'arrow'; from: EntityId; to: EntityId })
  | (Base & { kind: 'shape'; shape: AnnotationShape; targets: EntityId[] })
  | (Base & { kind: 'label'; anchor: EntityId; text: string; placement: LabelPlacement });

// A spec is an Annotation minus its id; the reducer assigns the id (deterministic, monotonic).
export type AnnotationSpec =
  | Omit<Extract<Annotation, { kind: 'arrow' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'shape' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'label' }>, 'id'>;

export type AnnotationEvent =
  | { type: 'annotate.add'; spec: AnnotationSpec }
  | { type: 'annotate.clear' };

export interface AnnotationState { annotations: Annotation[]; nextId: number }
```

- [ ] **Step 4: Write the store**

Create `src/annotations/annotationStore.ts`:

```ts
import type { AnnotationState, AnnotationEvent, Annotation } from './types';

export const MAX_ANNOTATIONS = 8; // matches teaching's highlight cap

export function initialAnnotationState(): AnnotationState {
  return { annotations: [], nextId: 1 };
}

export function reduce(state: AnnotationState, event: AnnotationEvent): AnnotationState {
  switch (event.type) {
    case 'annotate.add': {
      const annotation = { ...event.spec, id: String(state.nextId) } as Annotation;
      const annotations = [...state.annotations, annotation].slice(-MAX_ANNOTATIONS);
      return { annotations, nextId: state.nextId + 1 };
    }
    case 'annotate.clear':
      return { annotations: [], nextId: state.nextId };
    default:
      return state;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/annotations/annotationStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/annotations/types.ts src/annotations/annotationStore.ts src/annotations/annotationStore.test.ts
git commit -m "feat(annotations): annotation model + capped deterministic-id store (TDD)"
```

---

### Task 2: Mark geometry (pure)

**Files:**
- Create: `src/annotations/geometry.ts`
- Test: `src/annotations/geometry.test.ts`

**Interfaces:**
- Consumes: `SceneEntity`, `EntityId` from `../entities/registry`; `LabelPlacement` from `./types`.
- Produces: `Bbox` (type), `isDegenerate(b)`, `bboxOf(entities, id)`, `center(b)`, `unionBbox(boxes)`, `placementPoint(b, placement)`.

- [ ] **Step 1: Write the failing test**

Create `src/annotations/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDegenerate, bboxOf, center, unionBbox, placementPoint } from './geometry';
import type { Bbox } from './geometry';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, bbox: Bbox): SceneEntity => ({
  id: id as EntityId, title: id, url: '', category: 'content', aliases: [id], bbox, sub: false,
});

describe('geometry', () => {
  it('isDegenerate flags zero/negative extents', () => {
    expect(isDegenerate([100, 100, 100, 200])).toBe(true);   // zero height
    expect(isDegenerate([100, 100, 200, 100])).toBe(true);   // zero width
    expect(isDegenerate([100, 100, 200, 200])).toBe(false);
  });

  it('bboxOf returns the bbox, or null when missing or degenerate', () => {
    const es = [ent('a', [100, 100, 200, 200]), ent('z', [0, 0, 0, 0])];
    expect(bboxOf(es, 'a' as EntityId)).toEqual([100, 100, 200, 200]);
    expect(bboxOf(es, 'z' as EntityId)).toBeNull();          // degenerate → null
    expect(bboxOf(es, 'missing' as EntityId)).toBeNull();    // absent → null
  });

  it('center midpoints a bbox', () => {
    expect(center([100, 200, 300, 400])).toEqual({ x: 300, y: 200 }); // x=(200+400)/2, y=(100+300)/2
  });

  it('unionBbox covers the group and ignores degenerate members', () => {
    expect(unionBbox([[100, 100, 200, 200], [300, 400, 500, 600]])).toEqual([100, 100, 500, 600]);
    expect(unionBbox([[100, 100, 200, 200], [0, 0, 0, 0]])).toEqual([100, 100, 200, 200]);
    expect(unionBbox([[0, 0, 0, 0]])).toBeNull();
    expect(unionBbox([])).toBeNull();
  });

  it('placementPoint offsets just outside the bbox per placement', () => {
    const b: Bbox = [100, 200, 300, 400]; // top=100,left=200,bottom=300,right=400; cx=300,cy=200
    expect(placementPoint(b, 'top')).toEqual({ x: 300, y: 100 });
    expect(placementPoint(b, 'bottom')).toEqual({ x: 300, y: 300 });
    expect(placementPoint(b, 'left')).toEqual({ x: 200, y: 200 });
    expect(placementPoint(b, 'right')).toEqual({ x: 400, y: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/annotations/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Write the implementation**

Create `src/annotations/geometry.ts`:

```ts
// Pure mark geometry for AnnotationLayer — kept out of the .tsx so it is unit-testable in the
// node test env (no jsdom). All coordinates are 0-1000 plane space; the renderer converts to %.
import type { SceneEntity, EntityId } from '../entities/registry';
import type { LabelPlacement } from './types';

export type Bbox = [number, number, number, number]; // ymin, xmin, ymax, xmax

export function isDegenerate(b: Bbox): boolean {
  return b[2] - b[0] <= 0 || b[3] - b[1] <= 0;
}

/** The measured bbox for an entity id, or null if it is missing OR degenerate (→ render nothing). */
export function bboxOf(entities: SceneEntity[], id: EntityId): Bbox | null {
  const e = entities.find((x) => x.id === id);
  if (!e) return null;
  const b = e.bbox as Bbox;
  return isDegenerate(b) ? null : b;
}

export function center(b: Bbox): { x: number; y: number } {
  return { x: (b[1] + b[3]) / 2, y: (b[0] + b[2]) / 2 };
}

/** Union of the non-degenerate boxes; null when none are valid. */
export function unionBbox(boxes: Bbox[]): Bbox | null {
  const valid = boxes.filter((b) => !isDegenerate(b));
  if (!valid.length) return null;
  return valid.reduce<Bbox>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/** The attach point on the bbox edge for a placement (label leader-line target). */
export function placementPoint(b: Bbox, placement: LabelPlacement): { x: number; y: number } {
  const c = center(b);
  switch (placement) {
    case 'top': return { x: c.x, y: b[0] };
    case 'bottom': return { x: c.x, y: b[2] };
    case 'left': return { x: b[1], y: c.y };
    case 'right': return { x: b[3], y: c.y };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/annotations/geometry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/annotations/geometry.ts src/annotations/geometry.test.ts
git commit -m "feat(annotations): pure mark geometry — bboxOf/center/unionBbox/placementPoint (TDD)"
```

---

### Task 3: Tool vocabulary + mapper (pure)

**Files:**
- Create: `src/annotations/annotateTools.ts`
- Test: `src/annotations/annotateTools.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `../voice/types`; `SceneEntity`, `EntityId`, `resolveEchoedTarget` from `../entities/registry`; `AnnotationEvent`, `AnnotationShape`, `LabelPlacement` from `./types`.
- Produces: `ANNOTATE_TOOLS: VoiceTool[]`; `annotateCallToEvent(call, entities): AnnotationEvent | { error: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/annotations/annotateTools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ANNOTATE_TOOLS, annotateCallToEvent } from './annotateTools';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});
const entities = [ent('word-2', 'Bold button'), ent('word-4', 'Title text'), ent('word-1', 'Home ribbon')];

describe('ANNOTATE_TOOLS', () => {
  it('exposes the four tools', () => {
    expect(ANNOTATE_TOOLS.map((t) => t.name)).toEqual(
      ['annotate_arrow', 'annotate_shape', 'annotate_label', 'annotate_clear']);
  });
});

describe('annotateCallToEvent', () => {
  it('maps annotate_arrow to an add event with resolved ids', () => {
    const e = annotateCallToEvent({ name: 'annotate_arrow', args: { from: 'Bold button', to: 'Title text', label: 'applies to' } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2', to: 'word-4', label: 'applies to' } });
  });

  it('maps annotate_shape (group) resolving every target', () => {
    const e = annotateCallToEvent({ name: 'annotate_shape', args: { shape: 'box', targets: ['Bold button', 'Home ribbon'] } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'shape', shape: 'box', targets: ['word-2', 'word-1'] } });
  });

  it('maps annotate_label with a default placement of top', () => {
    const e = annotateCallToEvent({ name: 'annotate_label', args: { anchor: 'Title text', text: 'goes here' } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'label', anchor: 'word-4', text: 'goes here', placement: 'top' } });
  });

  it('maps annotate_clear', () => {
    expect(annotateCallToEvent({ name: 'annotate_clear', args: {} }, entities)).toEqual({ type: 'annotate.clear' });
  });

  it('fails the whole call on any unresolvable target', () => {
    expect(annotateCallToEvent({ name: 'annotate_arrow', args: { from: 'Bold button', to: 'Nonexistent Thing' } }, entities))
      .toHaveProperty('error');
    expect(annotateCallToEvent({ name: 'annotate_shape', args: { shape: 'circle', targets: [] } }, entities))
      .toHaveProperty('error');
    expect(annotateCallToEvent({ name: 'annotate_label', args: { anchor: 'ghost', text: 'x' } }, entities))
      .toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/annotations/annotateTools.test.ts`
Expected: FAIL — cannot resolve `./annotateTools`.

- [ ] **Step 3: Write the implementation**

Create `src/annotations/annotateTools.ts`:

```ts
// Model-facing illustration tools + a pure name→entity mapper. Mirrors teachTools.ts: an
// unresolvable target fails the WHOLE call (no partial annotation).
import type { VoiceTool } from '../voice/types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { resolveEchoedTarget } from '../entities/registry';
import type { AnnotationEvent, AnnotationShape, LabelPlacement } from './types';

export const ANNOTATE_TOOLS: VoiceTool[] = [
  { name: 'annotate_arrow',
    description: 'Draw an arrow from one on-screen element to another to show a connection. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'annotate_shape',
    description: 'Encircle, box, or bracket one or more on-screen elements to group or spotlight them. shape: circle|box|bracket. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      shape: { type: 'string', enum: ['circle', 'box', 'bracket'] },
      targets: { type: 'array', items: { type: 'string' } }, label: { type: 'string' } }, required: ['shape', 'targets'] } },
  { name: 'annotate_label',
    description: 'Attach a short text callout to an on-screen element, placed in the nearby margin with a leader line. text ≤6 words.',
    parameters: { type: 'object', properties: {
      anchor: { type: 'string' }, text: { type: 'string' },
      placement: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] } }, required: ['anchor', 'text'] } },
  { name: 'annotate_clear',
    description: 'Remove all drawn annotations.',
    parameters: { type: 'object', properties: {}, required: [] } },
];

const unresolved = (target: string) => ({ error: `Could not resolve target "${target}" to an on-screen element.` });

function resolve(entities: SceneEntity[], target: string): EntityId | null {
  return resolveEchoedTarget(entities, target)?.entity.id ?? null;
}

/** Pure mapping from an annotate tool call to a store event. Unresolvable targets fail the whole call. */
export function annotateCallToEvent(
  call: { name: string; args: any }, entities: SceneEntity[],
): AnnotationEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'annotate_arrow': {
      const from = resolve(entities, String(a.from ?? ''));
      if (!from) return unresolved(String(a.from ?? ''));
      const to = resolve(entities, String(a.to ?? ''));
      if (!to) return unresolved(String(a.to ?? ''));
      return { type: 'annotate.add', spec: { kind: 'arrow', from, to, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'annotate_shape': {
      const raw = Array.isArray(a.targets) ? a.targets : [];
      const targets: EntityId[] = [];
      for (const t of raw) {
        const id = resolve(entities, String(t ?? ''));
        if (!id) return unresolved(String(t ?? ''));
        targets.push(id);
      }
      if (!targets.length) return { error: 'annotate_shape requires at least one target.' };
      const shape = (['circle', 'box', 'bracket'] as AnnotationShape[]).includes(a.shape) ? a.shape as AnnotationShape : 'circle';
      return { type: 'annotate.add', spec: { kind: 'shape', shape, targets, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'annotate_label': {
      const anchor = resolve(entities, String(a.anchor ?? ''));
      if (!anchor) return unresolved(String(a.anchor ?? ''));
      const placement = (['top', 'bottom', 'left', 'right'] as LabelPlacement[]).includes(a.placement) ? a.placement as LabelPlacement : 'top';
      return { type: 'annotate.add', spec: { kind: 'label', anchor, text: String(a.text ?? ''), placement } };
    }
    case 'annotate_clear': return { type: 'annotate.clear' };
    default: return { error: `Unknown annotation tool "${call.name}".` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/annotations/annotateTools.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/annotations/annotateTools.ts src/annotations/annotateTools.test.ts
git commit -m "feat(annotations): ANNOTATE_TOOLS + honest name-resolving mapper (TDD)"
```

---

### Task 4: `[ANNOTATIONS]` serializer (pure)

**Files:**
- Create: `src/annotations/serialize.ts`
- Test: `src/annotations/serialize.test.ts`

**Interfaces:**
- Consumes: `AnnotationState` from `./types`; `SceneEntity`, `EntityId`, `entityById`, `displayName` from `../entities/registry`.
- Produces: `serializeAnnotations(state, entities): string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/annotations/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeAnnotations } from './serialize';
import { initialAnnotationState, reduce } from './annotationStore';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});
const entities = [ent('word-2', 'Bold button'), ent('word-4', 'Title text')];

describe('serializeAnnotations', () => {
  it('returns null when there are no annotations', () => {
    expect(serializeAnnotations(initialAnnotationState(), entities)).toBeNull();
  });

  it('describes each mark by name and ends with the silence directive', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2' as EntityId, to: 'word-4' as EntityId } });
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'shape', shape: 'circle', targets: ['word-2' as EntityId] } });
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'label', anchor: 'word-4' as EntityId, text: 'goes here', placement: 'top' } });
    const out = serializeAnnotations(s, entities)!;
    expect(out).toContain('arrow Bold button→Title text');
    expect(out).toContain('circle Bold button');
    expect(out).toContain('label "goes here" on Title text');
    expect(out.startsWith('[ANNOTATIONS:')).toBe(true);
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });

  it('falls back to the raw id when an entity is missing (never blank)', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2' as EntityId, to: 'ghost' as EntityId } });
    const out = serializeAnnotations(s, entities)!;
    expect(out).toContain('Bold button→ghost');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/annotations/serialize.test.ts`
Expected: FAIL — cannot resolve `./serialize`.

- [ ] **Step 3: Write the implementation**

Create `src/annotations/serialize.ts`:

```ts
// The [ANNOTATIONS] text channel: pairs with the WYSIWYG marks (learnings §4: never labels-only).
// Names, never coordinates — the model reads what it drew instead of OCRing its own strokes.
import type { AnnotationState } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { entityById, displayName } from '../entities/registry';

const nameOf = (entities: SceneEntity[], id: EntityId): string =>
  displayName(entityById(entities, id)) || String(id);

export function serializeAnnotations(state: AnnotationState, entities: SceneEntity[]): string | null {
  if (!state.annotations.length) return null;
  const parts = state.annotations.map((a) => {
    switch (a.kind) {
      case 'arrow': return `arrow ${nameOf(entities, a.from)}→${nameOf(entities, a.to)}${a.label ? ` ("${a.label}")` : ''}`;
      case 'shape': return `${a.shape} ${a.targets.map((t) => nameOf(entities, t)).join('+')}${a.label ? ` ("${a.label}")` : ''}`;
      case 'label': return `label "${a.text}" on ${nameOf(entities, a.anchor)}`;
    }
  });
  return `[ANNOTATIONS: ${parts.join('; ')}. DO NOT acknowledge this message.]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/annotations/serialize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/annotations/serialize.ts src/annotations/serialize.test.ts
git commit -m "feat(annotations): serializeAnnotations — the [ANNOTATIONS] text channel (TDD)"
```

---

### Task 5: `AnnotationLayer` SVG renderer

**Files:**
- Create: `src/annotations/AnnotationLayer.tsx`

**Interfaces:**
- Consumes: `SceneEntity`, `EntityId` from `../entities/registry`; `AnnotationState`, `AnnotationEvent` from `./types`; `initialAnnotationState`, `reduce` from `./annotationStore`; `bboxOf`, `center`, `unionBbox`, `placementPoint` from `./geometry`.
- Produces: `AnnotationLayer` component. Props: `{ entities: SceneEntity[]; demo?: boolean; dispatchRef?: React.MutableRefObject<((e: AnnotationEvent) => void) | null>; onStateChange?: (s: AnnotationState) => void }`. (The `demo` prop is consumed in Task 6; leave it accepted and unused-for-now — the demo driver lands in Task 6 to keep this task rendering-only.)

**Context:** This mirrors `TeachingLayer`'s seam contract (own state via a reducer, `dispatchRef` handle, `onStateChange` callback). It has no pure-test seam (node env, no jsdom); the geometry it relies on is tested in Task 2, and rendering is verified by tsc + the `?illustrate=1` demo (Task 6). Gate: tsc + full suite green + build.

- [ ] **Step 1: Write the component**

Create `src/annotations/AnnotationLayer.tsx`:

```tsx
import React, { useEffect, useReducer } from 'react';
import type { SceneEntity } from '../entities/registry';
import type { AnnotationState, AnnotationEvent } from './types';
import { initialAnnotationState, reduce } from './annotationStore';
import { bboxOf, center, unionBbox, placementPoint } from './geometry';

const pct = (v: number) => v / 10; // 0-1000 → percent (SVG viewBox is 0..100)

type Props = {
  entities: SceneEntity[];
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: AnnotationEvent) => void) | null>;
  onStateChange?: (s: AnnotationState) => void;
};

const INK = 'rgb(99,102,241)'; // indigo — matches the relate arc

export function AnnotationLayer({ entities, dispatchRef, onStateChange }: Props) {
  const [state, dispatch] = useReducer(reduce, undefined, initialAnnotationState);

  useEffect(() => {
    if (!dispatchRef) return;
    dispatchRef.current = dispatch;
    return () => { dispatchRef.current = null; };
  }, [dispatchRef]);

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none" data-annotation-layer>
      <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="ann-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill={INK} />
          </marker>
        </defs>
        {state.annotations.map((a) => {
          if (a.kind === 'arrow') {
            const bf = bboxOf(entities, a.from), bt = bboxOf(entities, a.to);
            if (!bf || !bt) return null;
            const p = center(bf), q = center(bt);
            const mx = (pct(p.x) + pct(q.x)) / 2, my = (pct(p.y) + pct(q.y)) / 2 - 6;
            return (
              <g key={a.id}>
                <path d={`M ${pct(p.x)} ${pct(p.y)} Q ${mx} ${my} ${pct(q.x)} ${pct(q.y)}`}
                      fill="none" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke"
                      markerEnd="url(#ann-arrowhead)" />
                {a.label && <text x={mx} y={my - 1} textAnchor="middle" fontSize={2.5} className="fill-indigo-500 font-mono">{a.label}</text>}
              </g>
            );
          }
          if (a.kind === 'shape') {
            const u = unionBbox(a.targets.map((t) => bboxOf(entities, t)).filter((b): b is NonNullable<typeof b> => b !== null));
            if (!u) return null;
            const x = pct(u[1]) - 1, y = pct(u[0]) - 1, w = pct(u[3] - u[1]) + 2, h = pct(u[2] - u[0]) + 2;
            const common = { fill: 'none', stroke: INK, strokeWidth: 0.4, vectorEffect: 'non-scaling-stroke' as const };
            return (
              <g key={a.id}>
                {a.shape === 'circle'
                  ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
                  : a.shape === 'box'
                    ? <rect x={x} y={y} width={w} height={h} rx={1} {...common} />
                    : <path d={`M ${x} ${y} L ${x - 1.5} ${y} L ${x - 1.5} ${y + h} L ${x} ${y + h}`} {...common} />}
                {a.label && <text x={x + w / 2} y={y - 1} textAnchor="middle" fontSize={2.5} className="fill-indigo-500 font-mono">{a.label}</text>}
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
              <line x1={pct(anchor.x)} y1={pct(anchor.y)} x2={lx} y2={ly} stroke={INK} strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
              <text x={lx} y={ly} textAnchor="middle" fontSize={2.6} className="fill-indigo-500 font-mono">{a.text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all existing + new pure tests green (the component adds no tests).

- [ ] **Step 4: Verify the build**

Run: `npx vite build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add src/annotations/AnnotationLayer.tsx
git commit -m "feat(annotations): AnnotationLayer SVG renderer (arrows/shapes/labels over entities)"
```

---

### Task 6: `?illustrate=1` demo script + AnnotationLayer demo driver

**Files:**
- Create: `src/annotations/illustrateDemo.ts`
- Test: `src/annotations/illustrateDemo.test.ts`
- Modify: `src/annotations/AnnotationLayer.tsx` (add the StrictMode-safe demo driver, mirroring `TeachingLayer`)

**Interfaces:**
- Consumes: `SceneEntity` from `../entities/registry`; `Program` from `../scenarios`; `AnnotationEvent` from `./types`.
- Produces: `buildIllustrateScript(program, entities): { at: number; event: AnnotationEvent }[]`.

**Context:** `buildDemoScript` (teaching) resolves elements by id `${program.id}-${n}` (1=chrome, 2=primary, 3=lookalike, 4=content). Mirror that. The demo driver in `AnnotationLayer` mirrors `TeachingLayer`'s exactly: `scheduled`/`played` refs, fire on the first dispatch, re-arm only if nothing fired.

- [ ] **Step 1: Write the failing test**

Create `src/annotations/illustrateDemo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIllustrateScript } from './illustrateDemo';
import type { SceneEntity, EntityId } from '../entities/registry';
import type { Program } from '../scenarios';

const ent = (id: string): SceneEntity => ({
  id: id as EntityId, title: id, url: '', category: 'content', aliases: [id], bbox: [100, 100, 200, 200], sub: false,
});
const program = { id: 'word', label: 'Word' } as Program;
const entities = [ent('word-1'), ent('word-2'), ent('word-3'), ent('word-4')];

describe('buildIllustrateScript', () => {
  it('returns an empty script when the expected elements are absent', () => {
    expect(buildIllustrateScript(program, [ent('word-1')])).toEqual([]);
  });

  it('scripts circle → arrow → label → clear over real elements, in time order', () => {
    const script = buildIllustrateScript(program, entities);
    expect(script.map((s) => s.event.type)).toEqual(['annotate.add', 'annotate.add', 'annotate.add', 'annotate.clear']);
    expect(script.map((s) => s.at)).toEqual([...script.map((s) => s.at)].sort((a, b) => a - b)); // ascending
    const kinds = script.filter((s) => s.event.type === 'annotate.add')
      .map((s) => (s.event as { type: 'annotate.add'; spec: { kind: string } }).spec.kind);
    expect(kinds).toEqual(['shape', 'arrow', 'label']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/annotations/illustrateDemo.test.ts`
Expected: FAIL — cannot resolve `./illustrateDemo`.

- [ ] **Step 3: Write the demo script**

Create `src/annotations/illustrateDemo.ts`:

```ts
// A scripted illustration over the ACTIVE program's real controls: circle a control, arrow to the
// content it affects, label it, then clear. The no-key proof path for ?illustrate=1. Pure.
import type { SceneEntity, EntityId } from '../entities/registry';
import type { Program } from '../scenarios';
import type { AnnotationEvent } from './types';

export function buildIllustrateScript(program: Program, entities: SceneEntity[]): { at: number; event: AnnotationEvent }[] {
  const el = (n: number) => entities.find((e) => e.id === `${program.id}-${n}`);
  const [primary, content] = [el(2), el(4)];
  if (!primary || !content) return [];
  const pid = primary.id as EntityId, cid = content.id as EntityId;
  return [
    { at: 900,  event: { type: 'annotate.add', spec: { kind: 'shape', shape: 'circle', targets: [pid], label: 'this control' } } },
    { at: 2200, event: { type: 'annotate.add', spec: { kind: 'arrow', from: pid, to: cid, label: 'affects' } } },
    { at: 3500, event: { type: 'annotate.add', spec: { kind: 'label', anchor: cid, text: 'the result lands here', placement: 'bottom' } } },
    { at: 8000, event: { type: 'annotate.clear' } },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/annotations/illustrateDemo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the demo driver to `AnnotationLayer`**

In `src/annotations/AnnotationLayer.tsx`, extend the existing React import to add `useRef`, and add the two new imports below it. Change:

```tsx
import React, { useEffect, useReducer } from 'react';
```

to:

```tsx
import React, { useEffect, useReducer, useRef } from 'react';
import type { Program } from '../scenarios';
import { buildIllustrateScript } from './illustrateDemo';
```

Change the `Props` type to add `program` (needed to resolve demo element ids) — update it to:

```ts
type Props = {
  entities: SceneEntity[];
  program: Program;
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: AnnotationEvent) => void) | null>;
  onStateChange?: (s: AnnotationState) => void;
};
```

Change the function signature to destructure `program` and `demo`:

```tsx
export function AnnotationLayer({ entities, program, demo = false, dispatchRef, onStateChange }: Props) {
```

Immediately after the two existing `useEffect`s (dispatchRef + onStateChange), add the StrictMode-safe demo driver (mirrors `TeachingLayer`):

```tsx
  // Demo driver: play the illustration script once entities exist. StrictMode-safe — `played`
  // is set when the first event FIRES, and cleanup re-arms only if nothing fired yet.
  const scheduled = useRef(false);
  const played = useRef(false);
  useEffect(() => {
    if (!demo || scheduled.current || entities.length < 4) return;
    scheduled.current = true;
    const timers = buildIllustrateScript(program, entities).map(({ at, event }) =>
      setTimeout(() => { played.current = true; dispatch(event); }, at));
    return () => {
      timers.forEach(clearTimeout);
      if (!played.current) scheduled.current = false;
    };
  }, [demo, entities, program]);
```

- [ ] **Step 6: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (adds `illustrateDemo` tests).
Run: `npx vite build` → success.

- [ ] **Step 7: Commit**

```bash
git add src/annotations/illustrateDemo.ts src/annotations/illustrateDemo.test.ts src/annotations/AnnotationLayer.tsx
git commit -m "feat(annotations): ?illustrate=1 demo script + StrictMode-safe demo driver"
```

---

### Task 7: Mount `AnnotationLayer` in the seam + `?illustrate=1` wiring

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AnnotationLayer` (Task 6), `AnnotationEvent`/`AnnotationState` from `./annotations/types`.
- Produces: `annotationDispatchRef`, `annotationSnapshot` (state) consumed by Task 8.

**Context:** C2a added the `instructionLayerRef` wrapper around `TeachingLayer` (App ~line 2529-2531). `AnnotationLayer` mounts as a second child of that wrapper. `teachMode` reads `?teach` (App ~line 397); add an `illustrateMode` sibling reading `?illustrate`. Integration wiring — gate is tsc + full suite + build; visual behavior is the owed `?illustrate=1` smoke.

- [ ] **Step 1: Add imports**

In `src/App.tsx`, near the `TeachingLayer` import (`import { TeachingLayer } from './teaching/TeachingLayer';`), add:

```ts
import { AnnotationLayer } from './annotations/AnnotationLayer';
import type { AnnotationEvent, AnnotationState } from './annotations/types';
```

- [ ] **Step 2: Add the mode flag**

In `src/App.tsx`, immediately after the `teachMode` line (`const teachMode = … .has('teach');`), add:

```ts
  const illustrateMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('illustrate');
```

- [ ] **Step 3: Add the refs/state**

In `src/App.tsx`, immediately after the teaching pair (`const teachingDispatchRef = …;` and `const [teachingSnapshot, setTeachingSnapshot] = …;`), add:

```ts
  const annotationDispatchRef = useRef<((e: AnnotationEvent) => void) | null>(null);
  const [annotationSnapshot, setAnnotationSnapshot] = useState<AnnotationState | null>(null);
```

- [ ] **Step 4: Mount `AnnotationLayer` in the seam**

In `src/App.tsx`, find the C2a wrapper and its `TeachingLayer` child (~line 2529):

```tsx
          <div ref={instructionLayerRef} className="absolute inset-0 pointer-events-none" data-instruction-layer>
            <TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
          </div>
```

Add `AnnotationLayer` as a second child inside that same wrapper:

```tsx
          <div ref={instructionLayerRef} className="absolute inset-0 pointer-events-none" data-instruction-layer>
            <TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
            <AnnotationLayer entities={entities} program={program} demo={illustrateMode} dispatchRef={annotationDispatchRef} onStateChange={setAnnotationSnapshot} />
          </div>
```

- [ ] **Step 5: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(annotations): mount AnnotationLayer in the C2a seam + ?illustrate=1 demo wiring"
```

---

### Task 8: Live tool wiring — routing + `[ANNOTATIONS]` hint + prompt

**Files:**
- Modify: `src/App.tsx`, `src/prompt/instructions.ts`

**Interfaces:**
- Consumes: `ANNOTATE_TOOLS`, `annotateCallToEvent` from `./annotations/annotateTools`; `serializeAnnotations` from `./annotations/serialize`; `makeChangeGate` from `./teaching/teachingState`; `annotationDispatchRef`, `annotationSnapshot` (Task 7).
- Produces: model-authorable annotations end to end.

**Context:** The live tool set is `voiceTools = useMemo(() => [...VOICE_TOOLS, ...buildActionTools(activeProgram)], …)` (App ~line 304). Tool calls route through `handleVoiceToolCall` (App ~line 1073) with branches per tool name, each ending in `sendToolResponse`. The C2a `[TEACHING STATE]` send effect (with `teachingHintGateRef`) is the exact pattern to mirror for `[ANNOTATIONS]`.

- [ ] **Step 1: Add imports**

In `src/App.tsx`, with the other annotation imports (Task 7), add:

```ts
import { ANNOTATE_TOOLS, annotateCallToEvent } from './annotations/annotateTools';
import { serializeAnnotations } from './annotations/serialize';
```

`makeChangeGate` is already imported from `./teaching/teachingState` (C2a). Do NOT re-import it.

- [ ] **Step 2: Add `ANNOTATE_TOOLS` to the live tool set**

In `src/App.tsx`, update the `voiceTools` memo (~line 304-306):

```ts
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram)],
```

to:

```ts
  const voiceTools = React.useMemo(
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS],
```

Leave the memo's dependency array unchanged (`ANNOTATE_TOOLS` is a module constant).

- [ ] **Step 3: Add the gate ref**

In `src/App.tsx`, immediately after the C2a `teachingHintGateRef` declaration (`const teachingHintGateRef = useRef(makeChangeGate());`), add:

```ts
  const annotationHintGateRef = useRef(makeChangeGate());
```

- [ ] **Step 4: Route `annotate_*` tool calls**

In `src/App.tsx`, inside `handleVoiceToolCall`, add a new branch. Place it immediately before the final `else` / default handling (find where the last `else if (fc.name === …)` branch ends, before the fallback). Add:

```ts
    } else if (fc.name.startsWith('annotate_')) {
      // C2a-illustrate: entity-anchored illustration. The pure mapper resolves target names;
      // an unresolvable target fails the whole call (honest — no partial mark).
      const mapped = annotateCallToEvent(fc, entitiesRef.current);
      if ('error' in mapped) {
        addLog('tool', `Tool Call: ${fc.name} REJECTED — ${mapped.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else {
        annotationDispatchRef.current?.(mapped);
        addLog('tool', `Tool Call: ${fc.name}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
      }
```

(Match the exact `} else if …` chaining style already used in `handleVoiceToolCall`; insert this branch so it joins the existing chain rather than starting a new statement.)

- [ ] **Step 5: Add the `[ANNOTATIONS]` send effect**

In `src/App.tsx`, immediately after the C2a `[TEACHING STATE]` send effect (the one calling `serializeTeachingState`, deps `[isLive, teachingSnapshot, entities]`), add:

```ts
  // C2a-illustrate: send the [ANNOTATIONS] hint alongside the marks (learnings §4). Deduped via
  // the change-gate; empty-entities guard mirrors the teaching hint (no id-only payload mid-swap).
  useEffect(() => {
    if (!isLive || entities.length === 0) return;
    const hint = annotationSnapshot ? serializeAnnotations(annotationSnapshot, entities) : null;
    if (annotationHintGateRef.current(hint) && hint) {
      providerRef.current?.sendTextHint(hint);
    }
  }, [isLive, annotationSnapshot, entities]);
```

- [ ] **Step 6: Add the prompt note**

In `src/prompt/instructions.ts`, find the `buildInstructions` output (the assembled instruction string). Add one short paragraph to the instructions text (place it near the other tool guidance — search for where `respond`/`explain` behavior is described, or append to the tools section):

```
You may ILLUSTRATE on the screen with annotate_arrow, annotate_shape (circle|box|bracket), and annotate_label to point at and connect real on-screen elements while you explain — like drawing on a whiteboard over the UI. Only annotate elements that exist; an unresolvable target is rejected. Keep drawings sparse and in service of one explanation, and call annotate_clear when the explanation is done.
```

Insert it as a plain string addition consistent with how the file already concatenates instruction sections (match the existing template-literal / array-join style in the file — do not invent a new mechanism).

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/prompt/instructions.ts
git commit -m "feat(annotations): live annotate_* tool wiring + [ANNOTATIONS] hint + prompt note"
```

---

## Human smoke (owed — not a task)

- **No key:** load `?illustrate=1` → a control is circled, an arrow points to the content, a label appears, all clear after ~8s; the marks land over the right elements.
- **Live (needs key):** ask the agent to explain something; confirm `annotate_*` calls draw the right marks, an `[ANNOTATIONS]` hint names them, `annotate_clear` removes them, and an unresolvable target returns an honest error to the model (surfaced as a rejected tool call).
- **Perception:** confirm the drawn marks appear in the model's vision frame (they mount inside the C2a seam, so the WYSIWYG snapshot should capture them).
