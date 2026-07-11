# Whiteboard (free-coordinate illustration) — Design Spec

*The agent composes original explanatory diagrams — nodes, connectors, labels — at free
coordinates, to demystify a concept the way a Khan-Academy instructor uses a scratch space. A
single free-coordinate mark model renders to one of two surfaces (a dedicated whiteboard panel OR
the C2a instruction overlay), selectable by a debug toggle so the friction/expressiveness of each
can be evaluated. The deferred sibling of C2a-illustrate's entity-anchored annotations.*

Date: 2026-07-10
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record:
- **Both surfaces, toggle-selected** (`whiteboardMode`, debug drawer): `board` = a dedicated panel;
  `overlay` = the C2a `instructionLayerRef` seam. Evaluation prototype — compare which fits (same
  rationale as C3's `confirmGoals`).
- **Vocabulary = structured diagram primitives** (node / connector / label). Agent-authored
  freehand is deferred (awkward for an LLM; better scoped later as a *user* sketch surface).
- **Separate `src/whiteboard/` subsystem** (not folded into `src/annotations/`): annotations anchor
  to *entity ids*, whiteboard marks live at *free coordinates* — different anchoring models, and
  keeping them apart lets each be evaluated independently and leaves the shipped annotation
  subsystem untouched.
- **Honest by construction (board) / perceivable + illustrative (overlay):** the board makes no
  positional claim about the program; overlay marks are framed as illustration, perceivable via
  C2a, and clearable.

---

## 1. Principle: the agent's scratch space, honestly

C2a-illustrate gave the agent *entity-anchored* annotation (arrows/shapes/labels tied to real UI
elements). It deferred *free-coordinate* drawing — diagrams in whitespace, untethered to elements —
because drawing at arbitrary `(x,y)` **over the program UI** is "drawing blind." The whiteboard
resolves that two ways, both offered for evaluation:

- A **dedicated panel** (`board` mode) sidesteps the blind-placement problem entirely: it's the
  agent's own canvas, so free coordinates are just diagram *layout*, not a claim about where UI
  elements are. Honest by construction.
- An **overlay** (`overlay` mode) draws the same marks into the C2a instruction seam, where C2a's
  WYSIWYG snapshot already lets the agent *perceive its own marks* — so placement is verifiable, not
  blind. Framed as illustration, not a positional claim, and clearable.

The agent composes structured diagrams (nodes wired by connectors, plus free labels) — exactly what
an LLM authors well — to explain concepts. Freehand strokes are out of scope (§8).

## 2. The mark model (pure)

`src/whiteboard/types.ts`:

```ts
export type WbShape = 'box' | 'ellipse';

export type WbMark =
  | { kind: 'node'; key: string; x: number; y: number; text: string; shape: WbShape }  // (x,y) 0-1000, box center
  | { kind: 'connector'; id: string; from: string; to: string; label?: string }         // from/to = node keys
  | { kind: 'label'; id: string; x: number; y: number; text: string };

export type WbSpec =
  | Extract<WbMark, { kind: 'node' }>                    // node carries its own model-supplied key (no stamped id)
  | Omit<Extract<WbMark, { kind: 'connector' }>, 'id'>   // connector/label get a deterministic id from the store
  | Omit<Extract<WbMark, { kind: 'label' }>, 'id'>;

export interface WhiteboardState { marks: WbMark[]; nextId: number }

export type WbEvent =
  | { type: 'wb.add'; spec: WbSpec }
  | { type: 'wb.clear' };
```

- **node** carries a model-supplied `key` (its diagram id) so connectors can reference it. Adding a
  node with an existing `key` replaces it (re-position/re-label). `(x,y)` is the box center in 0–1000
  space; a fixed node size (e.g. 180×70 in 0–1000 units) keeps geometry simple.
- **connector**/**label** get a deterministic `id` from `nextId` (like the annotation store), since
  they have no natural model key.
- `MAX_MARKS` cap (e.g. 32) — a whiteboard is a diagram, not an infinite canvas; oldest dropped.

`src/whiteboard/store.ts`: `initialWhiteboardState()`, `reduce(state, event)`:
- `wb.add` node with a new key → append; with an existing key → replace in place (keeps diagram
  stable while the model refines). connector/label → append with stamped `id`. Cap at `MAX_MARKS`.
- `wb.clear` → `{ marks: [], nextId: state.nextId }` (monotonic `nextId`).
- Deterministic — no `Math.random`/`Date.now`.

## 3. Geometry (pure)

`src/whiteboard/geometry.ts`:

```ts
export const NODE_W = 180, NODE_H = 70; // 0-1000 units
export function nodeBox(n: { x: number; y: number }): [number, number, number, number]; // ymin,xmin,ymax,xmax centered on (x,y)
export function nodeByKey(marks: WbMark[], key: string): Extract<WbMark, { kind: 'node' }> | null;
export function connectorEnds(marks: WbMark[], c: Extract<WbMark, { kind: 'connector' }>):
  { from: { x: number; y: number }; to: { x: number; y: number } } | null; // null if either key unresolved (fail-soft)
```

- `nodeBox` centers a `NODE_W×NODE_H` box on `(x,y)`, clamped to 0–1000.
- `connectorEnds` resolves `from`/`to` node keys → their centers; returns `null` if either is
  missing (the connector renders nothing — fail-soft, never a stray line to nowhere).

## 4. Rendering & surfaces

`src/whiteboard/WhiteboardMarks.tsx` — one SVG (`viewBox="0 0 100 100"`, `preserveAspectRatio="none"`,
`pct = v/10`, mirroring `AnnotationLayer`):
- **node:** a rounded `rect` (or `ellipse`) at `nodeBox`, with centered wrapped `text`.
- **connector:** an arrow (`markerEnd`) from `connectorEnds().from` to `.to`, optional mid `label`.
- **label:** free `text` at `(x,y)`.
- Indigo ink, `pointer-events-none`. `null`-guarded per mark (fail-soft).

Mounted into whichever surface `whiteboardMode` selects:
- **`board`** → `src/whiteboard/WhiteboardPanel.tsx`: a dedicated, dismissable panel over the desktop
  (a large centered card with a header "Whiteboard" + a ✕ → `wb.clear`), holding `WhiteboardMarks`
  in its own 0–1000 viewBox. Shown when `whiteboardMode === 'board'` and the board is non-empty.
- **`overlay`** → `WhiteboardMarks` rendered inside the C2a `instructionLayerRef` seam (plane 0–1000
  space, a sibling of `AnnotationLayer`), so C2a's snapshot perceives it.

The same component and mark coordinates serve both; only the container/coordinate frame differ.

## 5. Tools + mapper

`src/whiteboard/tools.ts` — `WB_TOOLS` + a pure mapper mirroring `annotateTools`:

```ts
export const WB_TOOLS: VoiceTool[]; // wb_node, wb_connect, wb_label, wb_clear

export function wbCallToEvent(call: { name: string; args: any }): WbEvent | { error: string };
```

- `wb_node { key, x, y, text, shape? }` → `wb.add` node (`shape` defaults `'box'`; `x`/`y` coerced to
  numbers, clamped 0–1000; missing `key` or `text` → error).
- `wb_connect { from, to, label? }` → `wb.add` connector (missing `from`/`to` → error). Note: the
  mapper does NOT verify the keys resolve — an unresolved key simply renders nothing (fail-soft);
  the model is told the board's node keys via `[WHITEBOARD]` (§6) so it wires correctly.
- `wb_label { x, y, text }` → `wb.add` label (missing `text` → error).
- `wb_clear` → `wb.clear`.

## 6. Perception (the `[WHITEBOARD]` channel)

- **overlay mode:** perceived WYSIWYG *for free* via C2a's instruction-layer snapshot (the marks are
  in the seam) — the agent sees exactly what it drew and can verify/refine placement.
- **board mode:** a pure `serializeWhiteboard(state): string | null` emits a deduped `[WHITEBOARD:
  nodes start,decide,end; decide→end "yes"; label "…". DO NOT acknowledge this message.]` via the
  C2a `makeChangeGate` pattern (`wbHintGateRef`), gated on `isLive` and a non-empty board. Nodes are
  named by their `key`, connectors by `from→to` (+ label). Since the model authored the marks, the
  store IS its ground truth — no vision-frame change needed; the hint also re-tells the model the
  live node keys so multi-call diagrams wire correctly.

## 7. Honesty invariants

- **board = no positional claim:** the panel is a scratch space; a diagram there asserts nothing
  about the program's layout. Honest by construction.
- **overlay = illustration, perceivable, clearable:** overlay marks are the agent's illustration,
  not a claim about where UI elements are; C2a's snapshot makes them perceivable (not blind); and
  `wb_clear` removes them.
- **Fail-soft:** an unresolved connector key, a missing node, or a degenerate coordinate renders
  nothing — never a stray mark or a crash.
- **No drift:** `[WHITEBOARD]` (board mode) keeps the model's view = the store's truth; overlay mode
  is perceived directly.
- **Deterministic + capped + clearable:** ids from `nextId`, `MAX_MARKS` cap, `wb_clear` empties.

## 8. Out of scope

- **Agent-authored freehand / hand-drawn strokes** — deferred (LLMs author structured data well but
  smooth strokes poorly). The natural next exploration is a *user* sketch surface the agent responds
  to, or a small library of hand-drawn-styled primitives — a separate project once this proves out.
- **A dedicated timeline / richer diagram primitives** — nodes + connectors approximate timelines
  and flowcharts for now; specialized primitives are deferred.
- **Animated / step-revealed diagram build-up**, multi-color palettes.
- **Perceiving the dedicated panel as pixels in the vision frame** — the `[WHITEBOARD]` text channel
  suffices (the model authored it); a panel snapshot can be added later if visual self-review of
  board layout proves necessary.

## 9. Testing

- **Pure store:** `wb.add` node (append / replace-by-key), connector/label (stamped ids), cap at
  `MAX_MARKS`, `wb.clear` (empties, keeps `nextId`).
- **Pure geometry:** `nodeBox` centering/clamp; `nodeByKey`; `connectorEnds` resolves both keys and
  returns `null` when either is missing.
- **Pure mapper (`wbCallToEvent`):** each tool's happy path + error cases (missing key/text/from/to);
  `shape`/coordinate defaults.
- **Pure `serializeWhiteboard`:** empty → `null`; else nodes by key + connectors `from→to` (+label) +
  the silence suffix; degrades gracefully.
- **App wiring + the two renderers/panel** gate on tsc + full suite + build; visual behavior is the
  `?whiteboard=1` demo + human smoke.

## 10. Files

| File | Responsibility |
|---|---|
| `src/whiteboard/types.ts` *(new)* | `WbMark`/`WbSpec`/`WbEvent`/`WhiteboardState`. |
| `src/whiteboard/store.ts` *(new)* | `initialWhiteboardState`, `reduce`, `MAX_MARKS`. |
| `src/whiteboard/geometry.ts` *(new)* | `nodeBox`, `nodeByKey`, `connectorEnds`, `NODE_W/H`. |
| `src/whiteboard/tools.ts` *(new)* | `WB_TOOLS`, `wbCallToEvent`. |
| `src/whiteboard/serialize.ts` *(new)* | `serializeWhiteboard` — the `[WHITEBOARD]` channel. |
| `src/whiteboard/WhiteboardMarks.tsx` *(new)* | The SVG renderer (nodes/connectors/labels). |
| `src/whiteboard/WhiteboardPanel.tsx` *(new)* | The dedicated `board`-mode panel. |
| `src/whiteboard/demo.ts` *(new)* | `buildWhiteboardDemo` — the `?whiteboard=1` script. |
| `src/whiteboard/*.test.ts` *(new)* | Unit tests for store/geometry/mapper/serializer/demo. |
| `src/App.tsx` | `whiteboardState` reducer + refs; `whiteboardMode` state; `wb_*` routing; `WB_TOOLS` in `voiceTools`; the `[WHITEBOARD]` send effect; mount `WhiteboardMarks` in the C2a seam (overlay) + `WhiteboardPanel` (board); demo wiring. |
| `src/shell/DebugDrawer.tsx` | The `whiteboardMode` control (board / overlay). |
| `src/prompt/instructions.ts` | A note: draw diagrams with `wb_*` to explain concepts; wire nodes by key; clear when done. |

No changes to `src/annotations/`, teaching, entities, or the perception plumbing beyond mounting a
sibling renderer in the C2a seam.

## 11. Sequencing note

The whiteboard is the free-coordinate counterpart to C2a-illustrate's entity-anchored annotations,
unblocked now that C2a's perception exists (overlay marks are seen, not drawn blind) and framed so
the dedicated-panel mode needs no perception at all. Both surfaces ship behind one toggle for
evaluation. Agent-authored freehand and a user sketch surface are the natural follow-ons once the
structured-diagram core proves out.
