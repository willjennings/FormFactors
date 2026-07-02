# Stable Entity Identity (R2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rekey the scene's identity layer onto stable, compiler-enforced `EntityId`s — titles and perceived labels become presentation data; the model's echoed targets resolve through an alias-aware, thresholded resolver; the G5 grounding telemetry comes back to life with honest semantics.

**Architecture:** A pure `src/entities/registry.ts` owns the `SceneEntity` model, `buildEntities`, and `resolveEchoedTarget` (matchElement's scoring generalized over aliases, with a ≥2-token overlap floor). `EntityId` is a **branded string type**, so the App.tsx rekey is compiler-driven: re-type the refs, and `tsc --noEmit` enumerates every site that still passes a raw title. Five slices, each landing green: (1) registry+resolver, (2) referents module (additive), (3) scene source + hover/presentation, (4) the deixis engine (keyword handler, markers, confidence, number-select, repair), (5) G5 + matchElement deletion + final sweep.

**Tech Stack:** TypeScript, React 19, vitest; no new dependencies.

## Global Constraints

- Branch: `honest-mode`. Verify `git branch --show-current` before each commit.
- **Boundary rule (from the spec):** decisions (hit-testing, grounding, agreement, candidate swaps, anaphora) operate on ids/aliases; presentation (badge, hints, prompt list, telemetry strings, mismatch notes) renders via `displayName`. OCR keeps indexing by title; `applyAction` still receives raw model text.
- **Ground-truth exception:** `telemetry.deixis(resolved, target, …)` compares against `focusTitleRef` (scenario target TITLES) — pass `entity.title` as `resolved`, never `displayName`, or accuracy grading breaks when perception is active.
- Resolver honesty: bare token overlap needs ≥ 2 tokens; below every tier → `null`. `resolution:'visual'` means the resolver resolved; `'none'` means it declined.
- Fail-soft: empty registry / unknown id / resolver null must never throw — fall back to raw strings / "Nothing (Empty Space)" behavior.
- Each task ends with `npm run lint && npm run build && npm test` all green (the suite is 51 tests before this plan).
- No telemetry schema changes. No new dependencies.

**Plan refinements vs the spec (called out, not silent):** (a) `EntityId` is branded (`string & { __brand: 'EntityId' }`) — plain string ids would give tsc no leverage over a string-typed monolith; (b) `referents.ts` change is additive (`Referent.id?` + a `note` id param) because `resolveAnaphora` has zero callers today — its signature stays; (c) `CONFUSABLE_PAIRS` stays title-keyed as the seeded table's data format (its retirement is F2, not R2) — `computePointingConfidence` maps via `entity.title` internally and returns candidate **ids**.

---

## File Structure

- Create `src/entities/registry.ts` + `src/entities/registry.test.ts` — the model, `buildEntities`, lookups, `displayName`, `resolveEchoedTarget`.
- Modify `src/referents.ts` + create `src/referents.test.ts` — additive `id` support (ports the commented self-checks while there).
- Modify `src/App.tsx` — the rekey (Tasks 3–5).
- Modify `src/scenarios.ts` — delete `matchElement` (Task 5).

---

### Task 1: Registry + resolver (pure)

**Files:**
- Create: `src/entities/registry.ts`, `src/entities/registry.test.ts`

**Interfaces:**
- Consumes: `Program`, `ElementCategory` from `../scenarios`; `PerceivedCache` from `../perception/perceiveTile`.
- Produces (later tasks import these exactly):
  - `type EntityId = string & { __brand: 'EntityId' }`
  - `const MAP_ENTITY_ID: EntityId`
  - `interface SceneEntity { id: EntityId; title: string; url: string; category: ElementCategory | 'map'; perceivedLabel?: string; aliases: string[]; bbox: [number, number, number, number] }`
  - `buildEntities(program: Program, perceived: PerceivedCache, layout: { items: { id: number; bbox: { ymin:number; xmin:number; ymax:number; xmax:number } }[]; map: { ymin:number; xmin:number; ymax:number; xmax:number } } | null): SceneEntity[]`
  - `entityById(entities: SceneEntity[], id: EntityId | null | undefined): SceneEntity | undefined`
  - `entityByTitle(entities: SceneEntity[], title: string | null | undefined): SceneEntity | undefined`
  - `displayName(e: SceneEntity | undefined): string` (`''` for undefined)
  - `resolveEchoedTarget(entities: SceneEntity[], text?: string): { entity: SceneEntity; score: number } | null`

- [ ] **Step 1: Write the failing test**

Create `src/entities/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  buildEntities, entityById, entityByTitle, displayName, resolveEchoedTarget, MAP_ENTITY_ID,
} from './registry';
import { getProgram } from '../scenarios';
import type { PerceivedCache } from '../perception/perceiveTile';

const excel = getProgram('excel');
const box = (n: number) => ({ ymin: n, xmin: n, ymax: n + 100, xmax: n + 100 });
const layout = {
  items: excel.images.map((img, i) => ({ id: img.id, bbox: box(i * 10) })),
  map: box(500),
};
const perceived: PerceivedCache = {
  [excel.images[3].url]: { status: 'done', label: 'grid of numbers' }, // 'Cell A1' tile
};

describe('buildEntities', () => {
  it('builds one entity per image plus the map, ids stable and prefixed', () => {
    const es = buildEntities(excel, {}, layout);
    expect(es).toHaveLength(excel.images.length + 1);
    expect(es[0].id).toBe(`excel-${excel.images[0].id}`);
    expect(es[es.length - 1].id).toBe(MAP_ENTITY_ID);
    expect(es[es.length - 1].category).toBe('map');
  });
  it('merges perceived labels into aliases and displayName', () => {
    const es = buildEntities(excel, perceived, layout);
    const cell = entityByTitle(es, 'Cell A1')!;
    expect(cell.perceivedLabel).toBe('grid of numbers');
    expect(displayName(cell)).toBe('grid of numbers');
    expect(cell.aliases).toContain('cell a1');
    expect(cell.aliases).toContain('grid of numbers');
  });
  it('without layout returns entities with zero bboxes (not empty)', () => {
    const es = buildEntities(excel, {}, null);
    expect(es).toHaveLength(excel.images.length + 1);
    expect(es[0].bbox).toEqual([0, 0, 0, 0]);
  });
  it('displayName falls back to title without perception; undefined → empty string', () => {
    const es = buildEntities(excel, {}, layout);
    expect(displayName(entityByTitle(es, 'SUM function'))).toBe('SUM function');
    expect(displayName(undefined)).toBe('');
    expect(entityById(es, undefined)).toBeUndefined();
  });
});

describe('resolveEchoedTarget', () => {
  const es = buildEntities(excel, perceived, layout);
  it('resolves exact and containment matches on titles', () => {
    expect(resolveEchoedTarget(es, 'Cell A1')!.entity.title).toBe('Cell A1');
    expect(resolveEchoedTarget(es, 'the SUM function please')!.entity.title).toBe('SUM function');
  });
  it('resolves via perceived-label aliases (the G5 fix)', () => {
    expect(resolveEchoedTarget(es, 'grid of numbers')!.entity.title).toBe('Cell A1');
  });
  it('REGRESSION (session 2026-07-02): "Cell A3" must NOT fuzzy-match the Cell A1 tile', () => {
    expect(resolveEchoedTarget(es, 'Cell A3')).toBeNull();
  });
  it('bare token overlap needs ≥2 tokens', () => {
    // 'AVERAGE function' vs 'the average of the function' → tokens {average, function} = 2 → resolves
    expect(resolveEchoedTarget(es, 'the average of the function')!.entity.title).toBe('AVERAGE function');
  });
  it('returns null for empty/unknown', () => {
    expect(resolveEchoedTarget(es, '')).toBeNull();
    expect(resolveEchoedTarget(es, 'the weather in Paris')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/entities/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 3: Write the module**

Create `src/entities/registry.ts`:
```ts
// Stable identity for everything pointable in the scene (R2).
// Decisions run on EntityIds and aliases; titles/perceived labels are presentation data.

import type { Program, ElementCategory } from '../scenarios';
import type { PerceivedCache } from '../perception/perceiveTile';

/** Branded so tsc flags any raw title string flowing into an id slot during the rekey. */
export type EntityId = string & { __brand: 'EntityId' };
const asId = (s: string): EntityId => s as EntityId;

export const MAP_ENTITY_ID: EntityId = asId('map');

export interface SceneEntity {
  id: EntityId;
  title: string;                              // registered name — data, not a reasoning key
  url: string;                                // '' for the map
  category: ElementCategory | 'map';
  perceivedLabel?: string;
  aliases: string[];                          // normalized names the model may use
  bbox: [number, number, number, number];     // ymin,xmin,ymax,xmax (0-1000)
}

const normText = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

type LayoutBox = { ymin: number; xmin: number; ymax: number; xmax: number };
type Layout = { items: { id: number; bbox: LayoutBox }[]; map: LayoutBox } | null;

const toTuple = (b: LayoutBox | undefined): [number, number, number, number] =>
  b ? [b.ymin, b.xmin, b.ymax, b.xmax] : [0, 0, 0, 0];

/** Single source for the scene: one entity per program image + the map. Pure & derived. */
export function buildEntities(program: Program, perceived: PerceivedCache, layout: Layout): SceneEntity[] {
  const tiles: SceneEntity[] = program.images.map((img) => {
    const p = perceived[img.url];
    const perceivedLabel = p && p.status === 'done' && p.label ? p.label : undefined;
    const aliases = [normText(img.title)];
    if (perceivedLabel) aliases.push(normText(perceivedLabel));
    return {
      id: asId(`${program.id}-${img.id}`),
      title: img.title,
      url: img.url,
      category: img.category,
      perceivedLabel,
      aliases,
      bbox: toTuple(layout?.items.find((it) => it.id === img.id)?.bbox),
    };
  });
  const map: SceneEntity = {
    id: MAP_ENTITY_ID, title: 'Google Maps', url: '', category: 'map',
    aliases: [normText('Google Maps'), 'map', 'the map'],
    bbox: toTuple(layout?.map),
  };
  return [...tiles, map];
}

export function entityById(entities: SceneEntity[], id: EntityId | null | undefined): SceneEntity | undefined {
  return id ? entities.find((e) => e.id === id) : undefined;
}

/** Edge adapter for text-domain subsystems (OCR, scenario focus titles). */
export function entityByTitle(entities: SceneEntity[], title: string | null | undefined): SceneEntity | undefined {
  return title ? entities.find((e) => e.title === title) : undefined;
}

/** What humans and the model see: the perceived name when we have one, else the registered title. */
export function displayName(e: SceneEntity | undefined): string {
  return e ? (e.perceivedLabel ?? e.title) : '';
}

const MIN_OVERLAP_TOKENS = 2;

/**
 * Resolve the model's echoed target against every alias of every entity.
 * matchElement's containment tiers, generalized — plus an honesty floor:
 * bare token overlap needs ≥2 tokens, else null ("below my resolution").
 * Regression anchor: "Cell A3" must NOT resolve to the "Cell A1" tile.
 */
export function resolveEchoedTarget(
  entities: SceneEntity[], text?: string,
): { entity: SceneEntity; score: number } | null {
  if (!text) return null;
  const t = normText(text);
  if (!t) return null;
  const tokens = new Set(t.split(' '));
  let best: { entity: SceneEntity; score: number } | null = null;
  for (const entity of entities) {
    for (const alias of entity.aliases) {
      let score = 0;
      if (t === alias) score = 1000;
      else if (t.includes(alias)) score = 500 + alias.length;
      else if (alias.includes(t)) score = 100 + Math.round((t.length / alias.length) * 100);
      else {
        const overlap = alias.split(' ').filter((w) => tokens.has(w)).length;
        score = overlap >= MIN_OVERLAP_TOKENS ? overlap : 0;
      }
      if (score > 0 && (!best || score > best.score)) best = { entity, score };
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/entities/registry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/entities/registry.ts src/entities/registry.test.ts
git commit -m "feat(entities): stable branded EntityIds + alias-aware thresholded echo resolver"
```

---

### Task 2: Referents carry optional entity ids (additive)

**Files:**
- Modify: `src/referents.ts`
- Create: `src/referents.test.ts`

**Interfaces:**
- Consumes: `EntityId` type shape (imported as `import type { EntityId } from './entities/registry'`).
- Produces: `Referent` gains `id?: EntityId | null`; `note(name: string, kind: ReferentKind, id?: EntityId | null)` stores it (dedupe refreshes it). `resolveAnaphora`/`promptContext`/`recent` signatures unchanged (`resolveAnaphora` has no callers today; `name` remains the display string).

- [ ] **Step 1: Write the failing test** (also ports the file's commented self-checks)

Create `src/referents.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ReferentRegistry } from './referents';
import type { EntityId } from './entities/registry';

const id = (s: string) => s as EntityId;

describe('ReferentRegistry', () => {
  let r: ReferentRegistry;
  beforeEach(() => { r = new ReferentRegistry(); });

  it('stores and refreshes the optional entity id', () => {
    r.note('Save button', 'pointed', id('word-2'));
    expect(r.recent()[0]).toMatchObject({ name: 'Save button', kind: 'pointed', id: 'word-2' });
    r.note('Save button', 'pointed', id('word-2')); // dedupe path refreshes
    expect(r.recent()).toHaveLength(1);
    expect(r.recent()[0].id).toBe('word-2');
  });

  it('id is optional — word/doc referents without entities still work', () => {
    r.note('"beam"', 'pointed');
    r.note('Chart', 'created');
    expect(r.recent().map(x => x.id ?? null)).toEqual([null, null]);
  });

  it('resolveAnaphora still returns names (ported self-checks)', () => {
    r.note('Save button', 'pointed', id('word-2'));
    r.note('Chart', 'created');
    expect(r.resolveAnaphora('make that bold')).toBe('Save button');
    expect(r.resolveAnaphora('send the chart I just made')).toBe('Chart');
    expect(r.resolveAnaphora('what time is it')).toBeNull(); // question guard
    expect(r.resolveAnaphora('open the spreadsheet')).toBeNull();
  });

  it('promptContext renders names', () => {
    r.note('Chart', 'created');
    expect(r.promptContext()).toContain('Chart (created');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/referents.test.ts`
Expected: FAIL — `note` rejects a 3rd argument / `id` undefined on the type.

- [ ] **Step 3: Implement (additive)**

In `src/referents.ts`:
- Add at the top: `import type { EntityId } from './entities/registry';`
- Extend the type (line ~22):
```ts
export type Referent = {
  /** The display name, e.g. "Save button" or a perceived label. */
  name: string;
  /** Stable entity id when the referent IS a scene entity (quoted OCR words and created doc-objects have none). */
  id?: EntityId | null;
  kind: ReferentKind;
  t: number;
};
```
- Extend `note` (line ~81):
```ts
  note(name: string, kind: ReferentKind, id: EntityId | null = null): void {
```
  and in the dedupe branch add `existing.id = id ?? existing.id;` after `existing.name = trimmed;`, and change the push to `this.items.push({ name: trimmed, id, kind, t });`

- [ ] **Step 4: Run tests + full suite**

Run: `npm test && npm run lint`
Expected: new tests PASS; suite green (existing 2-arg `note` calls compile via the default).

- [ ] **Step 5: Commit**

```bash
git add src/referents.ts src/referents.test.ts
git commit -m "feat(referents): optional entity ids on referents (additive) + port self-checks to vitest"
```

---

### Task 3: Scene source + hover + presentation rekey

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything from Task 1 (`SceneEntity`, `EntityId`, `MAP_ENTITY_ID`, `buildEntities`, `entityById`, `entityByTitle`, `displayName`).
- Produces (Tasks 4–5 rely on): `entitiesRef: React.RefObject<SceneEntity[]>` (replaces `interactiveObjectsRef` semantics), `hoveredIdRef/hoveredId` holding `EntityId | null`, `categoryOf(id?: EntityId)` — plus all presentation sites reading `displayName`.

This task is **compiler-driven**: Steps 1–2 change the types and the source; `npm run lint` then enumerates every site still passing a title where an id now flows. Fix each per the Rules table (Step 4). Verified by lint+build+suite (no new unit test — App wiring).

- [ ] **Step 1: Imports + the scene source swap**

In `src/App.tsx` add to the imports (after the perception imports):
```tsx
import { buildEntities, entityById, entityByTitle, displayName, MAP_ENTITY_ID } from './entities/registry';
import type { SceneEntity, EntityId } from './entities/registry';
```
Replace `INTERACTIVE_OBJECTS_BASE` (L306-309) and the `interactiveObjects` state pair (L323-324) with entity equivalents:
```tsx
  const [entities, setEntities] = useState<SceneEntity[]>([]);
  const entitiesRef = useRef<SceneEntity[]>([]);
```
In the layout effect (L701-720), replace the `newInteractiveObjects` assembly + `setInteractiveObjects`/`interactiveObjectsRef.current` assignments with:
```tsx
        const es = buildEntities(program, perceivedLabelsRef.current, {
          items: photoItems.map(it => ({ id: it.id, bbox: it.bbox })),
          map: toBBox(mRect),
        });
        setEntities(es);
        entitiesRef.current = es;
```
and rebuild the layout hint from entities (model-facing → displayName):
```tsx
          const layoutInfo = es.map(e => `${displayName(e)}: [${e.bbox.map(Math.round).join(', ')}]`).join('\n');
```
Add `perceivedVersion` to that effect's dependency array so entities rebuild when perception lands. Delete the now-unused `InteractiveObject` import if tsc flags it.

- [ ] **Step 2: Re-type hover + category**

- `hoveredObjectRef`/`hoveredObject` (L402-403 region): re-type to `EntityId | null`; rename to `hoveredIdRef`/`hoveredId` (rename makes every stale consumer a compile error rather than a silently-wrong string compare).
- `categoryMapRef` effect (L311-317): key by id — build from entities instead:
```tsx
  React.useEffect(() => {
    const m: Record<string, ElementCategory> = {};
    for (const e of entitiesRef.current) if (e.category !== 'map') m[e.id] = e.category as ElementCategory;
    categoryMapRef.current = m;
  }, [entities]);
  const categoryOf = (id?: EntityId | null): ElementCategory =>
    (id && categoryMapRef.current[id]) || DEFAULT_CATEGORY;
```
- The pointer-move hover block (L2495-2545): hit-test over `entitiesRef.current` (`found` is a `SceneEntity`); `const hovered = found ? found.id : null;` — map checks become `found.category === 'map'` / `hovered !== MAP_ENTITY_ID`; the proactive context hint renders via `displayName(found)` (delete the `resolveTileName` + `PHOTOS.find` chain here); `cursorHistoryRef` entries store the id.

- [ ] **Step 3: Presentation sites**

- Badge (L3127-3131 region): `hoveredId && hoveredId !== MAP_ENTITY_ID`; render `displayName(entityById(entitiesRef.current, hoveredId))` (replaces the R1 `resolveTileName(...)` chains).
- ON-SCREEN ELEMENTS list in `buildInstructions` (L1453): entities are not in scope inside the plain function — pass them: change the signature to `buildInstructions(honest: boolean, program: Program, entities: SceneEntity[])`, update the one caller (`L2110` region: `buildInstructions(honest, program, entitiesRef.current)`), and render:
```tsx
${entities.length
  ? entities.filter(e => e.category !== 'map').map(e => `- ${displayName(e)}`).join('\n')
  : program.images.map(img => `- ${img.title}`).join('\n')}
```
  (fallback keeps pre-layout sessions on titles; `displayName` must be imported where `buildInstructions` lives — it is module-scope in App.tsx, so the existing top-level import covers it).
- Map ring highlight (L3234): `hoveredId === MAP_ENTITY_ID`.

- [ ] **Step 4: Compiler-driven sweep — the Rules table**

Run `npm run lint`. Fix every remaining error by these rules (each is a complete transform; apply at every hit):
| # | Error site pattern | Transform |
|---|---|---|
| R1 | `o.name === 'Google Maps'` / `!== 'Google Maps'` on an entity or hovered value | `o.category === 'map'` / `hoveredId !== MAP_ENTITY_ID` |
| R2 | `.name` read on a former InteractiveObject for DISPLAY (logs, hints, labels) | `displayName(e)` |
| R3 | `.name` read for IDENTITY (compares, Set adds, telemetry `resolved`) | `e.id` — except `telemetry.deixis` resolved arg = `e.title` (ground-truth rule) |
| R4 | `interactiveObjectsRef` reference | `entitiesRef` |
| R5 | `hoveredObjectRef`/`hoveredObject` reference | `hoveredIdRef`/`hoveredId`; if the value reaches a string render, wrap `displayName(entityById(entitiesRef.current, …))` |
| R6 | `categoryOf(<title string>)` | `categoryOf(<EntityId>)` (the value at hand is an id after R3/R5) |
| R7 | `PHOTOS.find(p => p.title === X)?.url` + `resolveTileName(...)` chains | `displayName(entityById/entityByTitle(...))` as appropriate |

NOTE: Task 4's regions (keyword handler L1885-1975, markers, `computePointingConfidence`, `selectTargetByNumber`, repair-other) will ALSO surface in this sweep — apply the same rules there as needed to reach green; Task 4 then completes those regions' semantic rekey (confidence candidates, referent ids, marker typing). Greenness may not be perfectly separable between 3 and 4 in a monolith; the commit boundary is "Task 3 = types compile + presentation correct", "Task 4 = deixis engine semantics".

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run build && npm test`
Expected: all green (51 + 13 new = 64 tests).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(identity): scene source + hover + presentation on branded EntityIds"
```

---

### Task 4: The deixis engine on ids

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 3's `entitiesRef`, `hoveredIdRef`, `categoryOf(id)`; Task 2's `referents.note(name, kind, id)`.
- Produces: `Marker.identifiedObject?: EntityId`, `Marker.candidates?: EntityId[]`; `computePointingConfidence` takes/returns entities+ids.

- [ ] **Step 1: Marker + confidence types**

- `interface Marker` (L80 region): `identifiedObject?: EntityId;` and `candidates?: EntityId[];`
- `computePointingConfidence` (L124-171): signature becomes
```tsx
function computePointingConfidence(
  found: SceneEntity, hX: number, hY: number, entities: SceneEntity[],
  confusablePairs: Record<string, string[]>,
): { level: 'high' | 'low'; candidates: EntityId[]; reason: string }
```
  Internals: the seeded-confusable lookup keys by `found.title` (the table's format) and maps the confusable TITLES to ids via `entityByTitle(entities, t)?.id` (filtering undefined); the overlap/edge branches use `e.category !== 'map'` instead of the name check and push `e.id` into candidates.

- [ ] **Step 2: Keyword handler (L1885-1975 region)**

`foundObject` is now a `SceneEntity` (hit-test over `entitiesRef.current`). Apply:
- `lastM.identifiedObject = foundObject.id;` and `addLog('info', \`Identified: ${displayName(foundObject)}\`)`
- confidence call passes entities; `otherCandidates` are ids — render them in logs/hints via `displayName(entityById(entitiesRef.current, c))`
- `markerForConfidence.category = categoryOf(foundObject.id);`
- `telemetry.deixis(kw, foundObject.title, focusTitleRef.current ?? null, confidence.level, lastInputModalityRef.current);` ← **title, ground-truth rule**
- referents: `if (foundObject.category !== 'map') referents.note(displayName(foundObject), 'pointed', foundObject.id);`
- landmarks set: `identifiedLandmarksRef.current.add(displayName(foundObject));` gated on `category !== 'map'`
- deixis hint: `[USER JUST SAID … POINTING AT: ${displayName(foundObject)}…]` (delete the R1 `perceivedName`/`resolveTileName` line — displayName subsumes it); the OCR `subTag` compare becomes `sub.photoTitle === foundObject.title` (OCR is title-domain).
- The last-keyword fallback (L1814): `hoveredIdRef.current && hoveredIdRef.current !== MAP_ENTITY_ID`, then `foundObject = entityById(entitiesRef.current, hoveredIdRef.current) ?? null`.
- The history-walk hover check (L1791): entries hold ids — `entry.hovered && entry.hovered !== MAP_ENTITY_ID`.

- [ ] **Step 3: selectTargetByNumber (L1660-1676) + repair-other (L1705-1713)**

`selectTargetByNumber`:
```tsx
    const entity = entitiesRef.current.find(e => e.title === img.title); // scenario index → entity
    if (!entity) return;
    const [ymin, xmin, ymax, xmax] = entity.bbox;
    // … cursor math unchanged …
    hoveredIdRef.current = entity.id;
    setHoveredId(entity.id);
    cursorHistoryRef.current.push({ x: cx, y: cy, t: Date.now(), hovered: entity.id });
    addMarker('THIS', cx, cy);
    referents.note(displayName(entity), 'pointed', entity.id);
    telemetry.deixis('number', entity.title, focusTitleRef.current ?? null, 'high', 'direct');
    addLog('event', `Selected target ${n}: ${displayName(entity)}`);
    providerRef.current?.sendTextHint(`[USER SELECTED target ${n}: ${displayName(entity)} (numbered selection). Treat this as what they are pointing at.]`);
```
`repair-other`: `alt` is an `EntityId`; the hint + referent render display:
```tsx
      const altEntity = entityById(entitiesRef.current, alt);
      if (alt && altEntity && providerRef.current) {
        if (m) m.identifiedObject = alt;
        referents.note(displayName(altEntity), 'pointed', alt);
        providerRef.current.sendTextHint(`[SYSTEM: the user meant the OTHER one — they are pointing at "${displayName(altEntity)}", not your previous guess. Use ${displayName(altEntity)} now.]`);
      }
```
Canvas fallbacks `categoryOf(m.identifiedObject)` (L2294) now receive ids — already correct post-Task 3. The map-pointing sites (L1010 `topObject?.category === 'map'`, L2554-2563, L2603) follow rules R1/R3.

- [ ] **Step 4: Gates + commit**

Run: `npm run lint && npm run build && npm test` — all green.
```bash
git add src/App.tsx
git commit -m "refactor(identity): deixis engine — markers, confidence, number-select, repair on ids"
```

---

### Task 5: G5 through the resolver + retire matchElement + smoke

**Files:**
- Modify: `src/App.tsx`, `src/scenarios.ts`

**Interfaces:**
- Consumes: `resolveEchoedTarget`, `entityById`, `displayName` (Task 1); Task 3-4 state.

- [ ] **Step 1: Replace the G5 block (L1618-1626 region)**

```tsx
      // G5 GROUNDING RECONCILIATION on stable ids: the app's pointer referent vs the model's
      // echoed target resolved across ALL aliases (title + perceived). Below the resolver's
      // threshold → honest null (no phantom match, no spurious witness). See the 2026-07-02
      // session regression: "Cell A3" must not bind to the Cell A1 tile.
      const appReferentId = markersRef.current[0]?.identifiedObject ?? hoveredIdRef.current ?? null;
      const appReferentEntity = entityById(entitiesRef.current, appReferentId);
      const resolved = resolveEchoedTarget(entitiesRef.current, args.target);
      const agree = (appReferentId && resolved) ? appReferentId === resolved.entity.id : null;
      const resolution: 'structural' | 'visual' | 'none' =
        appReferentId ? 'structural' : (resolved ? 'visual' : 'none');
      telemetry.grounding(displayName(appReferentEntity) || null, args.target ?? null, agree, resolution);
      const disagreement = honestModeRef.current && agree === false && !confirmed;
      const effectiveDecision: 'commit' | 'witness' = disagreement ? 'witness' : decision;
      const note = disagreement
        ? `You pointed at “${displayName(appReferentEntity)}”, but I read “${displayName(resolved!.entity)}”.`
        : undefined;
```
Downstream in the same block: the witness `emitFeedback` label uses the same two displayNames; `sendToolResponse` fields `app_referent: displayName(appReferentEntity) || null, model_target: resolved ? displayName(resolved.entity) : null`; the created-referent naming becomes:
```tsx
          const createdName = nextDoc.kind === 'excel' ? 'Chart'
            : nextDoc.kind === 'powerpoint' ? (nextDoc.slides[nextDoc.slides.length - 1] ?? 'Slide')
            : (resolved ? displayName(resolved.entity) : target);
          referents.note(createdName, 'created');
```

- [ ] **Step 2: Retire matchElement**

Remove `matchElement` from the `src/App.tsx` import list (L53) and delete the function from `src/scenarios.ts` (L524-543). `npm run lint` confirms no other consumer.

- [ ] **Step 3: Final literal sweep**

Run: `grep -n "'Google Maps'\|\"Google Maps\"" src/App.tsx` — remaining hits must be only (a) the map entity's own construction is in `registry.ts` (not App), (b) the `buildInstructions` prose line (L1472, user-facing instruction text — update it to say `the map`), (c) none identity-bearing. Any identity compare left → apply rule R1.

- [ ] **Step 4: Gates**

Run: `npm run lint && npm run build && npm test` — all green (64 tests).

- [ ] **Step 5: Manual smoke (record evidence — needs GEMINI_API_KEY)**

Repeat the motivating session: excel program, live voice, say "put 100 in cell A3" **without pointing** → export JSON → the grounding event must read `resolution: "none"` (not "visual"), `agree: null`, no mismatch note. Then in honest mode with perception warm: point at a tile and command with a perceived-name echo → `agree: true`, `agreementRate` non-null; deliberately point at one tile and name another → the mismatch note shows two **perceived** names. Repair "no, the other one" still swaps. `?ramble=1` still mounts (untouched).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/scenarios.ts
git commit -m "feat(identity): G5 reconciliation on ids via thresholded resolver; retire matchElement"
```

---

## Self-Review notes

- **Spec coverage:** §2 model/registry (T1); §3 resolver + threshold + matchElement deletion (T1/T5); §4 rekey table — interactiveObjects→entities (T3), hover (T3), markers+confidence (T4), referents (T2/T4), map literals (T3-5), G5+created-referent (T5); §5 corrected semantics + displayName mismatch notes (T5); §6 staging (tasks=slices; T3/T4 boundary caveat stated explicitly in T3 Step 4's NOTE); §7 fail-soft (registry/lookups return undefined/[]; resolver null); §8 tests incl. the Cell-A3 regression (T1) + smoke (T5).
- **Refinements vs spec are declared** in Global Constraints (branded id; additive referents; confusable table stays title-keyed as data).
- **Ground-truth rule** (deixis telemetry compares titles) is stated in Global Constraints and applied at both `telemetry.deixis` sites (T4).
- **Type consistency:** `EntityId`/`SceneEntity`/`MAP_ENTITY_ID`/`buildEntities`/`entityById`/`entityByTitle`/`displayName`/`resolveEchoedTarget` names identical across tasks; `hoveredIdRef`/`setHoveredId`/`entitiesRef` introduced in T3 and used in T4/T5.
- **Honest caveat:** T3/T4 greenness in the monolith isn't perfectly separable; the plan states the commit boundary rather than pretending otherwise.
```
