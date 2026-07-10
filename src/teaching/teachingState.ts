// C2a text channel: a structured [TEACHING STATE] hint that pairs with the WYSIWYG overlay
// pixels (learnings §4: never labels-only). Pure & derived from the same selectors the overlay
// renders from, so text and pixels cannot disagree.

import type { TeachingState } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { entityById, displayName } from '../entities/registry';
import { activeStep, blockedEntityIds, fadeLevel } from './selectors';

/** Name for an entity id; falls back to the raw id so a stale id never yields a blank line. */
function nameOf(entities: SceneEntity[], id: EntityId): string {
  return displayName(entityById(entities, id)) || String(id);
}

/**
 * Serialize the active teaching sequence for the model. Returns null when no sequence is active
 * (nothing to say → nothing sent). Names come from displayName — the vocabulary the model grounds
 * on — never entity ids.
 */
export function serializeTeachingState(state: TeachingState, entities: SceneEntity[]): string | null {
  const seq = state.sequence;
  const step = activeStep(state);
  if (!seq || seq.activeIndex === null || !step) return null;

  const verb = seq.posture === 'guide' ? 'Guiding' : 'Teaching';
  const completed = seq.steps.filter((s) => s.state === 'done').map((s) => nameOf(entities, s.entityId));
  const blocked = blockedEntityIds(state, entities.map((e) => e.id)).map((id) => nameOf(entities, id));
  const fade = fadeLevel(state, seq.taskKey);

  return `[TEACHING STATE: ${verb} "${seq.title}" — step ${seq.activeIndex + 1} of ${seq.steps.length}.`
    + ` Active step: ${step.subgoal} — "${step.instruction}" (target: ${nameOf(entities, step.entityId)}).`
    + ` Completed: ${completed.length ? completed.join(', ') : 'none'}.`
    + ` Blocked (soft): ${blocked.length ? blocked.join(', ') : 'none'}.`
    + ` Fade level: ${fade} (0 full / 1 partial / 2 faint). Paused: ${seq.paused ? 'yes' : 'no'}.`
    + ` DO NOT acknowledge this message.]`;
}

/**
 * Send-once-per-change gate (mirrors makeThrottle's closure pattern). Returns true only when
 * `value` is non-null AND differs from the last value it returned true for. A null value resets
 * the gate (so the next active sequence re-sends) and is itself never sent.
 */
export function makeChangeGate(): (value: string | null) => boolean {
  let lastSent: string | null = null;
  return (value) => {
    if (value === null) { lastSent = null; return false; }
    if (value === lastSent) return false;
    lastSent = value;
    return true;
  };
}
