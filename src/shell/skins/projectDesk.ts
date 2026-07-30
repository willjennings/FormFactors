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
// `MATERIAL_DOCK_W_FRAC`.
import type { ShellSkin } from './types';
import type { DeskState, DeskWindow } from '../desk/types';
import { clampWindow, MIN_W, MIN_H, type WindowRect } from '../windowState';
import { COLUMN_W, freeArea } from './furniture';

export interface ProjectedRect { id: string; rect: WindowRect }

const GAP = 24;

// --- The free area ---------------------------------------------------------------------------
// Every skin computing geometry below lays out inside `freeArea(skin.slots, plane)` (furniture.ts)
// rather than inside the raw plane: the plane is the whole `<main>`, but the top bar, the bottom
// bar with the omnibox above it, and Material's source rail are all painted OVER it at z-30 and
// all carry `data-shell`, which the pointing carve-out reads as not-the-plane. A row drawn under
// any of them is therefore not merely half-hidden — it cannot be pointed at, which on this
// project is an honesty defect rather than a cosmetic one. Task 4's drive measured exactly that:
// at 1200×800 the top artifact slot started at y=48, under the bar.
//
// The inset lives HERE, in the skin arithmetic, and not at App's call site, for three reasons.
// (1) It is a function of the skin's own slots — `sideRail: 'sources'` costs 56px and
// `sideRail: 'icons'` costs nothing, because skin A's icons are z-[5] and draw UNDER the windows
// — and `skin.slots` is already this function's argument, where the call site would have to
// re-derive it. (2) `clampWindow` takes a size with no origin, so an inset "plane" argument
// could not express the offset; the call site would have to pass an offset rect and every
// consumer of `plane` would have to be taught about it. (3) Most decisively, an inset passed as
// the plane would apply to the IDENTITY skins too: Familiar and Provenance return the authored
// rect unchanged, and a window the user has never moved would jump the first time it was
// projected. Identity has to stay identity, so only a skin that positions windows itself takes
// responsibility for positioning them where they can be seen and touched.
//
// The final `clampWindow` in `projectOne` still runs against the FULL plane, deliberately: it is
// the last-resort "never off-screen" rule (design spec §4), and clamping an authored or placed
// rect into the free area would move windows the desk has no business moving.

// --- Material -----------------------------------------------------------------------------
// Material's ethos (registry.ts): "What you have made is the desk; programs are sources you
// draw from." Its probe asks whether foregrounding made material changes what people make — so
// the projection foregrounds it literally: the artifacts take the body of the desk, and the
// program window shrinks to a dock against the source rail (`slots.sideRail: 'sources'`).
//
// Sizes are fixed FRACTIONS OF THE FREE AREA, never of the window's current rect. A size relative
// to "how big it is right now" would compound under repeated projection (project a projection and
// it grows/shrinks again); a size relative to the plane does not — and the free area is a pure
// function of the plane and the skin's own slots, so projecting a projection recomputes the
// identical target, which is exactly the "stable" property the tests pin.
//
// The dock's two fractions are FLOORED at the legible minimum (`MIN_W`/`MIN_H`) rather than left
// to fall through `projectOne`'s MIN check. That check exists for a projection that cannot be
// drawn legibly AT ALL, and its answer — return the authored rect — is right for that case and
// wrong for this one: Task 4 measured `0.22 × 1200 = 264 < MIN_W`, so on every plane narrower
// than ~1455px the dock silently reverted to Word's authored 680×620 and Material's probe read
// "the program is the biggest thing on the desk" — the exact sentence this phase exists to
// falsify. A dock that is 320px wide because that is as narrow as a window may legibly be is
// still a dock; a dock that has quietly become the largest window on screen is not. The artifact
// slots are floored the same way, by the grid arithmetic below rather than by a `Math.max`.
const MATERIAL_DOCK_W_FRAC = 0.24;
const MATERIAL_DOCK_H_FRAC = 0.34;
// The vertical band the artifacts share, as a fraction of the free area's height.
const MATERIAL_BAND_H_FRAC = 0.92;
// A ceiling on a single slot. Without it, one artifact on a 1600-wide plane is handed the entire
// region beside the dock — an eleven-hundred-pixel-wide card holding a title and four fields,
// which is padding, not foregrounding. Fractions of the FREE AREA, so the ceiling scales with the
// desk like everything else here.
const MATERIAL_SLOT_MAX_W_FRAC = 0.55;
const MATERIAL_SLOT_MAX_H_FRAC = 0.70;

// The docked program window: pinned to the left edge of the free area, which is exactly the
// right-hand edge of the source rail (`freeArea` takes the rail's 56px off the left for skin B),
// so the dock hugs the rail programs are drawn from without any of it underneath. The old fixed
// `x: 24` was measured against the raw plane and put ~30px of the window under the rail.
function materialDockRect(free: { x: number; y: number; width: number; height: number }): WindowRect {
  const rw = Math.max(MIN_W, free.width * MATERIAL_DOCK_W_FRAC);
  const rh = Math.max(MIN_H, free.height * MATERIAL_DOCK_H_FRAC);
  return { x: free.x, y: free.y + (free.height - rh) / 2, w: rw, h: rh };
}

// The artifact grid. Every artifact used to land on the SAME centred rect, so two artifacts drew
// exactly on top of each other; Task 4 replaced that with a single column of n equal slots, which
// held for two artifacts and then collapsed — at n≥4 on a 1600×1000 plane (and n≥3 on 1200×800)
// a slot fell under `MIN_H` and EVERY artifact reverted to its authored rect, i.e. back to the
// cascaded default stack, with no surface saying Material had stopped projecting. Three artifacts
// on a laptop is not an edge case.
//
// So the slots are a GRID, and the grid is the smallest one that keeps every slot legible: as
// many rows as fit at `MIN_H`, and only then a second and third column. That is the honest
// degradation — the band gets denser, never absent.
//
// Past the grid's capacity the slots stay at `MIN_H` and the ROW PITCH shrinks below the slot
// height, so the rows overlap like a pile of paper on a desk: every artifact is still drawn at a
// legible size, still in its own stable slot, and the pile spreads across exactly the same band
// (`blockH` works out to `band` in that branch) rather than off the edge of it.
//
// What that costs, stated exactly rather than promised away. The strip left visible on a covered
// card is `(band − MIN_H) / (rows − 1)`, and a browser drive measured it at every plane this
// project supports: 116px with six artifacts at 1200×800 (title bar, provenance line and most of
// the content), 65px with two at 1024×620, 33px with three there — the title bar alone — and 13px
// with all six of `MAX_ARTIFACTS` at 1024×620, which is less than the title bar and is frankly
// bad. It is bad the way a real desk with six papers and no room is bad: every card is still
// there, still whole, and one click raises any of them clear of the rest, which is what a pile is
// FOR. The alternative this replaced — the entire band silently reverting to the hidden authored
// cascade, at four artifacts on a 1600×1000 desk — was not visibly bad, which was the problem.
// (A scrolling or paged band would beat both, and is not in this phase.)
//
// `index`/`count` are positions among the artifact windows this skin actually lays out, in desk
// order. That set INCLUDES placed windows and EXCLUDES minimized ones, and the asymmetry is the
// point:
//   - A PLACED window keeps its slot even though it is drawn at its own authored rect, so its
//     slot sits empty and every other artifact is one slot smaller for it. That is the price of
//     not shoving a neighbour out from under the user's hand: promotion happens mid-drag, and a
//     band that re-flowed on release would move a window nobody touched.
//   - A MINIMIZED window is not drawn at all, so holding a slot for it leaves a visible hole and
//     pushes the band toward its density ceiling for nothing. Putting a piece away is a deliberate
//     one-click act with an obvious expected answer — the rest spread out — and there is no drag
//     in flight to protect.
function materialArtifactRect(index: number, count: number, free: { x: number; y: number; width: number; height: number }): WindowRect {
  const dock = materialDockRect(free);
  // The region beside the dock. Artifacts never share x-space with the docked program: the skin's
  // claim is that made material is the desk and the program is a source at its edge, and a card
  // drawn on top of the dock says neither. GAP on both sides — the free area's right edge is the
  // viewport's, and a card flush against it reads as cut off rather than as placed.
  const regionX = dock.x + dock.w + GAP;
  const regionW = free.x + free.width - regionX - GAP;
  const band = free.height * MATERIAL_BAND_H_FRAC;

  // How many rows fit at the legible minimum, and how many columns — at least one of each, so a
  // free area too small for even one legible slot produces a sub-MIN candidate and is caught by
  // `projectOne`'s fallback rather than by a divide-by-zero here.
  const maxRows = Math.max(1, Math.floor((band + GAP) / (MIN_H + GAP)));
  const maxCols = Math.max(1, Math.floor((regionW + GAP) / (MIN_W + GAP)));
  const cols = Math.min(maxCols, Math.max(1, Math.ceil(count / maxRows)));
  const rows = Math.ceil(count / cols);

  // The ceilings are themselves floored at MIN: on a short plane `0.70 × free.height` can land
  // UNDER `MIN_H`, and a ceiling that pushes a slot below the legible minimum would hand the whole
  // band back to `projectOne`'s identity fallback — reintroducing the collapse this grid exists to
  // remove, at the narrowest plane the gate admits, where it is least affordable.
  const slotW = Math.min((regionW - (cols - 1) * GAP) / cols, Math.max(MIN_W, free.width * MATERIAL_SLOT_MAX_W_FRAC));
  const withinCapacity = rows <= maxRows;
  const slotH = withinCapacity
    ? Math.min((band - (rows - 1) * GAP) / rows, Math.max(MIN_H, free.height * MATERIAL_SLOT_MAX_H_FRAC))
    : MIN_H;
  // Pitch, not "slot height + gap": past capacity the rows deliberately overlap (see above), and
  // spreading the pile across the same band is what keeps the block centred and on-plane.
  const pitch = rows > 1
    ? (withinCapacity ? slotH + GAP : (band - slotH) / (rows - 1))
    : 0;

  const blockW = cols * slotW + (cols - 1) * GAP;
  const blockH = slotH + (rows - 1) * pitch;
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: regionX + (regionW - blockW) / 2 + col * (slotW + GAP),
    y: free.y + (free.height - blockH) / 2 + row * pitch,
    w: slotW,
    h: slotH,
  };
}

// --- Conversation ---------------------------------------------------------------------------
// Conversation's ethos: "The agent holds the centre; windows orbit the talk." Its probe asks
// whether centring conversation reduces pointing — every window (program or artifact alike,
// the skin draws no distinction) is pushed outward from the shared centre column and shrunk, so
// the column stays the visual centre of gravity. `COLUMN_W` is shared with the furniture that
// paints the column (furniture.ts) rather than re-typed, so the two can never disagree on its
// width.
const CONVERSATION_W_FRAC = 0.22;
const CONVERSATION_H_FRAC = 0.28;
const CONVERSATION_TOP_FRAC = 0.1; // where the first orbiting window on a side starts, into the free area

// Same fixed-fraction reasoning as Material, floored at MIN the same way and for the same
// reason — `0.28 × 800 = 224 < MIN_H` meant skin D ALSO silently stopped orbiting on a 1200×800
// laptop and drew the authored desk instead. The one thing this DOES read from the window's
// current rect is which SIDE it orbits (left or right of the column), and only as a threshold
// comparison against the centre: once a window is pushed left, projecting again reads
// its (now further-left) rect and still finds it left of centre, so the side never flips under
// repeated projection either.
//
// The column is centred on the PLANE (`surfaceBox` positions it at `calc(50% - 340px)` of the
// whole `<main>`), while the orbit's vertical extent belongs to the free area. Skin D declares
// `sideRail: 'none'`, so the free area spans the full width and the two agree — `free.x` is 0
// and `free.width` is `plane.width` — which is why the column arithmetic can read `free` without
// having to say which of the two it means.
//
// Beyond what fits, the same rule as Material's grid: the windows on a side keep their legible
// size and their pitch tightens into an overlapping stack, rather than the whole skin reverting
// to a hidden authored layout.
function conversationRect(w: DeskWindow, sameSideIndex: number, sameSideCount: number, free: { x: number; y: number; width: number; height: number }): WindowRect {
  const rw = Math.max(MIN_W, free.width * CONVERSATION_W_FRAC);
  const rh = Math.max(MIN_H, free.height * CONVERSATION_H_FRAC);
  const columnLeft = free.x + (free.width - COLUMN_W) / 2;
  const columnRight = columnLeft + COLUMN_W;
  const center = w.rect.x + w.rect.w / 2;
  const left = center < free.x + free.width / 2;
  const x = left ? columnLeft - rw - GAP : columnRight + GAP;
  const top = free.y + free.height * CONVERSATION_TOP_FRAC;
  const orbit = free.height * (1 - CONVERSATION_TOP_FRAC); // what is left below `top`
  const pitch = sameSideCount > 1
    ? Math.min(rh + GAP, (orbit - rh) / (sameSideCount - 1))
    : 0;
  return { x, y: top + sameSideIndex * pitch, w: rw, h: rh };
}

function projectOne(skin: ShellSkin, w: DeskWindow, desk: DeskState, plane: { width: number; height: number }): WindowRect {
  // Touch promotes (design spec §3): a window the user has placed is drawn exactly where they
  // put it, in EVERY skin — never re-walked, and never re-clamped, since a settled drag already
  // journals a clamped rect (windowState.ts). This is the first tested property and it is
  // checked before any skin-specific arithmetic runs.
  if (w.placed) return w.rect;

  // A minimized window is not drawn — App renders neither an `ArtifactWindow` nor a
  // `ProgramWindow` for one, and it is restored at its stored rect. So there is nothing to
  // project: it returns its authored rect (what it will come back to) and, more importantly, it
  // is left out of the slot arithmetic below, where holding a slot for something nobody can see
  // both leaves a hole in the band and pushes it toward the density ceiling. Task 4 measured that
  // under its single-column band: with a2 put away, a1 stayed in its half-band at h=428 rather
  // than taking the whole band, and four put-away artifacts were enough to break the band
  // entirely for the one still open.
  if (w.minimized) return w.rect;

  // Where the skin may actually draw (see the note above `freeArea`'s import).
  const free = freeArea(skin.slots, plane);

  let candidate: WindowRect;
  switch (skin.key) {
    case 'familiar':
    case 'provenance':
      candidate = w.rect;
      break;
    case 'material': {
      if (w.kind !== 'artifact') { candidate = materialDockRect(free); break; }
      // Recomputed from the current desk each call (not cached), same discipline as
      // Conversation's `sameSide` below. Placed windows are counted, minimized ones are not —
      // the asymmetry is argued where the slots are computed, above `materialArtifactRect`.
      const artifacts = desk.windows.filter(o => o.kind === 'artifact' && !o.minimized);
      candidate = materialArtifactRect(artifacts.findIndex(o => o.id === w.id), artifacts.length, free);
      break;
    }
    case 'conversation': {
      // "Same side" is recomputed from the current desk each call (not cached), so it stays
      // consistent with `conversationRect`'s own side test above and with repeated projection.
      // Minimized windows are excluded here for the same reason as Material's band: an orbit
      // slot held for a window nobody can see is a gap in the ring.
      const sameSide = desk.windows.filter(o => {
        if (o.minimized) return false;
        const oc = o.rect.x + o.rect.w / 2;
        const wc = w.rect.x + w.rect.w / 2;
        return (oc < free.x + free.width / 2) === (wc < free.x + free.width / 2);
      });
      const sameSideIndex = sameSide.findIndex(o => o.id === w.id);
      candidate = conversationRect(w, sameSideIndex, sameSide.length, free);
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
