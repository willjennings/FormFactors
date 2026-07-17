# Mission Arcs — Design (goal-driven experience script)

**Date:** 2026-07-17
**Status:** Approved in brainstorm (missions + fading scaffold / all four arcs / carousel → mission picker / quiet completion). Spec awaiting user review.
**Closes:** Experience-audit gap 7 (script is phrase-repetition, no goal-driven entry into guide/teach/fade); drives gap 10 (multi-step visibility) through the existing goal chip; partially pays gap 8 (direct-manipulation missions complete without a key).

## 1. Problem

The task carousel scripts UTTERANCES ("Say 'What is this?'"), not goals. The thesis wants a
user with a real goal and the system's guide/teach/just-do-it judgment, witnessed actions,
and fade meeting them along the way. Every mechanism for that exists (C3 goal model, teaching
postures + competence fade, combine/artifacts, response rail, telemetry) — nothing composes
them into an arc, and nothing measures an end-to-end experience.

## 2. Core honesty stance

The agent is NEVER told "this is a scripted mission." A mission is user-side scaffolding
only: starting one dispatches a genuine goal into the C3 goal model, and the agent sees
exactly what it would see for any user-held goal — `[GOAL STATE]` with objective + steps.
No `[MISSION]` hint channel, no hidden stage directions. If the user abandons the mission,
the goal clears the same way any goal clears.

## 3. Mission model (`src/missions/` — pure, TDD)

```ts
interface MissionStep {
  key: string;
  subgoal: string;                 // shown in the goal chip / step hints
  hint: string;                    // scaffold-level utterance hint, e.g. 'Try: "fix this cell"'
  /** Deterministic completion predicate over observable state — never model claims. */
  doneWhen: (s: MissionObservables) => boolean;
}
interface MissionDef {
  key: string;                     // stable, e.g. 'ship-brief'
  title: string;
  brief: string;                   // the user-visible goal sentence (becomes the objective)
  program: ProgramId;              // where the mission starts
  steps: MissionStep[];
}
interface MissionObservables {     // assembled by App from existing state — read-only
  mockDocs: Partial<Record<ProgramId, MockDoc>>;   // fullCorpus
  artifacts: ArtifactState;
  committedActions: { verb: string; verbClass: string }[]; // from telemetry action events
  shares: number;                  // committed share/act_on count
  teaching: { sequencesCompleted: string[] };      // taskKeys from guidance telemetry
}
```

`missionRun` reducer (pure): `start(def)` → `{ def, stepIndex, startedAt }`; `advance(obs)`
checks `doneWhen` of the current step (steps complete IN ORDER; later-step predicates that
happen to be true early do not skip — the arc is the point); `complete` when the last step
passes. State is App-held; `advance` is called from a single effect subscribed to the
observable inputs.

## 4. The four arcs (Meridian world)

1. **`learn-tools` — "Learn your way around."** Teach-posture arc: ask where your tools are →
   run the save walkthrough → export. `doneWhen`: teaching sequence for `word.save` completed;
   export action committed. THE MEASUREMENT IS THE REPEAT: running it a second time should
   show measurably terser scaffolding (fade level in guidance telemetry).
2. **`ship-brief` — "Get the Q3 status brief out."** Read the report → fix the margin cell
   (edit committed on excel) → combine word+excel into a doc artifact → share it (witnessed
   outward action committed). Exercises deixis, edit, combine grammar, witness flow.
3. **`glance-numbers` — "Make the numbers glanceable."** Build a widget artifact from
   word+excel with ≥1 LIVE feed and the SIMULATED stock. `doneWhen` on artifact state
   (kind widget, feeds bound). Exercises artifacts + feeds + provenance honesty.
4. **`fix-deck` — "Make the deck match the report."** Retitle slide(s) in PowerPoint to
   match the report's project names. `doneWhen` on the powerpoint MockDoc slides content.
   Exercises slide sub-entities + revise/edit path.

## 5. Fading scaffold

Per-mission competence persisted in localStorage (same pattern/module family as teaching
persistence): `{ [missionKey]: runsCompleted }`. Run 0: mission card shows brief + current
step's `hint` (utterance-level). Run ≥1: hints hidden; only `subgoal` shows. The fade applies
to the USER-side scaffold only — the agent's `[GOAL STATE]` never carried hints in the first
place. (Teaching's own fade continues independently via its competence store.)

## 6. Surfaces

- **Mission picker:** a floating Missions panel (MenuBar Target toggle; the audit-era carousel
  was already deleted in A1) lists mission cards
  (title + brief + step count + a "run again" affordance showing runsCompleted). Program
  auto-switches to `def.program` on start. The per-program suggestion chips in the omnibox
  stay (contextual, not scripted). The old TASK_LIBRARY carousel content is deleted with the
  same de-tourism spirit as A1 (a regression test keeps "Say \"" phrasing out of the picker).
- **Progress:** the existing goal chip IS the multi-step visibility (objective + n/m). No new
  progress chrome. The current step's subgoal/hint renders inside the mission card, faint.
- **Completion:** quiet — the create-class earcon + one rail ANSWER card ("Brief shipped —
  3 steps, 2 corrections, 1:42") + goal cleared. NO confetti; the celebration era ends.
- **Abandon:** picking another mission or clearing the goal chip abandons the run
  (telemetry `mission_abandoned`), nothing nags.

## 7. Telemetry (experiment arms)

New events: `mission_start {key, run}` · `mission_step_done {key, stepKey}` ·
`mission_complete {key, run, durationMs, steps}` · `mission_abandoned {key, stepIndex}`.
Modality attribution comes free from existing per-action modality telemetry — a mission run
IS an arm (voice vs typed vs point-and-speak on the same arc). Fade measurement: guidance
events already carry fadeLevel; the mission run id ties them together.

## 8. Honesty invariants

1. Agent-side channel is ONLY the goal model — no script hints, no stage directions, no
   mission vocabulary in any prompt or hint string.
2. Step completion is deterministic observation of committed state — never inferred from
   model claims or transcripts.
3. Steps complete in order; no silent skipping (an early-satisfied later predicate waits).
4. Completion card reports measured facts (duration, corrections) — no invented praise.
5. The picker's regression test forbids utterance-scripting ("Say \"…\"") from returning.

## 9. Testing

Pure `missions/` reducer + all four arcs' predicates TDD'd against synthetic observables
(each arc: step-by-step advance, out-of-order hold, abandon, repeat-run fade state).
Picker/App wiring: tsc + suite + build (house pattern) + a browser drive of `learn-tools`
start→goal-chip→abandon and a no-key `fix-deck` (direct manipulation only) completion.
Live smoke (owed, folds into the human sitting): run `ship-brief` end-to-end by voice.

## 10. Out of scope

Authoring UI, more than four arcs, cross-mission meta-progress ("campaigns"), any change to
teaching/goal/artifact mechanics themselves, server persistence.
