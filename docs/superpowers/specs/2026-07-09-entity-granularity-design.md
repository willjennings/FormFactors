# Entity Granularity (Project C1) — Design Spec

*A general, extensible mechanism for DOM-derived sub-element entities, so the honest pointer can
address a spreadsheet cell, a slide — and, as the prototype goes wide to arbitrary input surfaces,
whatever pointable parts those surfaces expose — not just the four hand-authored elements per
program. Excel cells and PowerPoint slides are the first two adopters of the mechanism, not the
whole of it. Foundation for Project C (audit gap 3).*

Date: 2026-07-09
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record: Decision A = **generalize the measurement contract** (one string `data-entity-id`
scan replaces the numeric `data-element-id`, unifying top-level + sub-elements) — going wide
requires one generic scan, not per-program measurement. Word/insertion-point pointing is
**deferred to C2b** (text has no DOM nodes; locating a word is a perception problem, and faking it
violates the thesis). No perception and no goal model in C1.

---

## 1. Principle: build the extension point, ship two adopters

The prototype is going wide — beyond Word/Excel/PowerPoint/Photo to arbitrary input surfaces a
computer accepts. C1 therefore delivers a **general contract** for a surface to expose its
pointable sub-elements, plus the measurement/identity/resolution plumbing that consumes it — and
implements that contract for the two surfaces with real, enumerable DOM nodes today (Excel cells,
PowerPoint slides). A new surface added later gains sub-element pointing by implementing the same
pure contract and stamping the same DOM attribute — no changes to the registry, measurement,
hit-test, or resolver. Cells and slides are the proof, not the point.

## 2. The sub-entity contract (the extension point)

A pure, per-surface derivation function — the one thing a new surface implements:

```ts
// A pointable sub-element a surface exposes, derived purely from its document/model state.
export interface SubEntitySpec {
  idSuffix: string;          // unique within the program, e.g. 'cell-A3', 'slide-2'
  title: string;             // human/registered name, e.g. 'Cell A3', 'Slide 2'
  aliases: string[];         // normalized names the model may echo (title auto-normalized in)
  category: ElementCategory; // hue/category (usually 'content')
}

// Each surface family contributes one of these; keyed by ProgramId (extensible as we go wide).
export type SubEntityDeriver = (doc: MockDoc) => SubEntitySpec[];
```

- `deriveSpreadsheetSubEntities(doc)` — one spec per grid cell that exists in the model (the
  `spreadsheetGrid` range), e.g. `{ idSuffix: 'cell-A3', title: 'Cell A3', aliases: ['a3','cell a3'], category: 'content' }`.
- `derivePptSubEntities(doc)` — one spec per `doc.slides[i]`, e.g. `{ idSuffix: 'slide-2', title: 'Slide 2', aliases: ['slide 2','the second slide'], category: 'content' }`.
- Word (`deriveWordSubEntities`) and Photo return `[]` in C1 (words deferred; canvas has no
  natural sub-elements). Their derivers exist as `() => []` so the wide-going contract is uniform
  and the future slice has an obvious home.

A single registry `SUB_ENTITY_DERIVERS: Partial<Record<ProgramId, SubEntityDeriver>>` maps program
→ deriver. Adding a surface = add one entry. All derivers are pure over `MockDoc` and unit-tested.

## 3. Identity

Entity ids become `${programId}-${idSuffix}`: the four top-level elements keep their existing
`${programId}-${imageId}` ids (e.g. `excel-1`, stable — see §6), sub-elements get
`${programId}-cell-A3`, `${programId}-slide-2`. `SceneEntity` gains an explicit discriminator
`sub?: boolean` (true for derived sub-entities) so downstream consumers filter cleanly (§7)
without parsing the id string — the id scheme is presentation, `sub` is the reasoning key. One
naming correction falls out: Excel's top-level element 4 is currently titled "Cell A1" (the whole
grid). It becomes the grid **container** (re-titled, e.g. "Spreadsheet grid"), and A1…D6 become
the real cell entities — so "Cell A1" unambiguously means the cell.

## 4. Measurement — one generic string contract (Decision A)

The current numeric `[data-element-id]` measurement (in App's `updateLayout`) generalizes to a
string `[data-entity-id]` scan:
- Top-level surface elements: `data-entity-id="${programId}-${imageId}"` (was numeric
  `data-element-id`).
- Sub-elements: the cell/slide DOM nodes stamp `data-entity-id="${programId}-cell-A3"` etc. (the
  spreadsheet already renders `<td data-cell="A3">`; the filmstrip renders a node per slide).

`updateLayout` scans every `[data-entity-id]` under `.program-window`, measures each bbox (0–1000
space), and produces `layout.items` keyed by the **string** entity id. `buildEntities` merges the
top-level entities + the derived sub-entity specs, attaching measured bboxes by id. One scan, one
contract, any surface — the wide-going requirement.

## 5. Hit-test: innermost wins

The scene stays a **flat** `SceneEntity[]` (no hierarchy in the data). Sub-element pointing is
correct via geometry: the hover hit-test and `computePointingConfidence` pick the **smallest bbox
containing the cursor**, so hovering a cell resolves to the cell, not the enclosing grid; hovering
grid padding (no cell) resolves to the grid container. This keeps the registry flat while giving
most-specific-target semantics for free.

## 6. Resolver honesty at scale (the load-bearing work)

`resolveEchoedTarget`'s honesty floor (the unit-tested "Cell A3 ≠ Cell A1" anchor) now faces a
**dense** set of near-identical aliases (A1…D6). The substring-containment tiers can misfire —
"Cell A3" must not resolve to "Cell A13" or "Cell A1"; "Slide 2" must not resolve to "Slide 12".
C1 hardens the resolver to be robust to arbitrary dense alias sets (not tuned to cells):
- **Exact-alias match wins outright** (already scored 1000) — ensure an exact echo always beats a
  substring near-miss.
- **Token/word-boundary matching** so `a3` matches the `a3` alias but not `a13` (avoid bare
  substring `includes` promoting `a3`⊂`a13`).
- Below-threshold echoes still return `null` ("below my resolution") — the honesty contract.
Regression tests cover the full grid + slide sets; this is the correctness heart of C1 and must be
surface-agnostic so wide-going surfaces inherit it.

## 7. Downstream integration (where more entities bite)

Consumers iterate `entities`; C1 keeps them correct by preserving top-level ids and scoping
number-selection:
- **`selectTargetByNumber` (keys 1–9)** keeps addressing only the **top-level** elements (a digit
  can't enumerate 24 cells) — it filters to non-sub entities.
- **Teaching soft-block scrim / demo scripts** reference top-level ids (`word-1`, `excel-2`, …)
  which are unchanged, so they keep working; the scrim's leaf set may now include sub-elements —
  verify it still blocks sensibly (a soft-blocked sequence over top-level elements is unaffected).
- **Vision-frame element labels** gain the sub-elements (the model now sees "Cell A3" as a named
  region) — a benefit, not a break.
- **Grounding chips / rail band inheritance** resolve against the fuller entity set unchanged.

## 8. Out of scope

Word/insertion-point pointing (C2b — needs text measurement/perception); any live perception (the
pointer stays honest geometry over derived titles); the task/goal model (C3); building sub-entities
for surfaces beyond Excel/PowerPoint now (the *contract* is general; only these two ship — Word/Photo
derivers return `[]`); hierarchy in the data model (flat + innermost-wins instead).

## 9. Testing

- **Pure derivation (vitest):** `deriveSpreadsheetSubEntities` (cells from a doc's grid range),
  `derivePptSubEntities` (one per slide, count grows with the deck), Word/Photo return `[]`.
- **Resolver density regression:** A1…D6 + slides — exact echoes resolve to the right cell; near
  neighbors (`a3` vs `a13`, `slide 2` vs `slide 12`) do NOT cross-resolve; below-threshold → null.
- **`buildEntities` merge:** top-level + sub-entities in one flat array, ids correct, bboxes
  attached by id, missing measurements → zero bbox (existing degradation).
- **Hit-test innermost-wins:** a cursor inside a cell bbox (also inside the grid bbox) resolves to
  the cell.
- **Manual:** hover a spreadsheet cell → the "Pointing at" pill reads "Cell A3"; "put 100 here"
  (grounded on A3) targets A3; hover a slide → "Slide 2".

## 10. Sequencing note (the wide-going trajectory)

C1 is the first foundation of Project C: it makes the honest pointer *granular and extensible*.
C2a (teaching overlays visible in the vision frame) and C2b (live perception + word-level
pointing) build on the richer entity set; C3 (goal model) is separable. As new input surfaces are
added (the wide-going roadmap), each implements §2's `SubEntityDeriver` and stamps §4's
`data-entity-id` — inheriting measurement, hit-testing, and the hardened resolver with no core
changes. That inheritance is the deliverable; cells and slides prove it works.
```
