import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry, exportConfigString } from './telemetry';

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

describe('mission telemetry (spec §7)', () => {
  beforeEach(() => telemetry.start(cfg));
  it('records the four mission events with their payloads', () => {
    telemetry.missionStart('ship-brief', 0);
    telemetry.missionStepDone('ship-brief', 'fix-sheet');
    telemetry.missionComplete('ship-brief', 0, 102000, 3);
    telemetry.missionAbandoned('fix-deck', 0);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'mission_start')).toMatchObject({ key: 'ship-brief', run: 0 });
    expect(events.find(e => e.type === 'mission_step_done')).toMatchObject({ key: 'ship-brief', stepKey: 'fix-sheet' });
    expect(events.find(e => e.type === 'mission_complete')).toMatchObject({ key: 'ship-brief', run: 0, durationMs: 102000, steps: 3 });
    expect(events.find(e => e.type === 'mission_abandoned')).toMatchObject({ key: 'fix-deck', stepIndex: 0 });
  });
});

describe('unspecified asks are counted apart from errors', () => {
  beforeEach(() => telemetry.start(cfg));

  it('records field / answered / viaChip per ask and never touches the error count', () => {
    telemetry.unspecifiedAsk('heading', true, true);
    telemetry.unspecifiedAsk('body', true, false);
    telemetry.unspecifiedAsk('slideTitle', false, false);   // Esc'd, or the program swapped
    const m = telemetry.metrics();
    expect(m.asks).toEqual({ total: 3, answered: 2, viaCandidate: 1 });
    expect(m.errors).toBe(0);                               // an ask is not an error
    expect(m.actions.total).toBe(0);                        // …and not an action decision either
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.filter(e => e.type === 'unspecified_ask')).toHaveLength(3);
    expect(events.find(e => e.type === 'unspecified_ask'))
      .toMatchObject({ field: 'heading', answered: true, viaChip: true });
  });

  it('a real error still counts as one, with the asks alongside it', () => {
    telemetry.unspecifiedAsk('heading', true, false);
    telemetry.error('boom');
    const m = telemetry.metrics();
    expect(m.errors).toBe(1);
    expect(m.asks.total).toBe(1);
  });

  it('the three action decisions sum to the action total (gate rejections included)', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.action('edit_content', 'mutate', 'witness');
    telemetry.action('insert_object', 'create', 'rejected');
    const a = telemetry.metrics().actions;
    expect(a.commits + a.witnesses + a.rejected).toBe(a.total);
    expect(a.rejected).toBe(1);
  });

  it('correctionRate divides by what reached the document, never by refusals', () => {
    // `actions` was widened to include 'rejected' when the gate landed, which INVERTED this rate:
    // an arm whose gate refuses more scored lower, i.e. looked better at not needing correction —
    // for refusing to act at all. A refusal is not a corrected action; it never happened.
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.action('edit_content', 'mutate', 'witness');
    telemetry.correction();
    expect(telemetry.metrics().correctionRate).toBe(0.5);
    // Three gate refusals later, the arm has corrected exactly as often as before.
    for (let i = 0; i < 3; i++) telemetry.action('edit_content', 'mutate', 'rejected');
    expect(telemetry.metrics().correctionRate).toBe(0.5);
    expect(telemetry.metrics().corrections).toBe(1);
  });

  it('nothing reached the document, so there is no rate to report', () => {
    telemetry.action('edit_content', 'mutate', 'rejected');
    expect(telemetry.metrics().correctionRate).toBe(0);
  });
});

describe('arm in telemetry', () => {
  it('stamps the arm on session config and register_switch events', () => {
    const DEFAULT_DIALS = { honest: false, autonomy: 'confirm' as const, feedback: 'earcon' as const, confirmGoals: false, markings: false, chipDensity: 'full' as const, traceView: 'hidden' as const, teaching: 'off' as const, proactivity: 'never' as const };
    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word',
      honest: false, device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
      arm: { register: 'guided', dials: DEFAULT_DIALS } });
    telemetry.registerSwitch('guided', 'terminal', true);
    const json = JSON.parse(telemetry.exportJSON());
    expect(json.config.arm.register).toBe('guided');
    expect(json.events.find((e: any) => e.type === 'register_switch'))
      .toMatchObject({ from: 'guided', to: 'terminal', midSession: true });
  });
});

describe('shell in telemetry (shell skin is a second, independent measured axis)', () => {
  beforeEach(() => telemetry.start(cfg));

  it('shellSwitch pushes a shell_switch event with the right shape and a timestamp', () => {
    telemetry.shellSwitch('familiar', 'material', true);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    const ev = events.find(e => e.type === 'shell_switch');
    expect(ev).toMatchObject({ from: 'familiar', to: 'material', midSession: true });
    expect(typeof ev.t).toBe('number');
  });

  it('snapshot() carries shell_switch events through', () => {
    telemetry.shellSwitch('conversation', 'provenance', false);
    const snap = telemetry.snapshot();
    expect(snap.events.find((e: any) => e.type === 'shell_switch'))
      .toMatchObject({ from: 'conversation', to: 'provenance', midSession: false });
  });

  it('the Arm round-trips shell: set a config with a shell, read it back out of the export', () => {
    const DEFAULT_DIALS = { honest: false, autonomy: 'confirm' as const, feedback: 'earcon' as const, confirmGoals: false, markings: false, chipDensity: 'full' as const, traceView: 'hidden' as const, teaching: 'off' as const, proactivity: 'never' as const };
    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word',
      honest: false, device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
      arm: { register: 'guided', dials: DEFAULT_DIALS, shell: 'material' } });
    const json = JSON.parse(telemetry.exportJSON());
    expect(json.config.arm.shell).toBe('material');
  });

  it('a shell switch never moves any number in metrics() — deep-equal before/after (the register-arm error-rate doctrine applied to the new axis)', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.action('edit_content', 'mutate', 'rejected');
    telemetry.correction();
    telemetry.error('boom');
    telemetry.unspecifiedAsk('heading', true, true);
    const before = telemetry.metrics();
    telemetry.shellSwitch('familiar', 'material', true);
    telemetry.shellSwitch('material', 'conversation', false);
    telemetry.shellSwitch('conversation', 'provenance', true);
    const after = telemetry.metrics();
    expect(after).toEqual(before);
  });
});

describe('turn events (the denominator is real)', () => {
  beforeEach(() => telemetry.start(cfg));

  it('pushes a turn event with the given shape', () => {
    telemetry.turn('t1', 'voice', 'add a heading here', 'speech_only', 300, null);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    const ev = events.find(e => e.type === 'turn');
    expect(ev).toMatchObject({
      id: 't1', modality: 'voice', request: 'add a heading here',
      outcome: 'speech_only', firstResponseMs: 300, settledMs: null,
    });
    expect(typeof ev.t).toBe('number');
  });

  it('records a tool_call turn with both millis set', () => {
    telemetry.turn('t2', 'typed', 'sum this column', 'tool_call', 120, 900);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'turn')).toMatchObject({ outcome: 'tool_call', firstResponseMs: 120, settledMs: 900 });
  });

  it('a turn event never moves any number in metrics() — deep-equal before/after (the same shape that caught a real inverted-denominator bug)', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.action('edit_content', 'mutate', 'rejected');
    telemetry.correction();
    telemetry.error('boom');
    telemetry.unspecifiedAsk('heading', true, true);
    telemetry.deixis('this', 'Cell A1', 'Cell A1', 'high');
    telemetry.grounding('Cell A1', 'Cell A1', true, 'structural');
    const before = telemetry.metrics();
    telemetry.turn('t1', 'voice', 'add a heading here', 'speech_only', 300, null);
    telemetry.turn('t2', 'voice', 'sum this column', 'no_response', null, null);
    telemetry.turn('t3', 'typed', 'insert a chart', 'tool_call', 120, 900);
    telemetry.turn('t4', 'voice', '<lost>', 'transcription_lost', null, null);
    telemetry.sessionComplete(42_000, 6, 1, 12, 3);
    const after = telemetry.metrics();
    expect(after).toEqual(before);
  });
});

describe('sessionComplete gains framesSent/hintsSent', () => {
  beforeEach(() => telemetry.start(cfg));

  it('records framesSent/hintsSent when provided', () => {
    telemetry.sessionComplete(42_000, 6, 1, 12, 3);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'session_complete'))
      .toMatchObject({ timeToCompleteMs: 42_000, slotsFilled: 6, inferredCount: 1, framesSent: 12, hintsSent: 3 });
  });

  it('defaults framesSent/hintsSent to 0 for existing call sites (compiles unchanged)', () => {
    telemetry.sessionComplete(42_000, 6, 1);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'session_complete'))
      .toMatchObject({ timeToCompleteMs: 42_000, slotsFilled: 6, inferredCount: 1, framesSent: 0, hintsSent: 0 });
  });
});

describe('exportConfigString (the arm/shell/cfg segment of the download filename)', () => {
  // Pulled out of exportJSON's `if (typeof window !== 'undefined')` guard, which vitest never
  // executes here (node, no jsdom) — this is the only way the 'unset' fallbacks are exercised.
  const base = { backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false,
    device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' } };
  const DEFAULT_DIALS = { honest: false, autonomy: 'confirm' as const, feedback: 'earcon' as const, confirmGoals: false, markings: false, chipDensity: 'full' as const, traceView: 'hidden' as const, teaching: 'off' as const, proactivity: 'never' as const };

  it('renders both register and shell when both are set', () => {
    const config = { ...base, arm: { register: 'guided', dials: DEFAULT_DIALS, shell: 'material' as const } };
    expect(exportConfigString(config)).toBe('guided-material-gemini-auto-safe-earcon');
  });

  it('renders unset for shell when a register is set but no shell', () => {
    const config = { ...base, arm: { register: 'guided', dials: DEFAULT_DIALS } };
    expect(exportConfigString(config)).toBe('guided-unset-gemini-auto-safe-earcon');
  });

  it('renders unset for both when there is no arm at all', () => {
    const config = { ...base };
    expect(exportConfigString(config)).toBe('unset-unset-gemini-auto-safe-earcon');
  });

  it('renders "session" for a null config, matching current behaviour', () => {
    expect(exportConfigString(null)).toBe('session');
  });
});
