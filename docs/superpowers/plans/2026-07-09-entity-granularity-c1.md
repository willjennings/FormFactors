# Entity Granularity (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general, extensible sub-element entity mechanism so the honest pointer can address a spreadsheet cell or a slide — with Excel cells + PowerPoint slides as the first two adopters — via a pure per-surface deriver, one generic string measurement contract, innermost-wins hit-testing, and a hardened surface-agnostic resolver.

**Architecture:** A pure `SubEntityDeriver` per surface produces `SubEntitySpec[]` from the MockDoc; the `data-element-id` (numeric) measurement contract generalizes to `data-entity-id` (string = full entity id) covering top-level + sub-elements; `buildEntities` merges them into one flat `SceneEntity[]` with a `sub` flag; hit-testing picks the smallest containing bbox; `resolveEchoedTarget` gets word-boundary matching so dense alias sets (A1…D6) don't cross-resolve.

**Tech Stack:** React 19, TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-09-entity-granularity-design.md`

## Global Constraints

- Branch `honest-mode`, work directly on it.
- **Build the extension point, ship two adopters** (spec §1): the deriver contract + measurement/identity/resolution plumbing is general; only Excel cells + PowerPoint slides are implemented (Word/Photo derivers return `[]`).
- **Decision A — one generic string contract:** the numeric `data-element-id` measurement generalizes to string `data-entity-id` = the full entity id (`${programId}-${imageId}` for top-level, `${programId}-cell-A3` / `${programId}-slide-2` for sub). No parallel/dual contract.
- The `data-*` attribute is consumed ONLY by `updateLayout` for bbox measurement; the JS click/soft-block paths (`handleSurfaceElementClick(id: number)`, `blockedElements: number[]`) keep using the numeric `img.id` in JS and are NOT changed by the measurement generalization.
- `SceneEntity` gains `sub?: boolean` (the reasoning key for filtering sub vs top-level; do not parse id strings).
- Flat entity list + innermost-wins hit-test (no hierarchy in data). Top-level entity ids stay `${programId}-${imageId}` so downstream (teaching demo scripts, scrim) is unaffected.
- Resolver stays surface-agnostic (no cell-specific logic); the honesty floor (below-threshold → null) is preserved.
- Out of scope: word/insertion-point pointing (C2b), any perception, the goal model (C3), sub-entities for surfaces beyond Excel/PowerPoint.
- Verify per task: `npx tsc --noEmit && npx vitest run` (baseline 151). Commit per task with the given message.

## File Structure

```
src/entities/subEntities.ts        CREATE  SubEntitySpec + SubEntityDeriver + derivers + registry
src/entities/subEntities.test.ts   CREATE  pure deriver tests
src/entities/registry.ts           MODIFY  SceneEntity.sub?; buildEntities(program,doc,perceived,layout) merge; resolver hardening
src/entities/registry.test.ts      MODIFY  resolver density regression + merge test
src/widgets/ProgramSurface.tsx     MODIFY  SurfaceElement data-entity-id; PPT filmstrip stamping; Spreadsheet cell stamping fn
src/widgets/Spreadsheet.tsx        MODIFY  cell data-entity-id via an entityIdFor(ref) prop
src/App.tsx                        MODIFY  updateLayout string scan; buildEntities call sites (×3) pass doc; innermost-wins hit-test + confidence
```

---

### Task 1: Sub-entity derivation module (pure, TDD)

**Files:**
- Create: `src/entities/subEntities.ts`, `src/entities/subEntities.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SubEntitySpec { idSuffix: string; title: string; aliases: string[]; category: ElementCategory; }
export type SubEntityDeriver = (doc: MockDoc) => SubEntitySpec[];
export const SUB_ENTITY_DERIVERS: Partial<Record<ProgramId, SubEntityDeriver>>;
```
Excel: one spec per cell in the grid range (columns A–D × rows 1–6, from `buildGridModel`), `{ idSuffix: 'cell-A3', title: 'Cell A3', aliases: ['a3'], category: 'content' }` (title auto-normalizes into aliases downstream; include the bare ref lowercased). PowerPoint: one spec per `doc.slides[i]`, `{ idSuffix: 'slide-2', title: 'Slide 2', aliases: ['slide 2','second slide'], category: 'content' }`. Word/Photo: `() => []`.

- [ ] **Step 1: Write the failing tests** — `src/entities/subEntities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveSpreadsheetSubEntities, derivePptSubEntities, SUB_ENTITY_DERIVERS } from './subEntities';
import { initialMockDoc, applyAction } from '../scenarios';

describe('sub-entity derivers', () => {
  it('excel: one spec per grid cell (A1..D6 = 24), correct id/title/aliases', () => {
    const specs = deriveSpreadsheetSubEntities(initialMockDoc('excel'));
    expect(specs).toHaveLength(24);
    const a3 = specs.find(s => s.idSuffix === 'cell-A3')!;
    expect(a3).toMatchObject({ title: 'Cell A3', category: 'content' });
    expect(a3.aliases).toContain('a3');
    // dense-set sanity: A3 and A13 do not exist together to collide, but A1 and A3 are distinct
    expect(specs.find(s => s.idSuffix === 'cell-A1')!.title).toBe('Cell A1');
  });
  it('powerpoint: one spec per slide, count grows with the deck', () => {
    let doc = initialMockDoc('powerpoint');                 // 1 slide
    expect(derivePptSubEntities(doc)).toHaveLength(1);
    doc = applyAction(doc, 'insert_object', { target: 'New Slide button' }); // +1
    const specs = derivePptSubEntities(doc);
    expect(specs).toHaveLength(2);
    expect(specs[1]).toMatchObject({ idSuffix: 'slide-2', title: 'Slide 2', category: 'content' });
    expect(specs[1].aliases).toContain('slide 2');
  });
  it('word and photo derive nothing (deferred / no sub-elements)', () => {
    expect(SUB_ENTITY_DERIVERS.word?.(initialMockDoc('word')) ?? []).toEqual([]);
    expect(SUB_ENTITY_DERIVERS.photo?.(initialMockDoc('photo')) ?? []).toEqual([]);
  });
  it('registry maps excel + powerpoint to their derivers', () => {
    expect(SUB_ENTITY_DERIVERS.excel).toBe(deriveSpreadsheetSubEntities);
    expect(SUB_ENTITY_DERIVERS.powerpoint).toBe(derivePptSubEntities);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/entities/subEntities.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/entities/subEntities.ts`**

```ts
import type { MockDoc, ProgramId, ElementCategory } from '../scenarios';
import { buildGridModel } from '../widgets/spreadsheetGrid';

/** A pointable sub-element a surface exposes, derived purely from its document state.
 *  The extension point for going wide: a new surface implements one of these. */
export interface SubEntitySpec {
  idSuffix: string;          // unique within the program, e.g. 'cell-A3', 'slide-2'
  title: string;             // registered name, e.g. 'Cell A3', 'Slide 2'
  aliases: string[];         // extra normalized names the model may echo (title added downstream)
  category: ElementCategory;
}
export type SubEntityDeriver = (doc: MockDoc) => SubEntitySpec[];

/** Every grid cell in the model's range is a pointable content entity. */
export const deriveSpreadsheetSubEntities: SubEntityDeriver = (doc) => {
  const model = buildGridModel(doc, null);
  const specs: SubEntitySpec[] = [];
  for (const row of model.cells) {
    for (const cell of row) {
      specs.push({ idSuffix: `cell-${cell.ref}`, title: `Cell ${cell.ref}`, aliases: [cell.ref.toLowerCase()], category: 'content' });
    }
  }
  return specs;
};

/** Every slide in the deck is a pointable content entity. */
export const derivePptSubEntities: SubEntityDeriver = (doc) => {
  if (doc.kind !== 'powerpoint') return [];
  return doc.slides.map((_, i) => {
    const n = i + 1;
    return { idSuffix: `slide-${n}`, title: `Slide ${n}`, aliases: [`slide ${n}`, ...(n === 2 ? ['second slide'] : n === 1 ? ['first slide'] : [])], category: 'content' as ElementCategory };
  });
};

const NONE: SubEntityDeriver = () => [];

export const SUB_ENTITY_DERIVERS: Partial<Record<ProgramId, SubEntityDeriver>> = {
  excel: deriveSpreadsheetSubEntities,
  powerpoint: derivePptSubEntities,
  word: NONE,
  photo: NONE,
};
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/entities/subEntities.test.ts` → PASS; then `npx tsc --noEmit && npx vitest run` → clean, 151 + new green.

- [ ] **Step 5: Commit**

```bash
git add src/entities/subEntities.ts src/entities/subEntities.test.ts
git commit -m "feat(entities): pure sub-entity derivers — cells + slides, the wide-going extension point (TDD)"
```

---

### Task 2: Resolver hardening + `sub?` field (TDD)

**Files:**
- Modify: `src/entities/registry.ts` (add `sub?` to SceneEntity; harden `resolveEchoedTarget`), `src/entities/registry.test.ts`

**Interfaces:**
- Produces: `SceneEntity.sub?: boolean`. `resolveEchoedTarget` unchanged signature but robust to dense near-identical alias sets: exact-alias match wins; word-boundary token matching so `a3` matches the `a3` alias but NOT `a13`; below-threshold → null preserved.

- [ ] **Step 1: Write the failing tests** — append to `src/entities/registry.test.ts`:

```ts
import { resolveEchoedTarget, type SceneEntity } from './registry';

const ent = (id: string, aliases: string[]): SceneEntity =>
  ({ id: id as any, title: id, url: '', category: 'content', aliases, bbox: [0,0,10,10], sub: true });

describe('resolveEchoedTarget — dense alias sets (C1)', () => {
  const cells = ['a1','a3','a13','b2'].map(r => ent(`excel-cell-${r.toUpperCase()}`, [r, `cell ${r}`]));
  it('exact echo resolves to the right cell', () => {
    expect(resolveEchoedTarget(cells, 'cell a3')!.entity.id).toBe('excel-cell-A3');
    expect(resolveEchoedTarget(cells, 'A3')!.entity.id).toBe('excel-cell-A3');
  });
  it('near neighbor does NOT cross-resolve (a3 must not match a13, nor a1)', () => {
    const r = resolveEchoedTarget(cells, 'a3');
    expect(r!.entity.id).toBe('excel-cell-A3');           // not A13, not A1
  });
  it('a13 resolves to A13, not A1 or A3', () => {
    expect(resolveEchoedTarget(cells, 'cell a13')!.entity.id).toBe('excel-cell-A13');
  });
  it('slides: "slide 2" does not resolve to "slide 12"', () => {
    const slides = [2,12].map(n => ent(`powerpoint-slide-${n}`, [`slide ${n}`]));
    expect(resolveEchoedTarget(slides, 'slide 2')!.entity.id).toBe('powerpoint-slide-2');
  });
  it('below-threshold gibberish still returns null (honesty floor)', () => {
    expect(resolveEchoedTarget(cells, 'xyzzy')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/entities/registry.test.ts` → FAIL (the bare-substring tier currently lets `a3` ⊂ `a13` cross-resolve, and `sub` isn't on the type).

- [ ] **Step 3: Implement** in `src/entities/registry.ts`

Add `sub?: boolean;` to the `SceneEntity` interface (after `bbox`).

Replace `resolveEchoedTarget`'s scoring loop so bare `includes` can't promote a shorter alias that is a token-substring of a longer one. Use whole-word/token-boundary matching for the containment tiers:

```ts
export function resolveEchoedTarget(
  entities: SceneEntity[], text?: string,
): { entity: SceneEntity; score: number } | null {
  if (!text) return null;
  const t = normText(text);
  if (!t) return null;
  const tTokens = t.split(' ');
  const tSet = new Set(tTokens);
  // A word-boundary "contains": every token of `needle` appears as a token of `hay`, in order-agnostic set terms.
  const tokenSubset = (needleTokens: string[], hayTokens: string[]) => {
    const haySet = new Set(hayTokens);
    return needleTokens.every(w => haySet.has(w));
  };
  let best: { entity: SceneEntity; score: number } | null = null;
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      const aTokens = alias.split(' ');
      let score = 0;
      if (t === alias) score = 1000;                                  // exact wins outright
      else if (tokenSubset(aTokens, tTokens)) score = 500 + alias.length; // echo contains the alias (word-boundary)
      else if (tokenSubset(tTokens, aTokens)) score = 100 + Math.round((t.length / alias.length) * 100); // alias contains the echo
      else {
        const overlap = aTokens.filter((w) => tSet.has(w)).length;
        score = overlap >= MIN_OVERLAP_TOKENS ? overlap : 0;          // honesty floor: ≥2 tokens
      }
      if (score > 0 && (!best || score > best.score)) best = { entity, score };
    }
  }
  return best;
}
```

(The key change: `t.includes(alias)` / `alias.includes(t)` become token-set subset checks, so `a3` is a token — it can never be "contained in" `a13` because `a13` is a different token. The exact-match tier still wins, and the ≥2-token honesty floor is unchanged.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/entities/registry.test.ts` → PASS; then `npx tsc --noEmit && npx vitest run` → clean, all green. (Confirm the pre-existing "Cell A3 must not resolve to Cell A1" anchor still passes.)

- [ ] **Step 5: Commit**

```bash
git add src/entities/registry.ts src/entities/registry.test.ts
git commit -m "feat(entities): SceneEntity.sub flag + word-boundary resolver — dense alias sets don't cross-resolve (TDD)"
```

---

### Task 3: String `data-entity-id` measurement + buildEntities merge

**Files:**
- Modify: `src/entities/registry.ts` (buildEntities signature + merge), `src/widgets/Spreadsheet.tsx`, `src/widgets/ProgramSurface.tsx`, `src/App.tsx` (updateLayout scan + 3 buildEntities call sites)

**Interfaces:**
- Produces: `buildEntities(program, doc, perceived, layout)` where `type Layout = { items: { id: string; bbox: LayoutBox }[] } | null` — builds top-level entities (`sub: false`) matched by string id, then merges `SUB_ENTITY_DERIVERS[program.id]?.(doc)` sub-entities (`sub: true`, id `${program.id}-${idSuffix}`, aliases include the normalized title, bbox matched by string id, missing → zero). `updateLayout` scans `[data-entity-id]` (string). Excel's top-level element 4 re-titled to "Spreadsheet grid".

- [ ] **Step 1: registry.ts — buildEntities merge**

Change `Layout` to `{ items: { id: string; bbox: LayoutBox }[] } | null`. Rewrite `buildEntities`:

```ts
import { SUB_ENTITY_DERIVERS } from './subEntities';
import type { MockDoc } from '../scenarios';

export function buildEntities(program: Program, doc: MockDoc, perceived: PerceivedCache, layout: Layout): SceneEntity[] {
  const bboxOf = (id: string) => toTuple(layout?.items.find((it) => it.id === id)?.bbox);
  const top: SceneEntity[] = program.images.map((img) => {
    const id = `${program.id}-${img.id}`;
    const p = perceived[img.url];
    const perceivedLabel = p && p.status === 'done' && p.label ? p.label : undefined;
    const aliases = [normText(img.title)];
    if (perceivedLabel) aliases.push(normText(perceivedLabel));
    return { id: asId(id), title: img.title, url: img.url, category: img.category, perceivedLabel, aliases, bbox: bboxOf(id), sub: false };
  });
  const subs: SceneEntity[] = (SUB_ENTITY_DERIVERS[program.id]?.(doc) ?? []).map((s) => {
    const id = `${program.id}-${s.idSuffix}`;
    const aliases = Array.from(new Set([normText(s.title), ...s.aliases.map(normText)]));
    return { id: asId(id), title: s.title, url: '', category: s.category, aliases, bbox: bboxOf(id), sub: true };
  });
  return [...top, ...subs];
}
```

- [ ] **Step 2: Spreadsheet.tsx — stamp cell entity ids**

Replace the numeric `elementIds` prop with a string entity-id function so cells carry `data-entity-id`. Props:

```tsx
type Props = {
  doc: MockDoc;
  selection?: string | null;
  /** Full entity id for a cell ref, e.g. (ref) => `excel-cell-${ref}`. Stamps data-entity-id. */
  entityIdFor?: (ref: string) => string;
  onCellClick?: (ref: string) => void;
};
```

On the `<td>`: `data-entity-id={entityIdFor?.(cell.ref)}` (replace the old `data-element-id={elementIds?.[cell.ref]}`). Keep `data-cell`, `onClick`.

- [ ] **Step 3: ProgramSurface.tsx — string ids on SurfaceElement + slides + cells**

- `SurfaceElement` (the wrapper stamping the measurement attr): change `data-element-id={img.id}` to `data-entity-id={`${programId}-${img.id}`}`. It needs `programId` — add a `programId: ProgramId` prop to `SurfaceElement` and pass `program.id` at every call site (all four surfaces already have `program` in scope). The `blocked`/`onElementClick(img.id)` JS paths stay numeric — unchanged.
- ExcelSurface: replace `<Spreadsheet doc={doc} elementIds={{ A1: 4 }} .../>` with `<Spreadsheet doc={doc} entityIdFor={(ref) => `${program.id}-cell-${ref}`} onCellClick={onCellClick} />` (drop the `elementIds` mapping; the grid container element 4 remains a SurfaceElement wrapping the Spreadsheet).
- ExcelSurface element 4's title: it comes from `program.images` (scenarios.ts). Re-title Excel image id 4 from "Cell A1" to "Spreadsheet grid" in `scenarios.ts` (the one content-word change), and update its alias expectations if any test asserts "Cell A1" as element 4 (grep).
- PptSurface filmstrip: each filmstrip slide `<div>` gets `data-entity-id={`${program.id}-slide-${i + 1}`}` (the map index). (The slide canvas element 4 stays the top-level content element.)

- [ ] **Step 4: App.tsx — string scan + call sites**

`updateLayout` (~694): the scan becomes string-keyed:

```ts
    const photoItems = Array.from(winEl.querySelectorAll<HTMLElement>('[data-entity-id]')).map((el: HTMLElement) => {
      const id = el.dataset.entityId;
      return id ? { id, bbox: toBBox(el.getBoundingClientRect()) } : null;
    }).filter(Boolean) as { id: string; bbox: BBox }[];
```

`layoutBounds.photoItems` type becomes `{ id: string; bbox: BBox }[]` (update the state type). Its only other consumer is the vision fallback labeled-boxes loop — update that to look the title up by string id (`program.images.find(...)` won't match sub ids; guard: for a `${program.id}-N` numeric-suffix id, find the image; else use the sub-entity title from `entitiesRef.current`). Keep it simple: label from `entityById(entitiesRef.current, id as EntityId)`'s `displayName`.

All three `buildEntities` call sites gain `doc` (use `mockDocRef.current`): line ~683 `buildEntities(program, mockDocRef.current, perceivedLabelsRef.current, { items: [] })`; line ~707 `buildEntities(program, mockDocRef.current, perceivedLabelsRef.current, { items: photoItems })`; line ~2414 `buildEntities(program, mockDocRef.current, perceivedLabelsRef.current, null)`.

`handleSurfaceElementClick` and `blockedElements` are UNCHANGED (numeric img.id in JS). Add a cell-click path: ExcelSurface's `onCellClick` prop flows from App — wire `onCellClick={(ref) => railDispatch(...)}`? NO — cell click grounding is out of C1 core; pass `onCellClick={undefined}` for now (cells are pointable via hover/deixis, which Task 4 enables; clicking a cell to ground it is a C2 nicety). Confirm the Spreadsheet renders cells with `data-entity-id` regardless of onCellClick.

- [ ] **Step 5: Verify**

`npx tsc --noEmit && npx vitest run` — clean; existing suite green (the demoScript/registry tests may need the `buildEntities` arity update — fix any call in tests to pass a doc: use `initialMockDoc(program.id)`).
Manual: `npm run dev`, Excel program — the grid cells now measure (check React devtools / that `entitiesRef` has 4 + 24 entities); no visual change to the surface.

- [ ] **Step 6: Commit**

```bash
git add src/entities/registry.ts src/widgets/Spreadsheet.tsx src/widgets/ProgramSurface.tsx src/App.tsx src/scenarios.ts
git commit -m "feat(entities): generic data-entity-id measurement + sub-entity merge — cells & slides join the scene"
```

---

### Task 4: Innermost-wins hit-test (+ nested-containment confidence fix)

**Files:**
- Modify: `src/App.tsx` (the hover hit-test ~2028; `computePointingConfidence` ~149-159)

**Interfaces:**
- Produces: hover resolution and confidence pick the **smallest-area** entity containing the cursor; nested containment (a cell inside its grid) is NOT treated as ambiguous overlap.

- [ ] **Step 1: Innermost hover hit-test** (~App.tsx:2028)

Replace the `find`-first containment with smallest-area-wins:

```ts
    const containing = entitiesRef.current.filter(e => {
      const [ymin, xmin, ymax, xmax] = e.bbox;
      return (ymax - ymin) > 0 && x >= xmin && x <= xmax && y >= ymin && y <= ymax;
    });
    const area = (e: SceneEntity) => (e.bbox[2] - e.bbox[0]) * (e.bbox[3] - e.bbox[1]);
    const found = containing.length ? containing.reduce((a, b) => (area(b) < area(a) ? b : a)) : undefined;
```

(so hovering a cell — inside both the cell bbox and the grid bbox — resolves to the smaller cell).

- [ ] **Step 2: Confidence — nesting is not ambiguity** (`computePointingConfidence` ~149)

The current `containing.length > 1 → low confidence` fires on every nested sub-element. Make it count only genuine sibling overlaps (entities that contain the cursor but are NOT strict supersets of the chosen innermost):

```ts
  // innermost (smallest-area) containing entity is the target; its containers are not competitors.
  const containing = entities.filter(o => {
    const [ymin, xmin, ymax, xmax] = o.bbox;
    return hX >= xmin && hX <= xmax && hY >= ymin && hY <= ymax;
  });
  const areaOf = (o: SceneEntity) => (o.bbox[2]-o.bbox[0]) * (o.bbox[3]-o.bbox[1]);
  const inner = containing.reduce((a, b) => (areaOf(b) < areaOf(a) ? b : a), found);
  const strictlyContains = (outer: SceneEntity, x: SceneEntity) =>
    outer.bbox[0] <= x.bbox[0] && outer.bbox[1] <= x.bbox[1] && outer.bbox[2] >= x.bbox[2] && outer.bbox[3] >= x.bbox[3] && outer.id !== x.id;
  const competitors = containing.filter(o => o.id !== inner.id && !strictlyContains(o, inner));
  if (competitors.length > 0) {
    return { level: 'low', candidates: [inner.id, ...competitors.map(o => o.id)], reason: `cursor inside ${competitors.length + 1} overlapping regions` };
  }
```

(Nesting resolves to the innermost cleanly; only true sibling overlaps still read low.)

- [ ] **Step 3: Verify**

`npx tsc --noEmit && npx vitest run` — clean/green.
Manual (Excel): hover a spreadsheet cell → the feedforward pill reads "Cell A3" (the innermost), not "Spreadsheet grid"; hovering grid padding (no cell) reads "Spreadsheet grid"; confidence stays high on a clean cell (not "overlapping regions").

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(pointer): innermost-wins hit-test — hovering a cell resolves to the cell; nesting isn't ambiguity"
```

---

### Task 5: Final verification + downstream sweep

- [ ] **Step 1: Downstream integrity**

Confirm the entity-count growth didn't break consumers:
- `selectTargetByNumber` (keys 1-9) still addresses only top-level (it reads `program.images[n-1]`) — grep confirms it doesn't iterate the full entity set for numbering.
- Teaching demo scripts + soft-block scrim reference top-level ids (`word-1`, `excel-2`, …) — `?teach=1` still advances (manual).
- Grounding chips / rail band inheritance resolve against the fuller set unchanged.
Run: `grep -n "selectTargetByNumber\|blockedElements\|program.images\[" src/App.tsx` and confirm number-selection is top-level-only.

- [ ] **Step 2: Full verification**

`npx vitest run` (all green), `npx tsc --noEmit` (clean), `npx vite build` (clean; pre-existing chunk warning).

- [ ] **Step 3: Manual acceptance** (`npm run dev`, needs no key)
- [ ] Excel: hover cell A3 → pill "Cell A3"; hover B2 → "Cell B2"; the grid padding → "Spreadsheet grid"; no visual change to the surface.
- [ ] PowerPoint: hover a filmstrip slide → "Slide 2"; add a slide (New Slide) → the new slide is hoverable as "Slide N".
- [ ] `?teach=1` still runs and advances on the four top-level elements.
- [ ] Word/Photo: unchanged (no sub-elements).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(entities): C1 entity granularity verified — cells & slides pointable, downstream intact"
```

---

## Self-Review Notes (already applied)

- Spec coverage: §1 extension-point principle → Task 1's general contract + registry; §2 deriver contract → Task 1; §3 identity + `sub?` → Tasks 2/3; §4 generic measurement → Task 3; §5 innermost-wins → Task 4; §6 resolver hardening → Task 2; §7 downstream → Task 5 (and the plan's Global Constraint keeping click/soft-block numeric); §8 out-of-scope honored (no words, no perception, no goal model, Word/Photo derivers empty); §9 testing → each task's TDD + Task 5 manual.
- The critical realization (in Task 4): `computePointingConfidence`'s `containing.length > 1 → low` assumption breaks under nesting — a cell is always inside its grid — so it must exclude strict-superset containers, else every sub-element point reads as low-confidence "overlapping regions." This is the load-bearing integration fix and is called out explicitly.
- Decision A honored as ONE contract: the measurement attribute changes numeric→string everywhere at once (Task 3), with the click/soft-block JS paths deliberately left on numeric `img.id` (they never read the DOM attribute), bounding the blast radius.
- Type consistency: `SubEntitySpec`/`SubEntityDeriver` (Task 1) consumed by `buildEntities` (Task 3); `SceneEntity.sub` (Task 2) consumed by Task 5's filtering reasoning; `Layout.items.id` is `string` from Task 3 onward and the App scan + all three call sites are updated in the same task to keep tsc green.
- buildEntities arity change (adds `doc`) ripples to test call sites — Task 3 Step 5 explicitly fixes them with `initialMockDoc(program.id)`.
