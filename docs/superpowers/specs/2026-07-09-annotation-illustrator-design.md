# Annotation Illustrator (Project C2a-illustrate) — Design Spec

*Give the agent an illustrator's toolkit — arrows, circles/boxes/brackets, and labels it draws on
top of real UI to demystify a step or concept, Khan-Academy style. Every mark is anchored to a
resolved C1 entity, so the agent draws honestly (only at things that exist). Renders into the C2a
instructional-overlay seam, so the model perceives what it drew for free. Third foundation of
Project C; generalizes the existing `teach_highlight` (a ring) and `teach_relate` (a labeled arc).*

Date: 2026-07-09
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record:
- **Entity-anchored illustration** — every mark derives its position from a `resolveEchoedTarget`
  entity (same honesty floor as the teach tools; unresolvable target fails the whole call). Marks
  may carry offsets so a label lands in adjacent whitespace, but the anchor is always a real
  element. Pure free-coordinate diagrams / freehand strokes are **deferred to a post-C2b
  "whiteboard"** — before C2b the agent can't perceive whether a whitespace diagram landed well,
  so raw x,y would be drawing blind (the one thing the project refuses to do).
- **Mounts in the C2a seam** — a new `AnnotationLayer` renders as a second child of
  `instructionLayerRef`, sibling to `TeachingLayer`, so the WYSIWYG snapshot perceives it with ZERO
  vision-loop changes.
- **Live-wired now, independent of Teaching Plan 2** — an annotation is a self-contained draw
  command with no posture/scribe routing, so wiring `ANNOTATE_TOOLS` to the live model does not
  front-run Teaching Plan 2 (which exists to design guide-vs-teach-vs-just-do-it posture for
  *sequences*). A scripted demo proves the vocabulary with no key.
- **SVG rendering**, one indigo illustration accent, capped + clearable.

---

## 1. Principle: generalize the two annotation primitives into an illustrator's toolkit

The agent already has two entity-anchored marks: `teach_highlight` (a ring on one element) and
`teach_relate` (labeled SVG arcs between elements). Both resolve target *names* to real entities
and render in `TeachingLayer`. C2a-illustrate delivers the general vocabulary those two are special
cases of — arrows, encircling/boxing/bracketing shapes, and text labels/callouts — as a separate,
self-contained subsystem (`src/annotations/`) that renders into the seam C2a built. C1 gives the
anchors (entities + sub-entities: cells, slides), C2a gives the perception (the marks reach the
model), and this project gives the authoring vocabulary. Cells/slides/controls are what it draws
on; the honest, entity-anchored *toolkit* is the deliverable.

## 2. The annotation data model (pure)

`src/annotations/types.ts`:

```ts
import type { EntityId } from '../entities/registry';

export type AnnotationShape = 'circle' | 'box' | 'bracket';
export type LabelPlacement = 'top' | 'bottom' | 'left' | 'right';

interface Base { id: string; label?: string }

export type Annotation =
  | (Base & { kind: 'arrow'; from: EntityId; to: EntityId })
  | (Base & { kind: 'shape'; shape: AnnotationShape; targets: EntityId[] })
  | (Base & { kind: 'label'; anchor: EntityId; text: string; placement: LabelPlacement });

// A spec is an Annotation without its id; the reducer stamps a deterministic id (§4).
export type AnnotationSpec =
  | Omit<Extract<Annotation, { kind: 'arrow' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'shape' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'label' }>, 'id'>;

export type AnnotationEvent =
  | { type: 'annotate.add'; spec: AnnotationSpec }
  | { type: 'annotate.clear' };

export interface AnnotationState { annotations: Annotation[]; nextId: number }
```

- `arrow` generalizes `teach_relate` (one pair, directed, optional mid label).
- `shape` encircles (`circle`), boxes (`box`), or braces (`bracket`) ONE target or the bounding box
  of a group; `label` optional (e.g. "input range").
- `label` is a text callout anchored to one element, offset into adjacent whitespace by
  `placement`, with a leader line back to the anchor.

## 3. The tool vocabulary + mapper

`src/annotations/annotateTools.ts` — four model-facing tools and a pure mapper, mirroring
`teachTools.ts` exactly (name resolution, whole-call-fails-on-unresolvable):

```ts
export const ANNOTATE_TOOLS: VoiceTool[] = [
  { name: 'annotate_arrow', description: 'Draw an arrow from one on-screen element to another to show a connection. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'annotate_shape', description: 'Encircle, box, or bracket one or more on-screen elements to group or spotlight them. shape: circle|box|bracket. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      shape: { type: 'string', enum: ['circle', 'box', 'bracket'] },
      targets: { type: 'array', items: { type: 'string' } }, label: { type: 'string' } }, required: ['shape', 'targets'] } },
  { name: 'annotate_label', description: 'Attach a short text callout to an on-screen element, placed in the nearby margin with a leader line. text ≤6 words.',
    parameters: { type: 'object', properties: {
      anchor: { type: 'string' }, text: { type: 'string' },
      placement: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] } }, required: ['anchor', 'text'] } },
  { name: 'annotate_clear', description: 'Remove all drawn annotations.',
    parameters: { type: 'object', properties: {}, required: [] } },
];

export function annotateCallToEvent(
  call: { name: string; args: any }, entities: SceneEntity[],
): AnnotationEvent | { error: string };
```

- `resolve(entities, name)` uses `resolveEchoedTarget(...)?.entity.id ?? null`; any unresolvable
  target returns `{ error: 'Could not resolve target "…" to an on-screen element.' }` and the whole
  call fails (no partial annotation) — identical contract to `teachCallToEvent`.
- `annotate_shape` with an empty resolved `targets` → `{ error: 'annotate_shape requires at least one target.' }`.
- `placement` defaults to `'top'` when omitted.
- `annotate_clear` → `{ type: 'annotate.clear' }`.

## 4. The store (pure reducer)

`src/annotations/annotationStore.ts`:

```ts
export const MAX_ANNOTATIONS = 8; // matches teaching's highlight cap
export function initialAnnotationState(): AnnotationState { return { annotations: [], nextId: 1 }; }
export function reduce(state: AnnotationState, event: AnnotationEvent): AnnotationState;
```

- `annotate.add`: stamp `id = String(state.nextId)`, append; if length would exceed
  `MAX_ANNOTATIONS`, drop the oldest (`slice(-MAX_ANNOTATIONS)`); `nextId` increments. **Deterministic
  id** — no `Math.random`/`Date.now`, so the reducer is unit-testable and replay-safe.
- `annotate.clear`: `{ annotations: [], nextId: state.nextId }` (keep the counter monotonic so ids
  never collide across clears).

## 5. Rendering — `AnnotationLayer.tsx`

Mounted as a second child of `instructionLayerRef`, sibling to `TeachingLayer` (App §7). Renders
SVG marks positioned from entity bboxes in 0–1000 plane space via the same `pct(v) = v/10 %` map
`TeachingLayer` and the relate arc use — so it inherits correct coordinate alignment in the vision
frame automatically (verified in C2a's final review).

- **arrow:** an SVG line/path from the `from` bbox edge to the `to` bbox edge with an arrowhead
  marker; optional label at the midpoint.
- **shape/circle:** an SVG ellipse inflated a few % around the single target (or the group bounding
  box); **shape/box:** a rounded rect; **shape/bracket:** a brace path along one side of the group
  bbox; optional label.
- **label:** a positioned callout (text in a pill) at the anchor bbox offset by `placement`, with a
  thin leader line back to the anchor edge.
- Degrades exactly like `TeachingLayer`: an anchor with a zero/absent bbox (unmeasured or closed
  window) renders nothing for that mark (no throw, no stray mark) — the honest fail-soft.
- One indigo accent (matching the existing relate arc), `pointer-events-none`.

## 6. Perception & honesty

- **Visual (free):** `AnnotationLayer` is inside `instructionLayerRef`, so C2a's WYSIWYG snapshot
  composites the marks into the model's vision frame with no vision-loop change.
- **Text:** a pure `serializeAnnotations(state, entities): string | null` (in
  `src/annotations/serialize.ts`) returns `null` when there are no annotations, else an
  `[ANNOTATIONS: arrow Bold button→Title; circle cell A3; label "totals" on D6. DO NOT acknowledge
  this message.]` block — names via `displayName` (fall back to raw id so a stale id is never
  blank), never coordinates. Sent through the same deduped `makeChangeGate` pattern C2a introduced
  (a dedicated `annotationHintGateRef`), gated on `isLive && entities.length > 0` (the same
  empty-entities honesty guard as the teaching hint).
- **Honesty invariants:** entity-anchored only (no drawing at unresolved targets); whole-call-fails
  on any unresolvable target; capped at `MAX_ANNOTATIONS`; `annotate_clear` removes everything;
  marks with no measured bbox render nothing. The agent never indicates something it can't resolve.

## 7. App integration & live wiring

- **Mount:** inside the `instructionLayerRef` wrapper, add `<AnnotationLayer entities={entities}
  dispatchRef={annotationDispatchRef} onStateChange={setAnnotationSnapshot} />` next to
  `TeachingLayer`. New refs: `annotationDispatchRef` (dispatch seam) and `annotationSnapshot`
  state (for the text channel), paralleling the teaching pair.
- **Live tool set:** extend `voiceTools` to `[...VOICE_TOOLS, ...buildActionTools(activeProgram),
  ...ANNOTATE_TOOLS]`. Annotations carry no posture routing, so this is independent of Teaching
  Plan 2.
- **Routing:** in `handleVoiceToolCall`, add an `annotate_*` branch: `annotateCallToEvent(fc,
  entitiesRef.current)`; on `error`, `sendToolResponse(..., { success: false, error })`; else
  `annotationDispatchRef.current?.(event)` and `sendToolResponse(..., { success: true })`. Follows
  the existing `respond`/`share` routing shape (resolve → dispatch → ack).
- **Text-channel effect:** a deduped `[ANNOTATIONS]` send effect mirroring C2a's `[TEACHING STATE]`
  effect (`isLive && entities.length > 0`, `annotationHintGateRef`, `serializeAnnotations`).
- **Prompt:** a short note in `buildInstructions` (`src/prompt/instructions.ts`) that the agent may
  illustrate with `annotate_*` to point at and connect on-screen elements, and must `annotate_clear`
  when the explanation is done — keep drawing sparse and in service of an explanation, not decoration.

## 8. Demo path (no key)

A scripted annotation demo proves the vocabulary without a live model, mirroring `?teach=1`. Add a
small **`?illustrate=1`** script (a sibling to the teaching demo, kept separate so the two concerns
don't entangle) that dispatches a short sequence (`annotate_shape circle` on a control,
`annotate_arrow` to another, `annotate_label`, then a delayed `annotate_clear`) through
`annotationDispatchRef` once entities exist. StrictMode-safe scheduling like the teaching demo
(fire-once guard set when the first dispatch FIRES, re-arm only if nothing fired).

## 9. Testing

- **Pure mapper (`annotateCallToEvent`):** each of the four tools with resolvable targets → correct
  event; an unresolvable `from`/`to`/`target`/`anchor` → whole-call error; empty `targets` → error;
  `placement` default `'top'`.
- **Pure reducer:** `annotate.add` stamps sequential ids and appends; exceeding `MAX_ANNOTATIONS`
  drops the oldest; `annotate.clear` empties but keeps `nextId` monotonic.
- **Pure `serializeAnnotations`:** empty → `null`; each kind rendered by name; missing entity →
  raw-id fallback (never blank); ends with `DO NOT acknowledge this message.]`.
- **jsdom render test for `AnnotationLayer`:** an arrow between two entities renders an SVG line
  whose endpoints track the two bboxes; a `circle` shape over a group renders an ellipse covering
  the group bounding box; an unmeasured anchor renders nothing. (The render-test class the project
  has owed since `TeachingLayer` — this is where a viewBox/geometry bug would hide.)
- **Human smoke (owed, needs a key):** live `annotate_arrow`/`annotate_shape`/`annotate_label`
  draw the right marks over the right elements; an `[ANNOTATIONS]` hint arrives naming them;
  `annotate_clear` removes them; an unresolvable target returns an honest error to the model.

## 10. Files

| File | Responsibility |
|---|---|
| `src/annotations/types.ts` *(new)* | `Annotation` union, `AnnotationSpec`, `AnnotationEvent`, `AnnotationState`. |
| `src/annotations/annotationStore.ts` *(new)* | `initialAnnotationState`, `reduce`, `MAX_ANNOTATIONS`. |
| `src/annotations/annotateTools.ts` *(new)* | `ANNOTATE_TOOLS`, `annotateCallToEvent`. |
| `src/annotations/AnnotationLayer.tsx` *(new)* | SVG renderer mounted in the C2a seam. |
| `src/annotations/serialize.ts` *(new)* | `serializeAnnotations` — the `[ANNOTATIONS]` text channel. |
| `src/annotations/*.test.ts(x)` *(new)* | Unit tests for mapper, reducer, serializer + the AnnotationLayer render test. |
| `src/App.tsx` | Mount `AnnotationLayer`; `annotationDispatchRef` + `annotationSnapshot`; `ANNOTATE_TOOLS` in `voiceTools`; `annotate_*` routing in `handleVoiceToolCall`; the `[ANNOTATIONS]` send effect; demo wiring. |
| `src/prompt/instructions.ts` | A short "you may illustrate" note. |

No changes to `TeachingLayer`, the teaching reducer/selectors, or C2a's perception plumbing —
this project only adds a sibling subsystem into the seam C2a built.

## 11. Out of scope (→ post-C2b "whiteboard")

- Free-coordinate diagrams and freehand strokes untethered to elements (need C2b live perception).
- Drawing in whitespace not anchored to any element.
- Animated/step-revealed diagram build-up, multi-color palettes, and richer diagram primitives
  (flowchart nodes, timelines) — deferred until the anchored core proves out.

## 12. Sequencing note

C2a-illustrate is the third foundation of Project C. C1 gives the anchors, C2a gives the
perception, this gives the authoring vocabulary. C2b (live perception + word-level pointing) both
adds finer anchors (a word) that annotations can target and unlocks the deferred whiteboard (honest
free-coordinate drawing). C3 (goal model) is separable. The entity-anchored toolkit rendered into
the C2a seam is the deliverable; the existing highlight/relate marks are the proof the anchoring
and perception already work.
