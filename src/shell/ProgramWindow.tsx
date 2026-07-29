import React, { useRef } from 'react';
import { Minus, X } from 'lucide-react';
import { clampWindow, type WindowRect } from './windowState';
import type { WindowOrigin } from './desk/types';
import type { ShellSkin } from './skins/types';
import { Button } from '../ui/Button';
import { Tip } from '../ui/Tooltip';

type Chrome = ShellSkin['slots']['windowChrome'];

type Props = {
  title: string;
  statusLabel: string;
  rect: WindowRect;
  /** Paint order, ranked from the desk's z by App — never the raw `z` (it grows unbounded). */
  zIndex: number;
  chrome: Chrome;
  /** Stamped when the window was opened; rendered only under `provenance` chrome. */
  origin: WindowOrigin;
  /** `settled` is false for the intermediate frames of a drag and true once the pointer is
   *  released — App journals only the settled rect (one drag would otherwise write hundreds of
   *  journal entries against a cap of 500). */
  onRectChange: (r: WindowRect, settled: boolean) => void;
  onMinimize: () => void;
  onFocus: () => void;
  planeRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

/** The program window: real chrome over a ProgramSurface. Drag by title bar, resize from the
 *  corner. Geometry is clamped to the desktop plane and OWNED BY THE DESK (spec §1) — this
 *  component reads a rect and reports changes, it stores none. Measurement (data-entity-id)
 *  re-runs from App's layout scan, which keys on the desk's own window signature.
 *
 *  A program window is never destroyed: both title-bar controls minimize it, so it keeps its
 *  rect and its place in the inventory and is recoverable from the restore surface every skin
 *  is required to name (spec §2). */
export function ProgramWindow({ title, statusLabel, rect, zIndex, chrome, origin, onRectChange, onMinimize, onFocus, planeRef, children }: Props) {
  const drag = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; start: WindowRect; last: WindowRect } | null>(null);

  const plane = () => {
    const el = planeRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
  };

  const begin = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation(); // the plane's pointer handlers own deixis painting, not window drags
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect, last: rect };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { mode, startX, startY, start } = drag.current;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    // Always a NEW rect object — never `start.x += dx`. The boot rect can be a module-level
    // constant shared by reference (journal/registry.ts's DEFAULT_DESK_RECT), and an in-place
    // mutation would rewrite that constant for the lifetime of the module, so a later "new desk"
    // would boot at wherever this window was last dragged.
    const next = clampWindow(
      mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy },
      plane(),
    );
    drag.current.last = next;
    onRectChange(next, false);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    // `last` is only replaced by `move`, so an untouched press-and-release is still the identical
    // object and writes nothing: a click on the title bar must not journal a move.
    if (d && d.last !== d.start) onRectChange(d.last, true);
  };

  const frameClass = chrome === 'minimal'
    ? 'rounded-lg border border-[var(--card-border)]/50 bg-[var(--card-bg)] shadow-md'
    : chrome === 'provenance'
      ? 'rounded-lg border border-[var(--accent-color)]/40 bg-[var(--card-bg)] shadow-xl'
      : 'rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl';
  const barClass = chrome === 'minimal'
    ? 'min-h-[32px] bg-transparent'
    : chrome === 'provenance'
      ? 'min-h-[36px] border-b border-[var(--card-border)] bg-[var(--bg-color)]'
      : 'min-h-[44px] border-b border-[var(--card-border)] bg-[var(--bg-color)]';

  return (
    <div
      className={`program-window absolute flex flex-col overflow-hidden ${frameClass}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }}
      // Capture phase, deliberately: the title bar's own pointerdown calls stopPropagation (it
      // owns the drag), which would otherwise keep a click on the title bar from ever raising
      // the window. Capture also never swallows the event — the plane still sees it.
      onPointerDownCapture={onFocus}
    >
      <div
        className={`flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none touch-none ${barClass}`}
        onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      >
        <div className="flex items-center gap-2 min-w-0">
          {chrome === 'provenance' && (
            <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[var(--accent-color)] shrink-0">
              {origin === 'you' ? 'yours' : 'agent'}
            </span>
          )}
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{title}</span>
          <span className={`text-[10px] font-mono font-bold ${statusLabel === 'Edited' ? 'text-[var(--text-secondary)] opacity-60' : 'text-green-500'}`}>{statusLabel}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Both controls are `icon44` (44×44), which is the project's larger hit standard and
              comfortably above the hit-24 floor the brief asks for. */}
          <Tip label="Minimize — it stays on the desk"><Button size="icon44" aria-label="Minimize window" onClick={onMinimize} onPointerDown={(e) => e.stopPropagation()}><Minus size={14} /></Button></Tip>
          {/* Full chrome keeps the familiar × as well, and it minimizes too: there is no event
              that destroys a program window, so the label says where it goes. */}
          {chrome === 'full' && (
            <Tip label="Put the window away (it minimizes — nothing is lost)">
              <Button size="icon44" aria-label="Put the window away — it minimizes" onClick={onMinimize} onPointerDown={(e) => e.stopPropagation()}><X size={14} /></Button>
            </Tip>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 p-2">{children}</div>
      <div
        className="absolute bottom-0 right-0 w-6 h-6 hit-24 cursor-nwse-resize touch-none"
        onPointerDown={begin('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      />
    </div>
  );
}
