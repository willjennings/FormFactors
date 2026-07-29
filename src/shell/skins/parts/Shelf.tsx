import React from 'react';
import { WindowChip, type ShellBarItem } from './WindowChip';

/** B · Material's shelf: the same inventory as the taskbar, laid out as material on a ledge.
 *
 *  Order is `barItems()`'s order, untouched — the temptation here is to float the artifacts to
 *  the front, since this is the skin that claims made material outweighs the apps. That would
 *  reshuffle the bar under the user's hand the moment they pinned something, which is the one
 *  thing the ordering rule forbids. Prominence is carried by the TILE instead: the `card` tone,
 *  the piece/source kicker, and an accent spine on the pieces.
 *
 *  What this skin does NOT do is resize or move anything. Spec §1's reducer passes `windows`
 *  through by identity on `desk.skin`, so a skin switch can never move a window the user placed;
 *  "artifacts are the desktop's largest objects" is therefore expressed in the furniture, and the
 *  geometry stays the user's. */
export function Shelf({ items, onOpen }: {
  items: ShellBarItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <div
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="What is on your desk"
      className="absolute bottom-0 left-0 right-0 z-30 h-[68px] flex items-center gap-2 px-3 border-t border-[#d9cdb8] dark:border-[#3a3229] bg-[#faf6ef]/90 dark:bg-[#211c17]/90 backdrop-blur overflow-x-auto custom-scrollbar"
    >
      <span className="shrink-0 text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)] -rotate-90 origin-center w-4">
        shelf
      </span>
      {items.length === 0 && (
        <span className="text-[11px] font-mono text-[var(--text-secondary)]">
          Nothing made yet — draw from a source on the left.
        </span>
      )}
      {items.map((it) => (
        <span key={it.id} className={`shrink-0 ${it.kind === 'artifact' ? 'border-l-2 border-[var(--accent-color)] pl-1.5 rounded-l' : ''}`}>
          <WindowChip item={it} tone="card" onOpen={() => onOpen(it.id)} />
        </span>
      ))}
    </div>
  );
}
