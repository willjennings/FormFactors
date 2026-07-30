// The one pure place a skin's geometry decision may live (design spec §1). `DeskWindow.rect`
// stays the AUTHORED rect — the only thing journaled, the only thing `fitWindows` clamps at
// boot (see `windowState.ts`'s header) — and `projectDesk` computes what is actually DRAWN from
// it, per skin, without ever writing back to the store. Skins render geometry; they never own
// it.
//
// Imports from `../desk/types` only (types, never `deskStore`/`selectors`/anything with
// behaviour) — the one-way dependency `skins/types.ts` already documents: nothing under
// `src/shell/skins/` may import from `src/shell/desk/` except types.
//
// Pure function of (skin, desk, plane): no time, no randomness, no DOM reads. That purity is
// also what makes the "stable" property below possible to state at all — see the note above
// `MATERIAL_ARTIFACT_W_FRAC`.
import type { ShellSkin } from './types';
import type { DeskState, DeskWindow } from '../desk/types';
import { clampWindow, MIN_W, MIN_H, type WindowRect } from '../windowState';
import { COLUMN_W } from './ShellFrame';

export interface ProjectedRect { id: string; rect: WindowRect }

const GAP = 24;

// --- Material -----------------------------------------------------------------------------
// Material's ethos (registry.ts): "What you have made is the desk; programs are sources you
// draw from." Its probe asks whether foregrounding made material changes what people make — so
// the projection foregrounds it literally: artifacts grow toward the plane centre, program
// windows shrink and dock toward the source rail (`slots.sideRail: 'sources'`).
//
// Sizes are fixed FRACTIONS OF THE PLANE, never of the window's current rect. A size relative
// to "how big it is right now" would compound under repeated projection (project a projection
// and it grows/shrinks again); a size relative to the plane does not — projecting a projection
// recomputes the identical target, which is exactly the "stable" property the tests pin.
const MATERIAL_ARTIFACT_W_FRAC = 0.5;
const MATERIAL_ARTIFACT_H_FRAC = 0.6;  // the height ONE artifact gets; several share the band below
const MATERIAL_ARTIFACT_BAND_FRAC = 0.88; // the vertical band all artifacts share, centred on the plane
const MATERIAL_PROGRAM_W_FRAC = 0.22;
const MATERIAL_PROGRAM_H_FRAC = 0.32;
const MATERIAL_PROGRAM_DOCK_X = 24; // hugs the left rail programs are drawn from

// Every artifact used to land on the SAME centred rect, so two artifacts drew exactly on top of
// each other and Material's own probe ("what you have made is the desk") was unreadable with more
// than one thing made. They share a vertical band instead: n slots of equal height, GAP apart,
// the whole block centred — so no two artifact rects overlap, and a single artifact still gets
// EXACTLY the rect this function returned before (rh = 0.6H, block centred = the old centring).
//
// `index`/`count` are positions among ALL artifact windows in desk order, INCLUDING placed ones
// (which never reach here — `projectOne` returns their authored rect first). Counting the placed
// ones is what keeps this stable across a promotion: dragging a2 out of the projected set must
// not slide a1 into its slot, and re-projecting must not walk anything.
function materialArtifactRect(index: number, count: number, plane: { width: number; height: number }): WindowRect {
  const rw = plane.width * MATERIAL_ARTIFACT_W_FRAC;
  const band = plane.height * MATERIAL_ARTIFACT_BAND_FRAC;
  // Fractions of the PLANE and of the count — never of the window's current rect (see the note
  // above), so projecting a projection recomputes the identical slot.
  const rh = Math.min(plane.height * MATERIAL_ARTIFACT_H_FRAC, (band - (count - 1) * GAP) / count);
  const blockH = count * rh + (count - 1) * GAP;
  return { x: (plane.width - rw) / 2, y: (plane.height - blockH) / 2 + index * (rh + GAP), w: rw, h: rh };
}

function materialProgramRect(plane: { width: number; height: number }): WindowRect {
  const rw = plane.width * MATERIAL_PROGRAM_W_FRAC;
  const rh = plane.height * MATERIAL_PROGRAM_H_FRAC;
  return { x: MATERIAL_PROGRAM_DOCK_X, y: (plane.height - rh) / 2, w: rw, h: rh };
}

// --- Conversation ---------------------------------------------------------------------------
// Conversation's ethos: "The agent holds the centre; windows orbit the talk." Its probe asks
// whether centring conversation reduces pointing — every window (program or artifact alike,
// the skin draws no distinction) is pushed outward from the shared centre column and shrunk, so
// the column stays the visual centre of gravity. `COLUMN_W` is imported from `ShellFrame`
// rather than re-typed, so the furniture that paints the column and the projection that reasons
// about it can never disagree on its width.
const CONVERSATION_W_FRAC = 0.22;
const CONVERSATION_H_FRAC = 0.28;
const CONVERSATION_TOP_FRAC = 0.1; // where the first orbiting window on a side starts

// Same fixed-fraction-of-plane reasoning as Material — see the note above `materialRect`. The
// one thing this DOES read from the window's current rect is which SIDE it orbits (left or
// right of the column), and only as a threshold comparison against the plane's centre: once a
// window is pushed left, projecting again reads its (now further-left) rect and still finds it
// left of centre, so the side never flips under repeated projection either.
function conversationRect(w: DeskWindow, sameSideIndex: number, plane: { width: number; height: number }): WindowRect {
  const rw = plane.width * CONVERSATION_W_FRAC;
  const rh = plane.height * CONVERSATION_H_FRAC;
  const columnLeft = (plane.width - COLUMN_W) / 2;
  const columnRight = columnLeft + COLUMN_W;
  const center = w.rect.x + w.rect.w / 2;
  const left = center < plane.width / 2;
  const x = left ? columnLeft - rw - GAP : columnRight + GAP;
  const y = plane.height * CONVERSATION_TOP_FRAC + sameSideIndex * (rh + GAP);
  return { x, y, w: rw, h: rh };
}

function projectOne(skin: ShellSkin, w: DeskWindow, desk: DeskState, plane: { width: number; height: number }): WindowRect {
  // Touch promotes (design spec §3): a window the user has placed is drawn exactly where they
  // put it, in EVERY skin — never re-walked, and never re-clamped, since a settled drag already
  // journals a clamped rect (windowState.ts). This is the first tested property and it is
  // checked before any skin-specific arithmetic runs.
  if (w.placed) return w.rect;

  let candidate: WindowRect;
  switch (skin.key) {
    case 'familiar':
    case 'provenance':
      candidate = w.rect;
      break;
    case 'material': {
      if (w.kind !== 'artifact') { candidate = materialProgramRect(plane); break; }
      // Recomputed from the current desk each call (not cached), same discipline as
      // Conversation's `sameSide` below.
      const artifacts = desk.windows.filter(o => o.kind === 'artifact');
      candidate = materialArtifactRect(artifacts.findIndex(o => o.id === w.id), artifacts.length, plane);
      break;
    }
    case 'conversation': {
      // "Same side" is recomputed from the current desk each call (not cached), so it stays
      // consistent with `conversationRect`'s own side test above and with repeated projection.
      const sameSide = desk.windows.filter(o => {
        const oc = o.rect.x + o.rect.w / 2;
        const wc = w.rect.x + w.rect.w / 2;
        return (oc < plane.width / 2) === (wc < plane.width / 2);
      });
      const sameSideIndex = sameSide.findIndex(o => o.id === w.id);
      candidate = conversationRect(w, sameSideIndex, plane);
      break;
    }
    default: { const _exhaustive: never = skin.key; candidate = w.rect; void _exhaustive; }
  }

  // A projection that would land below the legible minimum on a cramped plane is not honestly
  // "material foregrounded" or "pushed outward" — it is off-screen dressed up as geometry
  // (design spec §4). Falling back to the authored rect here, before clamping, means a window a
  // projection cannot fit legibly returns IDENTITY, never something `clampWindow` had to stretch
  // back up to MIN_W×MIN_H at some arbitrary position.
  if (candidate.w < MIN_W || candidate.h < MIN_H) candidate = w.rect;

  // The unconditional last step: whatever the skin computed, it never leaves this function
  // outside the plane (design spec §4).
  return clampWindow(candidate, plane);
}

export function projectDesk(skin: ShellSkin, desk: DeskState, plane: { width: number; height: number }): ProjectedRect[] {
  return desk.windows.map(w => ({ id: w.id, rect: projectOne(skin, w, desk, plane) }));
}
