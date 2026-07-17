# Teaching Plan 2 (live scribe wiring) — Design Spec

*Wire the teaching foundation to the live voice agent — the model drives guide/teach/just-do-it
posture through the existing `TEACH_TOOLS`, with the store's competence-driven fade staying
deterministic. Two interaction contracts the foundation flagged are honored: no double-advance
between the agent's pacing and the user's clicks, and no deixis contention while a sequence is
active. Completes the teaching form factor the foundation (`606a4da..9373b73`) deliberately left
agent-free.*

Date: 2026-07-13
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record:
- **Model judgment for posture** (guide / teach / just-do-it) via a system-prompt section; the
  store's **competence fade is deterministic** (repeat a taskKey → scaffolding recedes on its own).
  The model picks posture; the store governs intensity — mirroring C2a-illustrate/C3.
- **Live-wire via the existing pattern:** `TEACH_TOOLS` → `voiceTools`; `teach_*` routed through the
  already-tested `teachCallToEvent` mapper → `teachingDispatchRef`; mapper errors are data.
- **Contract A (advancement authority):** gated at the click dispatch site — clicks advance only in
  the no-key demo OR teach posture; live guide is agent-paced.
- **Contract B (deixis vs teaching):** the proactive grounding hint is muted while a sequence is
  active, so the teaching model isn't fed spurious "pointed command" context.

---

## 1. Principle: let the model drive what it already perceives

The teaching foundation is complete: `TeachingLayer` (rings / relate arc / numbered steps /
soft-block / fade), the `teachingStore` reducer (posture, competence, deterministic fade), the
`TEACH_TOOLS` + `teachCallToEvent` mapper, and the `?teach=1` scripted demo. It is driven today only
by the demo script, the rail's "show me", and surface-click step-advance — **not by the live
model**. C2a already made teaching *perceivable* to the model (overlays in the vision frame + the
`[TEACHING STATE]` hint, which names the active posture). Plan 2 supplies the missing half: the
model *drives* the teaching it already sees, choosing when and how to teach.

## 2. Live wiring

- Add `...TEACH_TOOLS` to the `voiceTools` memo (available in every program, like the other
  instructional tool sets).
- In `handleVoiceToolCall`, add a `teach_*` branch (before the `annotate_` branch), mirroring the
  annotation routing:
  - `const mapped = teachCallToEvent(fc, entitiesRef.current);`
  - `'error' in mapped` → `sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error })`
    (the **mapper-error-is-data** contract — an unresolvable target is reported, never thrown).
  - else → `teachingDispatchRef.current?.(mapped)` + `sendToolResponse(..., { success: true })`.
- The existing **G9 idempotency deduper** in `handleVoiceToolCall` already drops a re-emitted
  duplicate `teach_step_done` within its window — so model-side duplicate advances are handled with
  no new code.
- No change to the reducer, selectors, `TeachingLayer`, or the mapper — all foundation-complete.

## 3. Contract A — advancement authority (no double-advance)

The hazard: in a live **guide** sequence the *agent* paces via `teach_step_done`
(→ `teach.stepAdvance`), but a user click on the active-step control ALSO dispatches
`user.stepAction` (`handleSurfaceElementClick:1359`) — both call the reducer's `advance()`, skipping
a step. Yet the `?teach=1` demo *needs* clicks to advance guide sequences (no agent is present). And
in **teach** posture the user is *supposed* to advance by acting. So advancement authority is
posture-and-liveness scoped, gated at the **click dispatch site** (keeping the reducer pure):

```ts
// src/teaching/advanceOnClick.ts — pure.
export function advanceOnClick(isLive: boolean, posture: TeachPosture | null): boolean {
  // Demo (no agent) → clicks pace any sequence. Live → clicks pace only teach posture
  // (the user performs the steps); live guide is agent-paced via teach_step_done.
  return !isLive || posture === 'teach';
}
```

In `handleSurfaceElementClick`, gate the `user.stepAction` dispatch: dispatch it only when
`advanceOnClick(isLive, teachingSnapshotRef.current?.sequence?.posture ?? null)` is true. (The
element-selection / grounding / rail paths in that handler are unchanged — only the teaching
step-advance dispatch is gated.) A live guide click still selects/grounds the element; it just
doesn't double-advance the sequence.

## 4. Contract B — deixis vs teaching contention

The proactive grounding hint (`[CONTEXT: the cursor is over "X"…]`, sent on hover for non-Gemini
backends) fires on every hover, including mid-sequence — feeding the teaching model spurious
"pointed command" context. Resolution: **suppress the proactive deixis hint while a teach sequence
is active.** In the hover handler, guard the hint send with `!teachingSnapshotRef.current?.sequence`
(no active sequence). The "Pointing at" pill still renders locally; only the silent model hint is
gated. The model stays in teaching mode rather than being nudged to execute grounded commands.
(A `teachingSnapshotRef` mirror of `teachingSnapshot` is added for stale-closure-free reads in the
hover handler + click gate, matching the existing ref pattern.)

## 5. The posture prompt (the scribe intelligence)

A section in `buildInstructions` (`src/prompt/instructions.ts`) teaching the judgment:

- **Just do it** (no teaching — call the action verb / respond): the user wants the task done —
  "save it", "make it bold", "add a slide".
- **`guide`** (`teach_sequence` posture `guide`): a quick walkthrough — "how do I save?", "walk me
  through it". Numbered steps; **you pace** (narrate, then `teach_step_done` to advance).
- **`teach`** (posture `teach`): learn-by-doing — "show me how", "teach me", "let me try". You
  demonstrate step 1, then **the user performs** each remaining step (you do not advance past step 0).
- **Intensity ∝ complexity:** never build a sequence for a one-step task — just act, or a single
  `teach_highlight`. Reserve `teach_sequence` for genuinely multi-step tasks.
- **Terse voice:** one short sentence per step; the guideLine you *speak* is one warm sentence — step
  detail lives in the overlays, not your voice (verbiage is a measured cost, d=0.89).
- **Fade is automatic:** `[TEACHING STATE]` reports the fade level and posture; on a repeat task be
  terser and re-explain less — the overlays recede on their own. Call `teach_clear` when the user
  moves on or the task is done.

## 6. Perception — no new work

Teaching is already perceived (C2a): the overlays render into the vision frame, and
`serializeTeachingState` sends `[TEACHING STATE]` (active step, blocked set, fade, **posture**).
Plan 2 adds no perception; Contract B keeps that context clean by muting deixis mid-sequence. The
model's view of teaching is the store's truth, unchanged.

## 7. Honesty invariants

- **Errors are data:** an unresolvable teach target is reported to the model, never thrown (a
  sequence over a non-existent element simply isn't started; the model is told why).
- **The user drives consequential steps:** teach posture requires the *user* to perform each step;
  the agent never auto-completes the user's task under the guise of teaching.
- **No double-advance / no drift:** Contract A prevents a step being skipped by two authorities;
  `[TEACHING STATE]` keeps the model's view equal to the store.
- **Fade is honest recession, not a claim:** scaffolding recedes on mastery (competence), never
  asserting the user knows something they don't — and the model is *told* the fade level rather than
  guessing it.

## 8. Testing

- **Pure (vitest):** `advanceOnClick(isLive, posture)` — the four cases (demo→true, live+guide→false,
  live+teach→true, live+null→false). (`teachCallToEvent` + the reducer's posture advancement rules
  are already foundation-tested.)
- **Integration** (`voiceTools`, `teach_*` routing, the click gate, the deixis mute): tsc + full
  suite + build.
- **Live smoke (owed, needs an API key):** "how do I save?" → agent-paced guide sequence; "teach me
  to add a slide" → teach posture, the user performs the steps (agent stops at step 0); "just save
  it" → the action fires, no sequence; repeat the same task → terser, less scaffold (fade);
  confirm the proactive deixis hint is muted while a sequence is active; an unresolvable target
  returns an honest error to the model.

## 9. Files

| File | Responsibility |
|---|---|
| `src/teaching/advanceOnClick.ts` *(new)* | The pure click-gate `advanceOnClick(isLive, posture)`. |
| `src/teaching/advanceOnClick.test.ts` *(new)* | Its unit tests. |
| `src/App.tsx` | `...TEACH_TOOLS` in `voiceTools`; `teach_*` routing in `handleVoiceToolCall`; a `teachingSnapshotRef` mirror; gate the `user.stepAction` dispatch via `advanceOnClick`; mute the proactive deixis hint while a sequence is active. |
| `src/prompt/instructions.ts` | The posture-routing section (§5). |

No changes to `teachingStore`, selectors, `TeachingLayer`, `teachTools`, or the demo — the
foundation is complete; Plan 2 only wires and prompts.

## 10. Sequencing note

Plan 2 completes the teaching form factor: the foundation built the mechanism + perception (via
C2a), and this lets the live agent drive it with honest posture judgment. It is the teaching analog
of the annotation (C2a-illustrate) and goal (C3) live wirings — the last of the instructional
subsystems to reach the live model. Deferred still: an authored guided *tour*, learner-generated
tagging, and the `relate()` efficacy question flagged in the research deep-dive — all separable.
