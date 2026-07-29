import React from 'react';
import type { ProgramId } from '../../../scenarios';
import { ProgramLauncher } from './WindowChip';

/** B · Material's source rail: the programs you can still draw from, collapsed into a narrow
 *  strip down the left edge (spec §3 B).
 *
 *  Only programs with NO window on the desk appear here — one that has been opened is material on
 *  the shelf, and listing it in both places would make the same program two different things.
 *  When the desk holds every program the rail says so rather than rendering an empty strip: this
 *  skin's known first reaction is "where did my spreadsheet go?", and an unexplained blank rail
 *  is exactly how that starts.
 *
 *  56px wide, not the 76 it started at: a docked rail overlaps windows the way every dock does,
 *  but at 76 it clipped the title bar and the ribbon of a window opened at the desk's own default
 *  x of 48 (`DEFAULT_DESK_RECT` in journal/registry.ts). 56 leaves an 8px overlap that reads as a
 *  border rather than as a broken window — and the alternative, nudging the windows clear, is the
 *  one thing a skin may not do: geometry belongs to the desk, never to the furniture (spec §1). */
export function SourceRail({ launchers, onLaunch }: {
  launchers: { id: ProgramId; label: string }[];
  onLaunch: (id: ProgramId) => void;
}) {
  return (
    <div
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Sources you can draw from"
      className="absolute left-0 top-12 bottom-[68px] z-30 w-[56px] flex flex-col items-stretch gap-1 px-1 py-2 border-r border-[#d9cdb8] dark:border-[#3a3229] bg-[#faf6ef]/80 dark:bg-[#211c17]/80 backdrop-blur overflow-y-auto custom-scrollbar"
    >
      <span className="text-[8px] font-mono uppercase tracking-widest text-[var(--text-secondary)] text-center mb-1">
        sources
      </span>
      {launchers.length === 0 && (
        <span className="text-[9px] font-mono text-[var(--text-secondary)] text-center leading-tight">
          all open — they are on the shelf
        </span>
      )}
      {launchers.map((p) => (
        <ProgramLauncher key={p.id} id={p.id} label={p.label} orientation="column" onLaunch={() => onLaunch(p.id)} />
      ))}
    </div>
  );
}
