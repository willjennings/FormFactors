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
