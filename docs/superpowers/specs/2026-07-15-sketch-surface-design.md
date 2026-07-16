# User Sketch Surface — Design Spec

*The user draws rough strokes on the whiteboard; the agent honestly perceives them from
deterministic geometry and responds — first in conversation, then (milestone 2) by offering a
witnessed sketch→diagram transform. The deferred "freehand" sibling of the structured whiteboard
(`docs/superpowers/specs/2026-07-10-whiteboard-design.md` §8), scoped per its deferral note: a
user sketch surface the agent responds to. Agent-authored hand-drawn styling is a separate
follow-on.*

Date: 2026-07-15
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **Walking skeleton + one milestone** — stroke capture → pure classification → `[SKETCH]`
hint → conversation (skeleton); witnessed beautify (milestone 2). Annotation-over-sketch needs no
new work: both layers share the 0–1000 plane, so existing `wb_*` tools already place marks near
strokes the model knows from the hint.

---

## 1. Purpose & scope

The structured whiteboard proved the agent can *author* diagrams. This inverts it: the **user**
draws — rough boxes, arrows, scribbles — and the agent must perceive honestly and respond. The
honesty problem is perception: the model must never claim to "see" more than the system actually
measured. Perception here is deterministic geometry classification, serialized as text; the model
reads measurements, not pixels.

**In scope:** pointer-drawn strokes on the dedicated whiteboard panel; pure stroke classification;
a deduped `[SKETCH]` hint; user-only clear; the witnessed `wb_beautify` transform.

**Out of scope (follow-ons, in the deferral tradition):** hand-drawn/sketchy rendering of agent
marks; panel-snapshot vision (add only if drawn-WORD reading proves necessary — geometry cannot
read words and the hint says so honestly); sketching on the overlay surface (pointer-down over the
program is deixis and must not become ink); stroke editing/undo beyond clear; pressure/multi-touch.

## 2. Architecture & ownership

New self-contained `src/sketch/` subsystem beside `src/whiteboard/` (approach B of the
brainstorm). **The ownership boundary is the store boundary**: the agent has no tools that touch
strokes, so it structurally cannot erase or edit the user's sketch — the sketch-side mirror of
ramble's reducer-enforced yield. The one bridge is milestone 2's witnessed beautify, and it
mutates only after the user confirms.

| Module | Responsibility |
|---|---|
| `src/sketch/types.ts` | `Stroke`, `Classified`, `SketchEvent`, `SketchState`. |
| `src/sketch/classify.ts` | Pure `classify(points): Classified` — the geometry heuristics. |
| `src/sketch/sketchStore.ts` | Pure reducer `(state, event) → state`; calls `classify` on add. |
| `src/sketch/serialize.ts` | Pure `serializeSketch(state)` → the `[SKETCH]` hint text + change gate. |
| `src/sketch/SketchLayer.tsx` | Pointer capture + SVG polyline rendering inside `WhiteboardPanel`. |
| `src/whiteboard/WhiteboardPanel.tsx` | Composes `SketchLayer` under the agent's `WhiteboardMarks`. |

Existing whiteboard semantics are untouched: `wb_clear` still clears **agent marks only**; the
user's strokes have their own clear affordance; `MAX_MARKS` never counts strokes.

## 3. State model

```ts
type XY = { x: number; y: number };                        // 0-1000 plane space (shared with wb)

type Classified =
  | { kind: 'box' | 'ellipse' | 'scribble'; bbox: [number, number, number, number] }
  | { kind: 'line' | 'arrow'; bbox: [number, number, number, number]; from: XY; to: XY };

interface Stroke { id: string; points: XY[]; classified: Classified }

type SketchEvent =
  | { type: 'sketch.strokeAdd'; points: XY[] }             // complete stroke, on pointer-up
  | { type: 'sketch.clear' }                               // user's clear button
  | { type: 'sketch.replace'; removeIds: string[] };       // beautify commit ONLY (post-confirm)

interface SketchState { strokes: Stroke[]; nextId: number }
```

Reducer rules: ids are deterministic (`s1`, `s2`, …). A stroke with `< 3` points or path length
`< 8` plane units is a tap, not a stroke — dropped. `MAX_STROKES = 64`; when full, the oldest
stroke is dropped and the `[SKETCH]` hint says so ("oldest stroke dropped at the 64-stroke cap") —
never silently. `sketch.replace` with any unknown id is a no-op (fail-soft; the caller validates
first and reports errors-as-data).

## 4. Classification (`classify.ts`) — deterministic, thresholds are named constants

Order of tests (first match wins); anything ambiguous is `scribble` — the honest under-claim:

1. **Closed?** endpoint gap `< CLOSE_GAP_RATIO (0.15) ×` path length.
2. Closed → compare path length to the bbox perimeter and to the inscribed ellipse's perimeter
   (Ramanujan approximation): whichever is nearer wins **box** or **ellipse**, but only if within
   `SHAPE_FIT_RATIO (0.30)`; otherwise **scribble**.
3. Open + straight (max point deviation from the endpoint chord `< LINE_DEV_RATIO (0.10) ×` chord
   length):
   - **arrow** if the final `ARROW_TAIL (25%)` of points contains ≥ 2 direction reversals sharper
     than `ARROW_ANGLE (90°)` (a drawn head); `from`/`to` = chord endpoints, `to` at the head end.
   - else **line**.
4. Everything else → **scribble** with its bbox.

No ML, no hidden tunables — every constant is exported and every branch has a test fixture
(wobbly box, open arc, headless line, arrow with a sloppy head, genuine scribble). Exact threshold
tuning may move in the plan's TDD loop, but the *vocabulary* (five kinds, scribble-as-default) is
the contract.

## 5. Perception — the `[SKETCH]` hint

`serializeSketch` emits one deduped hint through the same change-gate pattern as `[WHITEBOARD]` /
`[TEACHING STATE]`, sent via `sendTextHint` only when the serialized text changes:

> `[SKETCH] The user has drawn on the whiteboard: a box at (300,400) ~180×90 (s1); an arrow from
> (390,430) to (610,430) (s2); 2 scribbles (s3, s4). You see measured geometry only — you cannot
> read drawn words. DO NOT acknowledge this update.]`

The ids let the model reference strokes in `wb_beautify`. The "measured geometry only" sentence is
the honesty floor: the model is told the limits of its own perception. Empty sketch → no hint
(gate handles it). The prompt gains one short section telling the model the sketch layer exists,
is user-owned (never clearable by it), and that `[SKETCH]` is its only view of it.

## 6. Input & rendering (`SketchLayer.tsx`)

Pointer events on the dedicated whiteboard panel only. Draw = pointer-down + drag anywhere on the
panel body (agent marks are not interactive, so ink can start over them); points are captured in
plane space (same viewBox transform as `WhiteboardMarks`)
and dispatched as one `sketch.strokeAdd` on pointer-up. Strokes render as SVG `<polyline>`s with
round caps/joins in a graphite gray — visually distinct from the agent's ink (the third ink, after
annotation ink and whiteboard ink). Rendered UNDER agent marks: the agent annotates over the
user's sketch, never the reverse. A small "clear sketch" button in the panel header (user-only;
disabled when no strokes).

## 7. Milestone 2 — witnessed beautify (`wb_beautify`)

New agent tool, live only after the skeleton proves out:

```
wb_beautify({ strokeIds: string[], marks: WbSpec[] })
```

The model proposes structured marks derived from `[SKETCH]`. The app validates (every strokeId
exists; every mark passes the existing wb-tool validation) — any failure returns errors-as-data
naming what's valid, nothing partial. Valid proposals render a **witness card**: "Replace 3 of
your strokes with 2 nodes + 1 connector?" with the proposed marks previewed on the board in a
provisional tint. Confirm → dispatch `sketch.replace(removeIds)` + the `wb.add`s in one handler
(the panel container owns both stores, so the swap is atomic from the user's view); the model gets
a success ack. Decline/Esc → nothing changes, the model is told the user declined. The agent can
never invoke replacement without the card — same unconditionally-witnessed posture as ramble's
submit.

## 8. Error handling & graceful degradation

- Degenerate strokes (taps, dust) are dropped at the reducer — never classified, never hinted.
- `classify` never throws: pathological input (duplicate points, zero-length chords) → `scribble`.
- `wb_beautify` referencing a stale/unknown stroke id → `{ success:false, error }` naming live ids.
- Stroke cap reached → oldest dropped + stated in the hint (no silent truncation).
- No live session → sketching still works fully (draw, clear); hints simply aren't sent — the
  layer is useful offline, like the rest of the board.

## 9. Testing

- **Pure (vitest, TDD):** `classify` fixtures per branch (§4); `sketchStore` transitions incl.
  cap-drop, tap-drop, replace-unknown-id; `serializeSketch` phrasing + gate dedup; beautify
  validation (stale id, invalid mark, valid proposal).
- **Scripted demo (`?sketch=1`, no key):** replays a recorded stroke set through the real store —
  box, arrow, scribble — and shows the exact `[SKETCH]` text that would be sent, proving the
  perception channel without a model.
- **Live smoke (owed, needs a key):** draw a rough flow → ask "what did I draw?" → the agent's
  answer matches the hint's vocabulary and admits it can't read any drawn words; `wb_beautify`
  round-trip: propose → witness card → confirm swaps strokes for marks / decline changes nothing.

## 10. Build order (informs the plan)

1. `types` + `classify` (TDD — the heart).
2. `sketchStore` + `serialize` (TDD).
3. `SketchLayer` + panel composition + clear button; `?sketch=1` scripted demo.
4. Live wiring: `[SKETCH]` hint dispatch + prompt section (skeleton complete — converse works).
5. Milestone 2: `wb_beautify` tool + validation + witness card + atomic swap.
6. Live smoke, reported as owed.

Steps 1–3 have no agent dependency and are fully testable offline.

## 11. Caveats (binding)

- **Never over-claim perception.** The hint states its limits ("measured geometry only"); the
  prompt must not imply the model can see the drawing. If the model is asked about a drawn word,
  the honest answer is that it can't read it.
- **User ink is user-owned.** No agent path deletes or mutates strokes except the confirmed
  beautify swap. `wb_clear` never touches strokes.
- **Scribble is the default verdict.** A misclassified shape is a lie; an "unrecognized stroke" is
  honest. Bias every threshold toward under-claiming.
- **Beautify is unconditionally witnessed.** No autonomy level auto-commits it.
