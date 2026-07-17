import { describe, it, expect } from 'vitest';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

describe('RFI_SCHEMA', () => {
  it('has 6 slots in order with the required ones marked', () => {
    expect(RFI_SCHEMA.slots.map(s => s.id)).toEqual([
      'question', 'location', 'drawingRef', 'neededBy', 'discipline', 'dateSubmitted',
    ]);
    expect(RFI_SCHEMA.slots.find(s => s.id === 'discipline')!.required).toBe(false);
    expect(RFI_SCHEMA.slots.find(s => s.id === 'question')!.required).toBe(true);
  });
});

describe('initialSessionState', () => {
  it('seeds every slot empty except dateSubmitted (inferred=today, draft)', () => {
    const st = initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);
    expect(st.phase).toBe('conversing');
    expect(st.activity).toBe('listening');
    expect(st.activeSlotId).toBeNull();
    const date = st.fills.find(f => f.slotId === 'dateSubmitted')!;
    expect(date).toMatchObject({ value: '6/29/2026', status: 'draft', source: 'inferred', confidence: 1, owner: 'agent' });
    const q = st.fills.find(f => f.slotId === 'question')!;
    expect(q).toMatchObject({ value: null, status: 'empty', source: 'heard', owner: 'agent' });
  });
});
