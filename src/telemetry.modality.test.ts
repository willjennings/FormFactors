import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'word', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('telemetry modality slicing', () => {
  beforeEach(() => telemetry.start(cfg));

  it('slices deixis accuracy by modality and defaults to voice', () => {
    telemetry.deixis('this', 'Save button', 'Save button', 'high', 'typed');
    telemetry.deixis('this', 'Save button', 'Save As button', 'high', 'typed');
    telemetry.deixis('number', 'Save button', 'Save button', 'high', 'direct');
    telemetry.deixis('this', 'Save button', 'Save button', 'high'); // defaults to voice
    const m = telemetry.metrics();
    expect(m.deixis.byModality.typed).toEqual({ n: 2, correct: 1 });
    expect(m.deixis.byModality.direct).toEqual({ n: 1, correct: 1 });
    expect(m.deixis.byModality.voice).toEqual({ n: 1, correct: 1 });
  });

  it('slices actions by modality', () => {
    telemetry.action('format_content', 'transform', 'commit', 'typed');
    telemetry.action('save_file', 'mutate', 'witness'); // defaults to voice
    const m = telemetry.metrics();
    expect(m.actions.byModality.typed).toEqual({ total: 1, commits: 1, witnesses: 0 });
    expect(m.actions.byModality.voice).toEqual({ total: 1, commits: 0, witnesses: 1 });
  });
});
