import { describe, it, expect } from 'vitest';
import { bandKeyAction } from './bandKeys';
import { REGISTERS, BAND_NOTCH_COUNT } from './registry';

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
  it('pins the call site\'s notch count: App.tsx passes BAND_NOTCH_COUNT (register row + ' +
     'Custom) to bandKeyAction, never a count that includes the band\'s 4-notch shell row ' +
     '(Task 8). Register-only digits is now a PERMANENT contract (human ruling 2026-07-29, ' +
     'spec §4 amended to match) rather than a deferral, so BAND_NOTCH_COUNT is the one ' +
     'sanctioned place that value can change — widening it (or the register list it is ' +
     'derived from) must show up here as an explicit edit, not silent drift.', () => {
    expect(BAND_NOTCH_COUNT).toBe(REGISTERS.length + 1);
    expect(BAND_NOTCH_COUNT).toBe(5); // 4 registers + Custom, pinned literal: a 5th register fails this line
    // Exercised through the same named export App.tsx imports, not a re-typed literal — digit 9
    // is the skin row's 4th notch and stays inert under the real call-site value.
    expect(bandKeyAction('9', false, true, BAND_NOTCH_COUNT)).toBeNull();
  });
});
