import type { VoiceTool } from '../voice/types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { resolveEchoedTarget, displayName } from '../entities/registry';
import type { TeachingEvent, TeachPosture, TeachRelation } from './types';

export const TEACH_TOOLS: VoiceTool[] = [
  { name: 'teach_highlight',
    description: 'Visually emphasize ONE on-screen element the user should look at. Use for "where is…" / "show me…" questions. Note is optional and must be ≤3 words.',
    parameters: { type: 'object', properties: {
      target: { type: 'string', description: 'The element to highlight (its visible name).' },
      note: { type: 'string', description: 'Optional ≤3-word label.' } }, required: ['target'] } },
  { name: 'teach_sequence',
    description: 'Start a step-by-step teaching sequence with numbered on-screen markers. posture "guide" = walk the user through it fast; "teach" = you demonstrate step 1, then the USER must perform each step. Keep instructions to ONE short sentence each.',
    parameters: { type: 'object', properties: {
      title: { type: 'string' },
      taskKey: { type: 'string', description: 'Stable key for this task family, e.g. "word.save" — repeats of the same key fade the scaffolding.' },
      posture: { type: 'string', enum: ['guide', 'teach'] },
      steps: { type: 'array', items: { type: 'object', properties: {
        target: { type: 'string' }, subgoal: { type: 'string', description: 'Short WHY label.' },
        instruction: { type: 'string', description: 'ONE short sentence.' } },
        required: ['target', 'subgoal', 'instruction'] } } },
      required: ['title', 'taskKey', 'posture', 'steps'] } },
  { name: 'teach_step_done',
    description: 'Advance the active teaching sequence one step (guide posture, or the demonstrated first step in teach posture).',
    parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'teach_relate',
    description: 'Draw labeled relationship links between on-screen elements to explain how they connect.',
    parameters: { type: 'object', properties: { pairs: { type: 'array', items: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
      required: ['from', 'to', 'label'] } } }, required: ['pairs'] } },
  { name: 'teach_clear',
    description: 'Remove all teaching overlays (highlights, sequence, relationship links).',
    parameters: { type: 'object', properties: {}, required: [] } },
];

// Errors are data the model recovers from: name the visible candidates so its retry can succeed.
// Consistency with the capped teaching scaffolds (MAX_HIGHLIGHTS/MAX_RELATIONS): a sequence
// is a guided walkthrough, not a manual — an unbounded one is model runaway (probe 2026-07-16).
export const MAX_SEQUENCE_STEPS = 12;

const unresolved = (target: string, entities: SceneEntity[]) => ({
  error: `Could not resolve target "${target}" to an on-screen element. Visible elements: ${entities.filter(e => !e.sub).map(e => displayName(e)).join(', ')}.`,
});

function resolve(entities: SceneEntity[], target: string): EntityId | null {
  return resolveEchoedTarget(entities, target)?.entity.id ?? null;
}

/** Pure mapping from a teach tool call to a reducer event. Unresolvable targets fail the WHOLE call. */
export function teachCallToEvent(
  call: { name: string; args: any }, entities: SceneEntity[],
): TeachingEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'teach_highlight': {
      const id = resolve(entities, String(a.target ?? ''));
      if (!id) return unresolved(String(a.target ?? ''), entities);
      return { type: 'teach.highlight', entityId: id, note: a.note ? String(a.note) : undefined };
    }
    case 'teach_sequence': {
      if ((a.steps ?? []).length > MAX_SEQUENCE_STEPS) {
        return { error: `teach_sequence accepts at most ${MAX_SEQUENCE_STEPS} steps (got ${(a.steps ?? []).length}) — split the task or teach the key steps only.` };
      }
      const steps: { entityId: EntityId; subgoal: string; instruction: string }[] = [];
      let n = 0;
      for (const s of a.steps ?? []) {
        n++;
        const target = String(s.target ?? '').trim();
        if (!target) return { error: `teach_sequence step ${n} has an empty target. Every step must name a visible control — a step with nothing to click (typing text, choosing a name) is not its own step; fold it into the previous step's instruction.` };
        const id = resolve(entities, target);
        if (!id) return unresolved(target, entities);
        steps.push({ entityId: id, subgoal: String(s.subgoal ?? ''), instruction: String(s.instruction ?? '') });
      }
      if (!steps.length) return { error: 'teach_sequence requires at least one step.' };
      return { type: 'teach.sequence', title: String(a.title ?? ''), taskKey: String(a.taskKey ?? 'task'),
               posture: (a.posture === 'teach' ? 'teach' : 'guide') as TeachPosture, steps };
    }
    case 'teach_step_done': return { type: 'teach.stepAdvance' };
    case 'teach_relate': {
      const relations: TeachRelation[] = [];
      for (const p of a.pairs ?? []) {
        const from = resolve(entities, String(p.from ?? ''));
        if (!from) return unresolved(String(p.from ?? ''), entities);
        const to = resolve(entities, String(p.to ?? ''));
        if (!to) return unresolved(String(p.to ?? ''), entities);
        relations.push({ from, to, label: String(p.label ?? '') });
      }
      if (!relations.length) return { error: 'teach_relate requires at least one pair.' };
      return { type: 'teach.relate', relations };
    }
    case 'teach_clear': return { type: 'teach.clear' };
    default: return { error: `Unknown teaching tool "${call.name}".` };
  }
}
