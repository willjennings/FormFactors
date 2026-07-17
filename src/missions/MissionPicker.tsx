import React from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { MissionDef, MissionRun } from './types';

/** Floating mission panel (window family styling — see WhiteboardPanel). Picker when idle;
 *  slim strip while a run is active. Hints show ONLY on run 0 (spec §5 fade). */
export function MissionPicker({ missions, runs, active, activeDef, open, onStart, onAbandon, onClose }: {
  missions: MissionDef[];
  runs: Record<string, number>;          // completed-run counts (fade source)
  active: MissionRun | null;
  activeDef: MissionDef | null;
  open: boolean;
  onStart: (key: string) => void;
  onAbandon: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  if (active && activeDef) {
    const step = activeDef.steps[active.stepIndex];
    const fade = (runs[activeDef.key] ?? 0) > 0;
    return (
      <div className="absolute top-10 right-4 z-40 w-72 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg px-4 py-3 pointer-events-auto" role="status" aria-label="Active mission">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">{activeDef.title}</span>
          <button aria-label="Abandon mission" onClick={onAbandon} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={12} /></button>
        </div>
        {step && (
          <>
            <p className="text-sm text-[var(--text-primary)] mt-1">{step.subgoal}</p>
            {!fade && <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{step.hint}</p>}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="absolute top-10 right-4 z-40 w-80 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg p-3 pointer-events-auto" role="dialog" aria-label="Missions">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">Missions</span>
        <button aria-label="Close missions" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X size={12} /></button>
      </div>
      <div className="flex flex-col gap-2">
        {missions.map((m) => (
          <div key={m.key} className="rounded-lg border border-[var(--card-border)] px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-primary)]">{m.title}</span>
              {(runs[m.key] ?? 0) > 0 && <span className="text-[10px] font-mono text-[var(--text-secondary)]">×{runs[m.key]}</span>}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{m.brief}</p>
            <div className="flex justify-end mt-1.5">
              <Button size="sm" onClick={() => onStart(m.key)}>{(runs[m.key] ?? 0) > 0 ? 'Run again' : 'Start'}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
