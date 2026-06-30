import type { FormSchema, SessionState, SlotFill } from './types';

export const RFI_SCHEMA: FormSchema = {
  formId: 'rfi',
  title: 'RFI',
  capturedAt: 0,
  slots: [
    { id: 'question', label: 'Question', type: 'text', required: true, order: 0 },
    { id: 'location', label: 'Location / gridline', type: 'shortText', required: true, order: 1 },
    { id: 'drawingRef', label: 'Drawing ref', type: 'reference', required: true, order: 2 },
    { id: 'neededBy', label: 'Needed by', type: 'date', required: true, order: 3 },
    { id: 'discipline', label: 'Discipline', type: 'enum', required: false, constraint: 'Architectural|Structural|Mechanical|Electrical', order: 4 },
    { id: 'dateSubmitted', label: 'Date', type: 'date', required: true, order: 5 },
  ],
};

/** Build the starting session. `today` and `now` are injected (pure). */
export function initialSessionState(schema: FormSchema, today: string, now: number): SessionState {
  const fills: SlotFill[] = schema.slots.map((s) =>
    s.id === 'dateSubmitted'
      ? { slotId: s.id, value: today, status: 'draft', confidence: 1, source: 'inferred', owner: 'agent', updatedAt: now }
      : { slotId: s.id, value: null, status: 'empty', confidence: 0, source: 'heard', owner: 'agent', updatedAt: now },
  );
  return { phase: 'conversing', activity: 'listening', activeSlotId: null, lastUpdateAt: now, fills };
}
