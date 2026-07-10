# Goal Model (C3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent a structured, honest goal model that tracks the user's objective + progress deterministically and drives proactive next-step *offers* the user accepts (→ witnessed action) or dismisses.

**Architecture:** A pure goal store (`src/goal/`) holds objective + steps + deterministic progress. The LLM proposes via `set_goal`/`suggest_next`; a deterministic `validateSuggestion` gate guards every suggestion before it surfaces. App wires the store, routes the tools, marks steps done from committed actions, sends a deduped `[GOAL STATE]` hint, and renders three surfaces: a tentative goal chip, a next-step offer card, and (Approach A) a set_goal confirm card. A `confirmGoals` debug-drawer toggle picks whether `set_goal` confirms first (A) or tracks directly (B, default).

**Tech Stack:** React 19 (`useReducer`), TypeScript, Vitest (node — pure tests only), the existing witness/commit grammar (`pendingAction`, `confirmPendingAction`, `decideCommit`), `makeChangeGate`, the `DebugDrawer` `Switch` pattern.

**Spec:** `docs/superpowers/specs/2026-07-10-goal-model-design.md`. Final Project-C foundation.

## Global Constraints

- **The yes is on the action, not the context:** the consequential gates are `validateSuggestion` + Accept → the existing witnessed flow, in BOTH toggle modes. `confirmGoals: On` (Approach A) adds an upfront set_goal confirm; `Off` (default, Approach B) tracks directly as a tentative, dismissable chip. The agent never *acts* on an inferred goal without a yes, and never auto-advances.
- **Deterministic progress:** steps are marked done only from committed actions (`goal.actionCommitted`), never inferred.
- **Validated suggestions:** every `suggest_next` passes `validateSuggestion(GoalState, proposal)` (reject a done-step match; reject with no active objective) before it can surface. One suggestion active at a time.
- **Working assumption, not asserted fact:** the goal chip is tentative and one-tap-dismissable (`goal.clear`).
- **Deterministic ids; no `Math.random`/`Date.now`** in any pure module.
- **No drift:** the `[GOAL STATE]` hint (deduped via `makeChangeGate`, gated `isLive` + active objective) keeps the model's view equal to the store's truth.
- No changes to teaching, entities, or perception plumbing — C3 adds a sibling `src/goal/` subsystem.

---

### Task 1: The goal store (pure)

**Files:**
- Create: `src/goal/goalStore.ts`
- Test: `src/goal/goalStore.test.ts`

**Interfaces:**
- Produces: `GoalStep`, `GoalState`, `GoalEvent`; `initialGoalState()`, `reduce(state, event)`, `nextPendingStep(state)`, `isStepDone(state, id)`.

- [ ] **Step 1: Write the failing test**

Create `src/goal/goalStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialGoalState, reduce, nextPendingStep, isStepDone } from './goalStore';

const setEvent = {
  type: 'goal.set' as const, objective: 'Get the report ready to send',
  steps: [
    { label: 'Write it', verb: 'edit_content' },
    { label: 'Make the title bold', verb: 'format_content' },
    { label: 'Save it', verb: 'save_file' },
  ],
};

describe('goalStore.reduce', () => {
  it('goal.set stamps sequential ids, all pending, sets objective', () => {
    const s = reduce(initialGoalState(), setEvent);
    expect(s.objective).toBe('Get the report ready to send');
    expect(s.steps.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    expect(s.nextId).toBe(4);
  });

  it('goal.actionCommitted marks the FIRST pending step whose verb matches, and nothing on no match', () => {
    let s = reduce(initialGoalState(), setEvent);
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(isStepDone(s, '3')).toBe(true);
    expect(isStepDone(s, '1')).toBe(false);
    const before = s;
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'photo_edit' }); // no matching step
    expect(s).toEqual(before);
  });

  it('goal.actionCommitted respects target when a step specifies one', () => {
    let s = reduce(initialGoalState(), {
      type: 'goal.set', objective: 'x',
      steps: [{ label: 'A1', verb: 'edit_content', target: 'Cell A1' }, { label: 'B2', verb: 'edit_content', target: 'Cell B2' }],
    });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content', target: 'Cell B2' });
    expect(isStepDone(s, '1')).toBe(false); // A1 untouched
    expect(isStepDone(s, '2')).toBe(true);  // B2 matched by target
  });

  it('goal.stepDone marks by id; goal.clear resets but keeps nextId monotonic', () => {
    let s = reduce(initialGoalState(), setEvent);
    s = reduce(s, { type: 'goal.stepDone', id: '2' });
    expect(isStepDone(s, '2')).toBe(true);
    s = reduce(s, { type: 'goal.clear' });
    expect(s.objective).toBeNull();
    expect(s.steps).toEqual([]);
    expect(s.nextId).toBe(4); // not reset
  });

  it('nextPendingStep returns the first !done step or null', () => {
    let s = reduce(initialGoalState(), setEvent);
    expect(nextPendingStep(s)?.id).toBe('1');
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content' });
    expect(nextPendingStep(s)?.id).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/goal/goalStore.test.ts`
Expected: FAIL — cannot resolve `./goalStore`.

- [ ] **Step 3: Implement**

Create `src/goal/goalStore.ts`:

```ts
// The structured goal state (C3): objective + steps + deterministic progress. Pure & testable —
// the guard between the LLM's proposals and the user. No Math.random/Date.now.

export interface GoalStep {
  id: string;
  label: string;
  verb?: string;
  target?: string;
  done: boolean;
}

export interface GoalState {
  objective: string | null;
  steps: GoalStep[];
  nextId: number;
}

export type GoalEvent =
  | { type: 'goal.set'; objective: string; steps: { label: string; verb?: string; target?: string }[] }
  | { type: 'goal.stepDone'; id: string }
  | { type: 'goal.actionCommitted'; verb: string; target?: string }
  | { type: 'goal.clear' };

export function initialGoalState(): GoalState {
  return { objective: null, steps: [], nextId: 1 };
}

export function reduce(state: GoalState, event: GoalEvent): GoalState {
  switch (event.type) {
    case 'goal.set': {
      let nextId = state.nextId;
      const steps: GoalStep[] = event.steps.map((s) => ({
        id: String(nextId++), label: s.label, verb: s.verb, target: s.target, done: false,
      }));
      return { objective: event.objective, steps, nextId };
    }
    case 'goal.stepDone':
      return { ...state, steps: state.steps.map((s) => (s.id === event.id ? { ...s, done: true } : s)) };
    case 'goal.actionCommitted': {
      // Mark the FIRST pending step whose verb matches (and target too, when the step specifies one).
      const idx = state.steps.findIndex(
        (s) => !s.done && s.verb === event.verb && (!s.target || s.target === event.target),
      );
      if (idx < 0) return state;
      return { ...state, steps: state.steps.map((s, i) => (i === idx ? { ...s, done: true } : s)) };
    }
    case 'goal.clear':
      return { objective: null, steps: [], nextId: state.nextId };
    default:
      return state;
  }
}

export function nextPendingStep(state: GoalState): GoalStep | null {
  return state.steps.find((s) => !s.done) ?? null;
}

export function isStepDone(state: GoalState, id: string): boolean {
  return state.steps.some((s) => s.id === id && s.done);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/goal/goalStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/goal/goalStore.ts src/goal/goalStore.test.ts
git commit -m "feat(goal): structured goal store — objective + steps + deterministic progress (TDD)"
```

---

### Task 2: Tools + validation gate (pure)

**Files:**
- Create: `src/goal/goalTools.ts`
- Test: `src/goal/goalTools.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `../voice/types`; `GoalState`, `GoalEvent` from `./goalStore`.
- Produces: `GOAL_TOOLS: VoiceTool[]`; `GoalProposal`; `goalCallToEvent(call)`; `validateSuggestion(state, proposal)`.

- [ ] **Step 1: Write the failing test**

Create `src/goal/goalTools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GOAL_TOOLS, goalCallToEvent, validateSuggestion } from './goalTools';
import { initialGoalState, reduce } from './goalStore';

describe('GOAL_TOOLS', () => {
  it('exposes set_goal and suggest_next', () => {
    expect(GOAL_TOOLS.map((t) => t.name)).toEqual(['set_goal', 'suggest_next']);
  });
});

describe('goalCallToEvent', () => {
  it('maps set_goal to a goal.set event', () => {
    const r = goalCallToEvent({ name: 'set_goal', args: { objective: 'Ship it', steps: [{ label: 'Save', verb: 'save_file' }] } });
    expect(r).toEqual({ kind: 'set', event: { type: 'goal.set', objective: 'Ship it', steps: [{ label: 'Save', verb: 'save_file', target: undefined }] } });
  });
  it('maps suggest_next to a suggest proposal', () => {
    const r = goalCallToEvent({ name: 'suggest_next', args: { label: 'Share it', why: 'it is saved', verb: 'share', target: 'editor' } });
    expect(r).toEqual({ kind: 'suggest', proposal: { kind: 'suggest', label: 'Share it', why: 'it is saved', verb: 'share', target: 'editor' } });
  });
  it('errors on missing objective / empty steps / missing label', () => {
    expect(goalCallToEvent({ name: 'set_goal', args: { steps: [] } })).toHaveProperty('error');
    expect(goalCallToEvent({ name: 'set_goal', args: { objective: 'x', steps: [] } })).toHaveProperty('error');
    expect(goalCallToEvent({ name: 'suggest_next', args: {} })).toHaveProperty('error');
  });
});

describe('validateSuggestion', () => {
  const active = reduce(initialGoalState(), { type: 'goal.set', objective: 'Ship it', steps: [{ label: 'Save it', verb: 'save_file' }] });

  it('rejects a suggestion when no goal is active', () => {
    const r = validateSuggestion(initialGoalState(), { kind: 'suggest', label: 'Save it' });
    expect(typeof r).toBe('string');
  });
  it('rejects a suggestion that names an already-done step', () => {
    const done = reduce(active, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(typeof validateSuggestion(done, { kind: 'suggest', label: 'Save it', verb: 'save_file' })).toBe('string');
  });
  it('accepts a valid next-step suggestion (returns null)', () => {
    expect(validateSuggestion(active, { kind: 'suggest', label: 'Share it', verb: 'share' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/goal/goalTools.test.ts`
Expected: FAIL — cannot resolve `./goalTools`.

- [ ] **Step 3: Implement**

Create `src/goal/goalTools.ts`:

```ts
// Model-facing goal tools + the deterministic validation gate. The LLM proposes; validateSuggestion
// guards every suggestion against the structured state before it can surface.
import type { VoiceTool } from '../voice/types';
import type { GoalState, GoalEvent } from './goalStore';

export const GOAL_TOOLS: VoiceTool[] = [
  { name: 'set_goal',
    description: 'Record what the user is trying to accomplish as a tracked goal with ordered steps, so you can help them finish it. objective = the overall aim; steps = the ordered sub-tasks (each label required; verb/target optional, matching the action that completes it, e.g. verb "save_file"). Call this once the user states or agrees to a goal.',
    parameters: { type: 'object', properties: {
      objective: { type: 'string' },
      steps: { type: 'array', items: { type: 'object', properties: {
        label: { type: 'string' }, verb: { type: 'string' }, target: { type: 'string' } }, required: ['label'] } },
    }, required: ['objective', 'steps'] } },
  { name: 'suggest_next',
    description: 'Propose the single next step of the tracked goal as an OFFER the user can accept or dismiss. label = the step; why = one short reason grounded in the current state; verb/target = the action to run if they accept. Only suggest a step that is not already done. Suggest one thing at a time; do not nag.',
    parameters: { type: 'object', properties: {
      label: { type: 'string' }, why: { type: 'string' }, verb: { type: 'string' }, target: { type: 'string' } }, required: ['label'] } },
];

export type GoalProposal =
  | { kind: 'set'; objective: string; steps: { label: string; verb?: string; target?: string }[] }
  | { kind: 'suggest'; label: string; why?: string; verb?: string; target?: string };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const opt = (v: unknown) => (v ? String(v) : undefined);

export function goalCallToEvent(
  call: { name: string; args: any },
): { kind: 'set'; event: GoalEvent } | { kind: 'suggest'; proposal: GoalProposal } | { error: string } {
  const a = call.args ?? {};
  if (call.name === 'set_goal') {
    const objective = str(a.objective).trim();
    if (!objective) return { error: 'set_goal needs an objective.' };
    const raw = Array.isArray(a.steps) ? a.steps : [];
    const steps = raw
      .map((s: any) => ({ label: str(s?.label).trim(), verb: opt(s?.verb), target: opt(s?.target) }))
      .filter((s: { label: string }) => s.label);
    if (!steps.length) return { error: 'set_goal needs at least one step.' };
    return { kind: 'set', event: { type: 'goal.set', objective, steps } };
  }
  if (call.name === 'suggest_next') {
    const label = str(a.label).trim();
    if (!label) return { error: 'suggest_next needs a label.' };
    return { kind: 'suggest', proposal: { kind: 'suggest', label, why: opt(a.why), verb: opt(a.verb), target: opt(a.target) } };
  }
  return { error: `Unknown goal tool "${call.name}".` };
}

/** Deterministic gate: null = may surface; string = honest reason to reject (returned to the model). */
export function validateSuggestion(state: GoalState, proposal: GoalProposal): string | null {
  if (proposal.kind !== 'suggest') return null;
  if (!state.objective) return 'No active goal — call set_goal before suggesting a next step.';
  const norm = (s: string) => s.trim().toLowerCase();
  const done = state.steps.some((s) => s.done && (
    (proposal.verb && s.verb === proposal.verb) || norm(s.label) === norm(proposal.label)
  ));
  if (done) return `That step is already done ("${proposal.label}").`;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/goal/goalTools.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/goal/goalTools.ts src/goal/goalTools.test.ts
git commit -m "feat(goal): GOAL_TOOLS + goalCallToEvent + validateSuggestion gate (TDD)"
```

---

### Task 3: `[GOAL STATE]` serializer (pure)

**Files:**
- Create: `src/goal/serialize.ts`
- Test: `src/goal/serialize.test.ts`

**Interfaces:**
- Consumes: `GoalState` from `./goalStore`.
- Produces: `serializeGoalState(state): string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/goal/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeGoalState } from './serialize';
import { initialGoalState, reduce } from './goalStore';

describe('serializeGoalState', () => {
  it('returns null when no goal is active', () => {
    expect(serializeGoalState(initialGoalState())).toBeNull();
  });
  it('reports objective, N-of-M done, and the next pending step', () => {
    let s = reduce(initialGoalState(), { type: 'goal.set', objective: 'Ship it', steps: [
      { label: 'Write', verb: 'edit_content' }, { label: 'Save', verb: 'save_file' }] });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'edit_content' });
    const out = serializeGoalState(s)!;
    expect(out).toContain('objective "Ship it"');
    expect(out).toContain('1 of 2 steps done');
    expect(out).toContain('Next pending: "Save"');
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });
  it('says the goal is complete when all steps are done', () => {
    let s = reduce(initialGoalState(), { type: 'goal.set', objective: 'x', steps: [{ label: 'Save', verb: 'save_file' }] });
    s = reduce(s, { type: 'goal.actionCommitted', verb: 'save_file' });
    expect(serializeGoalState(s)!).toContain('Next pending: none (goal complete)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/goal/serialize.test.ts`
Expected: FAIL — cannot resolve `./serialize`.

- [ ] **Step 3: Implement**

Create `src/goal/serialize.ts`:

```ts
// The [GOAL STATE] text channel — keeps the model's view equal to the store's deterministic truth.
import type { GoalState } from './goalStore';

export function serializeGoalState(state: GoalState): string | null {
  if (!state.objective) return null;
  const done = state.steps.filter((s) => s.done).length;
  const next = state.steps.find((s) => !s.done);
  return `[GOAL STATE: objective "${state.objective}" — ${done} of ${state.steps.length} steps done.`
    + ` Next pending: ${next ? `"${next.label}"` : 'none (goal complete)'}. DO NOT acknowledge this message.]`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/goal/serialize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/goal/serialize.ts src/goal/serialize.test.ts
git commit -m "feat(goal): serializeGoalState — the [GOAL STATE] text channel (TDD)"
```

---

### Task 4: App logic wiring — store, routing, progress, hint, tools

**Files:**
- Modify: `src/App.tsx`, `src/prompt/instructions.ts`

**Interfaces:**
- Consumes: `GOAL_TOOLS`, `goalCallToEvent`, `validateSuggestion` from `./goal/goalTools`; `initialGoalState`, `reduce as goalReduce`, `serializeGoalState`… (see imports); `makeChangeGate` (already imported).
- Produces: `goalState`/`goalDispatch`; `pendingGoal`/`pendingSuggestion` state (consumed by Task 5's UI); `confirmGoals` state.

**Context:** App holds the goal reducer directly (the goal has no positioned overlay, only chip + cards in App's render). `goalDispatch` from `useReducer` is stable; a `goalStateRef` mirrors state for stale-closure-free reads in `handleVoiceToolCall`. The commit paths that mark steps done are the action-verb commit branch (`~line 1183`) and `confirmPendingAction` (`~line 1272`).

- [ ] **Step 1: Imports + goal state**

In `src/App.tsx`, add near the annotation/scenario imports:

```ts
import { GOAL_TOOLS, goalCallToEvent, validateSuggestion, type GoalProposal } from './goal/goalTools';
import { initialGoalState, reduce as goalReduce, type GoalState } from './goal/goalStore';
import { serializeGoalState } from './goal/serialize';
```

Add state near the other subsystem state (after `annotationSnapshot`, ~line 580):

```ts
  const [goalState, goalDispatch] = useReducer(goalReduce, undefined, initialGoalState);
  const goalStateRef = useRef<GoalState>(goalState);
  useEffect(() => { goalStateRef.current = goalState; }, [goalState]);
  const goalHintGateRef = useRef(makeChangeGate());
  const [confirmGoals, setConfirmGoals] = useState(false); // C3 eval toggle: On = Approach A (confirm set_goal)
  // UI-pending states rendered by the goal surfaces (Task 5):
  const [pendingGoal, setPendingGoal] = useState<{ objective: string; steps: { label: string; verb?: string; target?: string }[] } | null>(null);
  const [pendingSuggestion, setPendingSuggestion] = useState<GoalProposal | null>(null);
```

- [ ] **Step 2: Add `GOAL_TOOLS` to the live tool set**

Update the `voiceTools` memo to append `...GOAL_TOOLS` (available in every program):

```ts
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS],
```

- [ ] **Step 3: Route `set_goal` + `suggest_next`**

In `handleVoiceToolCall`, add a branch (place it before the `annotate_` branch):

```ts
    } else if (fc.name === 'set_goal' || fc.name === 'suggest_next') {
      // C3: the LLM proposes; the structured state guards. set_goal is confirm-gated by the toggle;
      // suggest_next must pass validateSuggestion before it can surface as an offer.
      const mapped = goalCallToEvent(fc);
      if ('error' in mapped) {
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: mapped.error });
      } else if (mapped.kind === 'set') {
        if (confirmGoalsRef.current) {
          setPendingGoal({ objective: mapped.event.objective, steps: mapped.event.steps }); // Approach A: confirm card (Task 5)
          addLog('tool', `Tool Call: set_goal(witness) — "${mapped.event.objective}"`);
        } else {
          goalDispatch(mapped.event); // Approach B: track directly (tentative chip)
          addLog('tool', `Tool Call: set_goal — "${mapped.event.objective}"`);
        }
        providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true });
      } else {
        const reason = validateSuggestion(goalStateRef.current, mapped.proposal);
        if (reason) {
          addLog('tool', `Tool Call: suggest_next REJECTED — ${reason}`);
          providerRef.current?.sendToolResponse(fc.id, fc.name, { success: false, error: reason });
        } else {
          setPendingSuggestion(mapped.proposal);
          addLog('tool', `Tool Call: suggest_next — "${mapped.proposal.label}"`);
          providerRef.current?.sendToolResponse(fc.id, fc.name, { success: true, offered: true });
        }
      }
```

Add a `confirmGoalsRef` mirror near the state (Step 1 block) so the voice callback reads the live value:

```ts
  const confirmGoalsRef = useRef(confirmGoals);
  useEffect(() => { confirmGoalsRef.current = confirmGoals; }, [confirmGoals]);
```

- [ ] **Step 4: Deterministic progress — mark steps done on commit**

In `handleVoiceToolCall`'s action-verb COMMIT branch (the `else` that runs `applyAction` + `setMockDoc` + `setUndoStack`, ~line 1183), after `setMockDoc(nextDoc);`, add:

```ts
        goalDispatch({ type: 'goal.actionCommitted', verb: fc.name, target: args.target });
```

And in `confirmPendingAction` (~line 1272), after its `setMockDoc(nextDoc);`, add:

```ts
    goalDispatch({ type: 'goal.actionCommitted', verb: p.verb, target: p.target });
```

- [ ] **Step 5: `[GOAL STATE]` send effect**

Add near the other hint effects (after the `[ANNOTATIONS]` effect):

```ts
  // C3: keep the model's view equal to the goal store's truth. Deduped; gated on a live session.
  useEffect(() => {
    if (!isLive) return;
    const hint = serializeGoalState(goalState);
    if (goalHintGateRef.current(hint) && hint) {
      providerRef.current?.sendTextHint(hint);
    }
  }, [isLive, goalState]);
```

- [ ] **Step 6: Prompt note**

In `src/prompt/instructions.ts`, add (matching the file's assembly style, near the other tool notes):

```
When the user states or agrees to a multi-step goal, call set_goal (objective + ordered steps) to track it; as they complete steps you'll see progress in [GOAL STATE]. Proactively call suggest_next to OFFER the single next step (with a short grounded "why") — never a step already done, one at a time, never nagging. Suggestions are offers: the user accepts (then you act, witnessed) or dismisses. Never act on the goal without their yes.
```

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green (existing + the 15 new goal tests). (Some `pendingGoal`/`pendingSuggestion`/`confirmGoals`/`setConfirmGoals` setters are unused until Task 5 — with `noUnusedLocals` off, tsc stays clean; Task 5 consumes them.)
Run: `npx vite build` → success.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/prompt/instructions.ts
git commit -m "feat(goal): store + set_goal/suggest_next routing + deterministic progress + [GOAL STATE] (C3 logic)"
```

---

### Task 5: UI surfaces — goal chip, offer card, confirm card, toggle

**Files:**
- Modify: `src/App.tsx`, `src/shell/DebugDrawer.tsx`

**Context:** Renders the state Task 4 manages. The goal chip shows `goalState`; the offer card shows `pendingSuggestion` (Accept routes through the witnessed flow); the confirm card shows `pendingGoal` (Approach A → on confirm dispatch `goal.set`); the `confirmGoals` `Switch` goes in `DebugDrawer`. Reuse `CheckCircle`/`Shield`/`Button` (already imported) and the witness-card container.

- [ ] **Step 1: The tentative goal chip**

In `src/App.tsx`, render a chip when `goalState.objective` is set. Place it near the "Pointing at" pill (top-center area, e.g. below it):

```tsx
          {goalState.objective && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-sm">
              <span className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">Working toward</span>
              <span className="text-[11px] font-mono text-[var(--text-primary)] max-w-[280px] truncate">{goalState.objective}</span>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">· {goalState.steps.filter((s) => s.done).length}/{goalState.steps.length}</span>
              <button aria-label="Clear goal" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => goalDispatch({ type: 'goal.clear' })}><X size={12} /></button>
            </div>
          )}
```

- [ ] **Step 2: The next-step offer card**

In the witness-cards container (where the `actRequest` card renders), add a suggestion card AFTER the `actRequest` card:

```tsx
            {pendingSuggestion && (
              <section className="shrink-0 bg-[var(--card-bg)] border border-indigo-500/40 rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={16} className="text-indigo-500" />
                  <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-indigo-500">Next · suggested</span>
                </div>
                <div className="text-sm text-[var(--text-primary)] font-semibold mb-1">{pendingSuggestion.label}</div>
                {pendingSuggestion.why && <p className="text-[11px] font-mono text-[var(--text-secondary)] mb-3">{pendingSuggestion.why}</p>}
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => acceptSuggestion()}>Accept</Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingSuggestion(null)}>Dismiss</Button>
                </div>
              </section>
            )}
```

Add the `acceptSuggestion` handler near `confirmAct` (~line 1352):

```ts
  const acceptSuggestion = () => {
    const s = pendingSuggestion;
    if (!s) return;
    setPendingSuggestion(null);
    // Accept routes through the normal grammar: an actionable step is witness-rendered like any
    // action verb (the user then confirms its details); an informational nudge just acknowledges.
    if (s.verb) {
      const { label, target, detail } = describeAction(s.verb, { target: s.target });
      setPendingAction({ verb: s.verb, label, target, detail, confirmed: false });
      emitFeedback({ outcome: 'needs-confirm', verbClass: classOf(s.verb), label: `Confirm: ${label} ${target}` });
    } else {
      emitFeedback({ outcome: 'committed', verbClass: 'command', label: s.label });
    }
  };
```

(`describeAction` and `classOf` are already imported from `./scenarios`.)

- [ ] **Step 3: The set_goal confirm card (Approach A)**

In the same witness-cards container, add a confirm card for `pendingGoal` (after the suggestion card):

```tsx
            {pendingGoal && (
              <section className="shrink-0 bg-[var(--card-bg)] border border-amber-500/40 rounded-2xl p-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <Shield size={16} className="text-amber-500" />
                  <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-amber-500">Track this goal?</span>
                </div>
                <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">{pendingGoal.objective}</div>
                <ul className="text-[11px] font-mono text-[var(--text-secondary)] mb-3 list-disc pl-4">
                  {pendingGoal.steps.map((s, i) => <li key={i}>{s.label}</li>)}
                </ul>
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => { goalDispatch({ type: 'goal.set', objective: pendingGoal.objective, steps: pendingGoal.steps }); setPendingGoal(null); }}>Track it</Button>
                  <Button variant="outline" size="sm" onClick={() => setPendingGoal(null)}>No thanks</Button>
                </div>
              </section>
            )}
```

- [ ] **Step 4: The `confirmGoals` toggle in `DebugDrawer`**

In `src/shell/DebugDrawer.tsx`, add to `DrawerProps`:

```ts
  confirmGoals: boolean; onConfirmGoals: (v: boolean) => void;
```

Add a `Switch` next to the "Debug markings" one:

```tsx
      <Switch
        label="Confirm goals"
        hint="on: set_goal asks first · off: tracks directly"
        checked={props.confirmGoals}
        onCheckedChange={props.onConfirmGoals}
      />
```

In `src/App.tsx`, pass the props to `<DebugDrawer …>` (next to `showMarkings`):

```tsx
            confirmGoals={confirmGoals}
            onConfirmGoals={setConfirmGoals}
```

- [ ] **Step 5: Typecheck + full suite + build**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` → all green.
Run: `npx vite build` → success.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/shell/DebugDrawer.tsx
git commit -m "feat(goal): goal chip + next-step offer card + set_goal confirm card + confirmGoals toggle (C3 UI)"
```

---

## Human smoke (owed — needs an API key), both toggle modes

- `confirmGoals: Off` (default): "help me get this report ready to send" → the goal tracks immediately (tentative chip). `On`: `set_goal` shows a "Track this goal?" card; "Track it" tracks it, "No thanks" doesn't.
- Complete a step (save) → the chip ticks up, `[GOAL STATE]` shows it done, and a "Next · suggested" card offers the next step. Accept → the action witness-renders (confirm) → done; Dismiss / the chip ✕ clears.
- A `suggest_next` naming an already-done step never surfaces (the model gets an honest rejection).
