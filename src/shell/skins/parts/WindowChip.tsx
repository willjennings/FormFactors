import React from 'react';
import { FileText, Table, Presentation, Image as ImageIcon, Layers } from 'lucide-react';
import { PROGRAMS, type ProgramId } from '../../../scenarios';

// One bar item, as the bars see it.
//
// This is a STRUCTURAL MIRROR of `barItems()`'s return type in src/shell/desk/selectors.ts, not
// an import of it: `src/shell/skins/types.ts` states that nothing under src/shell/skins/ may
// import from src/shell/desk/ (the dependency runs the other way — desk knows the skin key). The
// field names match exactly, so App hands `barItems(...)` straight through.
//
// `origin` is deliberately ABSENT. The desk stamps every artifact window `origin: 'agent'`
// (selectors.ts's reconcileArtifacts), and it has no choice: artifactStore.ts's `artifact.create`
// stamps `owner: 'agent'` for a user's pin too, so the underlying data cannot tell a pin from a
// combine. A bar that printed "agent" beside something the user pinned would be a false claim
// about authorship in the one product whose thesis is that it does not make those. So the shell
// layer is not given the field, and cannot render it. `kind` — program vs artifact — is a fact
// the store genuinely owns, and it is what the chips distinguish instead.
export interface ShellBarItem {
  id: string;
  title: string;
  kind: 'program' | 'artifact';
  minimized: boolean;
  focused: boolean;
}

const PROGRAM_ICONS: Record<ProgramId, React.ReactNode> = {
  word: <FileText size={16} />, excel: <Table size={16} />,
  powerpoint: <Presentation size={16} />, photo: <ImageIcon size={16} />,
};

/** The icon for a window id (`program:excel` / `artifact:a1`). Falls back to the artifact glyph
 *  rather than guessing a program — an unknown id must never redecorate itself as Word. */
export function windowIcon(id: string): React.ReactNode {
  const p = PROGRAMS.find((x) => id === `program:${x.id}`);
  return p ? PROGRAM_ICONS[p.id] : <Layers size={16} />;
}

export function programIcon(id: ProgramId): React.ReactNode {
  return PROGRAM_ICONS[id];
}

/** One window in a bar. Minimized items are visibly dimmed and say where they went; the focused
 *  item carries the accent ring. It is a real <button>, so it is in the tab order, and `hit-24`
 *  gives it the repo's minimum pointer target regardless of the label's width. */
export function WindowChip({ item, onOpen, tone = 'bar' }: {
  item: ShellBarItem;
  onOpen: () => void;
  /** `bar` — a taskbar/timeline strip button. `card` — the Shelf's larger material tile. */
  tone?: 'bar' | 'card';
}) {
  const state = item.minimized ? 'put away — click to bring it back'
    : item.focused ? 'in front'
    : 'bring to front';
  const base = 'hit-24 flex items-center gap-2 min-w-0 text-left transition-colors';
  const shape = tone === 'card'
    ? 'px-3 py-2 rounded-xl border w-[168px]'
    : 'px-2.5 py-1 rounded-lg border max-w-[190px]';
  const skinTone = item.focused && !item.minimized
    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--text-primary)]'
    : 'border-[var(--card-border)] bg-[var(--card-bg)]/70 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-color)]/60';
  return (
    <button
      onClick={onOpen}
      title={`${item.title} — ${state}`}
      aria-label={`${item.title} — ${state}`}
      aria-pressed={item.focused && !item.minimized}
      className={`${base} ${shape} ${skinTone} ${item.minimized ? 'opacity-45' : ''}`}
    >
      <span aria-hidden className="shrink-0">{windowIcon(item.id)}</span>
      <span className="flex flex-col min-w-0">
        <span className="text-[11px] font-medium truncate">{item.title}</span>
        {tone === 'card' && (
          <span className="text-[9px] font-mono uppercase tracking-widest opacity-70">
            {item.kind === 'artifact' ? 'piece' : 'source'}{item.minimized ? ' · put away' : ''}
          </span>
        )}
      </span>
    </button>
  );
}

/** A program with NO window on the desk yet — a launcher, not an inventory entry. Rendered after
 *  the bar items so the inventory keeps its openedAt order untouched at the head of the bar. */
export function ProgramLauncher({ id, label, onLaunch, orientation = 'row' }: {
  id: ProgramId; label: string; onLaunch: () => void; orientation?: 'row' | 'column';
}) {
  return (
    <button
      onClick={onLaunch}
      title={`Open ${label}`}
      aria-label={`Open ${label}`}
      className={`hit-24 flex items-center gap-2 rounded-lg px-2.5 py-1 text-[var(--text-secondary)] hover:text-[var(--accent-color)] hover:bg-[var(--card-bg)]/70 transition-colors ${orientation === 'column' ? 'flex-col gap-1 w-full py-2' : ''}`}
    >
      <span aria-hidden>{PROGRAM_ICONS[id]}</span>
      <span className={orientation === 'column' ? 'text-[9px] leading-tight text-center' : 'text-[11px]'}>
        {orientation === 'column' ? label.replace('Microsoft ', '') : label}
      </span>
    </button>
  );
}
