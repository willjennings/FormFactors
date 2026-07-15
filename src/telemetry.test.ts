import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'excel', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('telemetry resolution slicing', () => {
  beforeEach(() => telemetry.start(cfg));

  it('slices grounding agreement by resolution path', () => {
    telemetry.grounding('Cell A1', 'Cell A1', true, 'structural');
    telemetry.grounding('Cell A1', 'Cell B2', false, 'structural');
    telemetry.grounding(null, 'Cell A1', null, 'visual');
    const m = telemetry.metrics();
    expect(m.grounding.byResolution.structural).toEqual({ total: 2, agree: 1 });
    expect(m.grounding.byResolution.visual).toEqual({ total: 0, agree: 0 });
    expect(m.grounding.byResolution.none).toEqual({ total: 0, agree: 0 });
  });

  it('defaults resolution to none when omitted', () => {
    telemetry.grounding('X', 'X', true);
    const m = telemetry.metrics();
    expect(m.grounding.byResolution.none).toEqual({ total: 1, agree: 1 });
  });
});

describe('ramble telemetry (spec §7)', () => {
  beforeEach(() => telemetry.start(cfg));
  it('records fill / gap_question / readback / stall / session_complete and an attributed correction', () => {
    telemetry.fill('location', 'heard', 0.8);
    telemetry.gapQuestion('neededBy');
    telemetry.readback(true);
    telemetry.readback(false);
    telemetry.stall();
    telemetry.correction('location', true);
    telemetry.sessionComplete(42_000, 6, 1);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'fill')).toMatchObject({ slotId: 'location', source: 'heard', confidence: 0.8 });
    expect(events.find(e => e.type === 'gap_question')).toMatchObject({ slotId: 'neededBy' });
    expect(events.filter(e => e.type === 'readback').map(e => e.accepted)).toEqual([true, false]);
    expect(events.some(e => e.type === 'stall')).toBe(true);
    expect(events.find(e => e.type === 'correction')).toMatchObject({ slotId: 'location', overAgent: true });
    expect(events.find(e => e.type === 'session_complete')).toMatchObject({ timeToCompleteMs: 42_000, slotsFilled: 6, inferredCount: 1 });
  });
});
