import React from 'react';
import { Button } from '../ui/Button';

/** The witness card for wb_beautify — unconditionally shown; nothing swaps without Confirm. */
export function BeautifyCard({ summary, onConfirm, onCancel }: {
  summary: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl shadow-lg px-4 py-3 w-80" role="dialog" aria-label="Beautify sketch">
      <div className="text-[11px] font-mono uppercase tracking-widest text-[var(--text-secondary)] mb-1">Beautify sketch</div>
      <p className="text-sm text-[var(--text-primary)]">{summary}</p>
      <p className="text-[11px] text-[var(--text-secondary)] mt-1">The preview is on the board. Your strokes are only replaced if you confirm.</p>
      <div className="flex gap-2 mt-3 justify-end">
        <Button size="sm" variant="outline" onClick={onCancel}>Keep my sketch</Button>
        <Button size="sm" onClick={onConfirm}>Replace</Button>
      </div>
    </div>
  );
}
