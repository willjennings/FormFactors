# Teaching Form Factor — Foundation (Plan 1 of 2) — Design Spec

*An agent that TEACHES inside the live UI — highlighting elements, sequencing steps with numbered
markers and subgoal labels, soft-blocking off-path actions, and drawing relationships — with an
adaptive guide→teach→fade posture. Evidence-grounded by the deep-dive research report
(`docs/superpowers/research/2026-07-02-learning-teaching-deep-dive.md`); this foundation is
agent-free (scripted demo), with scribe wiring as Plan 2. R6 of the architecture review, expanded.*

Date: 2026-07-02
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: the `src/teaching/` foundation — pure reducer + overlays + tools/mapper + telemetry +
`?teach=1` scripted demo. NOT in scope: wiring the live voice agent (Plan 2), authored tour
content, cross-program curricula.

---

## 1. Positioning (the decision the evidence forced)

**Adaptive: guide → teach → fade.** Overlays reliably buy *execution* (Stencils: 26% faster, no
better retention); *retained learning* requires the learner to generate (do/recall/label). So one
mode, two postures, and mandatory fading:
- **guide** — get the task done: highlight + numbered steps + soft-block; agent/learner advances.
- **teach** — build the skill: agent shows the first step worked; **the learner performs each
  step** (only learner action on the target advances); retrieval beats before reveals.
- **fade** — all scaffolding withdraws gradually with per-task competence (expertise reversal).

## 2. Evidence constraints (binding, from the research report)

1. Emphasis renders ON the element (banner blindness kills detached callouts).
2. One step visible at a time, at the moment of action (front-loaded hints decay in ~20s).
3. Steps grouped under **subgoal labels** naming WHY (d=0.44; halves at-risk failure).
4. **Terse voice**: one short sentence per step — verbiage is a measured cost (d=0.89).
5. **Soft-block over explain** during scaffolded sequences (training wheels: blocking beat
   instruction) — but never block leaving the path entirely (paradox of the active user).
6. **Fading is not optional**: gradual (Renkl), asymmetric (asking for help always works).
7. `relate()` is an **experiment** — no verified evidence; instrument, don't assume.
8. Teaching intensity ∝ task complexity — don't tutorial the simple.

## 3. State model — `src/teaching/types.ts`

```ts
import type { EntityId } from '../entities/registry';

export type TeachPosture = 'guide' | 'teach';
export type FadeLevel = 0 | 1 | 2;
// 0 = full scaffold (numbered markers + subgoal labels + soft-block)
// 1 = highlights only (markers/labels dropped, no block)
// 2 = learner-does-it (prompt only; visuals on request or stall)

export type StepState = 'pending' | 'active' | 'done' | 'skipped';

export interface TeachStep {
  entityId: EntityId;
  subgoal: string;        // WHY — short functional label
  instruction: string;    // ONE short sentence (terse-voice constraint)
  state: StepState;
}

export interface TeachSequence {
  title: string;
  taskKey: string;        // competence bucket (fading is per task family)
  posture: TeachPosture;
  steps: TeachStep[];
  activeIndex: number | null;
  softBlock: boolean;     // derived-at-start: fadeLevel === 0
  paused: boolean;        // learner left the path (allowed, never an error)
  blockedAttempts: number;                             // telemetry counter
  lastBlocked?: { entityId: EntityId; at: number };    // drives the transient disablement toast
}

export interface TeachHighlight { entityId: EntityId; note?: string; at: number }
export interface TeachRelation { from: EntityId; to: EntityId; label: string }

export interface TeachingState {
  posture: TeachPosture;
  sequence: TeachSequence | null;
  highlights: TeachHighlight[];
  relations: TeachRelation[];
  competence: Record<string, number>;   // taskKey → completed sequence count
  revealRequested: boolean;             // fade≥1 "show me" — one-step scaffold restore
}

export type TeachingEvent =
  | { type: 'teach.highlight'; entityId: EntityId; note?: string }
  | { type: 'teach.sequence'; title: string; taskKey: string; posture: TeachPosture;
      steps: { entityId: EntityId; subgoal: string; instruction: string }[] }
  | { type: 'teach.stepAdvance' }                      // guide posture: agent confirms
  | { type: 'teach.relate'; relations: TeachRelation[] }
  | { type: 'teach.clear' }
  | { type: 'user.stepAction'; entityId: EntityId }    // learner acted on an entity
  | { type: 'user.reveal' }                            // "show me" — restores scaffold for ONE step
  | { type: 'user.pause' } | { type: 'user.resume' } | { type: 'user.dismiss' };
```

## 4. Reducer & fading — `src/teaching/teachingStore.ts` + `selectors.ts`

Pure `reduce(state, event, now)`, ramble-foundation discipline (injected clock, never throws,
unknown entity ids no-op).

**Advancement rule (the posture difference):**
- `guide`: `teach.stepAdvance` OR `user.stepAction(target)` advances the active step.
- `teach`: ONLY `user.stepAction(target)` advances (except step 0, which the agent may advance —
  the worked first step). `teach.stepAdvance` in teach posture is a no-op past step 0.

**Off-target action while a sequence is active:**
- At fade 0 with `softBlock`: `user.stepAction(otherTileId)` does NOT advance and flags a
  `blockedAttempt` (drives the disablement toast naming the active subgoal). Never an error tone.
- Non-tile interaction (sidebar/map/dismiss) is untouched; `user.pause` marks the sequence paused
  rather than failed (active-user tolerance). `user.resume` restores the active step.

**Fading:** `fadeLevel(state, taskKey) = min(2, state.competence[taskKey] ?? 0)` — derived, never
stored. Sequence completion (`last step done`) increments `competence[taskKey]`. `user.reveal` sets
`revealRequested` (selector treats the active step as fade 0 until it advances) — asking always
works; fading only withdraws unsolicited scaffold.

**Selectors:** `activeStep`, `fadeLevel`, `visibleScaffold(state) → { markers, labels, block,
highlightOnly, promptOnly }` (the single source the renderer reads), `blockedEntityIds`.

## 5. Overlays — `src/teaching/TeachingOverlay.tsx` (+ HighlightRing, StepBadge, SoftBlockScrim, RelateLink)

Absolutely positioned over the main container, anchored from entity bboxes (0-1000 space →
percentages). All emphasis is ON the element (constraint 1):
- **HighlightRing** — ring + subtle glow in the entity's category hue; optional ≤3-word note
  attached at the ring edge.
- **StepBadge** — numbered circle on the active step's entity + subgoal chip (`② Save your work`).
  Exactly ONE active step rendered (constraint 2); done steps collapse to small ✓ dots at their
  entities (glanceable progress, no progress bar).
- **SoftBlockScrim** — fade-0 sequences only: low-opacity scrim over non-target *scene tiles* with
  a hole over the target (Stencils geometry). Clicks on scrimmed tiles → disablement toast
  ("Not yet — ② Save your work first"), Carroll semantics: inert, informative, never punitive.
  Sidebar, map, and dismissal are never scrimmed.
- **RelateLink** — SVG arcs between entity anchors with a mid-label. Instrumented as the
  experiment it is (constraint 7).

## 6. Tools + mapper — `src/teaching/teachTools.ts` (defined now, wired in Plan 2)

`TEACH_TOOLS: VoiceTool[]`: `teach_highlight(target, note?)`, `teach_sequence(title, taskKey,
posture, steps[{target, subgoal, instruction}])`, `teach_step_done()`, `teach_relate(pairs)`,
`teach_clear()`.

Pure `teachCallToEvent(call, entities) → TeachingEvent | { error: string }`: every `target`
resolves via **`resolveEchoedTarget`** (aliases + threshold — R2's payoff). An unresolvable step
target fails the WHOLE call with an error naming the unmatched target — the agent never teaches at
a guessed element (honesty over helpfulness).

## 7. Telemetry — the guidance rubric

New events tagged `interactionMode: 'guidance'` (extends the modality pattern): sequence
started/completed/abandoned/paused, per-step duration, `blockedAttempts`, `reveals`, fade level,
posture, relate-shown/relate-used. Scoring is **forgiving** (right region/entity-class = success —
a generous highlight still teaches) but anchored by hard outcomes so it isn't unfalsifiable:
completion, and unaided repetition (fade-2 completion of the same taskKey). Guide vs teach vs fade
become measurable arms of the UX exploration.

## 8. Scripted demo — `?teach=1`

Mounts the normal App scene plus a demo driver (no key needed): plays `teach_highlight` → a 3-step
`teach_sequence` (guide posture, soft-block on) over real scene entities → simulates completion →
replays the same taskKey to demonstrate fade 1 → a `teach_relate` pair. Interactions are real
(clicking the target advances; clicking a scrimmed tile shows the disablement toast). This is the
glance-testable proof before any agent exists.

## 9. Error handling & degradation

- Unknown/missing entity id in any event → reducer no-ops (never throws).
- Entities not yet measured (zero bboxes) → overlays render nothing (selector filters zero boxes).
- Overlay layer is purely additive: `?teach=1` off ⇒ zero change to existing modes.
- Tool mapper errors are data (returned to the agent in Plan 2), never thrown.

## 10. Testing

- **Pure (vitest):** reducer — posture advancement rules (incl. teach-posture step-0 exception),
  soft-block/blockedAttempt, pause/resume, dismissal; fading schedule (0→1→2, reveal restores one
  step, completion increments competence); selectors (`visibleScaffold` per fade level);
  `teachCallToEvent` (resolution via aliases, whole-call honest failure).
- **Scripted-demo assertions:** the demo's event sequence through the reducer reaches the expected
  end state (same pattern as ramble's `scriptedDemo.test.ts`).
- **Build + manual check:** `?teach=1` — overlays anchor correctly, one step at a time,
  soft-block toast, fade on second run.

## 11. Build order (informs the plan)

1. `types.ts` + `teachingStore.ts` reducer + `selectors.ts` (TDD — the fading engine is the core).
2. Overlay components + `?teach=1` demo mount + demo assertions.
3. `teachTools.ts` + `teachCallToEvent` + soft-block interaction wiring into the scene.
4. Telemetry (guidance events + forgiving rubric) + competence persistence (sessionStorage,
   fail-soft).

Plan 2 (separate spec): scribe wiring — teaching posture routing in the system prompt, voice
discipline (subgoal + one sentence), live smoke.
