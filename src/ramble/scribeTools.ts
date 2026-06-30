import type { VoiceTool } from '../voice/types';
import type { RambleEvent, SlotSource } from './types';

export const SCRIBE_TOOLS: VoiceTool[] = [
  {
    name: 'fill_slot',
    description: 'Provisionally fill one form field from what the user said. Use only for genuine content, not asides. Provide your confidence (0..1) and the source.',
    parameters: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'The field id, e.g. "question", "location", "drawingRef", "neededBy", "discipline".' },
        value: { type: 'string', description: 'The value to fill.' },
        confidence: { type: 'number', description: '0..1 — how sure you are this is right.' },
        source: { type: 'string', enum: ['heard', 'inferred', 'asked'], description: 'heard=said directly; inferred=you derived it; asked=answer to a gap question.' },
      },
      required: ['slotId', 'value', 'confidence', 'source'],
    },
  },
  {
    name: 'ask_gap',
    description: 'Ask the user ONE conversational question to fill a missing required field. Ask only when genuinely ambiguous or empty.',
    parameters: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'The field the question is about.' },
        question: { type: 'string', description: 'The short spoken question.' },
      },
      required: ['slotId', 'question'],
    },
  },
  {
    name: 'confirm_slot',
    description: 'Mark a field confirmed after you read it back and the user accepted it.',
    parameters: { type: 'object', properties: { slotId: { type: 'string' } }, required: ['slotId'] },
  },
  {
    name: 'recap',
    description: 'Begin the full recap: voice the whole form and explicitly flag every inferred field before submitting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'submit',
    description: 'Request submission of the completed form. This is a high-consequence action and will require explicit user consent.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

/** Pure 1:1 mapping from a scribe tool call to a reducer event. Returns null for unknown tools. */
export function toolCallToEvent(call: { name: string; args: any }): RambleEvent | null {
  const a = call.args ?? {};
  switch (call.name) {
    case 'fill_slot':
      return { type: 'slot.draft', slotId: String(a.slotId), value: String(a.value ?? ''), confidence: Number(a.confidence ?? 0.5), source: (a.source ?? 'heard') as SlotSource };
    case 'ask_gap':
      return { type: 'slot.needsInput', slotId: String(a.slotId), question: String(a.question ?? '') };
    case 'confirm_slot':
      return { type: 'slot.confirmed', slotId: String(a.slotId) };
    case 'recap':
      return { type: 'session.phaseChange', phase: 'recapping' };
    case 'submit':
      return { type: 'session.phaseChange', phase: 'awaitingConsent' };
    default:
      return null;
  }
}
