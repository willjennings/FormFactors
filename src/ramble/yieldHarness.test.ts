import { describe, it, expect } from 'vitest';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import type { RambleEvent, SessionState } from './types';

// Component-level yield proof, scripted (spec §9: "prove the glance with mocked events").
// The fill entry in SessionState IS the SlotRow's props — asserting it asserts the screen.
const play = (events: RambleEvent[], from?: SessionState) =>
  events.reduce((st, ev, i) => reduce(st, ev, 1000 + i * 100), from ?? initialSessionState(RFI_SCHEMA, '7/15/2026', 1000));

describe('yield harness — user edit mid-ramble survives an agent barrage', () => {
  it('after the user takes location, every later agent event on it is a no-op on screen', () => {
    const st = play([
      { type: 'slot.fillingStart', slotId: 'question' },
      { type: 'slot.draft', slotId: 'question', value: 'Beam conflicts with duct', confidence: 0.8, source: 'heard' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.7, source: 'heard' },
      { type: 'user.editStart', slotId: 'location' },
      { type: 'user.editCommit', slotId: 'location', value: 'C-9 (north wall)' },
      // the barrage — every agent event type that targets a slot:
      { type: 'slot.fillingStart', slotId: 'location' },
      { type: 'slot.valueUpdate', slotId: 'location', partialValue: 'C-3' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.99, source: 'heard' },
      { type: 'slot.needsInput', slotId: 'location', question: 'which gridline?' },
      { type: 'slot.confirmed', slotId: 'location' },
    ]);
    const loc = st.fills.find((f) => f.slotId === 'location')!;
    expect(loc).toMatchObject({ value: 'C-9 (north wall)', status: 'confirmed', owner: 'user', source: 'userEdited' });
    expect(st.activeSlotId).not.toBe('location'); // never became the anchor again
  });
});
