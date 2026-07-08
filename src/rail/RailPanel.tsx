import React, { useRef, useState } from 'react';
import { X, MessageSquare, GripHorizontal } from 'lucide-react';
import type { Rail } from './types';
import { visibleCards, type RailState, type RailEvent } from './railStore';
import { CardView } from './CardView';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';

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
  const projected: RailState | null = respond
    ? state
    : teachingRail ? { rail: teachingRail, openWhy: null, flipped: [] as number[] }
    : null;
  if (!projected?.rail) return null;
  const isProjection = !respond;
  const cards = visibleCards(projected);

  if (collapsed) {
    return (
      <Tip label="Open responses">
        <Button size="icon48" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCollapsed(false)}
          className="absolute top-14 right-4 z-30 border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg text-[var(--accent-color)]">
          <MessageSquare size={16} />
        </Button>
      </Tip>
    );
  }
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-30 w-[300px] flex flex-col gap-1.5 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-color)]/90 backdrop-blur shadow-xl p-2"
      style={{ right: -pos.x, top: pos.y }}
    >
      <div
        className="flex items-center justify-between px-1 min-h-8 cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, start: pos }; }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.start.x + (e.clientX - drag.current.sx), y: drag.current.start.y + (e.clientY - drag.current.sy) }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal size={14} className="text-[var(--text-secondary)] opacity-50 shrink-0" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{projected.rail.seq}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tip label="Collapse">
            <Button size="icon44" className="w-8 h-8 hit-44 text-[var(--text-secondary)]" onClick={() => setCollapsed(true)}>—</Button>
          </Tip>
          {!isProjection && (
            <Tip label="Dismiss">
              <Button size="icon44" className="w-8 h-8 hit-44 text-[var(--text-secondary)]" onClick={() => onEvent({ type: 'rail.dismiss' })}><X size={12} /></Button>
            </Tip>
          )}
        </div>
      </div>
      {cards.map(({ card, index, mode }) => (
        <CardView key={index} card={card} index={index} mode={mode}
          whyOpen={state.openWhy === index} flipped={state.flipped.includes(index)}
          onWhy={() => { if (!isProjection) onEvent({ type: 'user.whyToggle', index }); }}
          onFlip={() => { if (!isProjection) onEvent({ type: 'user.flip', index }); }}
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
