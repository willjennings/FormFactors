# Functional Program Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder picsum tiles with four real, working mini-apps (Word, Excel, PowerPoint, Photo Editor) so every named element in the program set is a real DOM control the teaching overlays can ring, block, and advance on.

**Architecture:** Each program gets a `MockDoc`-bound surface widget (pattern: the existing `Spreadsheet`). Buttons dispatch through the SAME pure `applyAction` reducer voice uses — one state layer, two input paths. Entities keep deriving from `program.images`; the layout measurer switches to a generic `[data-element-id]` contract so every surface's elements get live bboxes. Direct clicks commit immediately (no witness gate); voice policy is untouched.

**Tech Stack:** React 19 + Vite 6 + Tailwind v4, TypeScript, Vitest, lucide-react icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-functional-program-surfaces-design.md`

## Global Constraints

- Branch: `honest-mode`. Never touch `main` (disconnected histories).
- `MockDoc` / `applyAction` changes are **additive only**; unknown verb/arg combos keep returning the doc unchanged (never throw).
- Direct clicks **commit immediately** — the click IS the confirmation. Voice keeps `decideCommit` gating unchanged.
- No progress bars anywhere (glance-monitor rule). Done steps stay ✓ dots.
- Teaching copy is terse: subgoal = short functional label, instruction = ONE short sentence.
- Reducers stay pure; overlays render nothing for zero bboxes.
- `ProgramImage.url` remains ONLY as task-carousel card art — never a main-scene rendering input after Task 7.
- Run tests with `npx vitest run <file>`; full suite `npx vitest run`; build check `npx tsc --noEmit && npx vite build`.
- Commit after every task (messages given per task).

## File Structure

```
src/scenarios.ts                     MODIFY  MockDoc extensions + reducer cases + serialize
src/scenarios.test.ts                CREATE  applyAction/serialize tests (none exist today)
src/widgets/surfaceModels.ts         CREATE  pure view-model builders (word/ppt/photo)
src/widgets/surfaceModels.test.ts    CREATE  tests for the above
src/widgets/ProgramSurface.tsx       CREATE  dispatcher + SurfaceElement + RibbonButton + all four surfaces
src/widgets/Spreadsheet.tsx          MODIFY  optional elementIds / onCellClick props
src/teaching/TeachingLayer.tsx       MODIFY  catcher → pointer-events-none; scrim skips 'program' category; program prop
src/teaching/demoScript.ts           MODIFY  per-program scripts (signature gains program)
src/teaching/demoScript.test.ts      MODIFY  updated assertions
src/App.tsx                          MODIFY  measurement contract, surface render, click/action handlers,
                                             vision generalization, MockPreview demotion
src/components/MockPreview.tsx       DELETE  (Task 10)
```

Element convention (all four programs follow it): image id 1 = chrome container (`program`), 2 = primary control (`ui`), 3 = its look-alike (`ui`), 4 = content (`content`). Entity ids are `${programId}-${imageId}` (e.g. `word-2` = Save button).

---

### Task 1: MockDoc + applyAction extensions (pure layer, TDD)

**Files:**
- Create: `src/scenarios.test.ts`
- Modify: `src/scenarios.ts` (MockDoc union ~line 400, `initialMockDoc` ~406, `applyAction` ~428, `serializeMockDoc` ~520)

**Interfaces:**
- Consumes: existing `applyAction(doc, verb, args)`, `has()`, `initialMockDoc`.
- Produces: `MockDoc` word variant gains `savedAs?: string`; photo variant gains `resized: boolean`. New reducer behavior: `save_file` detail containing "as" (and not "pdf") on word → `savedAs`; excel `insert_object` detail SUM/AVERAGE → aggregate written to next empty A cell; powerpoint `insert_object` detail containing "dup" → copy of last slide; photo `photo_edit` detail containing "resize"/"size" → `resized: true`. Exported const `WORD_FILENAME = 'Quarterly report.docx'` (surfaces render it).

- [ ] **Step 1: Write the failing tests**

Create `src/scenarios.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyAction, initialMockDoc, serializeMockDoc } from './scenarios';

describe('applyAction — functional surface verbs', () => {
  it('word: Save As marks saved and records the copy filename', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Save As button', detail: 'Save As' });
    expect(doc.kind).toBe('word');
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toMatch(/copy/i);
  });

  it('word: plain Save does not set savedAs', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Save button' });
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toBeUndefined();
  });

  it('word: export "as a PDF" is a plain save, not Save As', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Document', detail: 'as a PDF' });
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toBeUndefined();
  });

  it('excel: SUM writes the column total into the next empty A cell', () => {
    const doc = applyAction(initialMockDoc('excel'), 'insert_object', { target: 'SUM function', detail: 'SUM' });
    if (doc.kind !== 'excel') return;
    expect(doc.cells.A4).toBe('60'); // A1=10, A2=20, A3=30
    expect(doc.chart).toBe(false);
  });

  it('excel: AVERAGE aggregates every numeric A cell', () => {
    const summed = applyAction(initialMockDoc('excel'), 'insert_object', { detail: 'SUM' });
    const doc = applyAction(summed, 'insert_object', { target: 'AVERAGE function', detail: 'AVERAGE' });
    if (doc.kind !== 'excel') return;
    expect(doc.cells.A5).toBe('30'); // (10+20+30+60)/4
  });

  it('excel: no empty A cell → doc unchanged (safe by default)', () => {
    let doc = initialMockDoc('excel');
    for (const ref of ['A4', 'A5', 'A6']) doc = applyAction(doc, 'edit_content', { target: ref, detail: '1' });
    expect(applyAction(doc, 'insert_object', { detail: 'SUM' })).toBe(doc);
  });

  it('excel: detail-less insert still creates a chart', () => {
    const doc = applyAction(initialMockDoc('excel'), 'insert_object', { target: 'Cell A1' });
    if (doc.kind !== 'excel') return;
    expect(doc.chart).toBe(true);
  });

  it('powerpoint: duplicate copies the last slide', () => {
    const doc = applyAction(initialMockDoc('powerpoint'), 'insert_object', { target: 'Duplicate Slide button', detail: 'duplicate' });
    if (doc.kind !== 'powerpoint') return;
    expect(doc.slides).toEqual(['Title slide', 'Title slide (copy)']);
  });

  it('powerpoint: plain insert appends a numbered slide (existing behavior)', () => {
    const doc = applyAction(initialMockDoc('powerpoint'), 'insert_object', { target: 'New Slide button' });
    if (doc.kind !== 'powerpoint') return;
    expect(doc.slides).toEqual(['Title slide', 'Slide 2']);
  });

  it('photo: resize sets resized without cropping', () => {
    const doc = applyAction(initialMockDoc('photo'), 'photo_edit', { target: 'Resize tool', detail: 'resize' });
    if (doc.kind !== 'photo') return;
    expect(doc.resized).toBe(true);
    expect(doc.cropped).toBe(false);
  });

  it('serializeMockDoc surfaces savedAs and resized', () => {
    const word = applyAction(initialMockDoc('word'), 'save_file', { detail: 'Save As' });
    expect(serializeMockDoc(word)).toContain('copy');
    const photo = applyAction(initialMockDoc('photo'), 'photo_edit', { detail: 'resize' });
    expect(serializeMockDoc(photo)).toContain('resized');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/scenarios.test.ts`
Expected: FAIL — savedAs/resized undefined, A4 undefined, duplicate appends `Slide 2` instead of copy, resize sets `cropped`.

- [ ] **Step 3: Implement in `src/scenarios.ts`**

MockDoc union (~line 400) — change the word and photo variants:

```ts
export type MockDoc =
  | { kind: 'word'; text: string; bold: boolean; heading?: string; saved: boolean; savedAs?: string }
  | { kind: 'excel'; cells: Record<string, string>; currency: string[]; chart: boolean; saved: boolean }
  | { kind: 'powerpoint'; slides: string[]; transition?: string; saved: boolean }
  | { kind: 'photo'; cropped: boolean; resized: boolean; brightness: number; bgRemoved: boolean; saved: boolean };
```

`initialMockDoc` photo case: `return { kind: 'photo', cropped: false, resized: false, brightness: 0, bgRemoved: false, saved: false };`

Above `applyAction`, add:

```ts
/** Filename shown in the Word surface title bar; Save As writes the "(copy)" variant. */
export const WORD_FILENAME = 'Quarterly report.docx';
const A_CELLS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']; // the grid's A column (see spreadsheetGrid ROWS)
```

In `applyAction`, replace the `save_file` block:

```ts
  if (verb === 'save_file') {
    if (doc.kind === 'word' && has(detail, 'as') && !has(detail, 'pdf'))
      return { ...doc, saved: true, savedAs: WORD_FILENAME.replace(/\.docx$/, ' (copy).docx') };
    return { ...doc, saved: true };
  }
```

Excel case — replace `if (verb === 'insert_object') return { ...doc, chart: true };` with:

```ts
      if (verb === 'insert_object') {
        if (has(detail, 'sum') || has(detail, 'aver') || has(detail, 'avg')) {
          const isAvg = has(detail, 'aver') || has(detail, 'avg');
          const nums = A_CELLS.map(r => parseFloat(doc.cells[r] ?? '')).filter(n => Number.isFinite(n));
          const target = A_CELLS.find(r => !(doc.cells[r] ?? '').trim());
          if (!nums.length || !target) return doc;
          const value = isAvg ? nums.reduce((a, b) => a + b, 0) / nums.length : nums.reduce((a, b) => a + b, 0);
          return { ...doc, cells: { ...doc.cells, [target]: String(Math.round(value * 100) / 100) } };
        }
        return { ...doc, chart: true };
      }
```

PowerPoint case — replace `if (verb === 'insert_object') return { ...doc, slides: [...doc.slides, \`Slide ${doc.slides.length + 1}\`] };` with:

```ts
      if (verb === 'insert_object') {
        if (has(detail, 'dup'))
          return { ...doc, slides: [...doc.slides, `${doc.slides[doc.slides.length - 1]} (copy)`] };
        return { ...doc, slides: [...doc.slides, `Slide ${doc.slides.length + 1}`] };
      }
```

Photo case — inside `if (verb === 'photo_edit')`, add the resize check BEFORE the crop check:

```ts
      if (verb === 'photo_edit') {
        if (has(detail, 'resize') || has(detail, 'size') || has(args.target, 'resize')) return { ...doc, resized: true };
        if (has(detail, 'crop') || has(args.target, 'crop')) return { ...doc, cropped: true };
        if (has(detail, 'bright') || has(detail, 'expos')) return { ...doc, brightness: Math.min(3, doc.brightness + 1) };
        if (has(detail, 'background') || has(detail, 'remove')) return { ...doc, bgRemoved: true };
        return { ...doc, cropped: true };
      }
```

`serializeMockDoc` — word and photo cases:

```ts
    case 'word':
      return `Word — text:"${doc.text}"${doc.heading ? `, heading:"${doc.heading}"` : ''}, bold:${doc.bold ? 'yes' : 'no'}, saved:${doc.saved ? (doc.savedAs ? `yes (as ${doc.savedAs})` : 'yes') : 'no'}`;
```

```ts
    case 'photo':
      return `Photo — ${doc.cropped ? 'cropped, ' : ''}${doc.resized ? 'resized, ' : ''}brightness:+${doc.brightness}${doc.bgRemoved ? ', background removed' : ''}, saved:${doc.saved ? 'yes' : 'no'}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/scenarios.test.ts` — Expected: PASS.
Run: `npx vitest run` — Expected: full suite PASS (nothing else consumes the changed fields yet).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios.ts src/scenarios.test.ts
git commit -m "feat(surfaces): additive MockDoc verbs — Save As, SUM/AVERAGE, duplicate slide, resize"
```

---

### Task 2: Pure surface view models (TDD)

**Files:**
- Create: `src/widgets/surfaceModels.ts`
- Create: `src/widgets/surfaceModels.test.ts`

**Interfaces:**
- Consumes: `MockDoc`, `WORD_FILENAME` from `../scenarios`.
- Produces (Task 4/6/7 render these):
  - `buildWordModel(doc: Extract<MockDoc, {kind:'word'}>): { filename: string; statusLabel: string; heading?: string; text: string; bold: boolean }`
  - `buildPptModel(doc: Extract<MockDoc, {kind:'powerpoint'}>): { slides: string[]; currentTitle: string; transition?: string; statusLabel: string }`
  - `buildPhotoModel(doc: Extract<MockDoc, {kind:'photo'}>): { filterCss: string; cropped: boolean; resized: boolean; bgRemoved: boolean; statusLabel: string }`
  - `statusLabel` is `'Saved'`, `'Saved as <name>'`, or `'Edited'`.

- [ ] **Step 1: Write the failing tests**

Create `src/widgets/surfaceModels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWordModel, buildPptModel, buildPhotoModel } from './surfaceModels';
import { initialMockDoc, applyAction, WORD_FILENAME } from '../scenarios';

const word = () => { const d = initialMockDoc('word'); return d.kind === 'word' ? d : (() => { throw new Error('kind'); })(); };
const ppt = () => { const d = initialMockDoc('powerpoint'); return d.kind === 'powerpoint' ? d : (() => { throw new Error('kind'); })(); };
const photo = () => { const d = initialMockDoc('photo'); return d.kind === 'photo' ? d : (() => { throw new Error('kind'); })(); };

describe('surface view models', () => {
  it('word: unsaved doc reads Edited; saved reads Saved; Save As names the copy', () => {
    expect(buildWordModel(word()).statusLabel).toBe('Edited');
    expect(buildWordModel({ ...word(), saved: true }).statusLabel).toBe('Saved');
    const savedAs = buildWordModel({ ...word(), saved: true, savedAs: 'X (copy).docx' });
    expect(savedAs.statusLabel).toBe('Saved as X (copy).docx');
    expect(buildWordModel(word()).filename).toBe(WORD_FILENAME);
  });

  it('ppt: currentTitle is the last slide', () => {
    const d = applyAction(ppt(), 'insert_object', {});
    if (d.kind !== 'powerpoint') return;
    expect(buildPptModel(d).currentTitle).toBe('Slide 2');
    expect(buildPptModel(d).slides).toHaveLength(2);
  });

  it('photo: brightness maps to a CSS brightness filter', () => {
    expect(buildPhotoModel(photo()).filterCss).toBe('brightness(100%)');
    expect(buildPhotoModel({ ...photo(), brightness: 2 }).filterCss).toBe('brightness(136%)');
    expect(buildPhotoModel({ ...photo(), resized: true }).resized).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/widgets/surfaceModels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/widgets/surfaceModels.ts`**

```ts
import type { MockDoc } from '../scenarios';
import { WORD_FILENAME } from '../scenarios';

// Pure view models for the program surfaces (pattern: spreadsheetGrid). Components stay thin.

const status = (saved: boolean, savedAs?: string): string =>
  saved ? (savedAs ? `Saved as ${savedAs}` : 'Saved') : 'Edited';

export function buildWordModel(doc: Extract<MockDoc, { kind: 'word' }>) {
  return { filename: WORD_FILENAME, statusLabel: status(doc.saved, doc.savedAs), heading: doc.heading, text: doc.text, bold: doc.bold };
}

export function buildPptModel(doc: Extract<MockDoc, { kind: 'powerpoint' }>) {
  return { slides: doc.slides, currentTitle: doc.slides[doc.slides.length - 1] ?? '', transition: doc.transition, statusLabel: status(doc.saved) };
}

export function buildPhotoModel(doc: Extract<MockDoc, { kind: 'photo' }>) {
  return {
    filterCss: `brightness(${100 + doc.brightness * 18}%)`, // matches MockPreview's scale
    cropped: doc.cropped, resized: doc.resized, bgRemoved: doc.bgRemoved,
    statusLabel: status(doc.saved),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/widgets/surfaceModels.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/surfaceModels.ts src/widgets/surfaceModels.test.ts
git commit -m "feat(surfaces): pure view models for word/ppt/photo surfaces"
```

---

### Task 3: Generic `[data-element-id]` measurement contract

**Files:**
- Modify: `src/App.tsx` — `updateLayout` (~line 682) and the tile render (~line 3188)

No unit test exists for the layout effect (DOM measurement inside App); verification is the type check + full suite + the fact that behavior is identical for tiles. Keep the diff minimal.

- [ ] **Step 1: Switch the measurer to the generic contract**

In `updateLayout` (App.tsx ~line 682), replace:

```ts
        const photoItems = Array.from(photosEl.querySelectorAll('.photo-item')).map((el, i) => {
          if (i >= PHOTOS.length) return null;
          return {
            id: PHOTOS[i].id,
            bbox: toBBox((el as HTMLElement).getBoundingClientRect())
          };
        }).filter(Boolean) as { id: number; bbox: BBox }[];
```

with:

```ts
        // Generic element contract: anything with data-element-id is a measurable scene
        // element (tiles today, surface controls after the surface migration).
        const photoItems = Array.from(photosEl.querySelectorAll<HTMLElement>('[data-element-id]')).map((el) => {
          const id = Number(el.dataset.elementId);
          return Number.isFinite(id) ? { id, bbox: toBBox(el.getBoundingClientRect()) } : null;
        }).filter(Boolean) as { id: number; bbox: BBox }[];
```

- [ ] **Step 2: Stamp the attribute on the existing tiles**

On the tile div (App.tsx ~line 3188, the one with `className={\`photo-item ...\`}`), add the attribute:

```tsx
                    <div
                      key={photo.id}
                      data-element-id={photo.id}
                      onClick={() => isLive && selectTargetByNumber(i + 1)}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean type check, full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(scene): measure elements via generic data-element-id contract"
```

---

### Task 4: ProgramSurface scaffolding + WordSurface + click/teaching rewiring

The big integration task: the shared surface chrome, the first real surface (Word), App's two new handlers, and the TeachingLayer interaction fix. These land together because the TeachingLayer catcher change breaks tile-click advancement unless element clicks are wired the same commit.

**Files:**
- Create: `src/widgets/ProgramSurface.tsx`
- Modify: `src/App.tsx` (imports, handlers near `selectTargetByNumber` ~line 1651, render ~line 3178, TeachingLayer mount ~line 3116, box header ~line 3170)
- Modify: `src/teaching/TeachingLayer.tsx` (scrim ids ~line 77, active-step catcher ~line 124)

**Interfaces:**
- Consumes: `buildWordModel` (Task 2), `applyAction`/`describeAction`/`classOf`/`serializeMockDoc` (already imported in App), `TeachingLayer`'s existing `dispatchRef` prop.
- Produces (Tasks 5-7 extend):
  - `ProgramSurface` props: `{ program: Program; doc: MockDoc; live: boolean; focusTitle?: string; onAction: (verb: string, args: { target?: string; detail?: string }) => void; onElementClick: (elementId: number) => void }`, `forwardRef<HTMLDivElement>`; root div has `className="program-surface ..."`.
  - `SurfaceElement` and `RibbonButton` exported from the same file for the other surfaces.
  - App handlers `handleSurfaceAction(verb, args)` and `handleSurfaceElementClick(elementId)`.
  - `teachingDispatchRef: React.MutableRefObject<((e: TeachingEvent) => void) | null>` in App.

- [ ] **Step 1: Create `src/widgets/ProgramSurface.tsx`**

```tsx
import React, { forwardRef, useState } from 'react';
import { Save, SaveAll, FileText } from 'lucide-react';
import type { MockDoc, Program, ProgramImage } from '../scenarios';
import { CATEGORY_COLORS } from '../scenarios';
import { buildWordModel } from './surfaceModels';

// Functional mini-app surfaces. Every named element in the program set renders as a real
// DOM node stamped data-element-id (the generic measurement contract) so teaching overlays
// anchor to real controls. Buttons dispatch the SAME applyAction verbs voice uses.

export type SurfaceProps = {
  program: Program;
  doc: MockDoc;
  live: boolean;
  focusTitle?: string;
  onAction: (verb: string, args: { target?: string; detail?: string }) => void;
  onElementClick: (elementId: number) => void;
};

/** Wrapper making one named element measurable + clickable. stopPropagation keeps a click
 *  on a nested element (Save inside the Ribbon) from firing the container's deixis too. */
export function SurfaceElement({ img, live, focusTitle, onElementClick, className, children }: {
  img: ProgramImage; live: boolean; focusTitle?: string;
  onElementClick: (id: number) => void; className?: string; children: React.ReactNode;
}) {
  const isFocus = !!focusTitle && img.title === focusTitle;
  const tone = CATEGORY_COLORS[img.category];
  return (
    <div
      data-element-id={img.id}
      onClick={(e) => { e.stopPropagation(); onElementClick(img.id); }}
      className={`relative ${className ?? ''}`}
      style={isFocus ? { boxShadow: `0 0 0 3px rgb(${tone}), 0 0 16px 2px rgba(${tone}, 0.45)` } : undefined}
    >
      {children}
      {live && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] font-mono font-bold flex items-center justify-center z-10">
          {img.id}
        </span>
      )}
      {isFocus && (
        <span className="absolute -top-2 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wide text-white z-10" style={{ backgroundColor: `rgb(${tone})` }}>
          Point here
        </span>
      )}
    </div>
  );
}

export function RibbonButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-md border border-transparent hover:border-[var(--card-border)] hover:bg-[var(--bg-color)] active:scale-95 transition-all text-[var(--text-primary)]"
    >
      {icon}
      <span className="text-[10px] font-mono">{label}</span>
    </button>
  );
}

export function TitleBar({ icon, filename, statusLabel }: { icon: React.ReactNode; filename: string; statusLabel: string }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2">
      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        {icon}
        <span className="text-xs font-semibold">{filename}</span>
      </div>
      <span className={`text-[10px] font-mono font-bold ${statusLabel === 'Edited' ? 'text-[var(--text-secondary)] opacity-60' : 'text-green-500'}`}>
        {statusLabel}
      </span>
    </div>
  );
}

const imgOf = (program: Program, id: number): ProgramImage =>
  program.images.find((i) => i.id === id) ?? program.images[0];

function WordSurface({ program, doc, live, focusTitle, onAction, onElementClick }: SurfaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (doc.kind !== 'word') return null;
  const m = buildWordModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <TitleBar icon={<FileText size={15} />} filename={m.filename} statusLabel={m.statusLabel} />
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Home</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Save size={16} />} label="Save"
            onClick={() => onAction('save_file', { target: 'Save button' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<SaveAll size={16} />} label="Save As"
            onClick={() => onAction('save_file', { target: 'Save As button', detail: 'Save As' })} />
        </SurfaceElement>
      </SurfaceElement>
      <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-white dark:bg-[#0f1623] overflow-hidden">
        <div className="p-4 h-full flex flex-col">
          {m.heading && <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1.5">{m.heading}</h5>}
          <textarea
            value={draft ?? m.text}
            onFocus={() => setDraft(m.text)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== m.text) onAction('edit_content', { target: 'Document body', detail: draft });
              setDraft(null);
            }}
            className={`flex-1 w-full resize-none bg-transparent outline-none text-[13px] leading-snug text-slate-900 dark:text-slate-100 ${m.bold ? 'font-bold' : 'font-normal'}`}
          />
        </div>
      </SurfaceElement>
    </div>
  );
}

/** Dispatcher: one surface per program. Tasks 5-7 fill in the remaining branches. */
export const ProgramSurface = forwardRef<HTMLDivElement, SurfaceProps>((props, ref) => {
  return (
    <div ref={ref} className="program-surface w-full h-full">
      {props.program.id === 'word' && <WordSurface {...props} />}
    </div>
  );
});
ProgramSurface.displayName = 'ProgramSurface';
```

- [ ] **Step 2: Add the App handlers and teaching dispatch ref**

In `src/App.tsx`, add imports:

```ts
import { ProgramSurface } from './widgets/ProgramSurface';
import type { TeachingEvent } from './teaching/types';
```

Near `spreadsheetRef` (~line 578), add:

```ts
  const teachingDispatchRef = useRef<((e: TeachingEvent) => void) | null>(null);
```

Directly after `selectTargetByNumber` (~line 1668), add:

```ts
  // Surface element click: deixis (numbered-selection path) + teaching step action. This is
  // how a click on a REAL control both selects it and advances an active teach sequence.
  const handleSurfaceElementClick = (elementId: number) => {
    const entity = entitiesRef.current.find(e => e.id === `${program.id}-${elementId}`);
    if (entity) teachingDispatchRef.current?.({ type: 'user.stepAction', entityId: entity.id });
    const idx = program.images.findIndex(im => im.id === elementId);
    if (isLive && idx >= 0) selectTargetByNumber(idx + 1);
  };

  // Direct manipulation commits immediately — the click IS the confirmation (no witness
  // gate; that gate exists for voice, where interpretation can be wrong). Same reducer,
  // same undo memento, same world-state feedback loop as the voice path.
  const handleSurfaceAction = (verb: string, args: { target?: string; detail?: string }) => {
    const prevDoc = mockDocRef.current;
    const nextDoc = applyAction(prevDoc, verb, args);
    if (nextDoc === prevDoc) return;
    mockDocRef.current = nextDoc;
    setMockDoc(nextDoc);
    const d = describeAction(verb, args);
    setUndoStack(s => [...s, { doc: prevDoc, label: `${d.label} ${d.target}` }]);
    lastInputModalityRef.current = 'direct';
    telemetry.action(verb, classOf(verb), 'commit', 'direct');
    emitFeedback({ outcome: 'committed', verbClass: classOf(verb), label: `${d.label} ${d.target}` });
    providerRef.current?.sendTextHint(`[DOCUMENT STATE after the user's direct edit: ${serializeMockDoc(nextDoc)}. DO NOT acknowledge this message.]`);
  };
```

(`describeAction`, `classOf`, `telemetry`, `emitFeedback`, `serializeMockDoc` are all already imported/defined in App.tsx — check the imports at the top and add any that are missing from the `./scenarios` import list.)

- [ ] **Step 3: Render WordSurface + retitle the box + pass the dispatch ref**

TeachingLayer mount (~line 3116):

```tsx
          {teachMode && <TeachingLayer entities={entities} demo dispatchRef={teachingDispatchRef} />}
```

Box header (~line 3170): replace `Camera roll` with the program label:

```tsx
                  <h3 className="text-xs sm:text-sm font-semibold text-[var(--text-primary)]">{program.label}</h3>
```

Render switch (~line 3178) — add the word branch before the excel one:

```tsx
                {activeProgram === 'word' ? (
                  <div className="col-span-2 h-full">
                    <ProgramSurface program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                      onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick} />
                  </div>
                ) : activeProgram === 'excel' ? (
```

And rewire the remaining tiles' onClick (~line 3190) through the shared handler so teaching advancement works on tiles during the migration:

```tsx
                      onClick={() => handleSurfaceElementClick(photo.id)}
```

- [ ] **Step 4: Fix TeachingLayer interaction for real controls**

In `src/teaching/TeachingLayer.tsx`:

(a) Scrim candidates (~line 77): chrome containers ('program' category) must not be scrimmed — a scrim over the Ribbon would cover the Save button nested inside it. Replace:

```ts
  const tileIds = entities.filter((e) => e.category !== 'map').map((e) => e.id);
```

with:

```ts
  // Scrim only leaf controls/content. 'program' chrome contains nested elements (Save sits
  // inside the Ribbon) — scrimming the container would block the sequence target itself.
  const tileIds = entities.filter((e) => e.category !== 'map' && e.category !== 'program').map((e) => e.id);
```

(b) Active-step catcher (~line 124-131): the target's real control must receive the click (it performs the actual action; App dispatches `user.stepAction` via the ref). The emphasis becomes visual-only. Replace the catcher div's className/onClick:

```tsx
            return (
              <div className={`absolute rounded-xl pointer-events-none ${showRing ? 'ring-4 ring-[var(--accent-color)] shadow-[0_0_28px_rgba(99,102,241,0.45)]' : ''}`}
                   style={b}>
```

(remove the `onClick={...}` and `cursor-pointer` — keep everything inside the div unchanged).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean type check, full suite PASS.

Manual check: `npm run dev`, open `http://localhost:<port>/?teach=1` (default program = word). Expect: real Word chrome (Home ribbon, Save, Save As, editable body); demo highlight ring lands on the ribbon; the 3-step sequence advances when you click the actual targets; clicking a scrimmed control shows the "Not yet" toast and does NOT perform its action; clicking Save flips the status to "Saved"; typing in the body then blurring updates the doc (status back to "Edited" is NOT expected — text edit doesn't unsave; just confirm no crash and text persists).

- [ ] **Step 6: Commit**

```bash
git add src/widgets/ProgramSurface.tsx src/App.tsx src/teaching/TeachingLayer.tsx
git commit -m "feat(surfaces): WordSurface + surface click/action wiring + teaching pass-through clicks"
```

---

### Task 5: ExcelSurface (ribbon wrap; fixes the excel bbox gap)

**Files:**
- Modify: `src/widgets/Spreadsheet.tsx` (two optional props)
- Modify: `src/widgets/ProgramSurface.tsx` (ExcelSurface + dispatcher branch)
- Modify: `src/App.tsx` (~line 3178: excel branch renders ProgramSurface)

**Interfaces:**
- Consumes: `Spreadsheet` (existing), `SurfaceElement`/`RibbonButton`/`TitleBar` (Task 4).
- Produces: `Spreadsheet` gains `elementIds?: Record<string, number>` (cell ref → element id, stamps `data-element-id`) and `onCellClick?: (ref: string) => void`. ExcelSurface accepts a `spreadsheetRef` pass-through prop on `ProgramSurface`: add optional `spreadsheetRef?: React.Ref<HTMLDivElement>` to `SurfaceProps` (the existing snapshot effect keeps working until Task 9 generalizes it).

- [ ] **Step 1: Extend `Spreadsheet.tsx`**

```tsx
type Props = {
  doc: MockDoc;
  selection?: string | null;
  /** Optional scene-element stamping: cell ref → data-element-id (e.g. { A1: 4 }). */
  elementIds?: Record<string, number>;
  onCellClick?: (ref: string) => void;
};

export const Spreadsheet = forwardRef<HTMLDivElement, Props>(({ doc, selection = null, elementIds, onCellClick }, ref) => {
```

and on the `<td>`:

```tsx
                <td
                  key={cell.ref}
                  data-cell={cell.ref}
                  data-element-id={elementIds?.[cell.ref]}
                  onClick={onCellClick ? (e) => { e.stopPropagation(); onCellClick(cell.ref); } : undefined}
```

- [ ] **Step 2: Add ExcelSurface to `ProgramSurface.tsx`**

Add imports: `Sigma, Divide, Table` from lucide-react; `Spreadsheet` from `./Spreadsheet`.
Add to `SurfaceProps`: `spreadsheetRef?: React.Ref<HTMLDivElement>;`

```tsx
function ExcelSurface({ program, doc, live, focusTitle, onAction, onElementClick, spreadsheetRef }: SurfaceProps) {
  if (doc.kind !== 'excel') return null;
  return (
    <div className="flex flex-col h-full gap-2">
      <TitleBar icon={<Table size={15} />} filename="Q2 numbers.xlsx" statusLabel={doc.saved ? 'Saved' : 'Edited'} />
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Formulas</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Sigma size={16} />} label="SUM"
            onClick={() => onAction('insert_object', { target: 'SUM function', detail: 'SUM' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Divide size={16} />} label="AVERAGE"
            onClick={() => onAction('insert_object', { target: 'AVERAGE function', detail: 'AVERAGE' })} />
        </SurfaceElement>
      </SurfaceElement>
      <div className="flex-1 rounded-lg border border-[var(--card-border)] overflow-hidden">
        <Spreadsheet ref={spreadsheetRef} doc={doc} elementIds={{ A1: 4 }}
          onCellClick={(ref) => { if (ref === 'A1') onElementClick(4); }} />
      </div>
    </div>
  );
}
```

Dispatcher: add `{props.program.id === 'excel' && <ExcelSurface {...props} />}`.

- [ ] **Step 3: Swap the App excel branch**

Replace (App.tsx ~3178):

```tsx
                ) : activeProgram === 'excel' ? (
                  <div className="col-span-2 h-full">
                    <Spreadsheet ref={spreadsheetRef} doc={mockDoc} />
                  </div>
                ) : (
```

with:

```tsx
                ) : activeProgram === 'excel' ? (
                  <div className="col-span-2 h-full">
                    <ProgramSurface program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                      onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick}
                      spreadsheetRef={spreadsheetRef} />
                  </div>
                ) : (
```

(The `Spreadsheet` import in App.tsx becomes unused — remove it.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.
Manual: dev server, switch program to Excel. Expect ribbon + grid; clicking SUM writes 60 into A4 (visible in the grid); Excel now has measured elements, so `?teach=1` runs its (still-generic) demo over the ribbon/SUM/AVERAGE.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/Spreadsheet.tsx src/widgets/ProgramSurface.tsx src/App.tsx
git commit -m "feat(surfaces): ExcelSurface — real SUM/AVERAGE ribbon around the spreadsheet"
```

---

### Task 6: PowerPointSurface

**Files:**
- Modify: `src/widgets/ProgramSurface.tsx`

**Interfaces:** consumes `buildPptModel` (Task 2). Element ids: 1 Ribbon, 2 New Slide, 3 Duplicate Slide, 4 Slide canvas.

- [ ] **Step 1: Add PptSurface**

Imports: `Presentation, Plus, Copy` from lucide-react; `buildPptModel` from `./surfaceModels`.

```tsx
function PptSurface({ program, doc, live, focusTitle, onAction, onElementClick }: SurfaceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  if (doc.kind !== 'powerpoint') return null;
  const m = buildPptModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <TitleBar icon={<Presentation size={15} />} filename="Pitch deck.pptx" statusLabel={m.statusLabel} />
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Insert</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Plus size={16} />} label="New Slide"
            onClick={() => onAction('insert_object', { target: 'New Slide button' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Copy size={16} />} label="Duplicate"
            onClick={() => onAction('insert_object', { target: 'Duplicate Slide button', detail: 'duplicate' })} />
        </SurfaceElement>
      </SurfaceElement>
      <div className="flex-1 flex gap-2 min-h-0">
        {/* filmstrip (chrome, not a named element) */}
        <div className="w-20 shrink-0 flex flex-col gap-1.5 overflow-y-auto">
          {m.slides.map((s, i) => (
            <div key={i} className={`h-12 shrink-0 rounded-md border text-[8px] text-center flex items-center justify-center px-1 leading-tight bg-white dark:bg-[#0f1623] text-[var(--text-primary)] ${i === m.slides.length - 1 ? 'border-[var(--accent-color)]' : 'border-[var(--card-border)]'}`}>
              {s}
            </div>
          ))}
        </div>
        <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
          className="flex-1 rounded-lg border border-[var(--card-border)] bg-white dark:bg-[#0f1623] flex items-center justify-center">
          <input
            value={draft ?? m.currentTitle}
            onFocus={() => setDraft(m.currentTitle)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null && draft !== m.currentTitle) onAction('edit_content', { target: 'Slide canvas', detail: draft });
              setDraft(null);
            }}
            className="w-3/4 bg-transparent outline-none text-center text-lg font-bold text-slate-900 dark:text-slate-100"
          />
          {m.transition && (
            <span className="absolute bottom-2 right-3 text-[9px] font-mono text-[var(--text-secondary)]">Transition: {m.transition}</span>
          )}
        </SurfaceElement>
      </div>
    </div>
  );
}
```

Dispatcher: add `{props.program.id === 'powerpoint' && <PptSurface {...props} />}`.
App render (~3178): extend the surface condition so powerpoint uses it — change the first branch test to `activeProgram === 'word' || activeProgram === 'powerpoint'`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.
Manual: switch to PowerPoint; New Slide appends to the filmstrip, Duplicate copies, editing the canvas title renames the last slide.

- [ ] **Step 3: Commit**

```bash
git add src/widgets/ProgramSurface.tsx src/App.tsx
git commit -m "feat(surfaces): PowerPointSurface — filmstrip, editable slide canvas, real New/Duplicate"
```

---

### Task 7: PhotoSurface + retire the tile grid

**Files:**
- Modify: `src/widgets/ProgramSurface.tsx`
- Modify: `src/App.tsx` (render ~3178-3211: remove the tile map entirely)

**Interfaces:** consumes `buildPhotoModel` (Task 2). Element ids: 1 Toolbar, 2 Crop, 3 Resize, 4 Image canvas.

- [ ] **Step 1: Add PhotoSurface**

Imports: `Image as ImageIcon, Crop as CropIcon, Maximize2` from lucide-react; `buildPhotoModel` from `./surfaceModels`.

```tsx
const PHOTO_CANVAS_URL = 'https://picsum.photos/seed/photo-canvas/800/600'; // the CONTENT being edited (honest: it is an image)

function PhotoSurface({ program, doc, live, focusTitle, onAction, onElementClick }: SurfaceProps) {
  if (doc.kind !== 'photo') return null;
  const m = buildPhotoModel(doc);
  return (
    <div className="flex flex-col h-full gap-2">
      <TitleBar icon={<ImageIcon size={15} />} filename="IMG_2041.jpg" statusLabel={m.statusLabel} />
      <SurfaceElement img={imgOf(program, 1)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex items-center gap-1 rounded-lg border border-[var(--card-border)] bg-[var(--bg-color)] p-1.5">
        <span className="px-2 text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Tools</span>
        <SurfaceElement img={imgOf(program, 2)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<CropIcon size={16} />} label="Crop"
            onClick={() => onAction('photo_edit', { target: 'Crop tool', detail: 'crop' })} />
        </SurfaceElement>
        <SurfaceElement img={imgOf(program, 3)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}>
          <RibbonButton icon={<Maximize2 size={16} />} label="Resize"
            onClick={() => onAction('photo_edit', { target: 'Resize tool', detail: 'resize' })} />
        </SurfaceElement>
      </SurfaceElement>
      <SurfaceElement img={imgOf(program, 4)} live={live} focusTitle={focusTitle} onElementClick={onElementClick}
        className="flex-1 rounded-lg border border-[var(--card-border)] overflow-hidden flex items-center justify-center"
      >
        <div className="w-full h-full flex items-center justify-center"
          style={{ background: m.bgRemoved ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f1f5f9 0% 50%) 50% / 16px 16px' : 'var(--bg-color)' }}>
          <img src={PHOTO_CANVAS_URL} alt="Photo being edited" referrerPolicy="no-referrer" draggable="false"
            className={`object-cover transition-all duration-300 ${m.cropped ? 'scale-[1.35]' : ''}`}
            style={{
              filter: m.filterCss,
              width: m.resized ? '70%' : '100%',
              height: m.resized ? '70%' : '100%',
              clipPath: m.bgRemoved ? 'ellipse(38% 46% at 50% 50%)' : undefined,
            }} />
        </div>
      </SurfaceElement>
    </div>
  );
}
```

Dispatcher: add `{props.program.id === 'photo' && <PhotoSurface {...props} />}`.

- [ ] **Step 2: Retire the tile grid in App.tsx**

Replace the whole conditional block inside the grid container (~lines 3178-3211: the `activeProgram === ...` ternary and the `PHOTOS.map(...)` branch) with a single unconditional surface render:

```tsx
                <div className="col-span-2 h-full">
                  <ProgramSurface program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                    onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick}
                    spreadsheetRef={spreadsheetRef} />
                </div>
```

Remove now-dead code in App.tsx: the tile `isFocus`/`tone` logic lived inside the removed map (nothing else to delete for it); keep `PHOTOS` (still used by perception/vision until Task 9) and `focusTitle` (surfaces consume it).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.
Manual: all four programs render real chrome; Photo's Crop/Resize visibly transform the image; program dropdown swaps surfaces cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/widgets/ProgramSurface.tsx src/App.tsx
git commit -m "feat(surfaces): PhotoSurface + retire the picsum tile grid — all programs are real mini-apps"
```

---

### Task 8: Per-program teaching demo scripts (TDD)

**Files:**
- Modify: `src/teaching/demoScript.ts`
- Modify: `src/teaching/demoScript.test.ts`
- Modify: `src/teaching/TeachingLayer.tsx` (pass program through)
- Modify: `src/App.tsx` (TeachingLayer mount gains `program={program}`)

**Interfaces:**
- Produces: `buildDemoScript(program: Program, entities: SceneEntity[])` — signature change. `TeachingLayer` props gain `program: Program`.
- Script per program teaches a REAL task ending in a visible result, using the element convention (1 chrome, 2 primary, 3 look-alike, 4 content); steps target [chrome, content, primary]; relate pairs primary ↔ look-alike.

- [ ] **Step 1: Update the test first**

Replace `src/teaching/demoScript.test.ts` content:

```ts
import { describe, it, expect } from 'vitest';
import { buildDemoScript } from './demoScript';
import { initialTeachingState, reduce } from './teachingStore';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';

const layoutFor = (programId: 'word' | 'excel') => ({
  items: getProgram(programId).images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
});

describe('demo script', () => {
  it('word: teaches the save task over ribbon → body → Save, then relates the look-alikes', () => {
    const program = getProgram('word');
    const entities = buildEntities(program, {}, layoutFor('word'));
    const script = buildDemoScript(program, entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.title).toBe('Save your document');
    expect(st.sequence!.steps.map(s => s.entityId)).toEqual(['word-1', 'word-4', 'word-2']);
    expect(st.sequence!.softBlock).toBe(true);
    for (const step of [...st.sequence!.steps]) st = reduce(st, { type: 'user.stepAction', entityId: step.entityId }, 30000);
    expect(st.sequence!.activeIndex).toBeNull();
    expect(st.competence['word.save']).toBe(1);
    expect(st.relations).toEqual([{ from: 'word-2', to: 'word-3', label: 'easily confused' }]);
  });

  it('excel: teaches totaling the column', () => {
    const program = getProgram('excel');
    const entities = buildEntities(program, {}, layoutFor('excel'));
    const script = buildDemoScript(program, entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.steps.map(s => s.entityId)).toEqual(['excel-1', 'excel-4', 'excel-2']);
    expect(st.sequence!.taskKey).toBe('excel.sum');
  });

  it('returns empty when the program elements are missing (renders nothing, never throws)', () => {
    expect(buildDemoScript(getProgram('word'), [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/teaching/demoScript.test.ts`
Expected: FAIL — buildDemoScript takes one argument / wrong titles.

- [ ] **Step 3: Rewrite `src/teaching/demoScript.ts`**

```ts
import type { SceneEntity } from '../entities/registry';
import type { Program, ProgramId } from '../scenarios';
import type { TeachingEvent } from './types';

// Per-program authored copy. Element convention: 1 = chrome, 2 = primary control,
// 3 = its look-alike, 4 = content. Steps run chrome → content → primary so every
// sequence ends on the button whose REAL effect proves the task worked.
const COPY: Record<ProgramId, {
  title: string; taskKey: string; highlightNote: string;
  steps: [subgoal: string, instruction: string][]; // [chrome, content, primary]
}> = {
  word: {
    title: 'Save your document', taskKey: 'word.save', highlightNote: 'your tools',
    steps: [
      ['Find your tools', 'Click the Home ribbon.'],
      ['Write the report', 'Click the document body.'],
      ['Save your work', 'Click Save.'],
    ],
  },
  excel: {
    title: 'Total the column', taskKey: 'excel.sum', highlightNote: 'formulas',
    steps: [
      ['Find your tools', 'Click the Formulas ribbon.'],
      ['Check the data', 'Click cell A1.'],
      ['Total the column', 'Click SUM.'],
    ],
  },
  powerpoint: {
    title: 'Add a slide', taskKey: 'ppt.new-slide', highlightNote: 'insert tools',
    steps: [
      ['Find your tools', 'Click the Insert ribbon.'],
      ['Review the slide', 'Click the slide canvas.'],
      ['Add a slide', 'Click New Slide.'],
    ],
  },
  photo: {
    title: 'Crop the image', taskKey: 'photo.crop', highlightNote: 'edit tools',
    steps: [
      ['Find your tools', 'Click the toolbar.'],
      ['Frame the shot', 'Click the image.'],
      ['Crop the image', 'Click Crop.'],
    ],
  },
};

/**
 * A scripted teaching session over the ACTIVE program's real controls: highlight →
 * 3-step guide sequence (soft-block on) → relate the look-alike pair. Timing offsets in
 * ms; the driver replays the same taskKey to demonstrate fade 1. Pure — inputs injected.
 */
export function buildDemoScript(program: Program, entities: SceneEntity[]): { at: number; event: TeachingEvent }[] {
  const el = (n: number) => entities.find((e) => e.id === `${program.id}-${n}`);
  const [chrome, primary, lookalike, content] = [el(1), el(2), el(3), el(4)];
  if (!chrome || !primary || !lookalike || !content) return [];
  const c = COPY[program.id];
  const targets = [chrome, content, primary];
  return [
    { at: 800,  event: { type: 'teach.highlight', entityId: chrome.id, note: c.highlightNote } },
    { at: 2600, event: { type: 'teach.clear' } },
    { at: 3000, event: { type: 'teach.sequence', title: c.title, taskKey: c.taskKey, posture: 'guide',
      steps: c.steps.map(([subgoal, instruction], i) => ({ entityId: targets[i].id, subgoal, instruction })) } },
    { at: 20000, event: { type: 'teach.relate', relations: [{ from: primary.id, to: lookalike.id, label: 'easily confused' }] } },
  ];
}
```

- [ ] **Step 4: Thread the program through TeachingLayer**

`src/teaching/TeachingLayer.tsx`:

```ts
import type { Program } from '../scenarios';

type Props = {
  entities: SceneEntity[];
  program: Program;
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: TeachingEvent) => void) | null>; // Plan 2 seam
};

export function TeachingLayer({ entities, program, demo = false, dispatchRef }: Props) {
```

and in the demo effect (~line 57): `buildDemoScript(program, entities)`, with `program` added to the effect deps array.

`src/App.tsx` mount:

```tsx
          {teachMode && <TeachingLayer entities={entities} program={program} demo dispatchRef={teachingDispatchRef} />}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/teaching/demoScript.test.ts` then `npx tsc --noEmit && npx vitest run`
Expected: PASS.

Manual: `?teach=1` on each program via the dropdown — each teaches its own task and the final click produces the real effect (doc saved / A4=60 / new slide / cropped image).

- [ ] **Step 6: Commit**

```bash
git add src/teaching/demoScript.ts src/teaching/demoScript.test.ts src/teaching/TeachingLayer.tsx src/App.tsx
git commit -m "feat(teaching): per-program demo scripts that end in a real visible result"
```

---

### Task 9: Vision generalization + retire URL perception

**Files:**
- Modify: `src/App.tsx` — layout measure (~line 690), frame composer (~lines 2779-2809), snapshot effect (~lines 2911-2928), perception effect (~lines 2723-2745), refs (~578)

**Interfaces:**
- Consumes: `snapshotNode`/`makeThrottle` (existing), `.program-surface` root class (Task 4).
- Produces: `layoutBounds.surface?: BBox` (replaces `spreadsheet`), `surfaceRef`/`surfaceSnapshotRef` (replace `spreadsheetRef`/`spreadsheetSnapshotRef`).

- [ ] **Step 1: Rename the refs and measure the surface root**

At ~line 576-579: rename the `spreadsheet?: BBox` field to `surface?: BBox`, `spreadsheetRef` → `surfaceRef`, `spreadsheetSnapshotRef` → `surfaceSnapshotRef` (project-wide in App.tsx; the ExcelSurface `spreadsheetRef` prop keeps its name — it points at the inner grid and is now ONLY used by nothing → remove the prop pass in App and the prop from `SurfaceProps` and ExcelSurface, since the whole-surface snapshot replaces it. Move the ref: attach to the dispatcher instead).

In `updateLayout` (~line 690):

```ts
        const surfEl = main.querySelector('.program-surface');
        setLayoutBounds({
          photos: toBBox(pRect),
          map: toBBox(mRect),
          photoItems,
          surface: surfEl ? toBBox((surfEl as HTMLElement).getBoundingClientRect()) : undefined,
        });
```

In the render, attach the ref to the dispatcher:

```tsx
                  <ProgramSurface ref={surfaceRef} program={program} doc={mockDoc} live={isLive} focusTitle={focusTitle}
                    onAction={handleSurfaceAction} onElementClick={handleSurfaceElementClick} />
```

- [ ] **Step 2: Snapshot every program's surface**

Replace the snapshot effect (~2911-2928) condition and node source:

```ts
  // Refresh the real-pixel surface snapshot (throttled, fail-soft) for the vision frame.
  useEffect(() => {
    if (!isLive) {
      surfaceSnapshotRef.current = null;
      return;
    }
    let cancelled = false;
    const gate = makeThrottle(500);
    const tick = async () => {
      if (cancelled || !gate(Date.now())) return;
      const node = surfaceRef.current;
      if (!node) return;
      const canvas = await snapshotNode(node);
      if (!cancelled && canvas) surfaceSnapshotRef.current = canvas;
    };
    const interval = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, activeProgram]);
```

- [ ] **Step 3: Compose the frame from the surface snapshot**

Replace the composer block (~2779-2809 — the `ssCanvas` branch AND the `photoItems.forEach` fallback):

```ts
      // Draw the program surface — REAL pixels when the snapshot is fresh, else labeled
      // boxes per element (honest fallback: labels only, never stale imagery).
      const sCanvas = surfaceSnapshotRef.current;
      if (sCanvas) {
        const b = layoutBounds.surface ?? layoutBounds.photos;
        const dx = (b.xmin / 1000) * VISION_SIZE, dy = (b.ymin / 1000) * VISION_SIZE;
        const dw = ((b.xmax - b.xmin) / 1000) * VISION_SIZE, dh = ((b.ymax - b.ymin) / 1000) * VISION_SIZE;
        try { ctx.drawImage(sCanvas, dx, dy, dw, dh); } catch { /* keep canvas clean */ }
        ctx.strokeStyle = '#e5e5e5';
        ctx.strokeRect(dx, dy, dw, dh);
      } else {
        layoutBounds.photoItems.forEach((item) => {
          const b = item.bbox;
          const dx = (b.xmin/1000)*VISION_SIZE, dy = (b.ymin/1000)*VISION_SIZE;
          const dw = ((b.xmax-b.xmin)/1000)*VISION_SIZE, dh = ((b.ymax-b.ymin)/1000)*VISION_SIZE;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(dx, dy, dw, dh);
          ctx.strokeStyle = '#e5e5e5';
          ctx.strokeRect(dx, dy, dw, dh);
          ctx.fillStyle = '#64748b';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          const title = program.images.find(im => im.id === item.id)?.title ?? '';
          ctx.fillText(title, dx + dw / 2, dy + dh / 2);
        });
      }
```

Delete the now-unused `visionImgCacheRef` and its image-loader effect (grep `visionImgCacheRef` in App.tsx and remove all uses; the picsum urls are no longer on screen, so drawing them into the vision frame would show the model a scene the user isn't seeing).

- [ ] **Step 4: Retire URL-based tile perception**

The perception effect (~2723-2745) labels `photo.url` images that no longer render — a perceived label describing an off-screen stock photo would be an honesty regression. Delete the effect body, keeping the seam documented:

```ts
  // Tile perception retired with the picsum tiles: the surfaces ARE self-describing DOM,
  // so registered titles are literally what's on screen. The PerceivedCache seam stays
  // (buildEntities accepts it) for a future surface-snapshot-based perception pass.
```

Remove the now-unused imports (`perceiveTileLabel`, `loadImageAsBase64`) and `perceivedVersion` state if nothing else references it (grep first — it appears in the layout-effect deps at ~732; drop it from that deps array too). Keep `perceivedLabelsRef` (buildEntities consumes it; it just stays empty).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.
Manual (needs a GEMINI key for full check, else just confirm no crash): start a live session; the debug vision frame should show the real surface pixels; excel's `[SPREADSHEET DATA]` text hint still flows (that effect is untouched).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/widgets/ProgramSurface.tsx
git commit -m "feat(vision): snapshot the active surface for every program; retire URL tile perception"
```

---

### Task 10: MockPreview demotion + final sweep

**Files:**
- Modify: `src/App.tsx` (sidebar section ~line 3728-3747, remove MockPreview import)
- Delete: `src/components/MockPreview.tsx`

- [ ] **Step 1: Replace MockPreview with the world-state debug line**

The surface IS the live preview now; what keeps debug value is the exact string the model reads. Replace `<MockPreview doc={mockDoc} />` (~line 3745) with:

```tsx
              <div className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)] mb-1.5">World state (as the model reads it)</div>
              <div className="text-[11px] font-mono text-[var(--text-primary)] break-words leading-relaxed">{serializeMockDoc(mockDoc)}</div>
```

Keep the section and the Undo button exactly as they are. Remove the `MockPreview` import (~line 60) and delete `src/components/MockPreview.tsx`.

- [ ] **Step 2: Dead-code sweep**

```bash
grep -n "MockPreview\|photo-item\|visionImgCacheRef\|perceiveTileLabel" src/App.tsx
```
Expected: no hits (`.photo-item` CSS class in index.css may remain — harmless, but delete its rules if present: `grep -n "photo-item" index.css src/index.css`).

- [ ] **Step 3: Full verification**

Run: `npx vitest run` — Expected: all tests PASS.
Run: `npx tsc --noEmit && npx vite build` — Expected: clean build.

Manual checklist (`npm run dev`):
- [ ] Each of the four programs renders its mini-app; header shows the program label.
- [ ] Word: type in body → blur → text persists; Save → "Saved"; Save As → "Saved as Quarterly report (copy).docx".
- [ ] Excel: SUM → A4 shows 60; AVERAGE → A5 shows 30; A1 click selects.
- [ ] PowerPoint: New Slide / Duplicate grow the filmstrip; canvas edit renames the last slide.
- [ ] Photo: Crop zooms, Resize shrinks, both animate.
- [ ] `?teach=1` per program: ring on real chrome → 3 steps advance ONLY on the real targets → off-target click on a leaf control is scrimmed + toasted and does NOT perform its action → final step's real effect is visible → relate arc joins the look-alike pair → second run of the same program shows fade 1 (highlights only).
- [ ] Undo button undoes a direct button click.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(surfaces): demote MockPreview to world-state debug; delete tile-era dead code"
```

---

## Self-Review Notes (already applied)

- Spec §2-§7 each map to Tasks 1-10; spec §3's "commit immediately" is `handleSurfaceAction` (Task 4); spec §4's excel bbox bug fix is Task 5; the two integration risks the spec didn't foresee are handled explicitly: the TeachingLayer catcher must stop swallowing clicks (Task 4 Step 4b) and nested elements must not be scrimmed by their container (Task 4 Step 4a — scrim skips `program`-category chrome).
- Perception retirement (Task 9 Step 4) is a plan-time addition the spec implies but doesn't state: perceiving off-screen picsum URLs after the tiles are gone would be an honesty regression.
- Numbered badges show `img.id` (1-4) and `selectTargetByNumber(idx+1)` uses array position; ids and positions coincide in `PROGRAMS` (ids are 1-4 in order), so voice "number two" and the badge agree.
