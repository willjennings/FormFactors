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
  if (isTrayFull(tray)) return tray;
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

/** True when the tray cannot accept another member. The UI must consult this BEFORE offering
 *  an add, and say so when it is true — a refusal the user cannot see reads as a broken
 *  control (the same discipline artifactStore applies with rejectedAtCap). */
export function isTrayFull(tray: CombineTray): boolean {
  return tray.length >= MAX_ARTIFACTS;
}

// A member's sourceId is "artifact-shaped" iff it matches this — artifact ids are always `a${n}`
// (artifactStore.ts), never hyphenated, so this never matches a program id (word/excel/…).
// Program-id members always survive both pruneTray and restoreTray below; only artifact-shaped
// members can go stale, because `artifact.close` (artifactStore.ts) is a hard delete with no
// soft-delete/tombstone — an id's absence from the live set is the only correct liveness test.
const isArtifactShaped = (sourceId: string): boolean => /^a\d+$/.test(sourceId);

/** Shared dead-id split, used by both pruneTray and restoreTray so the liveness rule lives in
 *  exactly one place. */
function splitByLiveness(members: CombineTray, liveArtifactIds: string[]): { kept: CombineTray; dropped: CombineTray } {
  const liveIds = new Set(liveArtifactIds);
  const kept: TrayMember[] = [];
  const dropped: TrayMember[] = [];
  for (const m of members) {
    if (isArtifactShaped(m.sourceId) && !liveIds.has(m.sourceId)) dropped.push(m);
    else kept.push(m);
  }
  return { kept, dropped };
}

/** Drop tray members whose artifact no longer exists (spec: C1 — a closed artifact's tray chip
 *  must not survive to be fired as a dead id with machine authority). Program members always
 *  survive. Order preserved. A no-op (nothing dropped) returns the SAME array reference as
 *  `tray`, so a caller gating a setState on reference identity can bail without a re-render. */
export function pruneTray(tray: CombineTray, liveArtifactIds: string[]): { tray: CombineTray; dropped: TrayMember[] } {
  const { kept, dropped } = splitByLiveness(tray, liveArtifactIds);
  if (!dropped.length) return { tray, dropped };
  return { tray: kept, dropped };
}

/** Reinstate a stashed selection after a failed fire: stash members first (their order was the
 *  user's), current members not already present appended, and any member whose artifact no
 *  longer exists dropped — returned so the caller can SAY so (a silent drop is a silent lie).
 *  Dedupe is by sourceId (same rule as toggleTray). Program-id members always survive; an
 *  artifact-shaped member (`/^a\d+$/`) survives only if its id is in `liveArtifactIds`. The
 *  combined, deduped, live-only list is then capped at MAX_ARTIFACTS keeping stash members
 *  first (the cap is not a liveness question — an over-cap survivor is still dropped, and still
 *  reported, just for a different reason). */
export function restoreTray(current: CombineTray, stash: CombineTray, liveArtifactIds: string[]): { tray: CombineTray; dropped: TrayMember[] } {
  const seen = new Set<string>();
  const combined: TrayMember[] = [];
  for (const m of stash) { if (!seen.has(m.sourceId)) { seen.add(m.sourceId); combined.push(m); } }
  for (const m of current) { if (!seen.has(m.sourceId)) { seen.add(m.sourceId); combined.push(m); } }

  const { kept, dropped } = splitByLiveness(combined, liveArtifactIds);
  const tray = kept.slice(0, MAX_ARTIFACTS);
  const overflow = kept.slice(MAX_ARTIFACTS);
  return { tray, dropped: [...dropped, ...overflow] };
}
