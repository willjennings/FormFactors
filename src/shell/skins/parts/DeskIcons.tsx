import React from 'react';
import { Layers } from 'lucide-react';
import type { ShellBarItem } from './WindowChip';

/** A · Familiar's desktop icons: the pieces the session has made, sitting ON the desk (spec §3 A).
 *
 *  Deliberately BELOW the windows in paint order (z-5 against the windows' 10…16, which App ranks)
 *  — that is what makes them read as lying on the desktop rather than floating over the work, and
 *  it is the same relationship a real desktop has. A window can therefore cover them; the taskbar
 *  is the surface that always answers "what exists", which is why the icons are a second view of
 *  the same inventory and never the only one.
 *
 *  Only artifacts appear. A program is not a thing on the desk in this metaphor; it is the desk's
 *  window onto a program, and it already has a taskbar button and a launcher. */
export function DeskIcons({ items, onOpen }: {
  items: ShellBarItem[];
  onOpen: (id: string) => void;
}) {
  const pieces = items.filter((i) => i.kind === 'artifact');
  if (pieces.length === 0) return null;
  return (
    <div
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Pieces on the desk"
      className="absolute left-2 top-14 z-[5] w-[84px] flex flex-col items-stretch gap-1"
    >
      {pieces.map((it) => (
        <button
          key={it.id}
          onClick={() => onOpen(it.id)}
          title={`${it.title} — ${it.minimized ? 'put away; click to bring it back' : 'bring to front'}`}
          aria-label={`${it.title} — ${it.minimized ? 'put away; click to bring it back' : 'bring to front'}`}
          className={`hit-24 flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[var(--text-primary)] hover:bg-[var(--card-bg)]/70 transition-colors ${it.minimized ? 'opacity-50' : ''}`}
        >
          <span aria-hidden className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]/85 shadow-sm">
            <Layers size={18} />
          </span>
          <span className="text-[9px] leading-tight text-center line-clamp-2 drop-shadow-[0_1px_0_rgba(255,255,255,0.6)] dark:drop-shadow-none">
            {it.title}
          </span>
        </button>
      ))}
    </div>
  );
}
