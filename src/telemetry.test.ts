import { describe, it, expect, beforeEach, vi } from 'vitest';
import { telemetry, exportConfigString, reversesAgent } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'excel', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('telemetry resolution slicing', () => {
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

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
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });
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
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });
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
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

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
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

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
    // Frozen clock: `durationMs` is a clock reading, not a measured number, so two reads either
    // side of a few pushes can straddle a millisecond and fail a whole-object deep-equal for a
    // reason this test is not about (seen intermittently 2026-07-30). Freezing keeps EVERY field
    // in the comparison — the alternative, excluding durationMs, would weaken the invariant.
    vi.useFakeTimers();
    const before = telemetry.metrics();
    telemetry.shellSwitch('familiar', 'material', true);
    telemetry.shellSwitch('material', 'conversation', false);
    telemetry.shellSwitch('conversation', 'provenance', true);
    const after = telemetry.metrics();
    vi.useRealTimers();
    expect(after).toEqual(before);
  });
});

describe('turn events (the denominator is real)', () => {
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

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
    // Frozen clock: `durationMs` is a clock reading, not a measured number, so two reads either
    // side of a few pushes can straddle a millisecond and fail a whole-object deep-equal for a
    // reason this test is not about (seen intermittently 2026-07-30). Freezing keeps EVERY field
    // in the comparison — the alternative, excluding durationMs, would weaken the invariant.
    vi.useFakeTimers();
    const before = telemetry.metrics();
    telemetry.turn('t1', 'voice', 'add a heading here', 'speech_only', 300, null);
    telemetry.turn('t2', 'voice', 'sum this column', 'no_response', null, null);
    telemetry.turn('t3', 'typed', 'insert a chart', 'tool_call', 120, 900);
    telemetry.turn('t4', 'voice', '<lost>', 'transcription_lost', null, null);
    telemetry.sessionComplete(42_000, 6, 1, 12, 3);
    const after = telemetry.metrics();
    vi.useRealTimers();
    expect(after).toEqual(before);
  });
});

describe('sessionComplete gains framesSent/hintsSent', () => {
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

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

// ==========================================================================================
// The eval deck's two hooks into the recorder (src/eval/deck.ts): a growth subscription so the
// deck's observe loop can re-grade when the stream moves, and the eval_card result event — the
// only durable record of a deck run, whose own state is deliberately unjournaled.
// ==========================================================================================
describe('growth subscription (the eval deck observe loop)', () => {
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

  it('notifies on every push, and the listener already sees the new event', () => {
    const lengths: number[] = [];
    const off = telemetry.subscribe(() => lengths.push(telemetry.eventCount()));
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.correction();
    off();
    telemetry.stall();                       // after unsubscribe: no further notifications
    expect(lengths).toEqual([2, 3]);         // session_start is event 0
    expect(telemetry.eventCount()).toBe(4);
  });

  it('a restart ARCHIVES the previous run instead of wiping it — the stream only ever grows', () => {
    let calls = 0;
    const off = telemetry.subscribe(() => { calls += 1; });
    telemetry.action('edit_content', 'mutate', 'commit');
    expect(telemetry.eventCount()).toBe(2);
    expect(telemetry.runCount()).toBe(1);
    telemetry.start(cfg);                    // a reconnect: program/register/shell/backend change
    expect(calls).toBe(2);                   // subscribers still hear it
    // THE C1 FIX (fix round 1). This used to assert 1 — "wiped back to the fresh session_start" —
    // which is exactly the defect: following the deck means switching program, every switch
    // reconnects, and a 12-card run exported roughly the last card's events while the panel claimed
    // twelve. Driven and measured before the fix: 5 events before a switch, 1 after.
    expect(telemetry.eventCount()).toBe(3);  // 2 archived + this run's session_start
    expect(telemetry.runCount()).toBe(2);
    expect(telemetry.eventsSnapshot().map((e) => e.type))
      .toEqual(['session_start', 'action', 'session_start']);
    off();
  });

  it('the export carries every run of the sitting, and says how many there were', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.start(cfg);
    telemetry.action('save_file', 'mutate', 'commit');
    telemetry.start(cfg);
    telemetry.correction();
    const snap = JSON.parse(telemetry.exportJSON());
    expect(snap.runs).toBe(3);
    expect(snap.events.filter((e: any) => e.type === 'session_start')).toHaveLength(3);
    expect(snap.events.filter((e: any) => e.type === 'action')).toHaveLength(2);
    // `metrics` stays CURRENT-RUN only (the drawer's per-session semantics, and what every
    // invariance test asserts): the two archived commits are in `events`, not in these counts.
    expect(snap.metrics.actions.total).toBe(0);
    expect(snap.metrics.corrections).toBe(1);
  });

  it('reset() drops everything, archives included', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.start(cfg);
    expect(telemetry.eventCount()).toBe(3);
    telemetry.reset();
    expect(telemetry.eventCount()).toBe(0);
    expect(telemetry.runCount()).toBe(0);
    telemetry.action('edit_content', 'mutate', 'commit');   // no config: records nothing
    expect(telemetry.eventCount()).toBe(0);
  });

  it('eventsSnapshot is a COPY — a held snapshot never changes underneath its reader', () => {
    const snap = telemetry.eventsSnapshot();
    telemetry.action('edit_content', 'mutate', 'commit');
    expect(snap.length).toBe(1);
    expect(telemetry.eventsSnapshot().length).toBe(2);
  });

  it('a throwing subscriber cannot stop the recorder or the other subscribers', () => {
    let good = 0;
    const offBad = telemetry.subscribe(() => { throw new Error('boom'); });
    const offGood = telemetry.subscribe(() => { good += 1; });
    telemetry.action('edit_content', 'mutate', 'commit');
    expect(good).toBe(1);
    expect(telemetry.eventCount()).toBe(2);
    offBad(); offGood();
  });
});

describe('eval_card events', () => {
  beforeEach(() => { telemetry.reset(); telemetry.start(cfg); });

  it('records the grade and HOW it was graded, verbatim', () => {
    telemetry.evalCard('honest-refusal', 'honesty', 'done', 'observed');
    telemetry.evalCard('robust-own-words', 'robustness', 'done', 'self');
    telemetry.evalCard('material-pin', 'material', 'skipped', 'self');
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.filter(e => e.type === 'eval_card')).toMatchObject([
      { cardId: 'honest-refusal', dimension: 'honesty', grade: 'done', graded: 'observed' },
      { cardId: 'robust-own-words', dimension: 'robustness', grade: 'done', graded: 'self' },
      { cardId: 'material-pin', dimension: 'material', grade: 'skipped', graded: 'self' },
    ]);
  });

  it('an eval_card event never moves any number in metrics() — deep-equal before/after', () => {
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.action('edit_content', 'mutate', 'rejected');
    telemetry.correction();
    telemetry.error('boom');
    telemetry.unspecifiedAsk('heading', true, true);
    telemetry.deixis('this', 'Cell A1', 'Cell A1', 'high');
    // Frozen clock: `durationMs` is a clock reading, not a measured number, so two reads either
    // side of a few pushes can straddle a millisecond and fail a whole-object deep-equal for a
    // reason this test is not about (seen intermittently 2026-07-30). Freezing keeps EVERY field
    // in the comparison — the alternative, excluding durationMs, would weaken the invariant.
    vi.useFakeTimers();
    const before = telemetry.metrics();
    telemetry.evalCard('honest-refusal', 'honesty', 'done', 'observed');
    telemetry.evalCard('point-then-change', 'pointing', 'failed', 'self');
    telemetry.evalCard('material-combine', 'material', 'skipped', 'self');
    const after = telemetry.metrics();
    vi.useRealTimers();
    expect(after).toEqual(before);
  });
});


describe('reversesAgent — which undo counts as reversing the AGENT (the anti-flattery signal)', () => {
  it('maps memento origin to overAgent, both directions', () => {
    expect(reversesAgent('agent')).toBe(true);
    expect(reversesAgent('user')).toBe(false);
  });
  it('is what handleUndo passes, so a desk undo of an agent commit now carries the flag', () => {
    telemetry.reset(); telemetry.start(cfg);
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.correction(undefined, reversesAgent('agent'));   // ⌘Z over a tool call's memento
    telemetry.correction(undefined, reversesAgent('user'));    // ⌘Z over the user's own edit
    const corrections = telemetry.eventsSnapshot().filter((e) => e.type === 'correction');
    expect(corrections).toMatchObject([{ overAgent: true }, { overAgent: false }]);
  });
});

// ==========================================================================================
// N16 (fix round 2, reviewer-ruled): neither production call site of the C1/N1 fixes was pinned
// end-to-end through the REAL singleton — this drives `telemetry.start()` twice (a register
// switch, the exact shape Task 6 ships) and asserts on `snapshot().scorecard` directly, which is
// exactly the test that would have caught the reviewer's `(3/1)`-fraction / cross-arm-latency bugs
// (N1/N5) had it existed before them.
// ==========================================================================================
describe('N16 — snapshot().scorecard is arm-scoped end-to-end across a real register switch', () => {
  const dials = { honest: false, autonomy: 'confirm' as const, feedback: 'earcon' as const, confirmGoals: false, markings: false, chipDensity: 'full' as const, traceView: 'hidden' as const, teaching: 'off' as const, proactivity: 'never' as const };
  const device = { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' };

  it('Guided abandons three speech-only turns, then a register switch to Terminal/Material completes one attempt — the scorecard is Terminal\'s alone', () => {
    telemetry.reset();
    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false, device,
      arm: { register: 'guided', dials, shell: 'familiar' } });
    telemetry.turn('g1', 'voice', 'make this pop', 'speech_only', 300, null);
    telemetry.turn('g2', 'voice', 'make this pop', 'speech_only', 310, null);
    telemetry.turn('g3', 'voice', 'make this pop', 'speech_only', 320, null);
    // P1 (fix round 3, reviewer-ruled — the mutation guard): a deixis MISS under Guided, before the
    // switch. Round 2's version of this test had no `deixis`/`grounding` event at all, so dropping
    // the `arm` argument from `capabilityLedger(events, scopedAttempts, arm)` at telemetry.ts's own
    // production call site left the WHOLE suite green (mutation-verified) — the pass-2 half of the
    // N1 fix had no end-to-end guard. This line is that guard: if `arm` is dropped there, this
    // Guided-only miss leaks onto Terminal's card below.
    telemetry.deixis('that', 'B2', 'C4', 'high');

    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false, device,
      arm: { register: 'terminal', dials, shell: 'material' } });
    telemetry.turn('t1', 'typed', 'sum this column', 'tool_call', 90, 900);
    telemetry.action('column_total', 'mutate', 'commit');

    const model = telemetry.snapshot().scorecard;
    expect(model).not.toBeNull();
    // Headline names Terminal's own 1 trial, not the sitting's 4.
    expect(model!.headline).toBe('Terminal · Material · Gemini · 1 trial');
    // N1: Guided's no-op-turn ledger row ("make this pop" x3) must not appear on Terminal's card at
    // all — not as a `(3/1)` fraction, not at any denominator. It belongs to a different arm.
    expect(model!.watch.some((l) => l.includes('make this pop'))).toBe(false);
    // P1: Guided's deixis-miss must not appear either — this is the pass-2 half of N1, unguarded
    // until this line existed.
    expect(model!.watch.some((l) => l.includes('wrong referent'))).toBe(false);
    // N5: latency/cost must be Terminal's own session, not Guided's (whose 3 speech-only turns are
    // `abandoned`, never timed anyway, but whose SESSION must not be counted either).
    expect(model!.latency.sessionCount).toBe(1);
    expect(model!.cost.sessionCount).toBe(1);
  });
});

// ==========================================================================================
// R1 (fix round 4, reviewer-ruled — the Important finding): round 3 gave the three stream-walkers
// one shared arm machine (`advanceArm`) and left the SUBJECT arm — the one the card is built for
// and named after — on the connect-time `SessionConfig.arm`, which `shellSwitch` never updates.
// The reviewer's Probe A2, on this same real singleton: a Terminal sitting that switched
// Familiar->Material mid-session drew `Terminal · Familiar · Gemini · 1 trial` with `watch: []` —
// Material's trial, Material's deixis miss and Material's slow turn in NO card at all, under a
// headline naming a shell no longer on screen. Reproduced here as a test, end-to-end through
// `snapshot()`. NOTE this is a SHELL switch, which by spec does not reconnect
// (`2026-07-28-desktop-metaphor-shell-design.md` §9, "switch shells mid-session and confirm the
// session survives") — so there is exactly one `session_start` in this stream, and the subject arm
// can only come from the stream itself.
// ==========================================================================================
describe('R1 — snapshot().scorecard is scoped to the arm CURRENT at snapshot time, across a mid-session shell switch', () => {
  const dials = { honest: false, autonomy: 'confirm' as const, feedback: 'earcon' as const, confirmGoals: false, markings: false, chipDensity: 'full' as const, traceView: 'hidden' as const, teaching: 'off' as const, proactivity: 'never' as const };
  const device = { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' };

  it('the card names Material and carries Material\'s trial, miss and turn — none of it silently absent', () => {
    telemetry.reset();
    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false, device,
      arm: { register: 'terminal', dials, shell: 'familiar' } });
    // One completed attempt under Familiar (the connect shell), including the session's cold row-1.
    telemetry.turn('f1', 'typed', 'bold the title', 'tool_call', 100, 400);
    telemetry.action('set_bold', 'mutate', 'commit');

    telemetry.shellSwitch('familiar', 'material', true);   // no reconnect: the session survives

    // One completed attempt under Material, plus a deixis miss only Material's card may carry.
    telemetry.turn('m1', 'typed', 'sum this column', 'tool_call', 4900, 5200);
    telemetry.deixis('that', 'B2', 'C4', 'high');
    telemetry.action('column_total', 'mutate', 'commit');

    const snap = telemetry.snapshot();
    const model = snap.scorecard;
    expect(model).not.toBeNull();
    // The connect-time config still says Familiar — correct, that IS what it connected as. The card
    // must not: it is drawn for the arm on screen.
    expect(snap.config?.arm?.shell).toBe('familiar');
    expect(model!.headline).toBe('Terminal · Material · Gemini · 1 trial');
    // Material's own deixis miss reaches the card it belongs to (round 3: it reached no card).
    expect(model!.watch.some((l) => l.includes('wrong referent'))).toBe(true);
    // Material's 4900 ms turn is on the card too — and as a WARM turn, since no connect happened at
    // the shell switch (R2). The session's real cold row-1 (100 ms) belongs to Familiar.
    expect(model!.latency.medianMs).toBe(4900);
    expect(model!.latency.warmN).toBe(1);
    expect(model!.latency.coldStartMs).toBeNull();
    expect(model!.latency.sessionCount).toBe(1);
  });

  it('with no shell switch, the subject arm is exactly the connect-time one (nothing changes for the ordinary sitting)', () => {
    telemetry.reset();
    telemetry.start({ backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false, device,
      arm: { register: 'terminal', dials, shell: 'familiar' } });
    telemetry.turn('f1', 'typed', 'bold the title', 'tool_call', 100, 400);
    telemetry.action('set_bold', 'mutate', 'commit');
    const model = telemetry.snapshot().scorecard;
    expect(model!.headline).toBe('Terminal · Familiar · Gemini · 1 trial');
  });
});

// ==========================================================================================
// P4 (fix round 3, reviewer-ruled — the Important finding): before `eval_deck_abandoned` existed,
// `abandoned` was a live-React-state-only fact — `snapshot()`'s own internal scorecard had no way
// to know a run had been abandoned, and always built one with `abandoned: false`, which per that
// field's own contract POSITIVELY ASSERTS "normally completed". Mirrors `mission_abandoned`'s
// precedent: a durable event, derived from the real event stream, not passed in from outside.
// ==========================================================================================
describe('P4 — evalDeckAbandoned makes snapshot().scorecard.abandoned durably true', () => {
  // `cfg` (this file's shared top-level fixture) carries no `arm`, and `snapshot()`'s scorecard is
  // `null` without one — these tests need a real arm-bearing config to get a non-null scorecard.
  const cfgWithArm = { ...cfg, arm: { register: 'guided', dials: {
    honest: false, autonomy: 'auto-safe' as const, feedback: 'earcon' as const, confirmGoals: false,
    markings: false, chipDensity: 'full' as const, traceView: 'ticker' as const, teaching: 'normal' as const, proactivity: 'on-goal' as const,
  } } };

  it('with no eval_deck_abandoned event, the export asserts abandoned: false (a real completion, or no deck run at all)', () => {
    telemetry.reset();
    telemetry.start(cfgWithArm);
    telemetry.action('edit_content', 'mutate', 'commit');
    const model = telemetry.snapshot().scorecard;
    expect(model).not.toBeNull();
    expect(model!.abandoned).toBe(false);
  });

  it('after evalDeckAbandoned, snapshot().scorecard.abandoned is true — derived from the event, not any external flag', () => {
    telemetry.reset();
    telemetry.start(cfgWithArm);
    telemetry.action('edit_content', 'mutate', 'commit');
    telemetry.evalDeckAbandoned(3, 12);
    const model = telemetry.snapshot().scorecard;
    expect(model).not.toBeNull();
    expect(model!.abandoned).toBe(true);
    // The raw event itself is in the export too — a reader of the raw JSON (without re-deriving
    // the scorecard) can still see how far the run got.
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find((e) => e.type === 'eval_deck_abandoned')).toMatchObject({ cardsRecorded: 3, totalCards: 12 });
  });
});
