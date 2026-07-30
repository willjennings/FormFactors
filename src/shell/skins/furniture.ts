// The measurements of the shell's own furniture, in one pure module.
//
// Why this file exists: `projectDesk` has to know where the furniture is — a projection that
// draws a window under an opaque z-30 bar has put it somewhere the user cannot point at (the
// pointing carve-out treats `data-shell` as not-the-plane, so a covered row is unpointable, not
// merely ugly) — and `ShellFrame` has to know the same numbers to draw it. Until now the two
// shared them by `projectDesk` importing `COLUMN_W` from `ShellFrame.tsx`, which pulled the whole
// React component graph into a module whose entire value is that it is pure (logged as a Task 2
// deferred minor: "move to a constants module next touch"). This is that module. One set of
// numbers, imported by both, so the furniture that is DRAWN and the free area a projection
// reasons about can never drift apart.
//
// Nothing here reads the DOM. These are the constants the components' own class names are
// written from; each is named against the file and class it mirrors, and any change to one of
// those class names is a change to the number here.
//
// One entry runs the other way: the Conversation column's width is DERIVED here (it is
// plane-relative, so no fixed class could express it) and `ShellFrame` draws it from the CSS this
// module generates. Same rule, same direction of truth — the number is decided in one place — but
// worth saying out loud, because it is the one measurement a reader cannot check by opening the
// component and reading a class name.
import type { ShellSkin } from './types';
import { MIN_W } from '../windowState';

type Slots = ShellSkin['slots'];

/** The breathing gap the skins lay out with — between a window and the furniture beside it, and
 *  between two windows in the same band. Declared here rather than in `projectDesk` because the
 *  Conversation column's width (below) is computed FROM it: if the two drifted, the width the
 *  column is drawn at and the width the projection reserved for it would disagree, which is the
 *  one thing this module exists to prevent. `projectDesk` imports it. */
export const GAP = 24;

/** How much room each bottom bar takes, in px, including the gap the omnibox wants above it.
 *  App applies this as the bottom edge of the surfaces region so the omnibox and the response
 *  rail sit ABOVE the bar rather than under it — the omnibox exists in every skin and only its
 *  position may change (spec §5).
 *
 *  Bar heights: `Taskbar.tsx` h-11 (44), `Shelf.tsx` h-[68px], `Timeline.tsx` h-[132px]; each
 *  entry is that height plus an 8px gap. `none` is the gap alone (skin D has no bottom bar). */
export const BOTTOM_INSET: Record<Slots['bottomBar'], number> = {
  taskbar: 52, shelf: 76, timeline: 140, none: 8,
};

/** Skin D's centre column at its designed width, on a plane wide enough to hold it: the cap the
 *  formula below may never exceed. */
export const COLUMN_MAX_W = 680;

/** What the column has to leave on EACH side of itself for one orbiting window: a gap to the
 *  plane's own edge, the narrowest a window may legibly be, and the gap between that window and
 *  the column. 24 + 320 + 24 = 368. */
export const COLUMN_SIDE_RESERVE = GAP + MIN_W + GAP;

/** The width of skin D's centre column ON THIS PLANE — the ONE formula, consumed by both
 *  `projectDesk`'s Conversation arithmetic (which pushes windows out from the column) and
 *  `ShellFrame`'s `surfaceBox` (which draws it). Two independently written widths would put the
 *  lie back one layer down: the projection would reserve a corridor the furniture does not
 *  actually occupy, or vice versa.
 *
 *  The derivation. Conversation's claim is that every window orbits OUTSIDE the column. Laid out
 *  across the plane's width that reads, edge to edge:
 *
 *      GAP | orbit window | GAP | COLUMN | GAP | orbit window | GAP
 *
 *  and an orbit window is never narrower than `MIN_W` (`conversationRect` floors it there, so a
 *  cramped plane shrinks the column rather than producing an illegible window). Solving for the
 *  column: `plane.width − 2·(GAP + MIN_W + GAP)`, capped at the designed 680. The cap binds at
 *  and above 1416px, so a 1600×1000 desk still gets exactly the 680px column it always had; a
 *  1200×800 laptop gets 464 and a 1024×620 one gets 288.
 *
 *  Why the column is what gives, rather than the orbit: a column narrower than its designed width
 *  still holds the conversation (the omnibox inside it is `min(640px, 90vw)` and is centred on
 *  the plane either way, so it does not move), whereas an orbit window below `MIN_W` is not a
 *  window you can read. The old fixed 680 gave neither: at 1200×800 and 1024×620 the arithmetic
 *  `columnLeft − rw − GAP` went NEGATIVE, every orbiting window clamped to x=0, and the drive
 *  measured 60–148px of window sitting under the column's own chip strip — geometry claiming an
 *  orbit that was not there, on the whole 1366×768 laptop class.
 *
 *  Clearance holds at every plane this can be asked about, not just the two pinned in the tests:
 *  below the cap the reserve is 368 per side against an orbit of 320+24=344 (24px to spare); above
 *  it, `(w − 680)/2 ≥ max(MIN_W, 0.22w) + GAP` reduces to w ≥ 1368 for the floored branch and
 *  w ≥ 1300 for the fraction branch, both under the 1416 where the cap starts binding. */
export function conversationColumnW(planeWidth: number): number {
  return Math.max(0, Math.min(COLUMN_MAX_W, planeWidth - 2 * COLUMN_SIDE_RESERVE));
}

/** The same formula, as CSS, for the one consumer that has no plane number to hand: `surfaceBox`
 *  returns a style, not a rect, and the box it styles is absolutely positioned against the plane,
 *  so `100%` here IS `plane.width`. Built from the same two constants as `conversationColumnW`
 *  above — the strings are generated, never typed out, so the drawn column and the reserved one
 *  are the same arithmetic evaluated by two engines.
 *
 *  `left` is the centring: half the width, subtracted from the plane's midpoint. Deliberately not
 *  `left-1/2 -translate-x-1/2` — a transform would make the wrapper a containing block for the
 *  `position: fixed` activity ledger inside it (see `surfaceBox`). A math function's negative
 *  result is clamped to zero by `width`, so a plane narrower than 736px degrades to no column
 *  rather than to an invalid declaration; that is below the 1024 device gate either way. */
export const COLUMN_CSS_W = `min(${COLUMN_MAX_W}px, calc(100% - ${2 * COLUMN_SIDE_RESERVE}px))`;
export const COLUMN_CSS_LEFT = `calc(50% - min(${COLUMN_MAX_W / 2}px, calc(50% - ${COLUMN_SIDE_RESERVE}px)))`;

/** The top bar's height. `MenuBar.tsx` renders `absolute top-0 left-0 right-0 z-30 … h-12` in
 *  EVERY skin — the four `TopBar` variants change the bar's surface and its left-hand reading,
 *  never its box — and it is `data-shell` with a `pointerdown` that stops propagation, so the
 *  strip it covers is not part of the plane in any skin. */
export const TOP_BAR_H = 48;

/** The omnibox COLUMN, measured above `BOTTOM_INSET`. `Omnibox.tsx`'s root is
 *  `absolute bottom-3 … z-30 … flex flex-col` inside App's `surfaceBox` wrapper, so it starts
 *  12px above the bottom bar and grows UPWARD — and it is `data-shell`, so everything in it
 *  swallows the pointer.
 *
 *  164 = that 12px offset plus the 152px the column occupies at rest, measured in a headless
 *  Chrome drive at all three of 1600×1000, 1200×800 and 1024×620 (it does not vary with the
 *  plane). Itemised against the real children, re-counted in the 2026-07-30 fix wave because the
 *  sentence that used to stand here summed to 145 and called it 152: the `above` slot's wrapper
 *  (0px — it renders empty at rest, but it is still a flex CHILD and still costs a gap), the
 *  first-run hint line (16.5), the suggestion-chip row (46), the input form (66), and THREE 8px
 *  gaps, not two, because of that empty first child: 0 + 16.5 + 46 + 66 + 24 = 152.5.
 *
 *  Which makes this constant half a pixel SHORT of the resting column rather than over it —
 *  stated rather than rounded away. It is not worth a geometry change on its own (nothing can be
 *  drawn in half a pixel of a row, and the transient stack below is a far larger unreserved
 *  amount), but it is not the conservative direction either. Reserving only the form — the first
 *  cut of this constant, at 80 — left an artifact field drawn under the chip row at 1024×620 and
 *  unpointable, which is the
 *  exact defect the inset exists to prevent; the drive caught it.
 *
 *  It is still NOT the worst case: a witness card, the combine tray or the working indicator
 *  stack above the chips during a turn and can reach higher. Those are transients the user
 *  watches arrive, and reserving for them would carve a third of a laptop plane out of the desk
 *  permanently. What this reserves is the column as it sits when nothing is happening. */
export const OMNIBOX_H = 164;

/** `SourceRail.tsx`: `absolute left-0 top-12 bottom-[68px] z-30 w-[56px]`, `data-shell`. Only
 *  skin B (`sideRail: 'sources'`) renders it. */
export const SOURCE_RAIL_W = 56;

/** The area of the plane a window can be drawn in without the shell's own furniture on top of
 *  it — the plane minus the top bar, minus the bottom bar and the omnibox above it, minus a
 *  side rail that is painted OVER the windows.
 *
 *  Returned as an origin plus a size, not a size: the rects `projectDesk` produces are in plane
 *  coordinates (every window is `position: absolute` inside `<main>`), so a skin that lays out
 *  inside the free area has to add its origin back. That is also why this cannot simply be a
 *  smaller `plane` argument at the call site — `clampWindow` takes a size with no origin, and
 *  handing every skin an inset plane would move the identity skins' windows too.
 *
 *  `sideRail: 'icons'` (skin A) contributes NOTHING: `DeskIcons.tsx` is `z-[5]`, below App's
 *  ranked window band (10…16), so windows draw over it rather than under it — it is the one
 *  piece of furniture the desk is allowed to cover. `sideRail: 'none'` likewise, and no skin
 *  draws a right-hand rail.
 *
 *  Not clamped to be non-negative in area beyond zero: a plane too short to hold any window at
 *  all is the device gate's problem (`innerWidth >= 1024`), and the per-window MIN check plus
 *  the final `clampWindow` in `projectDesk` are what keep an unusable free area from producing
 *  an off-plane rect. */
export function freeArea(slots: Slots, plane: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const left = slots.sideRail === 'sources' ? SOURCE_RAIL_W : 0;
  const bottom = BOTTOM_INSET[slots.bottomBar] + OMNIBOX_H;
  return {
    x: left,
    y: TOP_BAR_H,
    width: Math.max(0, plane.width - left),
    height: Math.max(0, plane.height - TOP_BAR_H - bottom),
  };
}
