# Stable Entity Identity (R2) — Design Spec

*Full id rekey of the scene's identity layer: every pointable thing gets a stable `EntityId`;
titles and perceived labels become presentation data; the model's echoed targets resolve through an
alias-aware, thresholded resolver. Subsumes the booked G5 perceived-name fix. R2 of the
architecture review (`2026-07-01-virtual-desktop-architecture-review.md`).*

Date: 2026-07-02
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **full rekey, delivered in staged slices, each keeping the app green.**

---

## 1. Motivating evidence (from a real session, 2026-07-02 export)

```json
{ "t": 10132, "type": "grounding",
  "appReferent": null, "modelTarget": "Cell A3", "agree": null, "resolution": "visual" }
```
One live excel session, one grounded action, and it exhibits both defects R2 exists to fix:
1. **Blindness:** `agree: null` — with no pointer referent, and with perceived-name echoes
   unmatchable against title-keyed `matchElement`, the grounding-agreement metric records nothing.
2. **Confident mis-resolution:** `resolution: "visual"` is wrong. The model targeted **Cell A3** —
   spreadsheet *content*, not a scene element. `matchElement` fuzzy-matched it to the **"Cell A1"**
   tile on a single-token overlap ("cell", score 1) and reported a visual resolution to the wrong
   element. In honest mode with a pointer down, that mints a spurious *"You pointed at X, but I
   read Cell A1"* confirm for a command that was about A3.

String identity caused both. Fix: stable ids for decisions; names as data; honest `null` when a
target is below the resolver's resolution.

## 2. The entity model — `src/entities/registry.ts` (new, pure)

```ts
export type EntityId = string;                    // `${programId}-${img.id}` e.g. 'word-1'; the map is 'map'

export interface SceneEntity {
  id: EntityId;
  title: string;                                   // registered name — DATA, not a reasoning key
  url: string;                                     // '' for the map
  category: ElementCategory | 'map';
  perceivedLabel?: string;                         // from the perception cache (url-keyed)
  aliases: string[];                               // normalized names the model may use: [title, perceivedLabel]
  bbox: [number, number, number, number];          // ymin,xmin,ymax,xmax (0-1000), from layout
}

buildEntities(program: Program, perceived: PerceivedCache,
              layout: { items: {id:number; bbox:BBox}[]; map: BBox } | null): SceneEntity[]
entityById(entities, id): SceneEntity | undefined
entityByTitle(entities, title): SceneEntity | undefined   // edge adapter for text-domain subsystems
displayName(e: SceneEntity): string                        // perceivedLabel ?? title
```
`buildEntities` is derived state — rebuilt whenever layout or the perception cache changes; it is
the **single source** for the scene (replacing the hand-assembled `interactiveObjects`).

## 3. Echo resolution — `resolveEchoedTarget` (replaces `matchElement` at decision sites)

```ts
resolveEchoedTarget(entities: SceneEntity[], text?: string): { entity: SceneEntity; score: number } | null
```
Generalizes `matchElement`'s scoring (`scenarios.ts:524`) over **every alias** of every entity
(best alias wins per entity), with one data-justified change:

- **Containment tiers unchanged:** exact = 1000; phrase-contains-alias = 500 + len;
  alias-contains-phrase = 100 + coverage.
- **Bare token overlap now requires ≥ 2 overlapping tokens.** Overlap of 1 returns no score.
  Rationale from §1: `"Cell A3"` vs `"Cell A1"` overlaps only on "cell" → today's wrong match;
  after: **null** (honest "below my resolution"). Legitimate overlap matches survive ("the save as
  option" → "Save As button", overlap 2).
- Below every tier → `null`. An honest null beats a confident wrong guess: `agree` stays `null`
  rather than false, and no spurious witness fires.

`matchElement` has exactly one call site (the G5 reconciliation, `App.tsx:1620`, whose
`modelElement` result also feeds the mismatch note and created-referent naming). Once the resolver
replaces that site, `matchElement` is **deleted** from `scenarios.ts` — its scoring lives on,
alias-generalized, in the resolver (and its unit character is preserved by the resolver's tests).

## 4. The rekey map (full rekey — what stores `EntityId` after this change)

| Structure | Today (title strings) | After |
|---|---|---|
| `interactiveObjectsRef` | `{name, bbox, category}[]` hand-built in the layout effect | `SceneEntity[]` from `buildEntities` |
| `hoveredObjectRef` / `hoveredObject` | title | `EntityId \| null` |
| `markersRef[].identifiedObject` | title | `EntityId` |
| `computePointingConfidence` candidates | titles | `EntityId[]` (same geometry, id in/out) |
| `referents.ts` entries | name strings | `{ id: EntityId; displayName: string }` (module signature update; `promptContext` renders displayName) |
| Magic `'Google Maps'` checks | scattered string compares | `category === 'map'` / `id === 'map'` |
| G5 `appReferent` vs model echo | title vs `matchElement` title | `EntityId` vs `resolveEchoedTarget(...)?.entity.id` |
| Created-referent naming | `modelElement ?? target` | resolver entity's displayName ?? raw target |

**Boundary rule (what keeps the rekey sane):** *decisions* — hit-testing, grounding, agreement,
candidate swaps, anaphora — operate on ids and aliases. *Presentation* — badge, deixis/context
hints, the ON-SCREEN prompt list, telemetry strings — renders through `displayName(entity)` (this
replaces the R1-perception `resolveTileName` call sites; the perception cache remains the label
*source*, now consumed via the registry). *Text-domain subsystems stay text-domain at the edges:*
OCR keeps indexing by title (unique per program, available on the entity); `applyAction`'s target
parsing (cell refs, dictation) still receives the raw model text — widget-internal content is not
scene identity.

## 5. G5 reconciliation & telemetry semantics (restored + corrected)

- `agree = (appReferentId && resolved) ? appReferentId === resolved.entity.id : null`.
- Perceived-name echoes now land (aliases carry them) → `agreementRate` is real again whenever the
  user is pointing.
- `resolution` semantics corrected: `'structural'` = pointer referent existed; `'visual'` = **the
  resolver actually resolved** (score above threshold), not "matchElement guessed"; `'none'` =
  resolver null. §1's event would now read `resolution:'none', modelTarget:'Cell A3'` — honest.
- Telemetry keeps emitting display strings (`displayName(appReferent)`, raw `args.target`) for
  export continuity; no telemetry schema change.
- The honest-mode mismatch note renders displayNames: *"You pointed at ⟨window with curtains⟩, but
  I read ⟨seashells on a beach⟩."*

## 6. Staged delivery (each slice lands green — how "full rekey now" stays safe)

1. **Registry + resolver (pure)** — `src/entities/registry.ts` + tests, including the literal
   `"Cell A3"` session case as a regression test. No App changes.
2. **Scene source swap** — layout effect builds entities via `buildEntities`;
   `interactiveObjectsRef` becomes `SceneEntity[]`; hit-test reads entity bboxes.
3. **Hover + confidence + presentation** — `hoveredObjectRef` stores ids;
   `computePointingConfidence` takes/returns ids; badge, deixis hint, context hint, ON-SCREEN list
   render via `displayName` (removing the `resolveTileName` + `PHOTOS.find` chains).
4. **Markers + referents** — `identifiedObject` → id; `referents.ts` → `{id, displayName}`;
   repair "the other one" swaps candidate ids.
5. **G5 + created-referent + map checks** — reconciliation on ids via the resolver; corrected
   `resolution` semantics; `'Google Maps'` strings → category checks.

## 7. Error handling & degradation

- Registry empty / layout unmeasured → `buildEntities` returns `[]`; hit-test finds nothing;
  hint says "Nothing (Empty Space)" — today's behavior.
- Perception absent → aliases = [title] only; displayName = title — pre-perception behavior.
- Resolver null → `agree: null`, `resolution:'none'`, no witness override — never a wrong guess.
- Unknown id lookups return `undefined`; call sites fall back to raw strings (never throw).

## 8. Testing

- **Pure (vitest):** `buildEntities` (map entity, alias assembly, bbox merge, perception-absent),
  `resolveEchoedTarget` (exact/containment/2-token overlap/threshold-null, perceived-alias echo,
  **the Cell-A3 regression**), `displayName`, referents module update.
- **Per-slice gates:** full suite + `tsc` + build green after every stage (2–5).
- **Manual smoke:** repeat the §1 session — the grounding event must read `resolution:'none'` for
  "Cell A3"; point-and-ask in honest mode with perception on — mismatch notes show perceived names;
  `agreementRate` non-null when pointing.

## 9. Non-goals

- No new widgets, no dataSnapshot-alias sources yet (R4 adds those to `aliases` later).
- No store/reducer migration of App state (R3) — the rekey changes what refs *hold*, not the
  ref-based architecture.
- No telemetry schema changes.
