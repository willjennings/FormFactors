import React from 'react';
import type { ProgramId } from '../../../scenarios';
import { ProgramLauncher, WindowChip, type ShellBarItem } from './WindowChip';

/** A · Familiar's full-width taskbar: the inventory, then the programs you could still open.
 *
 *  `items` is rendered in EXACTLY the order it arrives — `barItems()` orders by `openedAt` and
 *  nothing here may re-sort it. A bar that reshuffles under the user's hand destroys the
 *  recognition benefit that is the entire reason to have one (research §5), and it is why the
 *  agent's "Q3 brief" sits next to Excel as a peer instead of in a second-class row.
 *
 *  Launchers come AFTER the inventory, and only for programs with no window at all: a program
 *  that has been opened lives in the inventory, minimized or not, and must not appear twice. */
export function Taskbar({ items, launchers, onOpen, onLaunch }: {
  items: ShellBarItem[];
  launchers: { id: ProgramId; label: string }[];
  onOpen: (id: string) => void;
  onLaunch: (id: ProgramId) => void;
}) {
  return (
    <div
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Open windows"
      className="absolute bottom-0 left-0 right-0 z-30 h-11 flex items-center gap-1.5 px-2 border-t border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-[0_-1px_6px_rgba(0,0,0,0.06)] overflow-x-auto custom-scrollbar"
    >
      {items.length === 0 && (
        <span className="text-[11px] font-mono text-[var(--text-secondary)] px-2">Nothing open.</span>
      )}
      {items.map((it) => <WindowChip key={it.id} item={it} onOpen={() => onOpen(it.id)} />)}
      {launchers.length > 0 && items.length > 0 && (
        <span aria-hidden className="shrink-0 w-px h-6 bg-[var(--card-border)] mx-1" />
      )}
      {launchers.map((p) => (
        <ProgramLauncher key={p.id} id={p.id} label={p.label} onLaunch={() => onLaunch(p.id)} />
      ))}
    </div>
  );
}
