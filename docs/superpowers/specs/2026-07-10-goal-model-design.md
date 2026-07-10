# Goal Model (Project C3) — Design Spec

*Give the agent a model of what the user is trying to **accomplish** across turns, and use it to
proactively suggest the next step — honestly. A structured goal state tracks the objective +
progress deterministically; the LLM proposes candidate next steps; the structured state validates
every proposal before it surfaces as an offer the user accepts or dismisses. The agent proposes;
the user commits. Final foundation of Project C.*

Date: 2026-07-10
Branch: `honest-mode`
Status: Approved design — ready for implementation planning.
Decision record:
- **Primary job = proactive next-step suggestion** (forward momentum), resting on a tracked goal.
- **Hybrid derivation:** a structured goal model tracks objective + progress *deterministically*;
  the LLM *proposes* candidate next steps; a deterministic gate *validates* each proposal against
  the structured state before it can surface. The structured model is the guard the LLM cannot
  talk past.
- **A suggestion is an offer, never an action.** Accepting routes through the existing witnessed
  action flow — nothing new bypasses confirmation. The agent never auto-advances.
- **Honest by grounding:** the goal is stated/confirmed (not a silent guess acted upon); progress
  is read from real committed actions; suggestions are validated against deterministic state.

---

## 1. Principle: the honest suggest→offer→act loop

Project C's other foundations are about the *input/grounding* side — what the user points at (C1),
what the agent perceives (C2a), the word as a referent (C2b). C3 is the missing *objective* side:
the agent understanding the user's higher-level goal and moving it forward. Today nothing tracks a
goal across turns — `TASK_LIBRARY` is authored carousel suggestions, `ReferentRegistry` is
short-term anaphora only, and teaching sequences are the closest structure but teaching-specific.

The honesty risk of a "proactive" agent is that it *guesses* a goal and nudges the user toward it.
C3 avoids that by making the structured goal state the guard between the LLM and the user: the goal
is stated/confirmed, progress is deterministic from real actions, and every LLM-proposed suggestion
is validated against that state before it can be offered. A suggestion is only ever an *offer* —
accepting it issues the step through the normal witnessed grammar.

## 2. The structured goal state (deterministic)

`src/goal/goalStore.ts`:

```ts
export interface GoalStep {
  id: string;               // stable within the goal (deterministic, monotonic)
  label: string;            // human-readable, e.g. "Save the document"
  verb?: string;            // optional action verb this step corresponds to (e.g. 'save_file')
  target?: string;          // optional element/target the verb acts on
  done: boolean;
}

export interface GoalState {
  objective: string | null; // null = no active goal
  steps: GoalStep[];
  nextId: number;           // deterministic id source
}

export type GoalEvent =
  | { type: 'goal.set'; objective: string; steps: { label: string; verb?: string; target?: string }[] }
  | { type: 'goal.stepDone'; id: string }        // explicit
  | { type: 'goal.actionCommitted'; verb: string; target?: string } // deterministic marking (§3)
  | { type: 'goal.clear' };

export function initialGoalState(): GoalState;      // { objective: null, steps: [], nextId: 1 }
export function reduce(state: GoalState, event: GoalEvent): GoalState;

// selectors
export function nextPendingStep(state: GoalState): GoalStep | null; // first !done step, or null
export function isStepDone(state: GoalState, id: string): boolean;
```

- `goal.set` replaces the goal: stamps deterministic ids (`String(nextId++)` per step), all `done:false`.
- `goal.stepDone` marks one step done by id.
- `goal.actionCommitted` (§3) marks the first pending step whose `verb` (and, if present, `target`)
  matches the committed action — deterministic progress from what actually happened.
- `goal.clear` resets to `initialGoalState()` but keeps `nextId` monotonic (ids never collide).

## 3. Deterministic progress tracking

Progress reflects the document, not a guess. In the existing action commit paths
(`handleVoiceToolCall`'s commit branch and `confirmPendingAction`), after an action commits, dispatch
`goal.actionCommitted { verb, target }`. The reducer marks the first pending step whose `verb`
matches (and `target` matches when the step specifies one). So a `save_file` commit marks the
"Save" step done; an unrelated action marks nothing. No perception, no inference — real events only.

## 4. The tools: LLM proposes, structured state validates

`src/goal/goalTools.ts`:

```ts
export const GOAL_TOOLS: VoiceTool[]; // set_goal, suggest_next

// set_goal: the LLM proposes the goal structure (from the user's declaration or an inference the
// user okays). { objective: string, steps: [{ label, verb?, target? }] }.
// suggest_next: the LLM proposes the next step to OFFER.
//   { label: string, why?: string, verb?: string, target?: string }.

export type GoalProposal =
  | { kind: 'set'; objective: string; steps: { label: string; verb?: string; target?: string }[] }
  | { kind: 'suggest'; label: string; why?: string; verb?: string; target?: string };

export function goalCallToEvent(
  call: { name: string; args: any },
): { kind: 'set'; event: GoalEvent } | { kind: 'suggest'; proposal: GoalProposal } | { error: string };

// The deterministic gate: a suggestion may surface only if it is consistent with GoalState.
// Rejects: (a) no active objective AND the suggestion isn't establishing context; (b) a label/verb
// that matches an already-`done` step. Returns null when OK, else an honest reason string.
export function validateSuggestion(state: GoalState, proposal: GoalProposal): string | null;
```

- `set_goal` → a `goal.set` event. The goal is **confirmed** before it is tracked (§5) — the app
  surfaces the proposed objective/steps and the user okays it (or the user's own explicit
  declaration is the confirmation).
- `suggest_next` → a proposal that MUST pass `validateSuggestion(GoalState, proposal)` before it can
  render. On failure the app returns the reason to the model (no surface, no nag). On success it
  renders the offer card (§6). The structured state is the guard the LLM cannot bypass.

## 5. Confirmation of the goal

`set_goal` does not silently start tracking. The app **uniformly** witness-renders the proposed
objective + steps (reusing the pending-confirmation pattern) and the user confirms — *then*
`goal.set` commits. One rule, no branching on whether the goal was user-declared or agent-inferred:
the app can't reliably tell the two apart (the model calls `set_goal` in both cases), and a quick
confirm of a goal the user just stated is cheap and unambiguous. Rationale: the honesty thesis
forbids acting on an inferred goal without an explicit yes, and a tracked goal that drives
suggestions is consequential enough to confirm once. Cancelling the confirmation leaves no goal
tracked.

## 6. The suggestion surface — a next-step offer card

A dedicated **next-step offer card** in the existing bottom-center witness area, styled like the
`share`/pending witness cards the user already knows:

```
Next  ·  suggested
Share the report with your editor
why: it's saved and formatted — the last step of "get the report ready to send".
[ Accept ]  [ Dismiss ]     or say "yes"
```

- **Accept** routes the step through the **normal grammar**: if the suggestion carries `verb`+`target`,
  the app issues that action, which then follows its own witness/commit policy (a suggested `share`
  still witness-renders its recipient before sending — no double-jeopardy bypass); if it's an
  informational nudge (no verb), Accept simply acknowledges and clears.
- **Dismiss** clears the suggestion.
- **At most one** suggestion is active at a time; a new `suggest_next` replaces the prior. No nagging.

## 7. Perception (the `[GOAL STATE]` hint)

A pure `serializeGoalState(state): string | null` emits a deduped `[GOAL STATE: objective "…" — step
2 of 4 done. Next pending: "Save". DO NOT acknowledge this message.]` via the C2a `makeChangeGate`
pattern (a `goalHintGateRef`), gated on `isLive` and an active objective. Keeps the model's view
equal to the deterministic truth — so it proposes against the real progress, not its own memory. No
vision-frame change.

## 8. Honesty invariants

- **Stated/confirmed, not guessed:** a goal is tracked only after `set_goal` is confirmed (or
  user-declared); the agent never acts on an inferred goal without a yes.
- **Deterministic progress:** steps are marked done from committed actions, never inferred.
- **Validated suggestions:** every `suggest_next` passes `validateSuggestion` (no done steps, must
  have objective context) before it can surface — the structured model guards the LLM's proposals.
- **Offer, not action:** accepting a suggestion routes through the existing witnessed flow; the
  agent never auto-advances; the user commits every consequential step.
- **No drift:** the `[GOAL STATE]` hint keeps the model's view = the store's truth.
- **No nag:** one active suggestion at a time; dismiss clears it.

## 9. Testing

- **Pure reducer (`goalStore`):** `goal.set` stamps ids + all-pending; `goal.stepDone`;
  `goal.actionCommitted` marks the first matching pending step (verb, and target when specified) and
  nothing on a non-match; `goal.clear` keeps `nextId` monotonic; `nextPendingStep`/`isStepDone`.
- **Pure tools:** `goalCallToEvent` (set/suggest/error shapes); `validateSuggestion` — rejects a
  suggestion that matches a done step, rejects with no active objective, accepts a valid next step.
- **Pure `serializeGoalState`:** null when no objective; else objective + N-of-M done + next pending,
  ending `DO NOT acknowledge this message.]`; missing data degrades gracefully.
- **App wiring** gates on tsc + full suite + build.
- **Human smoke (needs a key):** state a goal → the agent confirms it (card) → tracked; complete a
  step (save) → `[GOAL STATE]` shows it done + a `suggest_next` offers the next; Accept issues the
  step (witnessed); Dismiss clears; a suggestion for a done step never surfaces.

## 10. Files

| File | Responsibility |
|---|---|
| `src/goal/goalStore.ts` *(new)* | `GoalState`/`GoalStep`/`GoalEvent`, reducer, selectors. |
| `src/goal/goalTools.ts` *(new)* | `GOAL_TOOLS`, `goalCallToEvent`, `validateSuggestion`. |
| `src/goal/serialize.ts` *(new)* | `serializeGoalState` — the `[GOAL STATE]` hint. |
| `src/goal/*.test.ts` *(new)* | Reducer, tools/gate, serializer unit tests. |
| `src/App.tsx` | `goalDispatchRef` + `goalSnapshot`; route `set_goal` (confirmed) / `suggest_next` (validated); `goal.actionCommitted` in the commit paths; `[GOAL STATE]` effect; the next-step offer card + accept/dismiss. |
| `src/prompt/instructions.ts` | A note: when to `set_goal` (and that it's confirmed), when to `suggest_next` (validated, one at a time), and that suggestions are offers the user drives. |

No changes to teaching, the entities, or the perception plumbing — C3 adds a sibling goal subsystem.

## 11. Sequencing note

C3 is the last foundation of Project C. C1 gave granular anchors, C2a the agent's perception of its
own teaching, C2a-illustrate the annotation vocabulary, C2b the word as a full referent — all the
*grounding* side. C3 adds the *objective* side: an honest model of what the user is accomplishing,
driving proactive-but-offered next steps. A future pass could unify the goal model with the teaching
sequence structure (both are tracked multi-step procedures); C3 keeps them separate and does not
refactor teaching. The structured-state-as-guard, LLM-proposes, offer-not-action loop is the
deliverable.
