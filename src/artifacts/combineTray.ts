// The combine tray (spec §5.2): an ordered, deduped selection buffer.
//
// Semantically distinct from the grounding buffer: grounding means "my next utterance is about
// these"; the tray means "make a new artifact from these". Deduped by sourceId rather than
// entityId because two different program elements resolve to the same document.
import { MAX_ARTIFACTS } from './artifactStore';

export interface TrayMember { entityId: string; sourceId: string; title: string; color: string }
export type CombineTray = TrayMember[];

export function toggleTray(tray: CombineTray, member: TrayMember): CombineTray {
  if (tray.some((x) => x.sourceId === member.sourceId)) return removeTray(tray, member.sourceId);
  if (tray.length >= MAX_ARTIFACTS) return tray;
  return [...tray, member];
}

export function removeTray(tray: CombineTray, sourceId: string): CombineTray {
  return tray.filter((x) => x.sourceId !== sourceId);
}

export function clearTray(): CombineTray {
  return [];
}

/** `combine` itself refuses fewer than two sources — the fire affordance must not offer it. */
export function canFire(tray: CombineTray): boolean {
  return tray.length >= 2;
}
