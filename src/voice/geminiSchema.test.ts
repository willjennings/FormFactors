import { describe, it, expect } from 'vitest';
import { Type } from '@google/genai';
import { toGeminiParams } from './gemini';

// Live smoke 2026-07-16: wb_beautify's marks[] reached the model with NO item schema —
// toGeminiParams flattened object array items to a bare type, dropping nested properties,
// required, and every enum. The model improvised mark objects without `kind` and the call
// was rejected twice before the link closed. Full recursion is the contract.
describe('toGeminiParams', () => {
  it('recurses into object array items, preserving properties and required', () => {
    const out = toGeminiParams({
      type: 'object',
      properties: {
        marks: { type: 'array', items: { type: 'object', properties: {
          kind: { type: 'string', enum: ['node', 'connector', 'label'] },
          x: { type: 'number' },
        }, required: ['kind'] }, description: 'The structured marks.' },
      },
      required: ['marks'],
    });
    const marks = out.properties.marks;
    expect(marks.type).toBe(Type.ARRAY);
    expect(marks.description).toBe('The structured marks.');
    expect(marks.items.type).toBe(Type.OBJECT);
    expect(marks.items.required).toEqual(['kind']);
    expect(marks.items.properties.kind.type).toBe(Type.STRING);
    expect(marks.items.properties.x.type).toBe(Type.NUMBER);
  });
  it('preserves enums at every depth (they were silently dropped before)', () => {
    const out = toGeminiParams({
      type: 'object',
      properties: { posture: { type: 'string', enum: ['guide', 'teach'], description: 'How to teach.' } },
    });
    expect(out.properties.posture.enum).toEqual(['guide', 'teach']);
    expect(out.properties.posture.description).toBe('How to teach.');
  });
  it('keeps primitive array items working as before', () => {
    const out = toGeminiParams({
      type: 'object',
      properties: { strokeIds: { type: 'array', items: { type: 'string' }, description: 'ids' } },
    });
    expect(out.properties.strokeIds.items.type).toBe(Type.STRING);
    expect(out.properties.strokeIds.description).toBe('ids');
  });
});
