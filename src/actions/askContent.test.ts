import { describe, it, expect } from 'vitest';
import { askCallToState, ASK_CONTENT_TOOL, MAX_CANDIDATES } from './askContent';

describe('ASK_CONTENT_TOOL', () => {
  it('has flat parameters — nested object-arrays are the d24abef schema hazard', () => {
    for (const p of Object.values(ASK_CONTENT_TOOL.parameters.properties as Record<string, any>)) {
      expect(p.type === 'object').toBe(false);
    }
    expect(ASK_CONTENT_TOOL.parameters.required).toEqual(['field', 'question']);
  });
});

describe('askCallToState', () => {
  it('accepts a question with candidates', () => {
    const v = askCallToState({ field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] });
    expect(v).toEqual({ ask: { field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] } });
  });
  it('accepts a bare question — the model asks plainly rather than padding', () => {
    const v = askCallToState({ field: 'body', question: 'What should it say?' }) as any;
    expect(v.ask.candidates).toEqual([]);
  });
  it('rejects an empty question', () => {
    expect((askCallToState({ field: 'heading', question: '  ' }) as any).error).toBeTruthy();
  });
  it('rejects an unknown field, naming the valid ones', () => {
    const v = askCallToState({ field: 'nonsense', question: 'What?' }) as any;
    expect(v.error).toContain('heading');
    expect(v.error).toContain('slideTitle');
  });
  it(`caps candidates at ${MAX_CANDIDATES} rather than truncating silently`, () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['a', 'b', 'c', 'd'] }) as any;
    expect(v.error).toContain(String(MAX_CANDIDATES));
  });
  it('drops blank candidates instead of rendering empty chips', () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['Real', '  ', ''] }) as any;
    expect(v.ask.candidates).toEqual(['Real']);
  });
});
