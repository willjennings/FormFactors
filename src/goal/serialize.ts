// The [GOAL STATE] text channel — keeps the model's view equal to the store's deterministic truth.
import type { GoalState } from './goalStore';

export function serializeGoalState(state: GoalState): string | null {
  if (!state.objective) return null;
  const done = state.steps.filter((s) => s.done).length;
  const next = state.steps.find((s) => !s.done);
  return `[GOAL STATE: objective "${state.objective}" — ${done} of ${state.steps.length} steps done.`
    + ` Next pending: ${next ? `"${next.label}"` : 'none (goal complete)'}. DO NOT acknowledge this message.]`;
}
