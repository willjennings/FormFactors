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
import type { ShellSkin } from './types';

type Slots = ShellSkin['slots'];

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

/** The width of skin D's centre column. Shared with `projectDesk` (Conversation pushes windows
 *  out from this same column), so the width the furniture draws and the width the projection
 *  reasons about can never drift apart. */
export const COLUMN_W = 680;

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
 *  plane): the first-run hint line (17), the suggestion-chip row (46), the input form (66) and
 *  the 8px gaps between them. Reserving only the form — the first cut of this constant, at 80 —
 *  left an artifact field drawn under the chip row at 1024×620 and unpointable, which is the
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
