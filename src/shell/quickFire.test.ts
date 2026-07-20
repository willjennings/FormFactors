import { describe, it, expect } from 'vitest';
import { quickFireIndex } from './quickFire';

// Quick-fire chips (user finding 2026-07-18): clicking a chip forces the pointer OFF the
// referent the question is about. Digits 1-9 fire chips while the pointer stays put.
describe('quickFireIndex', () => {
  it('maps digits 1-9 to chip indices 0-8', () => {
    expect(quickFireIndex('1', false, 5)).toBe(0);
    expect(quickFireIndex('5', false, 5)).toBe(4);
  });
  it('null when the digit exceeds the visible chip count', () => {
    expect(quickFireIndex('6', false, 5)).toBeNull();
    expect(quickFireIndex('9', false, 0)).toBeNull();
  });
  it('null for non-digits, 0, and multi-char keys', () => {
    for (const k of ['0', 'a', 'Enter', ' ', 'F1', '-']) expect(quickFireIndex(k, false, 9)).toBeNull();
  });
  it('never fires while focus is in an editable target (typing digits must stay typing)', () => {
    expect(quickFireIndex('1', true, 9)).toBeNull();
  });
  it('never fires on key-repeat — a held key must not machine-gun the chip (user 2026-07-19: one tap fired five slide inserts)', () => {
    expect(quickFireIndex('2', false, 9, { repeat: true })).toBeNull();
    expect(quickFireIndex('2', false, 9, { repeat: false })).toBe(1);
  });
  it('same-key cooldown swallows bounce but allows deliberate repeats after the window', () => {
    expect(quickFireIndex('2', false, 9, { lastFire: { key: '2', at: 1000 }, now: 1300 })).toBeNull();
    expect(quickFireIndex('2', false, 9, { lastFire: { key: '2', at: 1000 }, now: 1500 })).toBe(1);
    // a DIFFERENT chip is not blocked by the cooldown
    expect(quickFireIndex('3', false, 9, { lastFire: { key: '2', at: 1000 }, now: 1100 })).toBe(2);
  });
});
