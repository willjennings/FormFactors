import { describe, it, expect } from 'vitest';
import { activeSlot, recentSlots, isStalled, STALL_MS } from './selectors';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

const start = () => initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);

describe('selectors', () => {
  it('activeSlot returns the filling slot or null', () => {
    expect(activeSlot(start())).toBeNull();
    const st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    expect(activeSlot(st)!.slotId).toBe('question');
  });

  it('recentSlots returns the last n updated non-empty slots, excluding the active one', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 1, source: 'heard' }, 2000);
    st = reduce(st, { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 1, source: 'heard' }, 2100);
    st = reduce(st, { type: 'slot.fillingStart', slotId: 'question' }, 2200);
    const recent = recentSlots(st, 2).map(s => s.slotId);
    expect(recent).toEqual(['drawingRef', 'location']); // newest first, active 'question' excluded
  });

  it('isStalled only when conversing and past the threshold', () => {
    const st = start(); // lastUpdateAt = 1000, phase conversing
    expect(isStalled(st, 1000 + STALL_MS)).toBe(false);     // exactly at threshold, not past
    expect(isStalled(st, 1000 + STALL_MS + 1)).toBe(true);  // past
    // Walk the legal phase chain — the reducer now no-ops illegal jumps like
    // conversing -> done directly (spec 2026-07-21-ramble-phase-machine).
    let done = reduce(st, { type: 'session.phaseChange', phase: 'recapping' }, 1000);
    done = reduce(done, { type: 'session.phaseChange', phase: 'awaitingConsent' }, 1000);
    done = reduce(done, { type: 'session.phaseChange', phase: 'submitting' }, 1000);
    done = reduce(done, { type: 'session.phaseChange', phase: 'done' }, 1000);
    expect(isStalled(done, 1000 + STALL_MS + 5000)).toBe(false); // not conversing → never stalled
  });
});
