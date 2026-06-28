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
