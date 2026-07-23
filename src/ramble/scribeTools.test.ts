import { describe, it, expect } from 'vitest';
import { SCRIBE_TOOLS, scribeCallToEvents, phaseGuard } from './scribeTools';
import { RFI_SCHEMA } from './rfiSchema';

describe('SCRIBE_TOOLS', () => {
  it('declares the five scribe tools', () => {
    expect(SCRIBE_TOOLS.map(t => t.name).sort()).toEqual(
      ['ask_gap', 'confirm_slot', 'fill_slot', 'recap', 'submit'],
    );
  });
});

describe('scribeCallToEvents', () => {
  it('fill_slot → fillingStart THEN draft (the monitor needs the live anchor)', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' } }, RFI_SCHEMA);
    expect(evs).toEqual([
      { type: 'slot.fillingStart', slotId: 'location' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' },
    ]);
  });
  it('clamps confidence to 0..1 and coerces an invalid source to heard', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 7, source: 'guessed' } }, RFI_SCHEMA) as any[];
    expect(evs[1]).toMatchObject({ confidence: 1, source: 'heard' });
  });
  it('falls back an unparseable confidence to 0.5 rather than leaking NaN', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 'high', source: 'heard' } }, RFI_SCHEMA) as any[];
    expect(evs[1]).toMatchObject({ confidence: 0.5 });
  });
  it('FAILS THE CALL on an unknown slotId, naming the valid ids (errors are data)', () => {
    const bad = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'siteContact', value: 'x', confidence: 0.9, source: 'heard' } }, RFI_SCHEMA) as { error: string };
    expect(bad.error).toMatch(/^Unknown slotId "siteContact"\./);
    expect(bad.error).toContain('question, location, drawingRef, neededBy, discipline, dateSubmitted');
  });
  it('ask_gap and confirm_slot validate slotId too', () => {
    expect(scribeCallToEvents({ name: 'ask_gap', args: { slotId: 'neededBy', question: 'by when?' } }, RFI_SCHEMA))
      .toEqual([{ type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' }]);
    expect(scribeCallToEvents({ name: 'confirm_slot', args: { slotId: 'nope' } }, RFI_SCHEMA)).toHaveProperty('error');
  });
  it('recap and submit map to phase changes; unknown tool → error', () => {
    expect(scribeCallToEvents({ name: 'recap', args: {} }, RFI_SCHEMA)).toEqual([{ type: 'session.phaseChange', phase: 'recapping' }]);
    expect(scribeCallToEvents({ name: 'submit', args: {} }, RFI_SCHEMA)).toEqual([{ type: 'session.phaseChange', phase: 'awaitingConsent' }]);
    expect(scribeCallToEvents({ name: 'nope', args: {} }, RFI_SCHEMA)).toEqual({ error: 'Unknown scribe tool "nope".' });
  });
});

describe('enum constraint validation (probe 2026-07-16: "banana" landed as an unmarked high-confidence discipline)', () => {
  it('rejects a fill violating an enum constraint, naming the allowed values', () => {
    const r = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'discipline', value: 'banana', confidence: 0.95, source: 'heard' } }, RFI_SCHEMA) as { error: string };
    expect(r.error).toContain('discipline');
    expect(r.error).toContain('Architectural|Structural|Mechanical|Electrical');
  });
  it('accepts a case-insensitive match and normalizes to the canonical casing', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'discipline', value: 'structural', confidence: 0.9, source: 'heard' } }, RFI_SCHEMA) as any[];
    const draft = evs.find((e: any) => e.type === 'slot.draft');
    expect(draft.value).toBe('Structural');
  });
  it('non-enum slots accept any value as before', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'wherever', confidence: 0.5, source: 'heard' } }, RFI_SCHEMA);
    expect(Array.isArray(evs)).toBe(true);
  });
});

describe('phaseGuard', () => {
  it('fills are legal in conversing/recapping, rejected in sealed phases with the honest reason', () => {
    for (const name of ['fill_slot', 'ask_gap', 'confirm_slot']) {
      expect(phaseGuard(name, 'conversing')).toBeNull();
      expect(phaseGuard(name, 'recapping')).toBeNull();
      expect(phaseGuard(name, 'awaitingConsent')).toMatch(/awaiting the user's consent/);
      expect(phaseGuard(name, 'submitting')).toMatch(/being submitted/);
      expect(phaseGuard(name, 'done')).toMatch(/already submitted/);
    }
  });
  it('submit requires a recap first', () => {
    expect(phaseGuard('submit', 'conversing')).toMatch(/recap the collected slots before submitting/);
    expect(phaseGuard('submit', 'recapping')).toBeNull();
    expect(phaseGuard('submit', 'awaitingConsent')).toBeNull(); // idempotent repeat
    expect(phaseGuard('submit', 'done')).toMatch(/already submitted/);
  });
  it('recap is legal from conversing/recapping only', () => {
    expect(phaseGuard('recap', 'conversing')).toBeNull();
    expect(phaseGuard('recap', 'recapping')).toBeNull();
    expect(phaseGuard('recap', 'done')).toMatch(/already submitted/);
    expect(phaseGuard('recap', 'awaitingConsent')).toMatch(/awaiting the user's consent/);
  });
  it('unknown names pass through (validation owns them)', () => {
    expect(phaseGuard('not_a_tool', 'done')).toBeNull();
  });
});
