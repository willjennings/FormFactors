import React from 'react';
import type { ProgramId } from '../../scenarios';
import type { ActivityEntry } from '../activityStore';
import type { MenuBarProps } from '../MenuBar';
import type { ShellSkin } from './types';
import { Background } from './parts/Background';
import { TopBar } from './parts/TopBar';
import { Taskbar } from './parts/Taskbar';
import { Shelf } from './parts/Shelf';
import { Timeline } from './parts/Timeline';
import { SourceRail } from './parts/SourceRail';
import { DeskIcons } from './parts/DeskIcons';
import { WindowChip, type ShellBarItem } from './parts/WindowChip';
// The furniture's own measurements live in one pure module, shared with `projectDesk` — see its
// header for why they are not declared here any more.
import { BOTTOM_INSET, COLUMN_CSS_LEFT, COLUMN_CSS_W, TOP_BAR_H } from './furniture';

type Slots = ShellSkin['slots'];

// The furniture the app falls back to when the stored skin key names a skin this build does not
// have — a journal written by a newer build, never the ?shell= path (resolveSkin returns null for
// an unknown param and App ignores it, leaving the current skin alone). Written out literally
// rather than read from SHELL_SKINS[0], so this stays a deliberate "render something usable"
// decision and does not become the silent first-entry fallback resolveSkin exists to refuse. It
// mirrors App's own `windowChrome ?? 'full'`.
const FALLBACK_SLOTS: Slots = {
  background: 'flat', topBar: 'menu', bottomBar: 'taskbar', sideRail: 'none',
  windowChrome: 'full', surfaces: 'float', restoreVia: 'bottomBar',
};

/** The box the existing omnibox and response-rail components are positioned inside (the activity
 *  ticker uses `planeBox` below instead — see its note). It REPOSITIONS them: they are not forked
 *  and take no new props. App wraps them in one absolutely-positioned div carrying this style,
 *  which becomes their containing block, so the omnibox's `bottom-3` and the rail's `right: 16`
 *  resolve against the skin's region instead of against the whole plane.
 *
 *  Uses `left: calc(50% - …)` rather than the usual `left-1/2 -translate-x-1/2`: a transform makes
 *  the wrapper a containing block for `position: fixed` descendants too, which would drag the
 *  activity ledger (`fixed right-2 top-14 bottom-24`) into the column with it.
 *
 *  The column's WIDTH is plane-relative and comes from `furniture.ts` as CSS built from the same
 *  constants `conversationColumnW` evaluates in numbers — `projectDesk` pushes Conversation's
 *  windows out from this exact column, and a width typed twice would let the drawn column and the
 *  reserved corridor disagree. This box is absolutely positioned against the plane, so the `100%`
 *  inside those expressions is the plane's width. */
export function surfaceBox(skin: ShellSkin | null): React.CSSProperties {
  const slots = skin?.slots ?? FALLBACK_SLOTS;
  return slots.surfaces === 'column'
    ? { top: TOP_BAR_H, bottom: BOTTOM_INSET[slots.bottomBar], left: COLUMN_CSS_LEFT, width: COLUMN_CSS_W }
    : planeBox(skin);
}

/** The whole plane, minus whatever the bottom bar occupies. For the things that must clear the
 *  bar but must NOT be pulled into the Conversation column — the activity ticker, whose corner is
 *  `bottom-3 right-3`: inside a 680px column that corner lands on top of the omnibox and its
 *  candidate chips, which was exactly what the first drive of skin D showed. */
export function planeBox(skin: ShellSkin | null): React.CSSProperties {
  return { top: 0, bottom: BOTTOM_INSET[(skin?.slots ?? FALLBACK_SLOTS).bottomBar], left: 0, right: 0 };
}

/** Slot composition (spec §2). Every skin is the same parts filled differently; adding a fifth is
 *  a registry entry plus whichever parts are genuinely new.
 *
 *  Two rules bind every part and are checked by reading, since this repo has no component test
 *  harness: whatever takes the pointer is `data-shell` with a `pointerdown` that stops propagation
 *  (furniture must never become a deixis target), and the background is `pointer-events-none`
 *  (pointing at the empty desk must keep working). Where a part is a bare container rather than a
 *  visible surface — the `restoreVia: 'column'` strip below — the two are split: the container is
 *  `pointer-events-none` and only its chips are `data-shell`, because an INVISIBLE swallower of
 *  pointers is not the honest version of this rule. The decisions — what is in the bar, in what
 *  order, and what the timeline says — live in `desk/selectors.ts` and `parts/timelineItems.ts`,
 *  both tested; what is left here is a map. */
export function ShellFrame({ skin, items, launchers, summary, activity, menu, onOpen, onLaunch }: {
  skin: ShellSkin | null;
  /** `barItems(desk, resolveTitle)` — rendered in the order it arrives, never re-sorted. */
  items: ShellBarItem[];
  /** Programs with no window on the desk at all. */
  launchers: { id: ProgramId; label: string }[];
  summary: { pieces: number; sources: number };
  activity: ActivityEntry[];
  menu: MenuBarProps;
  /** A window id from `items` — App dispatches `window.open`, whose known-id branch is
   *  focus + restore, so one click serves "raise it" and "bring it back" alike. */
  onOpen: (id: string) => void;
  onLaunch: (id: ProgramId) => void;
}) {
  const slots = skin?.slots ?? FALLBACK_SLOTS;
  const box = surfaceBox(skin);

  // Skin C paints its own near-black ground, which does not follow the light/dark theme — so the
  // theme's text/border variables would be near-black on near-black in light mode. Overriding
  // them here, on a `display: contents` wrapper (no box, but custom properties still inherit),
  // re-themes the FURNITURE only and leaves the windows on the theme the user chose: a dark desk
  // with lit windows on it, which is what a dark desktop actually looks like.
  const furnitureVars: React.CSSProperties | undefined = slots.background === 'dark'
    ? ({
        '--card-bg': '#131b24', '--card-border': '#2a3542', '--bg-color': '#0b0f14',
        '--text-primary': '#e6edf5', '--text-secondary': '#93a4b8',
      } as React.CSSProperties)
    : undefined;

  return (
    <>
      <Background variant={slots.background} />
      <div className="contents" style={furnitureVars}>
        <TopBar
          variant={slots.topBar}
          skinKey={skin?.key ?? 'unknown'}
          skinLabel={skin?.label ?? 'Unknown shell'}
          skinGlyph={skin?.glyph ?? '·'}
          summary={summary}
          recorded={activity.length}
          menu={menu}
        />

        {slots.sideRail === 'icons' && <DeskIcons items={items} onOpen={onOpen} />}
        {slots.sideRail === 'sources' && <SourceRail launchers={launchers} onLaunch={onLaunch} />}

        {slots.bottomBar === 'taskbar' && (
          <Taskbar items={items} launchers={launchers} onOpen={onOpen} onLaunch={onLaunch} />
        )}
        {slots.bottomBar === 'shelf' && <Shelf items={items} onOpen={onOpen} />}
        {slots.bottomBar === 'timeline' && (
          <Timeline items={items} activity={activity} onOpen={onOpen} />
        )}

        {/* `surfaces: 'column'` — the windows sit dimmed at the edges (spec §3 D). A veil over the
            window band (z-20, above App's ranked 10…16 and below the z-30 furniture) rather than
            an opacity on the windows themselves, because dimming must not touch geometry and must
            not cost the windows their pointer events: it is `pointer-events-none`, so pointing,
            deixis and every window control still work through it. */}
        {slots.surfaces === 'column' && (
          <div aria-hidden className="absolute inset-0 z-20 pointer-events-none bg-[var(--bg-color)]/70" />
        )}

        {/* `restoreVia: 'column'` — D has no bottom bar, so the inventory lives at the top of the
            centre column. This is the surface the registry's invariant test names; without it a
            minimize in this skin would be a journaled trap with no route back. */}
        {slots.restoreVia === 'column' && (
          // I2: the strip is a bare CONTAINER, not a surface — it has no background, spans the
          // column's own width across the top-centre of the plane (`box`, so it narrows with the
          // column on a laptop plane), and sits over the default program window's title
          // bar. Every other skin's bar is a visibly opaque full-width thing, so "furniture
          // swallows pointers" reads honestly there; here it would be an invisible pointer sink
          // (elementFromPoint past the last chip returned this div, whose stopPropagation killed
          // the point, and a drag started on the title bar underneath did nothing). So the
          // container is transparent to the pointer and only the chips take it — the same
          // pointer-events-none / -auto pattern App uses on its planeBox/surfaceBox wrappers.
          <div
            aria-label="Open windows"
            style={{ left: box.left, width: box.width }}
            className="absolute top-14 z-30 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pointer-events-none"
          >
            {items.length === 0
              ? <span className="text-[11px] font-mono text-[var(--text-secondary)]">Nothing open.</span>
              : items.map((it) => (
                  <div
                    key={it.id}
                    data-shell
                    onPointerDown={(e) => e.stopPropagation()}
                    className="pointer-events-auto shrink-0"
                  >
                    <WindowChip item={it} onOpen={() => onOpen(it.id)} />
                  </div>
                ))}
          </div>
        )}
      </div>
    </>
  );
}
