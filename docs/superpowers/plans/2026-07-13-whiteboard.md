# Whiteboard (free-coordinate illustration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent compose structured explanatory diagrams (nodes / connectors / labels) at free coordinates, rendered to a dedicated whiteboard panel OR the C2a overlay seam, selectable by a debug toggle for evaluation.

**Architecture:** A self-contained `src/whiteboard/` subsystem (pure types + store + geometry + tool-mapper + serializer + demo, plus a `WhiteboardMarks` SVG renderer and a `WhiteboardPanel`). One free-coordinate mark model renders to whichever surface `whiteboardMode` picks. Live-wired via `WB_TOOLS`; board mode gets a deduped `[WHITEBOARD]` text hint; overlay mode is perceived for free via C2a's snapshot.

**Tech Stack:** React 19 (`useReducer`), TypeScript, Vitest (node — pure tests only), SVG, the existing `VoiceTool`/`sendTextHint` channels, the `DebugDrawer` `Select` pattern.

**Spec:** `docs/superpowers/specs/2026-07-10-whiteboard-design.md`. The free-coordinate sibling of C2a-illustrate.

## Global Constraints

- **Free coordinates, 0–1000 space, `[ymin,xmin,ymax,xmax]`** for boxes (matches the app's convention); the renderer converts via `pct = v/10`.
- **Deterministic:** connector/label ids from a monotonic `nextId`; nodes carry a model-supplied `key`. NO `Math.random`/`Date.now` in any pure module.
- **Fail-soft:** an unresolved connector key / missing node / degenerate coordinate renders nothing — never a stray mark or crash. `MAX_MARKS` cap (32), oldest dropped.
- **Honesty:** board mode makes no positional claim (scratch space); overlay marks are illustration (perceivable via C2a, clearable), never a claim about UI positions.
- **No drift:** `[WHITEBOARD]` (board mode) keeps the model's view = the store truth; it re-tells live node keys so multi-call diagrams wire correctly.
- No changes to `src/annotations/`, teaching, entities, or perception plumbing beyond mounting a sibling renderer in the C2a seam.

---

### Task 1: Mark model + store (pure)

**Files:**
- Create: `src/whiteboard/types.ts`, `src/whiteboard/store.ts`
- Test: `src/whiteboard/store.test.ts`

**Interfaces:**
- Produces: `WbShape`, `WbMark`, `WbSpec`, `WbEvent`, `WhiteboardState` (types); `initialWhiteboardState()`, `reduce(state, event)`, `MAX_MARKS`.

- [ ] **Step 1: Write the failing test**

Create `src/whiteboard/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialWhiteboardState, reduce, MAX_MARKS } from './store';
import type { WbSpec } from './types';

const node = (key: string, x = 500, y = 500): WbSpec => ({ kind: 'node', key, x, y, text: key, shape: 'box' });

describe('whiteboard store', () => {
  it('adds a node; re-adding the same key replaces in place (keeps order)', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: node('a', 100, 100) });
    s = reduce(s, { type: 'wb.add', spec: node('b', 200, 200) });
    s = reduce(s, { type: 'wb.add', spec: node('a', 900, 900) }); // replace a
    expect(s.marks.length).toBe(2);
    const a = s.marks.find((m) => m.kind === 'node' && m.key === 'a') as any;
    expect([a.x, a.y]).toEqual([900, 900]);
    expect(s.marks[0].kind === 'node' && s.marks[0].key).toBe('a'); // order preserved
  });

  it('stamps deterministic ids on connectors/labels', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'connector', from: 'a', to: 'b' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'label', x: 10, y: 10, text: 'hi' } });
    expect(s.marks.map((m) => (m.kind !== 'node' ? m.id : '·'))).toEqual(['1', '2']);
    expect(s.nextId).toBe(3);
  });

  it('caps at MAX_MARKS, dropping oldest', () => {
    let s = initialWhiteboardState();
    for (let i = 0; i < MAX_MARKS + 3; i++) s = reduce(s, { type: 'wb.add', spec: node(`n${i}`) });
    expect(s.marks.length).toBe(MAX_MARKS);
    expect((s.marks[0] as any).key).toBe('n3'); // oldest three dropped
  });

  it('clear empties marks but keeps nextId monotonic', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'label', x: 1, y: 1, text: 'x' } });
    s = reduce(s, { type: 'wb.clear' });
    expect(s.marks).toEqual([]);
    expect(s.nextId).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whiteboard/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write the types**

Create `src/whiteboard/types.ts`:

```ts
// Free-coordinate diagram marks (the whiteboard). Nodes carry a model-supplied key so connectors
// wire to them; connectors/labels get a deterministic id from the store.
export type WbShape = 'box' | 'ellipse';

export type WbMark =
  | { kind: 'node'; key: string; x: number; y: number; text: string; shape: WbShape } // (x,y) 0-1000, box center
  | { kind: 'connector'; id: string; from: string; to: string; label?: string }        // from/to = node keys
  | { kind: 'label'; id: string; x: number; y: number; text: string };

export type WbSpec =
  | Extract<WbMark, { kind: 'node' }>
  | Omit<Extract<WbMark, { kind: 'connector' }>, 'id'>
  | Omit<Extract<WbMark, { kind: 'label' }>, 'id'>;

export type WbEvent =
  | { type: 'wb.add'; spec: WbSpec }
  | { type: 'wb.clear' };

export interface WhiteboardState { marks: WbMark[]; nextId: number }
```

- [ ] **Step 4: Write the store**

Create `src/whiteboard/store.ts`:

```ts
import type { WhiteboardState, WbEvent, WbMark } from './types';

export const MAX_MARKS = 32;

export function initialWhiteboardState(): WhiteboardState {
  return { marks: [], nextId: 1 };
}

export function reduce(state: WhiteboardState, event: WbEvent): WhiteboardState {
  switch (event.type) {
    case 'wb.add': {
      const spec = event.spec;
      if (spec.kind === 'node') {
        // Replace-by-key in place if the key exists, else append (capped).
        const idx = state.marks.findIndex((m) => m.kind === 'node' && m.key === spec.key);
        if (idx >= 0) {
          const marks = state.marks.map((m, i) => (i === idx ? spec : m));
          return { ...state, marks };
        }
        const marks = [...state.marks, spec].slice(-MAX_MARKS);
        return { ...state, marks };
      }
      // connector | label: stamp a deterministic id.
      const mark = { ...spec, id: String(state.nextId) } as WbMark;
      const marks = [...state.marks, mark].slice(-MAX_MARKS);
      return { marks, nextId: state.nextId + 1 };
    }
    case 'wb.clear':
      return { marks: [], nextId: state.nextId };
    default:
      return state;
  }
}
```

(Note: the `WhiteboardState extends never …` guard is unnecessary — write the signature plainly as `reduce(state: WhiteboardState, event: WbEvent): WhiteboardState`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/whiteboard/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/whiteboard/types.ts src/whiteboard/store.ts src/whiteboard/store.test.ts
git commit -m "feat(whiteboard): mark model + store (replace-by-key nodes, stamped ids, cap) (TDD)"
```

---

### Task 2: Geometry (pure)

**Files:**
- Create: `src/whiteboard/geometry.ts`
- Test: `src/whiteboard/geometry.test.ts`

**Interfaces:**
- Consumes: `WbMark` from `./types`.
- Produces: `NODE_W`, `NODE_H`, `nodeBox({x,y})`, `nodeByKey(marks, key)`, `connectorEnds(marks, connector)`.

- [ ] **Step 1: Write the failing test**

Create `src/whiteboard/geometry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whiteboard/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Implement**

Create `src/whiteboard/geometry.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/whiteboard/geometry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/whiteboard/geometry.ts src/whiteboard/geometry.test.ts
git commit -m "feat(whiteboard): pure geometry — nodeBox/nodeByKey/connectorEnds (fail-soft) (TDD)"
```

---

### Task 3: Tools + mapper (pure)

**Files:**
- Create: `src/whiteboard/tools.ts`
- Test: `src/whiteboard/tools.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `../voice/types`; `WbEvent`, `WbShape` from `./types`.
- Produces: `WB_TOOLS`; `wbCallToEvent(call)`.

- [ ] **Step 1: Write the failing test**

Create `src/whiteboard/tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WB_TOOLS, wbCallToEvent } from './tools';

describe('WB_TOOLS', () => {
  it('exposes the four tools', () => {
    expect(WB_TOOLS.map((t) => t.name)).toEqual(['wb_node', 'wb_connect', 'wb_label', 'wb_clear']);
  });
});

describe('wbCallToEvent', () => {
  it('maps wb_node (shape defaults box, coords coerced+clamped)', () => {
    expect(wbCallToEvent({ name: 'wb_node', args: { key: 'a', x: '300', y: 1200, text: 'Start' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'node', key: 'a', x: 300, y: 1000, text: 'Start', shape: 'box' } });
  });
  it('maps wb_connect', () => {
    expect(wbCallToEvent({ name: 'wb_connect', args: { from: 'a', to: 'b', label: 'then' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'connector', from: 'a', to: 'b', label: 'then' } });
  });
  it('maps wb_label and wb_clear', () => {
    expect(wbCallToEvent({ name: 'wb_label', args: { x: 10, y: 20, text: 'note' } }))
      .toEqual({ type: 'wb.add', spec: { kind: 'label', x: 10, y: 20, text: 'note' } });
    expect(wbCallToEvent({ name: 'wb_clear', args: {} })).toEqual({ type: 'wb.clear' });
  });
  it('errors on missing required fields', () => {
    expect(wbCallToEvent({ name: 'wb_node', args: { x: 1, y: 1, text: 't' } })).toHaveProperty('error'); // no key
    expect(wbCallToEvent({ name: 'wb_node', args: { key: 'a', x: 1, y: 1 } })).toHaveProperty('error');   // no text
    expect(wbCallToEvent({ name: 'wb_connect', args: { from: 'a' } })).toHaveProperty('error');           // no to
    expect(wbCallToEvent({ name: 'wb_label', args: { x: 1, y: 1 } })).toHaveProperty('error');            // no text
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whiteboard/tools.test.ts`
Expected: FAIL — cannot resolve `./tools`.

- [ ] **Step 3: Implement**

Create `src/whiteboard/tools.ts`:

```ts
// Model-facing whiteboard tools + a pure mapper. Fail-soft on bad coords; missing required fields
// fail the call. Connectors are NOT key-checked here (unresolved keys render nothing — the model
// learns live node keys from the [WHITEBOARD] hint).
import type { VoiceTool } from '../voice/types';
import type { WbEvent, WbShape } from './types';

export const WB_TOOLS: VoiceTool[] = [
  { name: 'wb_node',
    description: 'Draw a labeled diagram node (box or ellipse) on the whiteboard at (x,y) in 0-1000 space. key = a short id you reuse to connect it. Compose diagrams by placing nodes then connecting them.',
    parameters: { type: 'object', properties: {
      key: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      text: { type: 'string' }, shape: { type: 'string', enum: ['box', 'ellipse'] } }, required: ['key', 'x', 'y', 'text'] } },
  { name: 'wb_connect',
    description: 'Draw an arrow between two whiteboard nodes by their keys, with an optional short label.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'wb_label',
    description: 'Place free caption text on the whiteboard at (x,y) in 0-1000 space.',
    parameters: { type: 'object', properties: {
      x: { type: 'number' }, y: { type: 'number' }, text: { type: 'string' } }, required: ['x', 'y', 'text'] } },
  { name: 'wb_clear',
    description: 'Clear the whiteboard.',
    parameters: { type: 'object', properties: {}, required: [] } },
];

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : NaN; };
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function wbCallToEvent(call: { name: string; args: any }): WbEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'wb_node': {
      const key = str(a.key).trim(); const text = str(a.text).trim();
      const x = num(a.x), y = num(a.y);
      if (!key) return { error: 'wb_node needs a key.' };
      if (!text) return { error: 'wb_node needs text.' };
      if (Number.isNaN(x) || Number.isNaN(y)) return { error: 'wb_node needs numeric x,y.' };
      const shape: WbShape = a.shape === 'ellipse' ? 'ellipse' : 'box';
      return { type: 'wb.add', spec: { kind: 'node', key, x, y, text, shape } };
    }
    case 'wb_connect': {
      const from = str(a.from).trim(), to = str(a.to).trim();
      if (!from || !to) return { error: 'wb_connect needs from and to node keys.' };
      return { type: 'wb.add', spec: { kind: 'connector', from, to, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'wb_label': {
      const text = str(a.text).trim(); const x = num(a.x), y = num(a.y);
      if (!text) return { error: 'wb_label needs text.' };
      if (Number.isNaN(x) || Number.isNaN(y)) return { error: 'wb_label needs numeric x,y.' };
      return { type: 'wb.add', spec: { kind: 'label', x, y, text } };
    }
    case 'wb_clear': return { type: 'wb.clear' };
    default: return { error: `Unknown whiteboard tool "${call.name}".` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/whiteboard/tools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/whiteboard/tools.ts src/whiteboard/tools.test.ts
git commit -m "feat(whiteboard): WB_TOOLS + wbCallToEvent mapper (TDD)"
```

---

### Task 4: `[WHITEBOARD]` serializer (pure)

**Files:**
- Create: `src/whiteboard/serialize.ts`
- Test: `src/whiteboard/serialize.test.ts`

**Interfaces:**
- Consumes: `WhiteboardState` from `./types`.
- Produces: `serializeWhiteboard(state): string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/whiteboard/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeWhiteboard } from './serialize';
import { initialWhiteboardState, reduce } from './store';

describe('serializeWhiteboard', () => {
  it('returns null for an empty board', () => {
    expect(serializeWhiteboard(initialWhiteboardState())).toBeNull();
  });
  it('names nodes by key and connectors by from→to', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'node', key: 'start', x: 100, y: 100, text: 'Start', shape: 'box' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'node', key: 'end', x: 800, y: 100, text: 'End', shape: 'box' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'connector', from: 'start', to: 'end', label: 'go' } });
    const out = serializeWhiteboard(s)!;
    expect(out).toContain('nodes: start, end');
    expect(out).toContain('start→end ("go")');
    expect(out.startsWith('[WHITEBOARD:')).toBe(true);
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whiteboard/serialize.test.ts`
Expected: FAIL — cannot resolve `./serialize`.

- [ ] **Step 3: Implement**

Create `src/whiteboard/serialize.ts`:

```ts
// The [WHITEBOARD] text channel (board mode): the model authored these marks, so the store IS its
// truth — this re-tells node keys so multi-call diagrams wire correctly.
import type { WhiteboardState } from './types';

export function serializeWhiteboard(state: WhiteboardState): string | null {
  if (!state.marks.length) return null;
  const nodes = state.marks.filter((m) => m.kind === 'node').map((m) => (m as { key: string }).key);
  const conns = state.marks.filter((m) => m.kind === 'connector')
    .map((m) => { const c = m as { from: string; to: string; label?: string }; return `${c.from}→${c.to}${c.label ? ` ("${c.label}")` : ''}`; });
  const labels = state.marks.filter((m) => m.kind === 'label').map((m) => `"${(m as { text: string }).text}"`);
  const parts: string[] = [];
  if (nodes.length) parts.push(`nodes: ${nodes.join(', ')}`);
  if (conns.length) parts.push(`connectors: ${conns.join('; ')}`);
  if (labels.length) parts.push(`labels: ${labels.join(', ')}`);
  return `[WHITEBOARD: ${parts.join('. ')}. DO NOT acknowledge this message.]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/whiteboard/serialize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/whiteboard/serialize.ts src/whiteboard/serialize.test.ts
git commit -m "feat(whiteboard): serializeWhiteboard — the [WHITEBOARD] text channel (TDD)"
```

---

### Task 5: `?whiteboard=1` demo script (pure)

**Files:**
- Create: `src/whiteboard/demo.ts`
- Test: `src/whiteboard/demo.test.ts`

**Interfaces:**
- Consumes: `WbEvent` from `./types`.
- Produces: `buildWhiteboardDemo(): { at: number; event: WbEvent }[]`.

- [ ] **Step 1: Write the failing test**

Create `src/whiteboard/demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWhiteboardDemo } from './demo';

describe('buildWhiteboardDemo', () => {
  it('scripts a small diagram (nodes → connectors) then clear, in time order', () => {
    const script = buildWhiteboardDemo();
    expect(script.length).toBeGreaterThan(3);
    expect(script.map((s) => s.at)).toEqual([...script.map((s) => s.at)].sort((a, b) => a - b)); // ascending
    expect(script[0].event).toMatchObject({ type: 'wb.add', spec: { kind: 'node' } });
    expect(script[script.length - 1].event).toEqual({ type: 'wb.clear' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/whiteboard/demo.test.ts`
Expected: FAIL — cannot resolve `./demo`.

- [ ] **Step 3: Implement**

Create `src/whiteboard/demo.ts`:

```ts
// A scripted whiteboard illustration (no key needed) for ?whiteboard=1: three nodes wired into a
// tiny flow, a caption, then clear. Pure — timing offsets in ms.
import type { WbEvent } from './types';

export function buildWhiteboardDemo(): { at: number; event: WbEvent }[] {
  return [
    { at: 600,  event: { type: 'wb.add', spec: { kind: 'node', key: 'in', x: 250, y: 300, text: 'You point', shape: 'box' } } },
    { at: 1200, event: { type: 'wb.add', spec: { kind: 'node', key: 'model', x: 500, y: 300, text: 'Agent grounds', shape: 'box' } } },
    { at: 1800, event: { type: 'wb.add', spec: { kind: 'node', key: 'act', x: 750, y: 300, text: 'Witnessed action', shape: 'box' } } },
    { at: 2400, event: { type: 'wb.add', spec: { kind: 'connector', from: 'in', to: 'model', label: 'this' } } },
    { at: 3000, event: { type: 'wb.add', spec: { kind: 'connector', from: 'model', to: 'act', label: 'confirm' } } },
    { at: 3600, event: { type: 'wb.add', spec: { kind: 'label', x: 500, y: 500, text: 'the honest loop' } } },
    { at: 9000, event: { type: 'wb.clear' } },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/whiteboard/demo.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/whiteboard/demo.ts src/whiteboard/demo.test.ts
git commit -m "feat(whiteboard): ?whiteboard=1 demo script (TDD)"
```

---

### Task 6: `WhiteboardMarks` renderer + `WhiteboardPanel`

**Files:**
- Create: `src/whiteboard/WhiteboardMarks.tsx`, `src/whiteboard/WhiteboardPanel.tsx`

**Interfaces:**
- Consumes: `WhiteboardState`, `WbMark` from `./types`; `nodeBox`, `connectorEnds` from `./geometry`.
- Produces: `WhiteboardMarks({ state })` (pure presentational SVG); `WhiteboardPanel({ state, onClear })`.

**Context:** No unit test (node env, no jsdom). The geometry is tested in Task 2. Gate: tsc + full suite + build; verified by the `?whiteboard=1` demo. `WhiteboardMarks` renders `state.marks`; `WhiteboardPanel` wraps it in a dismissable board-mode card.

- [ ] **Step 1: Write `WhiteboardMarks`**

Create `src/whiteboard/WhiteboardMarks.tsx`:

```tsx
import React from 'react';
import type { WhiteboardState, WbMark } from './types';
import { nodeBox, connectorEnds } from './geometry';

const pct = (v: number) => v / 10; // 0-1000 → percent (viewBox 0..100)
const INK = 'rgb(99,102,241)';

export function WhiteboardMarks({ state }: { state: WhiteboardState }) {
  const nodes = state.marks.filter((m): m is Extract<WbMark, { kind: 'node' }> => m.kind === 'node');
  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <marker id="wb-arrow" markerWidth="6" markerHeight="6" refX="4" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill={INK} />
        </marker>
      </defs>
      {/* connectors first (under nodes) */}
      {state.marks.map((m) => {
        if (m.kind !== 'connector') return null;
        const ends = connectorEnds(state.marks, m);
        if (!ends) return null;
        const x1 = pct(ends.from.x), y1 = pct(ends.from.y), x2 = pct(ends.to.x), y2 = pct(ends.to.y);
        return (
          <g key={m.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" markerEnd="url(#wb-arrow)" />
            {m.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1} textAnchor="middle" fontSize={2.4} className="fill-indigo-500 font-mono">{m.label}</text>}
          </g>
        );
      })}
      {nodes.map((n) => {
        const [ymin, xmin, ymax, xmax] = nodeBox(n);
        const x = pct(xmin), y = pct(ymin), w = pct(xmax - xmin), h = pct(ymax - ymin);
        return (
          <g key={n.key}>
            {n.shape === 'ellipse'
              ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="var(--card-bg)" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
              : <rect x={x} y={y} width={w} height={h} rx={1.5} fill="var(--card-bg)" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />}
            <text x={x + w / 2} y={y + h / 2 + 0.8} textAnchor="middle" fontSize={2.6} className="fill-[var(--text-primary)] font-mono">{n.text}</text>
          </g>
        );
      })}
      {state.marks.map((m) => m.kind === 'label'
        ? <text key={m.id} x={pct(m.x)} y={pct(m.y)} textAnchor="middle" fontSize={2.6} className="fill-indigo-500 font-mono">{m.text}</text>
        : null)}
    </svg>
  );
}
```

- [ ] **Step 2: Write `WhiteboardPanel`**

Create `src/whiteboard/WhiteboardPanel.tsx`:

```tsx
import React from 'react';
import { X } from 'lucide-react';
import type { WhiteboardState } from './types';
import { WhiteboardMarks } from './WhiteboardMarks';

// Board-mode surface: a dismissable card over the desktop holding the marks in its own 0-1000 space.
export function WhiteboardPanel({ state, onClear }: { state: WhiteboardState; onClear: () => void }) {
  if (!state.marks.length) return null;
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-[min(680px,88vw)] h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--card-border)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Whiteboard</span>
        <button aria-label="Clear whiteboard" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClear}><X size={13} /></button>
      </div>
      <div className="relative w-full h-[calc(100%-2rem)]">
        <WhiteboardMarks state={state} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (the new pure tests + existing).
Run: `npx vite build` → success.

- [ ] **Step 4: Commit**

```bash
git add src/whiteboard/WhiteboardMarks.tsx src/whiteboard/WhiteboardPanel.tsx
git commit -m "feat(whiteboard): WhiteboardMarks SVG renderer + WhiteboardPanel (board surface)"
```

---

### Task 7: App logic wiring — store, routing, hint, tools, demo, prompt

**Files:**
- Modify: `src/App.tsx`, `src/prompt/instructions.ts`

**Context:** App holds the whiteboard reducer directly (like the goal store). `whiteboardMode` state (`'board' | 'overlay'`, default `'board'`). Routing mirrors the `annotate_` branch. The `[WHITEBOARD]` hint mirrors the `[ANNOTATIONS]` effect but is gated to `board` mode (overlay is perceived via the snapshot). This task is logic only — the UI mount is Task 8; gate is tsc + suite + build.

- [ ] **Step 1: Imports + state**

In `src/App.tsx`, add near the annotation imports:

```ts
import { WB_TOOLS, wbCallToEvent } from './whiteboard/tools';
import { initialWhiteboardState, reduce as wbReduce } from './whiteboard/store';
import { serializeWhiteboard } from './whiteboard/serialize';
import { buildWhiteboardDemo } from './whiteboard/demo';
```

Add state near the annotation/goal state:

```ts
  const [whiteboard, whiteboardDispatch] = useReducer(wbReduce, undefined, initialWhiteboardState);
  const [whiteboardMode, setWhiteboardMode] = useState<'board' | 'overlay'>('board');
  const wbHintGateRef = useRef(makeChangeGate());
```

- [ ] **Step 2: Add `WB_TOOLS` to the live tool set**

Append `...WB_TOOLS` to the `voiceTools` memo (available in every program):

```ts
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS, ...WB_TOOLS],
```

- [ ] **Step 3: Route `wb_*` tool calls**

In `handleVoiceToolCall`, add a branch before the `annotate_` branch:

```ts
    } else if (fc.name.startsWith('wb_')) {
      // Whiteboard: free-coordinate diagram marks. Unresolved connector keys simply render nothing
      // (fail-soft); the model learns live node keys from [WHITEBOARD].
      const mapped = wbCallToEvent(fc);
      if ('error' in mapped) {
        addLog('tool', `Tool Call: ${fc.name} REJECTED — ${mapped.error}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else {
        whiteboardDispatch(mapped);
        addLog('tool', `Tool Call: ${fc.name}`);
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
      }
```

- [ ] **Step 4: `[WHITEBOARD]` send effect (board mode)**

Add near the `[ANNOTATIONS]`/`[GOAL STATE]` effects:

```ts
  // Whiteboard board-mode perception: the model authored these marks, so the store is its truth.
  // Overlay mode is perceived for free via the C2a snapshot, so this hint is board-mode only.
  useEffect(() => {
    if (!isLive || whiteboardMode !== 'board') return;
    const hint = serializeWhiteboard(whiteboard);
    if (wbHintGateRef.current(hint) && hint) {
      providerRef.current?.sendTextHint(hint);
    }
  }, [isLive, whiteboard, whiteboardMode]);
```

- [ ] **Step 5: Demo wiring**

Add a `whiteboardMode`-independent demo driver near the other demo effects (mirrors the annotation demo). Read the `?whiteboard=1` flag near `illustrateMode` (~line 397):

```ts
  const whiteboardDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('whiteboard');
```

And a StrictMode-safe driver effect:

```ts
  const wbDemoScheduled = useRef(false);
  const wbDemoPlayed = useRef(false);
  useEffect(() => {
    if (!whiteboardDemoMode || wbDemoScheduled.current) return;
    wbDemoScheduled.current = true;
    const timers = buildWhiteboardDemo().map(({ at, event }) => setTimeout(() => { wbDemoPlayed.current = true; whiteboardDispatch(event); }, at));
    return () => { timers.forEach(clearTimeout); if (!wbDemoPlayed.current) wbDemoScheduled.current = false; };
  }, [whiteboardDemoMode]);
```

- [ ] **Step 6: Prompt note**

In `src/prompt/instructions.ts`, add (near the annotation note):

```
To explain a concept, you may sketch a diagram on the whiteboard: wb_node (key, x, y 0-1000, text) places labelled nodes, wb_connect (from,to keys) wires them, wb_label adds captions; call wb_clear when done. Reuse each node's key to connect it; keep diagrams small and in service of one explanation.
```

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

(Note: `setWhiteboardMode` is consumed by Task 8 — unused here is fine, tsc has no `noUnusedLocals`.)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/prompt/instructions.ts
git commit -m "feat(whiteboard): store + wb_* routing + [WHITEBOARD] hint + tools + demo + prompt (logic)"
```

---

### Task 8: UI mount + `whiteboardMode` toggle

**Files:**
- Modify: `src/App.tsx`, `src/shell/DebugDrawer.tsx`

**Context:** Mount `WhiteboardMarks` in the C2a seam for overlay mode and `WhiteboardPanel` for board mode, each gated by `whiteboardMode`. Add the `whiteboardMode` `Select` to `DebugDrawer`.

- [ ] **Step 1: Import the components**

In `src/App.tsx`, near the annotation imports:

```ts
import { WhiteboardMarks } from './whiteboard/WhiteboardMarks';
import { WhiteboardPanel } from './whiteboard/WhiteboardPanel';
```

- [ ] **Step 2: Mount overlay marks in the C2a seam**

In `src/App.tsx`, inside the `instructionLayerRef` wrapper (~line 2735), after `<AnnotationLayer …/>`, add:

```tsx
            {whiteboardMode === 'overlay' && <WhiteboardMarks state={whiteboard} />}
```

- [ ] **Step 3: Mount the board panel**

In `src/App.tsx`, near the goal chip / witness cards (a top-level overlay in the main plane), add:

```tsx
          {whiteboardMode === 'board' && <WhiteboardPanel state={whiteboard} onClear={() => whiteboardDispatch({ type: 'wb.clear' })} />}
```

- [ ] **Step 4: Add the `whiteboardMode` Select to `DebugDrawer`**

In `src/shell/DebugDrawer.tsx`, add to `DrawerProps`:

```ts
  whiteboardMode: 'board' | 'overlay'; onWhiteboardMode: (v: 'board' | 'overlay') => void;
```

Add a labeled `Select` (mirroring the autonomy/feedback selects):

```tsx
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]" title="Where the agent's diagrams render">Whiteboard</span>
        <Select
          value={props.whiteboardMode}
          onValueChange={(v) => props.onWhiteboardMode(v as 'board' | 'overlay')}
          options={[{ value: 'board', label: 'Dedicated panel' }, { value: 'overlay', label: 'Overlay on UI' }]}
          ariaLabel="Whiteboard surface"
        />
      </div>
```

In `src/App.tsx`, pass the props to `<DebugDrawer …>` (next to `showMarkings`/`confirmGoals`):

```tsx
            whiteboardMode={whiteboardMode}
            onWhiteboardMode={setWhiteboardMode}
```

- [ ] **Step 5: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/shell/DebugDrawer.tsx
git commit -m "feat(whiteboard): mount overlay marks + board panel by mode + DebugDrawer toggle (UI)"
```

---

## Human smoke (owed — `?whiteboard=1` for the no-key path; a key for live)

- Load `?whiteboard=1` → a small flow diagram builds (nodes → connectors → caption) then clears after ~9s, on whichever surface the toggle selects.
- Flip the `Whiteboard` toggle (Dedicated panel / Overlay on UI) → the same diagram renders in the panel vs over the program.
- Live: ask the agent to "diagram how X works" → it composes nodes + connectors; in board mode a `[WHITEBOARD]` hint reflects the node keys; `wb_clear` empties it; an unresolved connector key renders nothing (no stray line).
