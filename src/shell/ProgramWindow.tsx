import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { clampWindow, type WindowRect } from './windowState';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';

type Props = {
  title: string;
  statusLabel: string;
  rect: WindowRect;
  onRectChange: (r: WindowRect) => void;
  onClose: () => void;
  planeRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

/** The single program window: real chrome over a ProgramSurface. Drag by title bar,
 *  resize from the corner. Geometry is clamped to the desktop plane; measurement
 *  (data-element-id) re-runs automatically via the existing ResizeObserver. */
export function ProgramWindow({ title, statusLabel, rect, onRectChange, onClose, planeRef, children }: Props) {
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: WindowRect } | null>(null);

  const plane = () => {
    const el = planeRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
  };

  const begin = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation(); // the plane's pointer handlers own deixis painting, not window drags
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { mode, startX, startY, start } = drag.current;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    onRectChange(clampWindow(
      mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy },
      plane(),
    ));
  };
  const end = () => { drag.current = null; };

  return (
    <div
      className="program-window absolute z-10 flex flex-col rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        className="flex items-center justify-between px-3 min-h-[44px] border-b border-[var(--card-border)] bg-[var(--bg-color)] cursor-grab active:cursor-grabbing select-none touch-none"
        onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{title}</span>
          <span className={`text-[10px] font-mono font-bold ${statusLabel === 'Edited' ? 'text-[var(--text-secondary)] opacity-60' : 'text-green-500'}`}>{statusLabel}</span>
        </div>
        <Tip label="Close window"><Button size="icon44" aria-label="Close window" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}><X size={14} /></Button></Tip>
      </div>
      <div className="flex-1 min-h-0 p-2">{children}</div>
      <div
        className="absolute bottom-0 right-0 w-6 h-6 hit-24 cursor-nwse-resize touch-none"
        onPointerDown={begin('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      />
    </div>
  );
}
