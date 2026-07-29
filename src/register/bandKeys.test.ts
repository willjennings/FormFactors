import { describe, it, expect } from 'vitest';
import { bandKeyAction } from './bandKeys';

describe('bandKeyAction', () => {
  it('backtick opens when closed, closes when open; inert in editable targets', () => {
    expect(bandKeyAction('`', false, false, 5)).toBe('open');
    expect(bandKeyAction('`', false, true, 5)).toBe('close');
    expect(bandKeyAction('`', true, false, 5)).toBeNull();
  });
  it('digits select a notch only while open and in range', () => {
    expect(bandKeyAction('1', false, true, 5)).toBe(0);
    expect(bandKeyAction('5', false, true, 5)).toBe(4);
    expect(bandKeyAction('6', false, true, 5)).toBeNull();
    expect(bandKeyAction('1', false, false, 5)).toBeNull(); // closed → digits are quick-fire's
  });
  it('Escape closes; everything else null', () => {
    expect(bandKeyAction('Escape', false, true, 5)).toBe('close');
    expect(bandKeyAction('x', false, true, 5)).toBeNull();
  });
  it('digits stay register-only: the band also renders a 4-notch shell row (Task 8), but ' +
     'App calls bandKeyAction with notchCount = REGISTERS.length + 1 (5, the 4 registers plus ' +
     'Custom) — the shell row is not part of notchCount, so its digits are deliberately inert ' +
     'here even though 9 notches are visible in the open band. Extending digit chords to the ' +
     'shell row is its own decision, deferred (see RegisterBand.tsx\'s file-top comment).', () => {
    expect(bandKeyAction('6', false, true, 5)).toBeNull();
    expect(bandKeyAction('9', false, true, 5)).toBeNull();
  });
});
