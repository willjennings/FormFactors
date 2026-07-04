import React, { useRef, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { Rail } from './types';
import { visibleCards, type RailState, type RailEvent } from './railStore';
import { CardView } from './CardView';

/** The floating response rail (shell spec §4): right side, draggable, collapsible to a
 *  pill. Renders the respond rail when present, else the projected teaching rail.
 *  One grammar, one renderer. Chrome stops pointer-down (deixis painter lives on main). */
export function RailPanel({ state, teachingRail, onEvent, onShowMe }: {
  state: RailState; teachingRail: Rail | null;
  onEvent: (e: RailEvent) => void; onShowMe: (entityId: string) => void;
}) {
  const [pos, setPos] = useState({ x: -16, y: 56 });   // offsets from top-right
  const [collapsed, setCollapsed] = useState(false);
  const drag = useRef<{ sx: number; sy: number; start: { x: number; y: number } } | null>(null);

  const respond = state.rail;
  const projected = respond ? state : teachingRail ? { rail: teachingRail, openWhy: null, flipped: [] } : null;
  if (!projected?.rail) return null;
  const isProjection = !respond;
  const cards = visibleCards(projected as RailState);

  if (collapsed) {
    return (
      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed(false)}
        className="absolute top-14 right-4 z-30 p-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg text-[var(--accent-color)]" title="Open responses">
        <MessageSquare size={16} />
      </button>
    );
  }
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-30 w-[300px] flex flex-col gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-color)]/90 backdrop-blur shadow-xl p-2"
      style={{ right: -pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-1 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, start: pos }; }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.start.x - (e.clientX - drag.current.sx), y: drag.current.start.y + (e.clientY - drag.current.sy) }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{projected.rail.seq}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsed(true)} className="text-[10px] font-mono text-[var(--text-secondary)] px-1" title="Collapse">—</button>
          {!isProjection && <button onClick={() => onEvent({ type: 'rail.dismiss' })} className="text-[var(--text-secondary)]" title="Dismiss"><X size={12} /></button>}
        </div>
      </div>
      {cards.map(({ card, index, mode }) => (
        <CardView key={index} card={card} index={index} mode={mode}
          whyOpen={state.openWhy === index} flipped={state.flipped.includes(index)}
          onWhy={() => onEvent({ type: 'user.whyToggle', index })}
          onFlip={() => onEvent({ type: 'user.flip', index })}
          onShowMe={() => card.entityId && onShowMe(card.entityId)}
          onCheckConfirm={() => onEvent({ type: 'user.checkConfirm' })}
        />
      ))}
      {projected.rail.guideLine && (
        <p className="px-1 text-[11px] italic text-[var(--text-secondary)]">{projected.rail.guideLine}</p>
      )}
    </div>
  );
}
