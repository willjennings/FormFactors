import React from 'react';
import type { ActivityEntry } from '../../activityStore';
import { timelineItems, type TimelineActor } from './timelineItems';
import { WindowChip, type ShellBarItem } from './WindowChip';

const LANE: Record<TimelineActor, { label: string; tone: string }> = {
  you:       { label: 'you',       tone: 'text-sky-300' },
  agent:     { label: 'agent',     tone: 'text-slate-300' },
  witnessed: { label: 'witnessed', tone: 'text-emerald-300' },
  waiting:   { label: 'waiting',   tone: 'text-amber-300' },
};

const ROWS = 4;

/** C · Provenance's four-lane timeline (spec §3), plus the inventory.
 *
 *  The inventory is here because C declares `restoreVia: 'bottomBar'` and its bottom bar IS this
 *  component — so this is the surface a minimized window has to be recoverable from, and the
 *  registry's own invariant test is what makes that non-optional. It sits to the left of the
 *  lanes rather than in a bar of its own: one bottom edge, two readings.
 *
 *  Every row comes from `timelineItems`, which is pure and tested — including the decision that
 *  the trailing `waiting` lane appears only for an unanswered agent ask, and that a user's own
 *  utterance is never dressed up as one. */
export function Timeline({ items, activity, onOpen }: {
  items: ShellBarItem[];
  activity: ActivityEntry[];
  onOpen: (id: string) => void;
}) {
  const rows = timelineItems(activity, ROWS);
  return (
    <div
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-0 left-0 right-0 z-30 h-[132px] flex flex-col gap-1.5 px-3 py-2 border-t border-white/10 bg-[#0f151c]/92 backdrop-blur"
    >
      {/* The inventory is a full-width ROW, not a column beside the lanes: as a column it held
          two chips in the bar's height and silently scrolled the third out of sight — and this is
          the surface skin C's `restoreVia: 'bottomBar'` promises a minimized window can be
          recovered from, so "you have to know to scroll" is not an acceptable version of it. */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto custom-scrollbar" aria-label="Open windows">
        <span className="shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 mr-1">open</span>
        {items.length === 0 && <span className="text-[11px] font-mono text-slate-500">Nothing open.</span>}
        {items.map((it) => <WindowChip key={it.id} item={it} onOpen={() => onOpen(it.id)} />)}
      </div>
      <span aria-hidden className="h-px bg-white/10" />
      <div className="flex-1 min-h-0 flex flex-col justify-end gap-0.5 overflow-hidden" aria-label="Session timeline" aria-live="polite">
        {rows.length === 0 && (
          <span className="text-[11px] font-mono text-slate-500">Nothing has happened yet — the record starts empty.</span>
        )}
        {rows.map((r, i) => (
          <div key={`${r.at}-${i}`} className="flex items-baseline gap-2 min-w-0">
            <span className={`shrink-0 w-[68px] text-right text-[9px] font-mono uppercase tracking-widest ${LANE[r.actor].tone}`}>
              {LANE[r.actor].label}
            </span>
            <span className={`min-w-0 truncate text-[11px] font-mono ${r.actor === 'waiting' ? 'text-amber-200' : 'text-slate-200'}`}>
              {r.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
