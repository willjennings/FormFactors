import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'word', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('guidance telemetry', () => {
  beforeEach(() => telemetry.start(cfg));
  it('counts sequences, completions, unaided (fade-2) completions, blocked, reveals', () => {
    telemetry.guidance('sequence_start', { taskKey: 'k', posture: 'guide', fadeLevel: 0 });
    telemetry.guidance('blocked', { taskKey: 'k' });
    telemetry.guidance('sequence_complete', { taskKey: 'k', fadeLevel: 0 });
    telemetry.guidance('sequence_start', { taskKey: 'k', posture: 'teach', fadeLevel: 2 });
    telemetry.guidance('reveal', { taskKey: 'k' });
    telemetry.guidance('sequence_complete', { taskKey: 'k', fadeLevel: 2 });
    const g = telemetry.metrics().guidance;
    expect(g).toEqual({ sequences: 2, completions: 2, unaidedCompletions: 1, blocked: 1, reveals: 1, abandoned: 0, relatesShown: 0 });
  });
});
