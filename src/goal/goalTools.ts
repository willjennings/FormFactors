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

/** The 'suggest' arm alone. Only suggestions are ever offered to the user, so the offer state and
 *  goalCallToEvent's suggest branch carry this rather than the whole union — label/why/verb/target
 *  are then readable without narrowing at each site. */
export type GoalSuggestion = Extract<GoalProposal, { kind: 'suggest' }>;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const opt = (v: unknown) => (v ? String(v) : undefined);

export function goalCallToEvent(
  call: { name: string; args: any },
): { kind: 'set'; event: GoalEvent } | { kind: 'suggest'; proposal: GoalSuggestion } | { error: string } {
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
