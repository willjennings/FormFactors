# Functional Program Surfaces — Design Spec

*Recreate the four programs in the program set (`PROGRAMS` in `scenarios.ts`) as real, working
mini-apps, so the teaching form factor can truly teach "on screen": every named element (Save
button, SUM function, Slide canvas, Crop tool, …) becomes a real DOM control that does what its
name says, instead of a placeholder picsum tile. Teaching overlays then ring actual controls, and
taught sequences end in visible results.*

Date: 2026-07-03
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Decision record: fidelity = **functional mini-apps** (not facades); layout = **one program at a
time** (existing dropdown model; the virtual-desktop refactor R3/R4 stays out of scope).

---

## 1. The gap this closes

`scenarios.ts` declares four programs — Word, Excel, PowerPoint, Photo Editor — each with four
named elements (`PROGRAMS`, scenarios.ts:108-149). At runtime those elements render as generic
`picsum.photos` image tiles inside one "Camera roll" box (App.tsx:3165-3214) plus a Google Maps
iframe. Only Excel gets a real widget (`src/widgets/Spreadsheet.tsx`, swapped in at
App.tsx:3178). So a teaching step like "② Click Save" rings a stock photo, not a Save button —
the demo is not 1:1 with the program set it names.

The teaching stack itself needs no changes to fix this: `buildEntities`
(src/entities/registry.ts:33) derives teachable entities from the program's element list plus
live DOM bboxes, and `TeachingLayer` anchors purely to those bboxes. Real chrome in, real
teaching out.

## 2. Surface widgets — `src/widgets/`

One component per program, following the Spreadsheet template: a thin component bound to
`MockDoc`, a pure model builder beside it (like `spreadsheetGrid.ts`), `forwardRef` so the vision
pipeline can snapshot the node.

- **`WordSurface`** — a ribbon bar (category `program`) containing real **Save** and **Save As**
  buttons (`ui`), above a **document body** (`content`) rendering `doc.text` / `doc.heading` /
  `doc.bold`. The body is directly editable (styled textarea → updates `doc.text`). Save marks
  the doc saved; a small title bar reflects "Edited" / "Saved" / the Save As filename.
- **`ExcelSurface`** — an Excel ribbon with real **SUM** and **AVERAGE** buttons wrapped around
  the existing `Spreadsheet`. Clicking SUM/AVERAGE writes the computed result of the data column
  into the next free cell, visible in the grid. `Cell A1` is already a real `data-cell` node.
- **`PowerPointSurface`** — ribbon with **New Slide** and **Duplicate Slide** buttons, a
  filmstrip of `doc.slides`, and a **slide canvas** showing the current slide's title (click to
  edit). New Slide appends a slide; Duplicate copies the current one.
- **`PhotoSurface`** — toolbar with **Crop** and **Resize** tools over an **image canvas** (one
  real image). Crop visibly crops (CSS clip/zoom), Resize visibly scales, and `doc.brightness`
  renders as a CSS filter.

Element categories keep driving highlight hue exactly as today (`CATEGORY_COLORS`).

## 3. State — additive `MockDoc` extensions

Buttons dispatch through the SAME pure reducer voice uses: `applyAction(doc, verb, args)`
(scenarios.ts:428). One state layer, two input paths (click or voice). Additive gaps to fill:

- word: `savedAs?: string` (Save As), body edits flow through `edit_content`.
- excel: SUM/AVERAGE dispatch `insert_object` with `detail: 'SUM' | 'AVERAGE'`; the excel
  `insert_object` case writes the computed aggregate of column A into the next empty A-column
  cell, and keeps `detail`-less calls meaning `chart: true` (existing behavior).
- powerpoint: Duplicate Slide (copy current slide).
- photo: `resized?: boolean` (Resize tool).

**Policy:** a direct click **commits immediately** — the click IS the confirmation; no witness
gate. Voice keeps the existing `decideCommit` gating unchanged. `serializeMockDoc` extends to the
new fields so the model continues to read true world state after its own (or the user's) edits.

## 4. Measurement contract — `data-element-id`

Each surface renders its four named elements with `data-element-id={img.id}` (ids from
`program.images`). The layout effect (App.tsx:660-711) switches from index-matching
`.photo-item` nodes to querying `[data-element-id]` inside the program box — one generic
measurement path feeding `buildEntities` for every program.

This also fixes a latent bug: when Excel's Spreadsheet renders, zero `.photo-item`s exist, so
Excel's entities get no per-element bboxes and the teaching layer gates itself off
(TeachingLayer.tsx:55). Under the new contract Excel measures like everything else.

## 5. Teaching + click wiring

- Clicks on any `[data-element-id]` node emit `user.stepAction(entityId)` into the teaching
  reducer. Step advancement, soft-block scrim, and blocked-attempt toasts then operate over real
  controls with no overlay changes (they already anchor to entity bboxes).
- `buildDemoScript` (src/teaching/demoScript.ts) replaces "first three non-map tiles" with a real
  per-program script — e.g. Word: `teach_highlight`(ribbon) → `teach_sequence` "Save your
  document" (① type in the Document body → ② click Save) → `teach_relate`(Save ↔ Save As).
  Look-alike pairs (`confusableWith`) are the natural relate/soft-block material in each program.

## 6. Vision

Generalize the Excel-only snapshot path (App.tsx:2911-2928): a single `surfaceRef` +
`snapshotNode()` loop runs for whichever program is active, so the vision frame shows the real
rendered app. The structured text hint continues via `serializeMockDoc` (never pixels-only).

## 7. Retirements

- The picsum tile grid goes away; surfaces replace it in the same box.
- The box header "Camera roll" becomes the active program's label.
- `MockPreview` demotes to a debug panel — the surface is now the live preview; the serialized
  view keeps its honesty/debug value.
- `ProgramImage.url` stays only where card art needs it (task carousel) — no longer a rendering
  input for the main scene.

## 8. Out of scope

- Desktop / multi-window (R3/R4 of the architecture review).
- Cross-program teaching curricula (teaching Plan 2+).
- Real file I/O (Save writes `MockDoc` state only).
- Any change to voice Policy gating or the interaction grammar.

## 9. Error handling & degradation

- Surfaces are pure renders of `MockDoc`; unknown verb/arg combos keep returning the doc
  unchanged (existing `applyAction` contract).
- Unmeasured elements (zero bboxes) already render no overlay (existing selector filter).
- If a surface fails to snapshot, vision falls back to the composed frame without the widget
  pixels (existing fail-soft throttle pattern).

## 10. Testing

- Pure model builders per surface unit-tested (pattern: `spreadsheetGrid`).
- New `applyAction` cases (Save As, Duplicate, SUM/AVERAGE, Resize) tested in vitest.
- Demo-script assertions updated per program (pattern: ramble's `scriptedDemo.test.ts`).
- Manual pass: `?teach=1` on each of the four programs — rings on real controls, one step at a
  time, soft-block toast on off-target clicks, visible end result (saved doc / new slide /
  cropped image / computed total).

## 11. Build order (informs the plan)

1. `MockDoc` + `applyAction` additive extensions (TDD — pure layer first).
2. `data-element-id` measurement contract + registry wiring (fixes the Excel bbox bug).
3. Surfaces one at a time: Word → Excel (ribbon wrap) → PowerPoint → Photo, each with its pure
   model + click wiring + demo script + tests.
4. Vision generalization + MockPreview demotion + retire the tile grid.
