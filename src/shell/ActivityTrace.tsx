import React, { useEffect, useState } from 'react';
import { visibleActivity, type ActivityState, type ActivityEntry } from './activityStore';

// The transparency trace (audit 2026-07-18): bottom-right ticker of what the model is
// actually doing. Rows come from the real seams only; a click opens the Control Center's
// full op-stream. data-shell: this is chrome, not a pointable referent.

const ICON: Record<ActivityEntry['kind'], string> = {
  ask: '→', call: '⚙', witness: '⧖', done: '✓', error: '✕',
};
const TONE: Record<ActivityEntry['kind'], string> = {
  ask: 'text-[var(--text-secondary)]',
  call: 'text-[var(--text-primary)]',
  witness: 'text-amber-600',
  done: 'text-emerald-600',
  error: 'text-red-500',
};

export function ActivityTrace({ state, onOpenStream, variant = 'ticker' }: {
  state: ActivityState; onOpenStream: () => void; variant?: 'ticker' | 'ledger';
}) {
  // Re-render on a coarse tick so ticker rows fade out on time even with no new entries.
  // The ledger variant shows the whole history with no fade, so it has no need for the tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (variant === 'ledger') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [variant]);

  if (variant === 'ledger') {
    // Full history, no fade, no VISIBLE_MAX window — a standing audit column, not a ticker.
    const rows = state.entries;
    if (!rows.length) return null;
    return (
      <div className="fixed right-2 top-14 bottom-24 w-64 overflow-y-auto z-30 flex flex-col items-end gap-1 pointer-events-auto" data-shell aria-label="Model activity ledger">
        {rows.map((r, i) => (
          <button
            key={`${r.at}-${i}`}
            onClick={onOpenStream}
            title="Open the full operation stream"
            className={`hit-24 max-w-[320px] truncate text-left px-2.5 py-1 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-sm text-[11px] font-mono ${TONE[r.kind]} hover:border-[var(--accent-color)]`}
          >
            <span aria-hidden className="mr-1.5">{ICON[r.kind]}</span>
            {r.text}
          </button>
        ))}
      </div>
    );
  }

  const rows = visibleActivity(state, Date.now());
  if (!rows.length) return null;
  return (
    <div className="absolute bottom-3 right-3 z-30 flex flex-col items-end gap-1 pointer-events-auto" data-shell aria-label="Model activity">
      {rows.map((r, i) => (
        <button
          key={`${r.at}-${i}`}
          onClick={onOpenStream}
          title="Open the full operation stream"
          className={`max-w-[320px] truncate text-left px-2.5 py-1 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-sm text-[11px] font-mono ${TONE[r.kind]} hover:border-[var(--accent-color)]`}
        >
          <span aria-hidden className="mr-1.5">{ICON[r.kind]}</span>
          {r.text}
        </button>
      ))}
    </div>
  );
}
