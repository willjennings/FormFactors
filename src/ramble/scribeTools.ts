import type { VoiceTool } from '../voice/types';
import type { RambleEvent, SlotSource, FormSchema } from './types';

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

const AGENT_SOURCES: SlotSource[] = ['heard', 'inferred', 'asked'];

/** Errors are data: name the valid ids so the scribe's retry can succeed. */
function badSlot(slotId: string, schema: FormSchema) {
  return { error: `Unknown slotId "${slotId}". Valid slot ids: ${schema.slots.map((s) => s.id).join(', ')}.` };
}

/** Pure mapping from a scribe tool call to reducer events. Unknown tool/slot fails the WHOLE call. */
export function scribeCallToEvents(
  call: { name: string; args: any }, schema: FormSchema,
): RambleEvent[] | { error: string } {
  const a = call.args ?? {};
  const slotId = String(a.slotId ?? '');
  const known = (id: string) => schema.slots.some((s) => s.id === id);
  switch (call.name) {
    case 'fill_slot': {
      if (!known(slotId)) return badSlot(slotId, schema);
      const confidence = Math.min(1, Math.max(0, Number(a.confidence ?? 0.5)));
      const source = (AGENT_SOURCES.includes(a.source) ? a.source : 'heard') as SlotSource;
      return [
        { type: 'slot.fillingStart', slotId },
        { type: 'slot.draft', slotId, value: String(a.value ?? ''), confidence, source },
      ];
    }
    case 'ask_gap':
      if (!known(slotId)) return badSlot(slotId, schema);
      return [{ type: 'slot.needsInput', slotId, question: String(a.question ?? '') }];
    case 'confirm_slot':
      if (!known(slotId)) return badSlot(slotId, schema);
      return [{ type: 'slot.confirmed', slotId }];
    case 'recap':
      return [{ type: 'session.phaseChange', phase: 'recapping' }];
    case 'submit':
      return [{ type: 'session.phaseChange', phase: 'awaitingConsent' }];
    default:
      return { error: `Unknown scribe tool "${call.name}".` };
  }
}
