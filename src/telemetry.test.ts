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
