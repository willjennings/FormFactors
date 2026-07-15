import { describe, it, expect } from 'vitest';
import { SCRIBE_TOOLS, scribeCallToEvents } from './scribeTools';
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
