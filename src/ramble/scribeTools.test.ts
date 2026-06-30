import { describe, it, expect } from 'vitest';
import { SCRIBE_TOOLS, toolCallToEvent } from './scribeTools';

describe('SCRIBE_TOOLS', () => {
  it('declares the five scribe tools', () => {
    expect(SCRIBE_TOOLS.map(t => t.name).sort()).toEqual(
      ['ask_gap', 'confirm_slot', 'fill_slot', 'recap', 'submit'],
    );
  });
});

describe('toolCallToEvent', () => {
  it('maps fill_slot → slot.draft with coerced fields', () => {
    const ev = toolCallToEvent({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' } });
    expect(ev).toEqual({ type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' });
  });

  it('maps ask_gap → slot.needsInput', () => {
    expect(toolCallToEvent({ name: 'ask_gap', args: { slotId: 'neededBy', question: 'by when?' } }))
      .toEqual({ type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' });
  });

  it('maps confirm_slot, recap, submit', () => {
    expect(toolCallToEvent({ name: 'confirm_slot', args: { slotId: 'location' } }))
      .toEqual({ type: 'slot.confirmed', slotId: 'location' });
    expect(toolCallToEvent({ name: 'recap', args: {} })).toEqual({ type: 'session.phaseChange', phase: 'recapping' });
    expect(toolCallToEvent({ name: 'submit', args: {} })).toEqual({ type: 'session.phaseChange', phase: 'awaitingConsent' });
  });

  it('returns null for an unknown tool', () => {
    expect(toolCallToEvent({ name: 'nope', args: {} })).toBeNull();
  });
});
