# F1: Real Spreadsheet Perception — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model perceive the Excel spreadsheet for real — via a live DOM grid that is rasterized into the vision frame (real pixels) and whose live cell data is sent as structured text — replacing today's gray placeholder tiles + 6-line text-strip label.

**Architecture:** Build a real `Spreadsheet` React component bound to the existing `MockDoc.excel` state. Extract pure functions (grid model for rendering, structured snapshot for the model) so they unit-test without a DOM. Add an `html-to-image` snapshot utility that rasterizes the spreadsheet's real DOM node, throttled and fail-soft. Wire it into `App.tsx`: render the grid for the `excel` program, measure its bbox into `layoutBounds`, composite the snapshot into the vision canvas, and push the structured snapshot via `sendTextHint`.

**Tech Stack:** TypeScript, React 19, Vite, Tailwind v4, `html-to-image` (new), `vitest` (new, dev).

## Global Constraints

- Branch: work on `honest-mode` (the real project; `main` is an unrelated README-only history). Do NOT branch off `main`.
- Graceful degradation (learnings §6): every new capability must fail soft. If `html-to-image` fails or the node is missing, the app must behave exactly as before (fall back to the existing schematic/text-strip path). Never throw into the vision loop.
- Never labels-only (learnings §4): the structured-data channel is sent *in addition to* real pixels, never as a replacement.
- Pure functions take an injected `now: number`; do not call `Date.now()` inside pure modules (matches the existing `coherence.ts` convention).
- Reuse existing types: `MockDoc` from `src/scenarios.ts`; the `BBox` interface `{ ymin; xmin; ymax; xmax }` is defined in `src/App.tsx:82`.
- No new runtime dependency beyond `html-to-image`. No CLIP, no test of cross-origin iframes.

---

## File Structure

- Create `src/widgets/spreadsheetData.ts` — pure: `SpreadsheetSnapshot` type, `buildSpreadsheetSnapshot`, `formatSnapshotForModel`. The structured data-layer channel.
- Create `src/widgets/spreadsheetData.test.ts` — vitest for the above.
- Create `src/widgets/spreadsheetGrid.ts` — pure: `GridModel` type, `buildGridModel`. The render model.
- Create `src/widgets/spreadsheetGrid.test.ts` — vitest for the above.
- Create `src/widgets/Spreadsheet.tsx` — thin React component consuming `buildGridModel`; forwards a ref to its root node; tagged `.spreadsheet-box` + `data-cell` attributes.
- Create `src/vision/snapshotNode.ts` — `snapshotNode` (html-to-image wrapper, fail-soft) + pure `makeThrottle`.
- Create `src/vision/snapshotNode.test.ts` — vitest for `makeThrottle`.
- Create `vitest.config.ts` — test runner config.
- Modify `package.json` — add `html-to-image` dep, `vitest` devDep, `"test"` script.
- Modify `src/App.tsx` — render `Spreadsheet` for the `excel` program; add refs + `layoutBounds.spreadsheet`; snapshot loop; composite into the vision canvas; send structured hint.

---

### Task 1: Test harness + structured data layer (pure)

**Files:**
- Create: `vitest.config.ts`, `src/widgets/spreadsheetData.ts`, `src/widgets/spreadsheetData.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MockDoc` from `src/scenarios.ts` (the `excel` variant: `{ kind:'excel'; cells: Record<string,string>; currency: string[]; chart: boolean; saved: boolean }`).
- Produces:
  - `type CellData = { ref: string; value: string; isCurrency: boolean }`
  - `type SpreadsheetSnapshot = { cells: CellData[]; chart: boolean; saved: boolean; selection: string | null }`
  - `buildSpreadsheetSnapshot(doc: MockDoc, selection?: string | null): SpreadsheetSnapshot`
  - `formatSnapshotForModel(s: SpreadsheetSnapshot): string`

- [ ] **Step 1: Add deps and test script**

Run:
```bash
npm install --save html-to-image@^1.11.13
npm install --save-dev vitest@^2.1.0
```
Then edit `package.json` `"scripts"` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing test**

Create `src/widgets/spreadsheetData.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSpreadsheetSnapshot, formatSnapshotForModel } from './spreadsheetData';
import type { MockDoc } from '../scenarios';

const excel = (over: Partial<Extract<MockDoc, { kind: 'excel' }>> = {}): MockDoc => ({
  kind: 'excel', cells: { A1: '10', A2: '20', A3: '30' }, currency: [], chart: false, saved: false, ...over,
});

describe('buildSpreadsheetSnapshot', () => {
  it('keeps only non-empty cells, sorted by ref, flags currency', () => {
    const snap = buildSpreadsheetSnapshot(excel({ cells: { B1: '', A1: '10', A2: '5' }, currency: ['A2'] }), 'A1');
    expect(snap.cells).toEqual([
      { ref: 'A1', value: '10', isCurrency: false },
      { ref: 'A2', value: '5', isCurrency: true },
    ]);
    expect(snap.selection).toBe('A1');
  });

  it('returns an empty snapshot for non-excel docs', () => {
    const snap = buildSpreadsheetSnapshot({ kind: 'word', text: 'hi', bold: false, saved: false } as MockDoc);
    expect(snap.cells).toEqual([]);
    expect(snap.selection).toBeNull();
  });
});

describe('formatSnapshotForModel', () => {
  it('renders currency cells with a $ and includes chart/saved/selection', () => {
    const out = formatSnapshotForModel({
      cells: [{ ref: 'A1', value: '50', isCurrency: true }], chart: true, saved: false, selection: 'A1',
    });
    expect(out).toContain('A1=$50');
    expect(out).toContain('chart:yes');
    expect(out).toContain('saved:no');
    expect(out).toContain('selected:A1');
    expect(out).toContain('DO NOT acknowledge');
  });

  it('reports an empty sheet', () => {
    expect(formatSnapshotForModel({ cells: [], chart: false, saved: false, selection: null }))
      .toBe('[SPREADSHEET DATA: empty sheet]');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './spreadsheetData'`.

- [ ] **Step 5: Write the implementation**

Create `src/widgets/spreadsheetData.ts`:
```ts
import type { MockDoc } from '../scenarios';

export type CellData = { ref: string; value: string; isCurrency: boolean };

export type SpreadsheetSnapshot = {
  cells: CellData[];
  chart: boolean;
  saved: boolean;
  selection: string | null;
};

/** Structured data-layer view of the live spreadsheet (non-empty cells only, sorted). */
export function buildSpreadsheetSnapshot(doc: MockDoc, selection: string | null = null): SpreadsheetSnapshot {
  if (doc.kind !== 'excel') {
    return { cells: [], chart: false, saved: false, selection: null };
  }
  const cells: CellData[] = Object.entries(doc.cells)
    .filter(([, v]) => v !== '' && v != null)
    .map(([ref, value]) => ({ ref, value, isCurrency: doc.currency.includes(ref) }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  return { cells, chart: doc.chart, saved: doc.saved, selection };
}

/** Render the snapshot as a structured text hint for the model (sent alongside the pixels). */
export function formatSnapshotForModel(s: SpreadsheetSnapshot): string {
  if (s.cells.length === 0) return '[SPREADSHEET DATA: empty sheet]';
  const cellStr = s.cells
    .map((c) => `${c.ref}=${c.isCurrency && c.value ? '$' + c.value : c.value}`)
    .join(' ');
  const sel = s.selection ? ` selected:${s.selection}` : '';
  return `[SPREADSHEET DATA: ${cellStr} chart:${s.chart ? 'yes' : 'no'} saved:${s.saved ? 'yes' : 'no'}${sel}. This is the live cell data; the SPREADSHEET image shows its pixels. DO NOT acknowledge this message.]`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/widgets/spreadsheetData.ts src/widgets/spreadsheetData.test.ts
git commit -m "feat(spreadsheet): structured data-layer snapshot + vitest harness"
```

---

### Task 2: Grid render model (pure)

**Files:**
- Create: `src/widgets/spreadsheetGrid.ts`, `src/widgets/spreadsheetGrid.test.ts`

**Interfaces:**
- Consumes: `MockDoc` from `src/scenarios.ts`.
- Produces:
  - `type GridCell = { ref: string; display: string; isCurrency: boolean; selected: boolean }`
  - `type GridModel = { columns: string[]; rows: number[]; cells: GridCell[][] }`
  - `buildGridModel(doc: MockDoc, selection?: string | null): GridModel`

- [ ] **Step 1: Write the failing test**

Create `src/widgets/spreadsheetGrid.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildGridModel } from './spreadsheetGrid';
import type { MockDoc } from '../scenarios';

const excel = (over = {}): MockDoc => ({
  kind: 'excel', cells: { A1: '10', A2: '20', A3: '30' }, currency: [], chart: false, saved: false, ...over,
}) as MockDoc;

describe('buildGridModel', () => {
  it('produces a 6-row x 4-col grid (A-D, 1-6)', () => {
    const m = buildGridModel(excel());
    expect(m.columns).toEqual(['A', 'B', 'C', 'D']);
    expect(m.rows).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.cells).toHaveLength(6);
    expect(m.cells[0]).toHaveLength(4);
  });

  it('fills known cells, blanks the rest, and prefixes $ for currency cells', () => {
    const m = buildGridModel(excel({ cells: { A1: '50' }, currency: ['A1'] }), 'A1');
    expect(m.cells[0][0]).toEqual({ ref: 'A1', display: '$50', isCurrency: true, selected: true });
    expect(m.cells[0][1]).toEqual({ ref: 'B1', display: '', isCurrency: false, selected: false });
  });

  it('renders an empty grid for non-excel docs', () => {
    const m = buildGridModel({ kind: 'word', text: 'x', bold: false, saved: false } as MockDoc);
    expect(m.cells[0][0].display).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './spreadsheetGrid'`.

- [ ] **Step 3: Write the implementation**

Create `src/widgets/spreadsheetGrid.ts`:
```ts
import type { MockDoc } from '../scenarios';

export type GridCell = { ref: string; display: string; isCurrency: boolean; selected: boolean };
export type GridModel = { columns: string[]; rows: number[]; cells: GridCell[][] };

const COLUMNS = ['A', 'B', 'C', 'D'];
const ROWS = [1, 2, 3, 4, 5, 6];

/** Build the visual grid for the Spreadsheet component from the live doc. */
export function buildGridModel(doc: MockDoc, selection: string | null = null): GridModel {
  const cellMap = doc.kind === 'excel' ? doc.cells : {};
  const currency = doc.kind === 'excel' ? doc.currency : [];
  const cells = ROWS.map((row) =>
    COLUMNS.map((col) => {
      const ref = `${col}${row}`;
      const raw = cellMap[ref] ?? '';
      const isCurrency = currency.includes(ref);
      const display = raw && isCurrency ? `$${raw}` : raw;
      return { ref, display, isCurrency, selected: selection === ref };
    }),
  );
  return { columns: COLUMNS, rows: ROWS, cells };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add src/widgets/spreadsheetGrid.ts src/widgets/spreadsheetGrid.test.ts
git commit -m "feat(spreadsheet): pure grid render model"
```

---

### Task 3: Spreadsheet component

**Files:**
- Create: `src/widgets/Spreadsheet.tsx`

**Interfaces:**
- Consumes: `buildGridModel` (Task 2), `MockDoc`.
- Produces: `Spreadsheet` — `React.forwardRef<HTMLDivElement, { doc: MockDoc; selection?: string | null }>`. Root node carries class `spreadsheet-box`; each cell carries `data-cell="A1"`.

This component is verified by typecheck + build (the project has no component-test infra; pure logic is covered in Tasks 1-2).

- [ ] **Step 1: Write the component**

Create `src/widgets/Spreadsheet.tsx`:
```tsx
import React, { forwardRef } from 'react';
import type { MockDoc } from '../scenarios';
import { buildGridModel } from './spreadsheetGrid';

type Props = { doc: MockDoc; selection?: string | null };

/** A real DOM spreadsheet grid bound to MockDoc.excel — the node the vision pipeline snapshots. */
export const Spreadsheet = forwardRef<HTMLDivElement, Props>(({ doc, selection = null }, ref) => {
  const model = buildGridModel(doc, selection);
  return (
    <div
      ref={ref}
      className="spreadsheet-box w-full h-full bg-white text-slate-900 overflow-auto select-none"
      data-widget="spreadsheet"
    >
      <table className="border-collapse w-full text-sm font-mono">
        <thead>
          <tr>
            <th className="w-10 bg-slate-100 border border-slate-300"></th>
            {model.columns.map((col) => (
              <th key={col} className="bg-slate-100 border border-slate-300 px-3 py-1 text-slate-600 font-semibold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, r) => (
            <tr key={row}>
              <th className="bg-slate-100 border border-slate-300 px-2 py-1 text-slate-600 font-semibold">{row}</th>
              {model.cells[r].map((cell) => (
                <td
                  key={cell.ref}
                  data-cell={cell.ref}
                  className={`border border-slate-300 px-3 py-1 text-right ${
                    cell.selected ? 'bg-blue-100 outline outline-2 outline-blue-500' : ''
                  }`}
                >
                  {cell.display}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
Spreadsheet.displayName = 'Spreadsheet';
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors referencing `Spreadsheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/Spreadsheet.tsx
git commit -m "feat(spreadsheet): real DOM grid component"
```

---

### Task 4: Snapshot utility

**Files:**
- Create: `src/vision/snapshotNode.ts`, `src/vision/snapshotNode.test.ts`

**Interfaces:**
- Consumes: `html-to-image` `toCanvas`.
- Produces:
  - `snapshotNode(node: HTMLElement): Promise<HTMLCanvasElement | null>` — rasterizes a node; returns `null` on any failure (fail-soft).
  - `makeThrottle(intervalMs: number): (now: number) => boolean` — pure gate; returns `true` at most once per `intervalMs`.

- [ ] **Step 1: Write the failing test**

Create `src/vision/snapshotNode.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeThrottle } from './snapshotNode';

describe('makeThrottle', () => {
  it('allows the first call and blocks until the interval elapses', () => {
    const gate = makeThrottle(500);
    expect(gate(1000)).toBe(true);   // first call always allowed
    expect(gate(1200)).toBe(false);  // 200ms < 500ms
    expect(gate(1500)).toBe(true);   // 500ms elapsed
    expect(gate(1600)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './snapshotNode'`.

- [ ] **Step 3: Write the implementation**

Create `src/vision/snapshotNode.ts`:
```ts
import { toCanvas } from 'html-to-image';

/**
 * Rasterize a DOM node to a canvas (real pixels of exactly what the user sees).
 * Returns null on ANY failure (taint, detached node, library error) so the vision
 * loop degrades gracefully to the existing schematic path (learnings §6: fail soft).
 */
export async function snapshotNode(node: HTMLElement): Promise<HTMLCanvasElement | null> {
  try {
    return await toCanvas(node, { cacheBust: false, pixelRatio: 1, skipFonts: true });
  } catch {
    return null;
  }
}

/** Pure throttle gate: returns true at most once per intervalMs. Caller supplies `now`. */
export function makeThrottle(intervalMs: number): (now: number) => boolean {
  let last = -Infinity;
  return (now: number): boolean => {
    if (now - last >= intervalMs) {
      last = now;
      return true;
    }
    return false;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vision/snapshotNode.ts src/vision/snapshotNode.test.ts
git commit -m "feat(vision): fail-soft DOM snapshot utility + throttle"
```

---

### Task 5: Wire real perception into App

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Spreadsheet` (Task 3), `buildSpreadsheetSnapshot` + `formatSnapshotForModel` (Task 1), `snapshotNode` + `makeThrottle` (Task 4), existing `mockDoc`/`mockDocRef`, `layoutBounds`, `activeProgram`, `providerRef`, `isLive`, `sendFrequency`.
- Produces: no new exports; behavioral change only.

Verified by typecheck + build + a manual run checklist (no component-test infra exists). Each step shows the exact anchor to find and the change.

- [ ] **Step 1: Add imports**

Find the existing import block near the top of `src/App.tsx` (after the `./scenarios` import at line ~55). Add:
```tsx
import { Spreadsheet } from './widgets/Spreadsheet';
import { buildSpreadsheetSnapshot, formatSnapshotForModel } from './widgets/spreadsheetData';
import { snapshotNode, makeThrottle } from './vision/snapshotNode';
```

- [ ] **Step 2: Add refs and extend layoutBounds type**

Find `const [layoutBounds, setLayoutBounds] = useState<{` (line ~562). Change the generic to add a `spreadsheet` field:
```tsx
  const [layoutBounds, setLayoutBounds] = useState<{
    photos: BBox;
    map: BBox;
    photoItems: { id: number; bbox: BBox }[];
    spreadsheet?: BBox;
  } | null>(null);
  const spreadsheetRef = useRef<HTMLDivElement>(null);
  const spreadsheetSnapshotRef = useRef<HTMLCanvasElement | null>(null);
```

- [ ] **Step 3: Measure the spreadsheet bbox in the layout effect**

Find the `setLayoutBounds({ photos: toBBox(pRect), map: toBBox(mRect), photoItems });` call (line ~677). Replace it with a version that also measures the spreadsheet node when present:
```tsx
        const ssEl = main.querySelector('.spreadsheet-box');
        setLayoutBounds({
          photos: toBBox(pRect),
          map: toBBox(mRect),
          photoItems,
          spreadsheet: ssEl ? toBBox((ssEl as HTMLElement).getBoundingClientRect()) : undefined,
        });
```

- [ ] **Step 4: Render the Spreadsheet for the excel program**

Find the camera-roll grid `<div className="grid grid-cols-2 gap-3 sm:gap-4 ...">` that maps `PHOTOS` (line ~3047). Wrap its content so the excel program shows the real grid instead of the placeholder tiles. Replace the opening of that grid div and its `{PHOTOS.map(...)}` with a conditional:
```tsx
              {activeProgram === 'excel' ? (
                <div className="col-span-2 h-full">
                  <Spreadsheet ref={spreadsheetRef} doc={mockDoc} />
                </div>
              ) : (
                PHOTOS.map((photo, i) => {
                  // ...existing tile JSX unchanged...
                })
              )}
```
(Keep the existing `.photos-box` wrapper and the per-tile JSX exactly as-is inside the `else` branch; only the `excel` branch is new.)

- [ ] **Step 5: Add the snapshot loop**

After the existing "Vision pipeline" `useEffect` (the one ending at line ~2808), add a new effect that refreshes the spreadsheet snapshot off the render cadence:
```tsx
  // Refresh the real-pixel spreadsheet snapshot (throttled, fail-soft) for the vision frame.
  useEffect(() => {
    if (!isLive || activeProgram !== 'excel') {
      spreadsheetSnapshotRef.current = null;
      return;
    }
    let cancelled = false;
    const gate = makeThrottle(500);
    const tick = async () => {
      if (cancelled || !gate(Date.now())) return;
      const node = spreadsheetRef.current;
      if (!node) return;
      const canvas = await snapshotNode(node);
      if (!cancelled && canvas) spreadsheetSnapshotRef.current = canvas;
    };
    const interval = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, activeProgram]);
```

- [ ] **Step 6: Composite the snapshot into the vision canvas**

In the "Vision pipeline" effect, find the photo-items draw loop `layoutBounds.photoItems.forEach((item, i) => {` (line ~2693). Guard it so that, for excel with a ready snapshot, we draw the REAL pixels into the photos region instead of placeholder tiles:
```tsx
      const ssCanvas = spreadsheetSnapshotRef.current;
      if (activeProgram === 'excel' && ssCanvas) {
        const b = layoutBounds.photos;
        const dx = (b.xmin / 1000) * VISION_SIZE, dy = (b.ymin / 1000) * VISION_SIZE;
        const dw = ((b.xmax - b.xmin) / 1000) * VISION_SIZE, dh = ((b.ymax - b.ymin) / 1000) * VISION_SIZE;
        try { ctx.drawImage(ssCanvas, dx, dy, dw, dh); } catch { /* keep canvas clean */ }
        ctx.strokeStyle = '#e5e5e5';
        ctx.strokeRect(dx, dy, dw, dh);
      } else {
        layoutBounds.photoItems.forEach((item, i) => {
          // ...existing placeholder/real-photo draw loop unchanged...
        });
      }
```
(Leave the body of the existing `forEach` exactly as-is inside the `else`.)

- [ ] **Step 7: Replace the excel doc-strip text with a pointer to the image**

Find the DOCUMENT STRIP serialization `const docWords = serializeMockDoc(mockDocRef.current).split(' ');` (line ~2780). Replace that single line so excel defers to the image + structured hint rather than dumping the label:
```tsx
      const docText = (mockDocRef.current.kind === 'excel')
        ? 'Excel — see SPREADSHEET image + [SPREADSHEET DATA] hint'
        : serializeMockDoc(mockDocRef.current);
      const docWords = docText.split(' ');
```

- [ ] **Step 8: Send the structured data layer on change**

After the snapshot-loop effect (Step 5), add an effect that pushes the live structured snapshot to the model whenever the excel doc changes:
```tsx
  // Send the live structured spreadsheet data alongside the pixels (learnings §4: never labels-only).
  useEffect(() => {
    if (!isLive || activeProgram !== 'excel') return;
    const hint = formatSnapshotForModel(buildSpreadsheetSnapshot(mockDoc));
    providerRef.current?.sendTextHint(hint);
  }, [isLive, activeProgram, mockDoc]);
```

- [ ] **Step 9: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: both succeed, no type errors.

- [ ] **Step 10: Manual smoke (record evidence)**

Run: `npm run dev`, open the app, switch the program dropdown to **Excel**.
Confirm:
1. A real spreadsheet grid (A–D × 1–6, showing A1=10/A2=20/A3=30) renders where the camera roll was.
2. Start a live session (with a valid key). In the debug/log panel, confirm a `[SPREADSHEET DATA: A1=10 A2=20 A3=30 ...]` hint is sent.
3. With no key / if `html-to-image` fails, the app still runs (grid renders; vision falls back without throwing).

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat(vision): real spreadsheet perception — DOM-snapshot pixels + structured data layer"
```

---

### Task 6: Instrument resolution path (structure-first vs visual)

**Why:** Per `SWIFT_DOCS_TO_VITE.md` §2/§8.1, F1 makes the structural signal real, so we can now measure the structure-first bet: when the target is resolved structurally (the app's pointer hit-test gave a referent) vs only visually (the model's pixel read), how much higher is grounding agreement? This adds a `resolution` dimension to the existing grounding telemetry and slices agreement by it.

**Files:**
- Modify: `src/telemetry.ts`
- Create: `src/telemetry.test.ts`
- Modify: `src/App.tsx` (the grounding call site, ~line 1601-1604)

**Interfaces:**
- Consumes: the existing `telemetry.grounding(appReferent, modelTarget, agree)` call site; `appReferent` / `modelElement` locals already computed there.
- Produces: extended `grounding(appReferent, modelTarget, agree, resolution?)` with `resolution: 'structural' | 'visual' | 'none'`; a `byResolution` slice in `metrics().grounding`.

- [ ] **Step 1: Write the failing test**

Create `src/telemetry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'excel', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('telemetry resolution slicing', () => {
  beforeEach(() => telemetry.start(cfg));

  it('slices grounding agreement by resolution path', () => {
    telemetry.grounding('Cell A1', 'Cell A1', true, 'structural');
    telemetry.grounding('Cell A1', 'Cell B2', false, 'structural');
    telemetry.grounding(null, 'Cell A1', null, 'visual');
    const m = telemetry.metrics();
    expect(m.grounding.byResolution.structural).toEqual({ total: 2, agree: 1 });
    expect(m.grounding.byResolution.visual).toEqual({ total: 0, agree: 0 });
    expect(m.grounding.byResolution.none).toEqual({ total: 0, agree: 0 });
  });

  it('defaults resolution to none when omitted', () => {
    telemetry.grounding('X', 'X', true);
    const m = telemetry.metrics();
    expect(m.grounding.byResolution.none).toEqual({ total: 1, agree: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `byResolution` is undefined / `grounding` rejects a 4th argument.

- [ ] **Step 3: Extend the telemetry event and method**

In `src/telemetry.ts`, change the `grounding` event in the `TelemetryEvent` union (line 38) to:
```ts
  | { t: number; type: 'grounding'; appReferent: string | null; modelTarget: string | null; agree: boolean | null; resolution: 'structural' | 'visual' | 'none' }
```
And change the `grounding` method (lines 85-87) to:
```ts
  grounding(appReferent: string | null, modelTarget: string | null, agree: boolean | null, resolution: 'structural' | 'visual' | 'none' = 'none') {
    this.push({ type: 'grounding', appReferent, modelTarget, agree, resolution });
  }
```

- [ ] **Step 4: Add the byResolution slice in metrics()**

In `metrics()`, after the existing `gAgree` line (line 106), build the slice and include it in the returned `grounding` object:
```ts
    const byResolution = (r: 'structural' | 'visual' | 'none') => {
      const g = gGraded.filter(e => e.resolution === r);
      return { total: g.length, agree: g.filter(e => e.agree).length };
    };
```
Then in the returned `grounding: { ... }` object (lines 126-131), add:
```ts
        byResolution: {
          structural: byResolution('structural'),
          visual: byResolution('visual'),
          none: byResolution('none'),
        },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all suites green).

- [ ] **Step 6: Wire the resolution tag at the App grounding call site**

In `src/App.tsx`, find the grounding reconciliation block (line ~1601-1604):
```tsx
      const appReferent = markersRef.current[0]?.identifiedObject ?? hoveredObjectRef.current ?? null;
      const modelElement = matchElement(program.images, args.target);
      const agree = (appReferent && modelElement) ? appReferent === modelElement : null;
      telemetry.grounding(appReferent, args.target ?? null, agree);
```
Replace the `telemetry.grounding(...)` line with a resolution-tagged call:
```tsx
      const resolution: 'structural' | 'visual' | 'none' = appReferent ? 'structural' : (modelElement ? 'visual' : 'none');
      telemetry.grounding(appReferent, args.target ?? null, agree, resolution);
```

- [ ] **Step 7: Typecheck and build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/telemetry.ts src/telemetry.test.ts src/App.tsx
git commit -m "feat(telemetry): slice grounding agreement by resolution path (structure-first vs visual)"
```

---

## Self-Review notes

- **Spec coverage:** F1's two channels are both implemented — real pixels (Tasks 3-4 + Step 6) and real structured data (Task 1 + Step 8), sent together (Global Constraint "never labels-only"). The first true "widget" is built (Task 3), matching the gap analysis F1.
- **Fail-soft:** `snapshotNode` returns null on failure; Step 6 falls back to the existing draw loop; Step 7 only changes excel text. No new throw paths in the vision loop.
- **Out of scope (follow-ups, not this plan):** cell-level pointer hit-testing (the grid is a single pointable region for now); F2 (retire the seeded confusable table now that the model has a real read); maps/other widgets; a Playwright headless smoke.
- **Type consistency:** `MockDoc`, `BBox`, `buildGridModel`, `buildSpreadsheetSnapshot`, `formatSnapshotForModel`, `snapshotNode`, `makeThrottle` names are used identically across tasks.
