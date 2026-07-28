import { describe, it, expect } from 'vitest';
import { quickFireIndex, digitSelectsTarget } from './quickFire';

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

// Two window keydown listeners see the same digit. Quick-fire is mounted first, so it runs first
// and calls clearAsk SYNCHRONOUSLY — by the time the deixis listener reads askRef it is already
// null, so "is an ask open?" cannot be the question. The event's own defaultPrevented flag can.
describe('digitSelectsTarget — a digit is claimed once', () => {
  it('a digit quick-fire already claimed never also selects a target', () => {
    // Pressing "2" to answer ask candidate 2 also ran selectTargetByNumber(2): it set the input
    // modality to 'direct' (so the answered edit was attributed to the wrong modality), dropped a
    // THIS marker, pushed a graded deixis event, and told the model to treat target 2 as what the
    // user was pointing at — while they were answering a content question. Grounding
    // reconciliation then graded the model's edit against that phantom referent.
    for (const k of ['1', '2', '5', '9']) expect(digitSelectsTarget(k, false, true)).toBe(false);
  });
  it('an unclaimed digit still selects its target — pointer-free deixis is untouched', () => {
    expect(digitSelectsTarget('1', false, false)).toBe(true);
    expect(digitSelectsTarget('9', false, false)).toBe(true);
  });
  it('an open register band owns its digits, stated directly and not via the other listener', () => {
    expect(digitSelectsTarget('3', true, false)).toBe(false);
    expect(digitSelectsTarget('3', true, true)).toBe(false);
  });
  it('only 1-9: 0 and letters are other grammars', () => {
    for (const k of ['0', 't', 'i', 'h', 'Escape', '`']) expect(digitSelectsTarget(k, false, false)).toBe(false);
  });
});
