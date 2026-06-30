import type { RambleEvent } from './types';

/** A recorded ramble: fills three slots, asks a gap, then recaps. Drives the demo and the test. */
export const SCRIPTED_DEMO: RambleEvent[] = [
  { type: 'slot.fillingStart', slotId: 'question' },
  { type: 'slot.valueUpdate', slotId: 'question', partialValue: 'S-301 beam conflicts with A-502' },
  { type: 'slot.draft', slotId: 'question', value: 'S-301 beam conflicts with A-502 ceiling height', confidence: 0.9, source: 'heard' },
  { type: 'slot.fillingStart', slotId: 'location' },
  { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.95, source: 'heard' },
  { type: 'slot.fillingStart', slotId: 'drawingRef' },
  { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 0.5, source: 'inferred' },
  { type: 'slot.needsInput', slotId: 'neededBy', question: 'by when do you need an answer?' },
  { type: 'activity.change', activity: 'readingBack' },
  { type: 'session.phaseChange', phase: 'recapping' },
];
