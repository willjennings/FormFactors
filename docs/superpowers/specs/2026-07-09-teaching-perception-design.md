# Teaching Perception (Project C2a) — Design Spec

*Make the agent's teaching overlays perceivable to the model — WYSIWYG pixels in the vision
frame plus a structured `[TEACHING STATE]` text hint — so the agent can witness its own teaching
(where its scaffold landed) and track the learner's progress (which step, what's blocked, the fade
level). Second foundation of Project C (audit gaps 4+5). Builds on C1's entities; lays the seam the
C2a-illustrate annotation vocabulary will plug into.*

Date: 2026-07-09
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record:
- Purpose = **both** self-witness (verify the scaffold landed on the right element) and
  progress-tracking (see how far the learner is), treated as one perception surface.
- Visual approach = **WYSIWYG snapshot** (rasterize the actual teaching DOM), not a schematic
  redraw — a second renderer would reintroduce the model-vs-reality gap C2a exists to close.
- Channels = **dual** (pixels + a structured `[TEACHING STATE]` hint), mirroring the established
  spreadsheet pattern (pixels + `[SPREADSHEET DATA]`); never labels-only (learnings §4).
- The Khan-Academy-style **annotation vocabulary is deferred to C2a-illustrate** — C2a builds only
  the perception seam it plugs into.

---

## 1. Principle: build the perception seam, make today's overlays visible

The agent teaches by rendering `TeachingLayer` — numbered step rings, the relate arc, "Point
here", the soft-block scrim, competence-based fade. Today the model sees **none of it**: the
vision frame's surface snapshot captures only `ProgramSurface` (`snapshotNode(surfaceRef.current)`),
and `TeachingLayer` is a DOM *sibling* in a different coordinate subtree, so it never rasterizes.
`teachingSnapshot` state feeds only the soft-block selector and the shell rail — it is never sent
to the model, visually or textually. So the agent teaches blind: it draws a ring on step 2 with no
perception that the ring exists, where it landed, which step the learner is on, or that it
soft-blocked anything. That is a direct honesty violation — it cannot witness its own teaching.

C2a closes this with **one new DOM seam** and the plumbing that consumes it, using the same
extension-point philosophy as C1 (`SubEntityDeriver`): build the seam once; future adopters (the
C2a-illustrate annotation renderer) drop *inside* it and inherit perception with no further change
to the vision loop.

## 2. The instructional overlay layer (the seam)

A transparent, plane-spanning wrapper node — `instructionLayerRef` — that today contains
`TeachingLayer` and tomorrow contains the annotation renderer:

```tsx
<div ref={instructionLayerRef} className="absolute inset-0 pointer-events-none">
  <TeachingLayer entities={entities} program={program} demo={teachMode}
    dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
</div>
```

- **Plane-spanning, same 0–1000 space as entities.** `TeachingLayer` positions marks at
  `pct(bbox) = bbox/10 %` of its container; the wrapper is `absolute inset-0` over the main plane,
  the same plane entity bboxes are measured against in `updateLayout`. So the wrapper's snapshot
  composites at full frame extent and lines up over the reconstructed window automatically — no
  per-mark coordinate math.
- **Transparent except where marks are drawn** (`pointer-events-none`, no background) so its
  snapshot is alpha — only the teaching marks land when composited, the surface pixels underneath
  show through.
- **Scope boundary:** the wrapper is the *teaching/annotation* layer only. The trace canvas
  (`traceCanvasRef`, the agent's pointer trace) and the red crosshairs stay outside it — they are
  already reconstructed schematically in the vision frame, so wrapping them would double-draw.

## 3. Visual channel — transparent WYSIWYG composite

The model's teaching pixels **are** the user's teaching pixels, or they are absent — never a
reconstruction that could drift.

- **Reuse `snapshotNode(node)`** — no new snapshot function. `toCanvas` (html-to-image 1.11.x)
  fills a background **only** when `options.backgroundColor` is set, and `snapshotNode` never sets
  it, so its output is already transparent where the node is transparent. The instruction layer is
  transparent except where marks are drawn, so `snapshotNode` yields exactly the alpha canvas we
  want — only the marks composite, the surface underneath shows through. (A separate
  `*Transparent` variant would be a byte-identical duplicate.) A one-line comment at the
  instruction-snapshot call site records that the transparency relies on `snapshotNode` omitting
  `backgroundColor`, so a future opaque change to `snapshotNode` must not silently occlude the
  surface. Returns `null` on ANY failure, exactly as today.
- **`instructionSnapshotRef`** (a `useRef<HTMLCanvasElement | null>`), refreshed by a throttled
  effect that mirrors the existing surface-snapshot effect: `makeThrottle(500)` gate on a 250 ms
  interval, cleared to `null` immediately on program swap / window close, cancelled on unmount.
  Gated on `isLive`.
- **Composite in the vision loop.** Draw it right after the markers (M1/M2…) and before the
  document strip — it paints only the plane region `(0,0)–(VISION_SIZE, VISION_SIZE)`, so it never
  touches the doc strip below:
  ```ts
  const iCanvas = instructionSnapshotRef.current;
  if (iCanvas) { try { ctx.drawImage(iCanvas, 0, 0, VISION_SIZE, VISION_SIZE); } catch { /* keep frame clean */ } }
  ```
  Drawn at `(0, 0, VISION_SIZE, VISION_SIZE)` — the full plane extent, matching the wrapper's
  span. If `iCanvas` is `null`, draw nothing: the frame shows the bare surface, never a stale or
  schematic teaching mark.

## 4. Text channel — the `[TEACHING STATE]` structured hint

A pure serializer, in a new `src/teaching/teachingState.ts` (mirrors `serializeMockDoc` /
`formatSnapshotForModel`):

```ts
export function serializeTeachingState(
  state: TeachingState, entities: SceneEntity[],
): string | null
```

- **Returns `null` when there is no active sequence** (`state.sequence === null` or
  `state.sequence.activeIndex === null`) — nothing to say, nothing sent.
- **When a sequence is active**, emits a compact block the model reasons over instead of OCR-ing
  rings. Exact shape (names via `displayName`, resolved through the existing `activeStep`,
  `blockedEntityIds`, `fadeLevel` selectors):
  ```
  [TEACHING STATE: Guiding "<sequence.title>" — step <activeIndex+1> of <steps.length>.
   Active step: <activeStep.subgoal> — "<activeStep.instruction>" (target: <displayName(activeStep entity)>).
   Completed: <comma-list of displayName for steps with state 'done', or "none">.
   Blocked (soft): <comma-list of displayName for blockedEntityIds, or "none">.
   Fade level: <fadeLevel> (0 full / 1 partial / 2 faint). Paused: <yes|no>. DO NOT acknowledge this message.]
  ```
  - Posture word: `state.sequence.posture === 'guide'` → "Guiding", `'teach'` → "Teaching".
  - Names are entity **names** (`displayName`), never ids — the same vocabulary the model already
    grounds on. Resolution: look up the step/blocked `entityId` in `entities`; if found, use
    `displayName(entity)`; if the entity is absent (so `displayName(undefined)` would return `''`),
    fall back to the raw `entityId` string so the hint is never blank. In practice entities are
    always present for an active sequence; the fallback exists only so a stale id can never produce
    an empty, meaningless line.
- **Dedupe helper `makeChangeGate()`** (in the same file, mirroring `makeThrottle`'s closure
  pattern): returns a `(value: string | null) => boolean` that returns `true` only when `value` is
  non-null AND differs from the last value it returned `true` for; a `null` value resets the gate
  (so the next active sequence re-sends) and is itself never sent. Pure and unit-testable.
- **Wiring in App:** an effect gated on `isLive`, computing
  `serializeTeachingState(teachingSnapshot, entities)` (or `null` when there's no snapshot) and
  calling `providerRef.current?.sendTextHint(hint)` only when a `teachingHintGateRef` (holding one
  `makeChangeGate()` for the component's lifetime) returns `true` for it. This directly honors the
  R2 follow-up warning about re-sending hints every frame.

## 5. Honesty & fail-soft

- **Snapshot fails → overlay omitted, never faked.** A `null` `instructionSnapshotRef` means the
  vision frame shows the bare surface; the model is never handed a schematic teaching mark that
  might not match the live DOM.
- **Serializer is derived state, not a second source.** It reads the same selectors `TeachingLayer`
  renders from (`activeStep`, `blockedEntityIds`, `fadeLevel`), so the text and the pixels cannot
  disagree.
- **Silent context.** The hint ends with `DO NOT acknowledge this message.` (matching every other
  `[SYSTEM …]` hint) so perception never triggers speech.
- **No new token cost when idle.** Both channels are dormant unless a session is live AND a
  sequence is active — consistent with the traffic-meter / idle-watchdog discipline already in
  place. The dedupe guarantees at most one hint per teaching-state change, not one per frame.

## 6. Components & files

| File | Change |
|---|---|
| `src/vision/snapshotNode.ts` | No change — `snapshotNode` is reused as-is (already transparent-background); §3 explains why. |
| `src/teaching/teachingState.ts` *(new)* | `serializeTeachingState(state, entities)` — pure serializer, returns `string \| null`; `makeChangeGate()` — pure send-once-per-change gate. |
| `src/teaching/teachingState.test.ts` *(new)* | Serializer + `makeChangeGate` unit tests. |
| `src/App.tsx` | `instructionLayerRef` wrapper around `TeachingLayer`; `instructionSnapshotRef` + throttled refresh effect; composite step in the vision loop; `[TEACHING STATE]` deduped send effect + `teachingHintGateRef`. |

No changes to `TeachingLayer`, the teaching reducer, or the selectors — C2a is purely additive
perception plumbing around them.

## 7. Testing

- **Pure serializer (vitest):** no sequence → `null`; sequence with `activeIndex === null` →
  `null`; active sequence → "step N of M" + active step subgoal/instruction/target name; completed
  steps listed by name (or "none"); blocked entities by displayName (or "none"); fade level value;
  paused flag; posture word maps guide→"Guiding", teach→"Teaching". Degrades gracefully when an
  entity id is absent from `entities` (falls back, never throws).
- **Dedupe/gating logic (`makeChangeGate`):** identical successive values return `true` once then
  `false`; a changed value returns `true`; a `null` returns `false` and resets, so the next
  non-null value returns `true` again.
- **Snapshot path:** unchanged and reused as-is; actual rasterization stays fail-soft — jsdom
  cannot run `html-to-image`, the same boundary as today's `snapshotNode` (whose test covers only
  `makeThrottle`).
- **Human smoke (owed, needs an API key):** run `?teach=1` alongside a live session and confirm
  (a) the numbered rings / relate arc appear in the model's vision frame, (b) a `[TEACHING STATE]`
  hint arrives naming the active step and the blocked set, (c) advancing a step changes the hint
  once (not every frame), (d) on `html-to-image` failure the frame degrades to the bare surface
  with no phantom marks. This is the honest test boundary — pixel compositing + live send are
  live-only, consistent with prior sub-projects' owed smokes.

## 8. Out of scope (→ C2a-illustrate and beyond)

- **The annotation vocabulary** (the Khan-Academy "agent as illustrator" capability): a declarative
  shape/diagram schema (arrows, circles, boxes, freehand strokes, connectors, labels, small
  diagrams), an entity-anchored renderer that paints into `instructionLayerRef`, and model-facing
  draw tools so the agent authors marks live. C2a builds only the seam — anything rendered inside
  `instructionLayerRef` is perceived for free, so C2a-illustrate needs no vision-loop change.
- **Word-level / insertion-point pointing** (C2b — needs text measurement/perception).
- **The task/goal model** (C3).
- **Trace-canvas restructuring** — the pointer trace stays schematically reconstructed in the
  frame; it is not folded into the instructional layer in C2a.

## 9. Sequencing note (the wide-going trajectory)

C2a is the second foundation of Project C: it makes the agent's teaching *perceivable to itself*.
C2a-illustrate (the annotation vocabulary) renders into the seam C2a builds and is perceived with
zero vision-loop changes. C2b (live perception + word-level pointing) and C3 (goal model) build on
the richer perceived state. That inherited perception — any mark inside `instructionLayerRef`
reaching the model as WYSIWYG pixels plus, where it carries semantic state, a structured hint — is
the deliverable; the existing teaching scaffold is the proof it works.
