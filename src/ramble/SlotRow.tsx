import { useState } from 'react';
import type { Slot, SlotFill } from './types';

const CONF_THRESHOLD = 0.6;

const BASE: Record<string, string> = {
  empty: 'opacity-40',
  filling: 'bg-blue-50 ring-1 ring-blue-300',
  draft: 'bg-amber-50/40',
  confirmed: '',
  needsInput: 'bg-amber-50/60',
};

export function SlotRow({
  slot, fill, isActive, onEditStart, onEditCommit, onEditCancel,
}: {
  slot: Slot; fill: SlotFill; isActive: boolean;
  onEditStart: (id: string) => void;
  onEditCommit: (id: string, value: string) => void;
  onEditCancel: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const uncertain = fill.source === 'inferred' || (fill.value != null && fill.confidence < CONF_THRESHOLD);
  const owned = fill.owner === 'user';

  const begin = () => { setDraft(fill.value ?? ''); setEditing(true); onEditStart(slot.id); };
  const commit = () => { setEditing(false); onEditCommit(slot.id, draft); };
  const cancel = () => { setEditing(false); onEditCancel(slot.id); };

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-md ${BASE[fill.status] ?? ''} ${isActive ? 'animate-pulse' : ''}`}>
      <div className="w-32 shrink-0 text-xs text-slate-500">{slot.label}</div>
      <div className="flex-1 font-mono text-sm">
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
            onBlur={commit}
            className="w-full border border-blue-400 rounded px-1 py-0.5"
          />
        ) : (
          <button className="text-left w-full" onClick={begin}>
            {fill.status === 'needsInput'
              ? <span className="text-amber-600">asking… "{fill.pendingQuestion}"</span>
              : (fill.value ?? <span className="text-slate-300">·</span>)}
          </button>
        )}
      </div>
      {uncertain && <span title="inferred / low confidence" className="text-amber-500 text-xs">✓?</span>}
      {owned && <span title="yours — agent won't overwrite" className="text-blue-600 text-[10px] font-semibold">yours</span>}
    </div>
  );
}
