import React from 'react';
import { X } from 'lucide-react';
import type { WhiteboardState } from './types';
import { WhiteboardMarks } from './WhiteboardMarks';

// Board-mode surface: a dismissable card over the desktop holding the marks in its own 0-1000 space.
export function WhiteboardPanel({ state, onClear }: { state: WhiteboardState; onClear: () => void }) {
  if (!state.marks.length) return null;
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-[min(680px,88vw)] h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--card-border)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Whiteboard</span>
        <button aria-label="Clear whiteboard" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClear}><X size={13} /></button>
      </div>
      <div className="relative w-full h-[calc(100%-2rem)]">
        <WhiteboardMarks state={state} />
      </div>
    </div>
  );
}
