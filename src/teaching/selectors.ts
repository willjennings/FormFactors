import type { TeachingState, TeachStep, FadeLevel } from './types';
import type { EntityId, SceneEntity } from '../entities/registry';

export function fadeLevel(state: TeachingState, taskKey: string): FadeLevel {
  return Math.min(2, state.competence[taskKey] ?? 0) as FadeLevel;
}

export function activeStep(state: TeachingState): TeachStep | null {
  const seq = state.sequence;
  return seq && seq.activeIndex !== null ? seq.steps[seq.activeIndex] : null;
}

/** The single source the overlay renderer reads. Reveal restores full scaffold for the active step. */
export function visibleScaffold(state: TeachingState) {
  const seq = state.sequence;
  const none = { markers: false, labels: false, block: false, highlightOnly: false, promptOnly: false };
  if (!seq || seq.activeIndex === null || seq.paused) return none;
  const level = state.revealRequested ? 0 : fadeLevel(state, seq.taskKey);
  if (level === 0) return { markers: true, labels: true, block: seq.softBlock, highlightOnly: false, promptOnly: false };
  if (level === 1) return { ...none, highlightOnly: true };
  return { ...none, promptOnly: true };
}

export function blockedEntityIds(state: TeachingState, allTileIds: EntityId[]): EntityId[] {
  const seq = state.sequence;
  if (!seq || seq.activeIndex === null || seq.paused || !visibleScaffold(state).block) return [];
  const target = seq.steps[seq.activeIndex].entityId;
  return allTileIds.filter((t) => t !== target);
}

/** The scrimmed leaf elements as numeric image ids — lets surfaces set `inert` so keyboard
 *  (Tab+Enter) cannot bypass the pointer-only scrim. Chrome ('program') is never blocked. */
export function blockedElementNumbers(state: TeachingState, entities: SceneEntity[]): number[] {
  const leafIds = entities.filter(e => e.category !== 'program').map(e => e.id);
  return blockedEntityIds(state, leafIds)
    .map(id => Number(String(id).split('-').pop()))
    .filter(n => Number.isFinite(n));
}
