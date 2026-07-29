import React from 'react';
import { MenuBar, type MenuBarProps } from '../../MenuBar';
import type { ShellSkin } from '../types';

type Variant = ShellSkin['slots']['topBar'];

/** A ticking wall clock — the Familiar skin's one piece of pure convention (spec §3 A). One
 *  interval, cleared on unmount; it renders the machine's own locale time, nothing derived. */
function Clock() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-[11px] font-mono text-[var(--text-secondary)] mr-2 tabular-nums" aria-label={`Clock — ${now.toLocaleTimeString()}`}>
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </span>
  );
}

const COUNT = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The top bar, four ways. Every variant hosts the SAME control cluster (MenuBar) — the drawer,
 *  the mic status, the register pill and the theme toggle are invariants (spec §5), not
 *  furniture — and varies only the reading on the left and the bar's own surface.
 *
 *  `summary` is `deskSummary(desk)`'s output, passed in by value: this file may not import from
 *  src/shell/desk/ (skins/types.ts). */
export function TopBar({ variant, skinKey, skinLabel, skinGlyph, summary, recorded, menu }: {
  variant: Variant;
  skinKey: string;
  skinLabel: string;
  skinGlyph: string;
  summary: { pieces: number; sources: number };
  /** How many rows the session's activity trace holds — skin C's "session + counts". */
  recorded: number;
  menu: MenuBarProps;
}) {
  if (variant === 'desk') {
    return (
      <MenuBar {...menu} skinKey={skinKey}
        frameClass="border-b border-[#d9cdb8] dark:border-[#3a3229] bg-[#faf6ef]/85 dark:bg-[#211c17]/85 backdrop-blur"
        lead={
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">Your desk</span>
            <span className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
              {COUNT(summary.pieces, 'piece', 'pieces')} · {COUNT(summary.sources, 'source', 'sources')}
            </span>
          </span>
        } />
    );
  }
  if (variant === 'session') {
    return (
      <MenuBar {...menu} skinKey={skinKey}
        frameClass="border-b border-white/10 bg-[#0f151c]/90 backdrop-blur"
        lead={
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">session</span>
            <span className="text-[11px] font-mono text-[var(--text-primary)] truncate">
              {COUNT(summary.pieces, 'piece', 'pieces')} · {COUNT(summary.sources, 'source', 'sources')} · {COUNT(recorded, 'step', 'steps')} recorded
            </span>
          </span>
        } />
    );
  }
  if (variant === 'minimal') {
    return (
      <MenuBar {...menu} skinKey={skinKey}
        frameClass="bg-transparent"
        lead={
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
            <span aria-hidden>{skinGlyph}</span>{skinLabel}
          </span>
        } />
    );
  }
  // 'menu' — A · Familiar. The brand where a system menu would be, and a clock on the right.
  return <MenuBar {...menu} skinKey={skinKey} trail={<Clock />} />;
}
