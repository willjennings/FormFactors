// Every rendering decision for the desk lives here (spec: skins are a thin map over tested
// output — this repo has no App-level test harness, so anything left in a component is verified
// only by reading). The store owns geometry/order/visibility; these functions read it out in the
// shapes each skin needs, and never mutate it except via deskReduce.
import { artifactWindowId, deskReduce } from './deskStore';
import type { DeskState, DeskWindow, WindowKind, WindowOrigin } from './types';
import { clampWindow, type WindowRect } from '../windowState';

export interface BarItem {
  id: string;
  title: string;
  kind: WindowKind;
  origin: WindowOrigin;
  minimized: boolean;
  focused: boolean;
}

// barItems: ordered by openedAt ascending — NEVER by z, NEVER by focus. A bar that reshuffles
// under the user's hand destroys the recognition benefit that justifies having one (research §5).
// Titles come from the injected resolver: the store never owns content, so a retitled artifact
// can never leave a stale label in the bar.
export function barItems(desk: DeskState, resolveTitle: (w: DeskWindow) => string): BarItem[] {
  return [...desk.windows]
    .sort((a, b) => a.openedAt - b.openedAt)
    .map(w => ({
      id: w.id,
      title: resolveTitle(w),
      kind: w.kind,
      origin: w.origin,
      minimized: w.minimized,
      focused: w.id === desk.focusedId,
    }));
}

// visibleWindows: non-minimized only, ascending z — render order, so the last element paints
// in front.
export function visibleWindows(desk: DeskState): DeskWindow[] {
  return desk.windows.filter(w => !w.minimized).sort((a, b) => a.z - b.z);
}

// deskSummary: an inventory summary, not a visibility summary — counts every window including
// minimized ones.
export function deskSummary(desk: DeskState): { pieces: number; sources: number } {
  let pieces = 0;
  let sources = 0;
  for (const w of desk.windows) {
    if (w.kind === 'artifact') pieces++;
    else sources++;
  }
  return { pieces, sources };
}

// Cascade base for newly-opened artifact windows (S4 prune lesson: derived lists reconcile
// against live truth). Offset by +16 x / +24 y per artifact window already present at the time
// that window is added, so two artifacts arriving in one reconcileArtifacts call land at
// distinct rects.
export const ARTIFACT_BASE_RECT: WindowRect = { x: 560, y: 80, w: 380, h: 300 };

// reconcileArtifacts: pure derived-list reconciliation against liveArtifactIds. Opens a window
// for every live artifact id that has none (origin 'agent'), removes windows whose kind is
// 'artifact' and whose refId is no longer live, and returns `desk` unchanged BY IDENTITY when
// nothing needs to change — the calling effect keys on that identity, so this is the property
// that stops it from looping. Program windows are never touched. Composes deskReduce internally
// so the open/close/id semantics live in one place, not duplicated here.
export function reconcileArtifacts(desk: DeskState, liveArtifactIds: string[], now: number): DeskState {
  const liveSet = new Set(liveArtifactIds);
  const currentArtifactWindows = desk.windows.filter(w => w.kind === 'artifact');
  const toRemove = currentArtifactWindows.filter(w => !liveSet.has(w.refId));
  const presentRefIds = new Set(currentArtifactWindows.map(w => w.refId));
  const toAdd = liveArtifactIds.filter(id => !presentRefIds.has(id));

  if (toRemove.length === 0 && toAdd.length === 0) return desk;

  let next = desk;
  for (const w of toRemove) {
    next = deskReduce(next, { type: 'window.close', id: w.id });
  }

  let artifactCount = next.windows.filter(w => w.kind === 'artifact').length;
  for (const id of toAdd) {
    const rect: WindowRect = {
      x: ARTIFACT_BASE_RECT.x + artifactCount * 16,
      y: ARTIFACT_BASE_RECT.y + artifactCount * 24,
      w: ARTIFACT_BASE_RECT.w,
      h: ARTIFACT_BASE_RECT.h,
    };
    next = deskReduce(next, {
      type: 'window.open', id: artifactWindowId(id), kind: 'artifact', refId: id, rect, origin: 'agent', at: now,
    });
    artifactCount++;
  }
  return next;
}

// fitWindows: which windows do not fit THIS plane, and where each one belongs. The desk is
// restored from a journal written on some other screen — and the registry's own initial() hands
// out the PRE-clamp default rect — so a window can boot taller than the viewport or entirely
// below the fold. That is not cosmetic: an artifact window has no drag handle at all, and a
// program window whose title bar is off-plane cannot be grabbed either, so the only recovery
// would be erasing the desk. Callers dispatch one journaled `window.move` per entry, which is
// what keeps the fitted desk and its replay identical (a clamp applied silently at render or in
// a state initializer would diverge from the journal by exactly this correction).
//
// Minimized windows are included deliberately: they are restored at their stored rect, so
// skipping them only defers the trap to the moment the user asks for one back. Returns an EMPTY
// array when everything already fits — the by-value guard that makes the calling effect a no-op
// on StrictMode's second pass and on every resize that changes nothing.
export function fitWindows(desk: DeskState, plane: { width: number; height: number }): { id: string; rect: WindowRect }[] {
  const out: { id: string; rect: WindowRect }[] = [];
  for (const w of desk.windows) {
    const rect = clampWindow(w.rect, plane);
    if (rect.x !== w.rect.x || rect.y !== w.rect.y || rect.w !== w.rect.w || rect.h !== w.rect.h) {
      out.push({ id: w.id, rect });
    }
  }
  return out;
}
