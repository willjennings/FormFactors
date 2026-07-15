import type { FormSchema, SessionState } from './types';
import { LivenessIndicator } from './LivenessIndicator';
import { SlotRow } from './SlotRow';

export function Monitor({
  schema, state, now, onEditStart, onEditCommit, onEditCancel, onOpenFullEditor, live = true,
}: {
  schema: FormSchema; state: SessionState; now: number;
  onEditStart: (id: string) => void;
  onEditCommit: (id: string, value: string) => void;
  onEditCancel: (id: string) => void;
  onOpenFullEditor: () => void;
  live?: boolean;
}) {
  const slots = [...schema.slots].sort((a, b) => a.order - b.order);
  return (
    <div className="max-w-md mx-auto mt-10 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold">{schema.title}</h2>
        <LivenessIndicator state={state} now={now} live={live} />
      </div>
      <div className="py-2">
        {slots.map((slot) => {
          const fill = state.fills.find((f) => f.slotId === slot.id)!;
          return (
            <SlotRow
              key={slot.id} slot={slot} fill={fill}
              isActive={state.activeSlotId === slot.id}
              onEditStart={onEditStart} onEditCommit={onEditCommit} onEditCancel={onEditCancel}
            />
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-slate-100 text-right">
        <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={onOpenFullEditor}>open full editor</button>
      </div>
    </div>
  );
}
