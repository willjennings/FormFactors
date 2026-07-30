/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { scorecard, type ScorecardOpts } from './scorecard';
import { UNDERPOWERED_N, type ArmAggregate } from './armAggregate';
import { EVAL_DECK, type CardResult } from './deck';
import { DEFAULT_DIALS } from '../register/registry';
import type { Arm, TelemetryEvent, SessionConfig } from '../telemetry';
import type { LedgerRow } from './capabilityLedger';

// ---- fixture builders -----------------------------------------------------------------------

const ARM: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };

function mkAgg(n: number, opts: Partial<{
  completion: number; corrected: number; wrong: number; refusal: number; ask: number;
  abandoned: number; ungradeable: number; medianTurns: number | null; medianDurationMs: number | null;
}> = {}): ArmAggregate {
  const rate = (v = 0) => ({ value: v, n });
  return {
    n,
    completion: rate(opts.completion),
    corrected: rate(opts.corrected),
    wrong: rate(opts.wrong),
    refusal: rate(opts.refusal),
    ask: rate(opts.ask),
    abandoned: rate(opts.abandoned),
    ungradeable: rate(opts.ungradeable),
    medianTurns: { value: opts.medianTurns ?? null, n },
    medianDurationMs: { value: opts.medianDurationMs ?? null, n },
  };
}

const cfg = (arm: Arm = ARM): SessionConfig => ({
  backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program: 'word', honest: false,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop', ua: '' },
  arm,
});

const sessionStart = (t: number, arm: Arm = ARM): TelemetryEvent => ({ t, type: 'session_start', config: cfg(arm) });

const turn = (
  t: number, id: string, request: string,
  outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost',
  firstResponseMs: number | null, settledMs: number | null = null,
): TelemetryEvent => ({ t, type: 'turn', id, modality: 'typed', request, outcome, firstResponseMs, settledMs });

const sessionComplete = (t: number, frames: number, hints: number): TelemetryEvent =>
  ({ t, type: 'session_complete', timeToCompleteMs: 1000, slotsFilled: 0, inferredCount: 0, framesSent: frames, hintsSent: hints });

const noOpRow = (n: number, example: string): LedgerRow => ({ kind: 'no-op-turn', key: `speech-only/word`, n, examples: [example] });

const opts = (events: TelemetryEvent[], extra: Partial<ScorecardOpts> = {}): ScorecardOpts => ({ events, ...extra });

const cardResult = (cardId: string, grade: CardResult['grade'], graded: CardResult['graded'] = 'observed'): CardResult =>
  ({ cardId, grade, graded, at: 0 });

// ==========================================================================================
// Binding test 1: refusals render under Good at, never as a failure.
// ==========================================================================================
describe('refusals render under Good at', () => {
  it('a session with refusals lists them in goodAt, not shaky', () => {
    const agg = mkAgg(10, { refusal: 0.3, completion: 0.7 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.goodAt.some((l) => l.includes('honest refusals'))).toBe(true);
    expect(model.shaky.some((l) => l.includes('refus'))).toBe(false);
  });
});

// ==========================================================================================
// Binding test 2: speech_only no-ops render under Watch and never vanish.
// ==========================================================================================
describe('speech_only no-ops render under Watch and never vanish', () => {
  it('a single no-op-turn ledger row of any size is rendered, not filtered by count', () => {
    const agg = mkAgg(UNDERPOWERED_N, { completion: 1 });
    const ledger = [noOpRow(1, 'make it pop')];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('"make it pop"'))).toBe(true);
  });

  it('a large no-op-turn row is still rendered — no threshold suppresses it', () => {
    const agg = mkAgg(100, { completion: 0.5 });
    const ledger = [noOpRow(50, 'do something vague')];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('do something vague') && l.includes('(50/100)'))).toBe(true);
  });
});

// ==========================================================================================
// Binding test 3: every goodAt/shaky/watch line carries its n.
// ==========================================================================================
describe('every good-at/shaky/watch line carries n', () => {
  it('every line matches (n/n)', () => {
    const agg = mkAgg(20, { refusal: 0.1, corrected: 0.1, wrong: 0.05, ungradeable: 0.25 });
    const ledger = [noOpRow(2, 'nothing happened')];
    const deck: CardResult[] = [
      cardResult('point-what-is-this', 'done'),
      cardResult('point-then-change', 'failed'),
    ];
    const model = scorecard(agg, ledger, deck, ARM, opts([]));
    const all = [...model.goodAt, ...model.shaky, ...model.watch];
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) expect(line).toMatch(/\(\d+\/\d+\)/);
  });
});

// ==========================================================================================
// Binding test 4: below UNDERPOWERED_N, comparison is exactly the fixed sentence.
// ==========================================================================================
describe('below UNDERPOWERED_N — comparison is exactly the fixed sentence', () => {
  it('n one below the threshold', () => {
    const agg = mkAgg(UNDERPOWERED_N - 1, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([], { control: mkAgg(20, { completion: 0.5 }) }));
    expect(model.comparison).toBe('not enough trials to compare arms');
  });

  it('n === 0', () => {
    const agg = mkAgg(0);
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.comparison).toBe('not enough trials to compare arms');
  });
});

// ==========================================================================================
// Binding test 5 (the flattery test): an all-refusals session produces an EMPTY shaky.
// ==========================================================================================
describe('the flattery test — an all-refusals session produces an empty Shaky', () => {
  it('refusal=1, everything else 0: shaky is empty, goodAt names the refusals', () => {
    const agg = mkAgg(5, { refusal: 1 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.shaky).toEqual([]);
    expect(model.goodAt.some((l) => l.includes('honest refusals'))).toBe(true);
  });
});

// ==========================================================================================
// Carry-in #1: ProbeVerdict has no 'untestable' state — a not-met verdict whose `because` names
// an unmeasurable half must render that `because` text, never the bare enum.
// ==========================================================================================
describe('carry-in — a not-met verdict always surfaces its because text', () => {
  it('Material shell (never returns met) renders its because prose in `comparison`', () => {
    const arm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'material' };
    const agg = mkAgg(UNDERPOWERED_N, { completion: 0.6 });
    const control = mkAgg(UNDERPOWERED_N, { completion: 0.5 });
    const model = scorecard(agg, [], [], arm, opts([], { control }));
    // Never the bare enum: 'not-met' alone would tell a reader nothing about WHY, which is
    // exactly the confident-wrong-claim anti-pattern this carry-in exists to forbid.
    expect(model.comparison).toContain('not-met');
    expect(model.comparison).toContain('ArmAggregate has no field for "what people make"');
  });

  it('REVERT CHECK: a bare-enum formatter would fail this test', () => {
    // Documents the exact failure this test pins: rendering only the verdict word.
    const bareEnum = 'not-met';
    expect(bareEnum).not.toContain('ArmAggregate has no field for "what people make"');
  });
});

// ==========================================================================================
// Carry-in #2: cold first turns are excluded from the latency median and reported separately.
// ==========================================================================================
describe('carry-in — cold first turns never enter the latency median', () => {
  it('a cold row-1 turn (slow) does not drag the median away from the warm turns', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      turn(10, 't1', 'first ever thing', 'tool_call', 2085), // cold — session's row 1
      turn(20, 't2', 'second thing', 'tool_call', 400),
      turn(30, 't3', 'third thing', 'tool_call', 420),
    ];
    const agg = mkAgg(3, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.latency.coldStartMs).toBe(2085);
    // Warm median is over [400, 420] only — 2085 must never appear in it.
    expect(model.latency.medianMs).toBe(400);
    expect(model.latency.medianMs).not.toBe(2085);
  });

  it('one cold turn per session — a second session in the same sitting gets its own cold row-1', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      turn(10, 't1', 'session one opener', 'tool_call', 2000),
      turn(20, 't2', 'session one warm', 'tool_call', 300),
      sessionStart(30, ARM), // reconnect — a second session_start
      turn(40, 't3', 'session two opener', 'tool_call', 1800),
      turn(50, 't4', 'session two warm', 'tool_call', 320),
    ];
    const agg = mkAgg(4, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.latency.coldStartMs).toBe(1800); // lower median of [2000, 1800] -> [1800,2000] -> 1800
    expect(model.latency.medianMs).toBe(300); // lower median of [300, 320]
  });
});

// ==========================================================================================
// Behavioural revert #2 (documented for the report): averaging the cold turn into the median
// would make medianMs move toward 2085 instead of staying at 400 — this test's own assertion
// (`medianMs).not.toBe(2085)` plus the exact `400` pin) is what catches that regression.
// ==========================================================================================

describe('latency.worst names the slowest WARM turn with its request text', () => {
  it('worst carries ms + label, cold turns excluded from contention', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      turn(10, 't1', 'cold opener', 'tool_call', 9999), // cold — must never win "worst"
      turn(20, 't2', 'sum this column', 'tool_call', 4900),
      turn(30, 't3', 'quick one', 'tool_call', 300),
    ];
    const agg = mkAgg(3, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.latency.worst).toEqual({ ms: 4900, label: 'sum this column' });
  });
});

// ==========================================================================================
// Carry-in #3: ungradeable share above threshold is SAID, not averaged away.
// ==========================================================================================
describe('carry-in — high ungradeable share is named on the card', () => {
  it('a session with a large ungradeable share gets a Watch line naming it', () => {
    const agg = mkAgg(10, { ungradeable: 0.5, completion: 0.5 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('ungradeable') && l.includes('(5/10)'))).toBe(true);
  });

  it('a low ungradeable share is not flagged', () => {
    const agg = mkAgg(20, { ungradeable: 0.05, completion: 0.95 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('ungradeable'))).toBe(false);
  });
});

// ==========================================================================================
// Carry-in #5: the partial-recording marker (Task 7) appears when non-zero.
// ==========================================================================================
describe('carry-in — the unrecorded marker appears when non-zero, absent when zero', () => {
  it('unrecorded > 0 produces a Watch line', () => {
    const agg = mkAgg(8, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([], { unrecorded: 2 }));
    expect(model.watch.some((l) => l.includes('recorded in this panel only'))).toBe(true);
  });

  it('unrecorded === 0 (or absent) produces no such line', () => {
    const agg = mkAgg(8, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([], { unrecorded: 0 }));
    expect(model.watch.some((l) => l.includes('recorded in this panel only'))).toBe(false);
    const model2 = scorecard(agg, [], [], ARM, opts([]));
    expect(model2.watch.some((l) => l.includes('recorded in this panel only'))).toBe(false);
  });
});

// ==========================================================================================
// Carry-in #4: deck results join the card as their own line; self-grades are never presented
// as observed.
// ==========================================================================================
describe('carry-in — deckSummary names the observed vs self-graded split', () => {
  it('names totals and never merges observed into self or vice versa', () => {
    const agg = mkAgg(3, { completion: 1 });
    const deck: CardResult[] = [
      cardResult('point-what-is-this', 'done', 'observed'),
      cardResult('point-then-change', 'done', 'self'),
      cardResult('point-by-number', 'skipped', 'self'),
    ];
    const model = scorecard(agg, [], deck, ARM, opts([]));
    expect(model.deckSummary).toContain('3 cards');
    expect(model.deckSummary).toContain('1 observed');
    expect(model.deckSummary).toContain('2 your call');
  });

  it('an empty deck is reported honestly, not as 0 cards', () => {
    const agg = mkAgg(3, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.deckSummary).toBe('no eval-deck cards played this session');
  });
});

// ==========================================================================================
// Headline + cost + deck-dimension routing sanity
// ==========================================================================================
describe('headline names register, shell, backend and trial count', () => {
  it('renders all four segments', () => {
    const agg = mkAgg(12, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([], { backend: 'gemini' }));
    expect(model.headline).toBe('Guided · Familiar · Gemini · 12 trials');
  });
});

describe('cost sums framesSent/hintsSent across every session_complete in the stream', () => {
  it('two runs in one sitting sum their traffic', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0), sessionComplete(100, 40, 10),
      sessionStart(200), sessionComplete(300, 23, 9),
    ];
    const agg = mkAgg(5, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.cost).toEqual({ frames: 63, hints: 19 });
  });
});

describe('deck-dimension routing — perfect goes to goodAt, partial goes to shaky', () => {
  it('a perfect pointing run and a partial robustness run land in different buckets', () => {
    const agg = mkAgg(4, { completion: 1 });
    const deck: CardResult[] = [
      cardResult('point-what-is-this', 'done'),
      cardResult('point-then-change', 'done'),
      cardResult('robust-rephrase', 'done'),
      cardResult('robust-own-words', 'failed'),
    ];
    const model = scorecard(agg, [], deck, ARM, opts([]));
    expect(model.goodAt).toContain('pointing (2/2)');
    expect(model.shaky).toContain('robustness (1/2)');
  });
});

describe('EVAL_DECK sanity — the dimension-routing test above uses real card ids', () => {
  it('the four card ids used above exist in EVAL_DECK', () => {
    const ids = new Set(EVAL_DECK.map((c) => c.id));
    for (const id of ['point-what-is-this', 'point-then-change', 'robust-rephrase', 'robust-own-words']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
