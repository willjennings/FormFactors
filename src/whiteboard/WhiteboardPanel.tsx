import React from 'react';
import { X, Eraser } from 'lucide-react';
import type { WhiteboardState } from './types';
import type { SketchState, XY } from '../sketch/types';
import { WhiteboardMarks } from './WhiteboardMarks';
import { SketchLayer } from '../sketch/SketchLayer';

// Board-mode surface: agent marks + the user's sketch layer in one 0-1000 space.
// Visibility: any content, or explicitly opened (MenuBar pen toggle / ?sketch=1).
export function WhiteboardPanel({ state, preview, sketch, open, onClear, onClearSketch, onStroke, demoCaption }: {
  state: WhiteboardState; preview?: WhiteboardState | null; sketch: SketchState; open: boolean;
  onClear: () => void; onClearSketch: () => void; onStroke: (points: XY[]) => void;
  demoCaption?: string | null;
}) {
  if (!open && !state.marks.length && !sketch.strokes.length && !preview) return null;
  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 w-[min(680px,88vw)] h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden" data-shell onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 h-8 border-b border-[var(--card-border)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Whiteboard</span>
        <div className="flex items-center gap-2">
          <button aria-label="Clear sketch" disabled={!sketch.strokes.length}
            className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            onClick={onClearSketch}><Eraser size={13} /></button>
          <button aria-label="Clear whiteboard" className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClear}><X size={13} /></button>
        </div>
      </div>
      <div className="relative w-full h-[calc(100%-2rem)]">
        <SketchLayer strokes={sketch.strokes} onStroke={onStroke} />
        <WhiteboardMarks state={state} />
        {preview && (
          // A PROPOSAL, not a committed diagram: faint so declining doesn't read as deletion.
          <div className="absolute inset-0 opacity-40 pointer-events-none" aria-label="Proposed marks (awaiting confirmation)">
            <WhiteboardMarks state={preview} />
            <span className="absolute top-1 right-2 text-[8px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">proposed</span>
          </div>
        )}
      </div>
      {demoCaption && (
        <div className="absolute bottom-0 inset-x-0 px-3 py-1 text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--card-bg)]/90 border-t border-[var(--card-border)] truncate" title={demoCaption}>
          {demoCaption}
        </div>
      )}
    </div>
  );
}
