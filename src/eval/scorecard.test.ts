/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { scorecard, attemptsForArm, type ScorecardOpts } from './scorecard';
import { UNDERPOWERED_N, armAggregate, type ArmAggregate } from './armAggregate';
import { EVAL_DECK, type CardResult } from './deck';
import { DEFAULT_DIALS } from '../register/registry';
import type { Arm, TelemetryEvent, SessionConfig } from '../telemetry';
import type { LedgerRow } from './capabilityLedger';
import { currentArmFrom, type Attempt } from './types';

// ---- fixture builders -----------------------------------------------------------------------

const ARM: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };

function mkAgg(n: number, opts: Partial<{
  completion: number; corrected: number; wrong: number; refusal: number; ask: number;
  abandoned: number; ungradeable: number; medianTurns: number | null; medianDurationMs: number | null;
}> = {}): ArmAggregate {
  // N9 (fix round 2, reviewer-ruled, disclosed rather than fixed): `count: Math.round(v * n)`
  // reintroduces, in THIS fixture helper only, the exact float round-trip M2 (fix round 1) removed
  // from production (armAggregate.ts's real `rate()` computes `count` as a true integer, never
  // derives it from `value`). A stricter version of this helper that REJECTED a `v` not equal to an
  // exact `count/n` was tried and reverted: many `winsWhen`/threshold fixtures across this file and
  // its siblings (register/registry.test.ts, shell/skins/registry.test.ts) deliberately use `v`
  // values like 0.6, 0.58 that were never meant to be exact fractions of `n`. P11 (fix round 3,
  // corrected): the earlier version of this comment said those tests "never read `.count` at all" —
  // false for THIS file specifically (`scorecard()` reads `.count` for the completed/refusals/
  // corrected/undone/ungradeable lines, so `mkAgg(UNDERPOWERED_N, { completion: 0.6 })` really does
  // render "completed (5/8)" from a `value` of 0.6 via `Math.round(0.6*8)`). The honest statement:
  // none of these assertions check `count`-AGAINST-`value` COHERENCE — they read whichever one
  // (`value` in the two `winsWhen` registries, `count`-derived text in this file) the code under
  // test happens to use, never both together to catch a fixture where they'd disagree. `count`'s
  // own cross-field consistency is pinned where it matters — armAggregate.test.ts's "counts sum to
  // n EXACTLY" test — against the real production path, not these hand-built fixtures.
  const rate = (v = 0) => ({ value: v, n, count: Math.round(v * n) });
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

let attemptSeq = 0;
const mkAttempt = (overrides: Partial<Attempt> = {}): Attempt => {
  attemptSeq += 1;
  return {
    id: `a${attemptSeq}`, askedAt: attemptSeq * 1000, request: `request ${attemptSeq}`,
    program: 'word', verb: 'set_heading', outcome: 'completed', turns: 1,
    corrections: 0, undos: 0, witnessed: false, durationMs: 100,
    arm: ARM, ungradeableReason: null,
    ...overrides,
  };
};

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
// I2 (fix round 1, reviewer-ruled): the card used to drop every ledger row that was not
// 'no-op-turn' — `asked-and-dropped`, `deixis-miss` and `grounding-disagree` never surfaced
// anywhere on the card, so a wrong-referent row could sit in the ledger in the same sitting the
// deck's own dimension line claimed "pointing (2/2)" under Good at. All three now render under
// Watch, each with its own n and verbatim example, same discipline as no-op-turn. 'refusal' rows
// are deliberately still excluded — they are already Good at, via `agg.refusal`.
//
// N1 (fix round 2, reviewer-ruled): deixis-miss/grounding-disagree count SIGNALS, not attempts —
// a single attempt can contain several — so they no longer use the `(n/agg.n)` fraction shape
// (which could print `(3/1)`, a fraction greater than 1, for a signal count against an attempt
// count). They state their count alone ("seen N×") instead; see scorecard.ts's Watch-loop comment.
// ==========================================================================================
describe('I2 — every non-refusal ledger kind surfaces under Watch, not just no-op-turn', () => {
  it('a deixis-miss row is rendered under Watch, with its own count and the wrong-referent text', () => {
    const agg = mkAgg(UNDERPOWERED_N, { completion: 1 });
    const ledger: LedgerRow[] = [
      { kind: 'deixis-miss', key: 'that/word', n: 3, examples: ['"that" -> resolved "B2" (wanted "C4")'] },
    ];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('wrong referent') && l.includes('B2') && l.includes('seen 3×'))).toBe(true);
  });

  it('an asked-and-dropped row is rendered under Watch', () => {
    const agg = mkAgg(UNDERPOWERED_N, { completion: 1 });
    const ledger: LedgerRow[] = [
      { kind: 'ask', key: 'ask/word', n: 2, examples: ['what should the heading say?'] },
    ];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('what should the heading say?') && l.includes('never answered'))).toBe(true);
  });

  it('a grounding-disagree row is rendered under Watch, count stated alone (not a fraction)', () => {
    const agg = mkAgg(UNDERPOWERED_N, { completion: 1 });
    const ledger: LedgerRow[] = [
      { kind: 'grounding-disagree', key: 'B2/word', n: 1, examples: ['app said "B2", model said "C4"'] },
    ];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('app/model disagreed') && l.includes('B2') && l.includes('seen 1×'))).toBe(true);
  });

  it('a refusal ledger row is NOT duplicated under Watch — it is already Good at', () => {
    const agg = mkAgg(UNDERPOWERED_N, { refusal: 0.25 });
    const ledger: LedgerRow[] = [
      { kind: 'refusal', key: 'insert_object/word', n: 2, examples: ['add a chart'] },
    ];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => l.includes('add a chart'))).toBe(false);
    expect(model.goodAt.some((l) => l.includes('honest refusals'))).toBe(true);
  });

  // N1 (fix round 2): the exact failure mode the reviewer reproduced — several deixis-miss SIGNALS
  // inside effectively one arm's aggregate must never render as a fraction that exceeds 1.
  it('three deixis-miss signals against agg.n=1 never prints a fraction greater than 1 (the reproduced bug)', () => {
    const agg = mkAgg(1, { completion: 1 });
    const ledger: LedgerRow[] = [
      { kind: 'deixis-miss', key: 'that/word', n: 3, examples: ['"that" -> resolved "B2" (wanted "C4")'] },
    ];
    const model = scorecard(agg, ledger, [], ARM, opts([]));
    expect(model.watch.some((l) => /\(\d+\/1\)/.test(l) && l.includes('wrong referent'))).toBe(false);
    expect(model.watch.some((l) => l.includes('seen 3×'))).toBe(true);
  });
});

// ==========================================================================================
// Binding test 3: every goodAt/shaky/watch line carries its n.
// ==========================================================================================
describe('every good-at/shaky/watch line carries n', () => {
  // P14 (fix round 3, reviewer-ruled): this is the repo's most load-bearing anti-flattery test, and
  // it used to pass on a fixture that never exercised the two ledger kinds (deixis-miss,
  // grounding-disagree) whose line shape it could NOT match — `/\(\d+\/\d+\)/` never matches
  // "... (seen 3×)" (N1, fix round 2's own reviewer-sanctioned alternative to a fraction that could
  // read greater than 1). A regex that only ever saw fixture rows shaped one way was passing by
  // omission, not by proof. Both shapes are now in the fixture, and the assertion accepts either —
  // "every line carries its n" is the invariant, not "every line is a fraction".
  it('every line carries its n — either "(n/n)" or "(seen n×)"', () => {
    const agg = mkAgg(20, { refusal: 0.1, corrected: 0.1, wrong: 0.05, ungradeable: 0.25 });
    const ledger: LedgerRow[] = [
      noOpRow(2, 'nothing happened'),
      { kind: 'deixis-miss', key: 'that/word', n: 3, examples: ['"that" -> resolved "B2" (wanted "C4")'] },
      { kind: 'grounding-disagree', key: 'B2/word', n: 1, examples: ['app said "B2", model said "C4"'] },
    ];
    const deck: CardResult[] = [
      cardResult('point-what-is-this', 'done'),
      cardResult('point-then-change', 'failed'),
    ];
    const model = scorecard(agg, ledger, deck, ARM, opts([]));
    const all = [...model.goodAt, ...model.shaky, ...model.watch];
    expect(all.length).toBeGreaterThan(0);
    // Both shapes are actually present in this fixture's output — not just accepted in principle.
    expect(all.some((l) => /\(\d+\/\d+\)/.test(l))).toBe(true);
    expect(all.some((l) => /seen \d+×/.test(l))).toBe(true);
    for (const line of all) expect(line).toMatch(/(\(\d+\/\d+\)|seen \d+×)/);
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

  // M1 (fix round 1, reviewer-ruled): the test that used to sit here ("REVERT CHECK: a bare-enum
  // formatter would fail this test") asserted `expect('not-met').not.toContain(...)` — a check on
  // a LOCAL STRING LITERAL, never on `model` at all. It could not fail under any implementation,
  // including the bare-enum regression it claimed to guard (verified: it passed under all five
  // mutations run against this file in the fix-round-1 review, the bare-enum one included). The
  // real guard is the test immediately above, which asserts on `model.comparison` — this comment
  // replaces the vacuous test rather than leaving a test in the suite that can never fail.
});

// ==========================================================================================
// C1 direction test (fix round 1, reviewer-ruled, the Critical finding): `armAggregate(attempts)`
// used to be called UNSCOPED at both production call sites — every attempt in the whole sitting,
// regardless of which arm it belonged to. The reviewer reproduced this with a Guided×2 +
// Terminal×1 stream and got a headline of `Terminal · Material · Gemini · 3 trials` (attributing
// Guided's own two attempts to Terminal) and a `winsWhen` comparison whose `control` was a SUBSET
// of the arm under test rather than disjoint from it. `attemptsForArm` (scorecard.ts) is the fix:
// callers scope BEFORE calling `armAggregate`. These tests pin `attemptsForArm` itself, then
// reproduce the reviewer's exact scenario to show it no longer happens.
// ==========================================================================================
describe('C1 — attemptsForArm partitions a mixed-arm stream disjointly', () => {
  const guidedArm: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };
  const terminalArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'familiar' };

  it('reproduces the reviewer\'s exact probe (Guided×2, Terminal×1): n\'s no longer merge, headline names the counted arm', () => {
    const attempts: Attempt[] = [
      mkAttempt({ arm: guidedArm }),
      mkAttempt({ arm: guidedArm }),
      mkAttempt({ arm: terminalArm }),
    ];
    const guidedAttempts = attemptsForArm(attempts, guidedArm);
    const terminalAttempts = attemptsForArm(attempts, terminalArm);

    // Disjoint, and the n's sum to the total — no attempt is double-counted or dropped.
    expect(guidedAttempts.length).toBe(2);
    expect(terminalAttempts.length).toBe(1);
    expect(guidedAttempts.length + terminalAttempts.length).toBe(attempts.length);
    expect(guidedAttempts.some((a) => terminalAttempts.includes(a))).toBe(false);

    const agg = armAggregate(terminalAttempts);
    const control = armAggregate(guidedAttempts);
    expect(agg.n).toBe(1);       // NOT 3 — the reviewer's bug merged all three into this number
    expect(control.n).toBe(2);   // NOT 3, and not 0 either

    const model = scorecard(agg, [], [], terminalArm, opts([], { control }));
    // Headline names the arm the card actually counted (Terminal, n=1), not the sitting's total.
    expect(model.headline).toBe('Terminal · Familiar · 1 trial');
  });

  it('an attempt with arm === undefined (no session_start) is excluded, never guessed onto the current arm', () => {
    const attempts: Attempt[] = [
      mkAttempt({ arm: guidedArm }),
      mkAttempt({ arm: undefined }),
    ];
    expect(attemptsForArm(attempts, guidedArm).length).toBe(1);
  });

  it('at n=8/8, winsWhen receives genuinely disjoint aggregates — the comparison names both n\'s, neither inflated by the other arm\'s trials', () => {
    const guidedAttempts = Array.from({ length: 8 }, () => mkAttempt({ arm: guidedArm, durationMs: 500 }));
    const terminalAttempts = Array.from({ length: 8 }, () => mkAttempt({ arm: terminalArm, durationMs: 100 }));
    const attempts = [...guidedAttempts, ...terminalAttempts];

    const agg = armAggregate(attemptsForArm(attempts, terminalArm));
    const control = armAggregate(attemptsForArm(attempts, guidedArm));
    expect(agg.n).toBe(8);
    expect(control.n).toBe(8);

    const model = scorecard(agg, [], [], terminalArm, opts([], { control }));
    // Terminal's own winsWhen names both n's — pinned to 8 vs 8, never 16 vs 16 (which is what a
    // caller merging both arms into one aggregate before calling scorecard() would have produced).
    expect(model.comparison).toContain('n=8 vs 8');
  });

  // N7 (fix round 2, reviewer-ruled): every C1 test above uses `shell: 'familiar'` on BOTH arms —
  // a register-only implementation of `attemptsForArm` (shell dropped from the comparison) passes
  // every one of them. This is the missing half: two arms that differ ONLY in shell, same register.
  it('two arms differing ONLY in shell (same register) are scoped disjointly — the shell half of the identity rule', () => {
    const familiarArm: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };
    const materialArm: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'material' };
    const attempts: Attempt[] = [
      mkAttempt({ arm: familiarArm }),
      mkAttempt({ arm: familiarArm }),
      mkAttempt({ arm: materialArm }),
    ];
    const familiarAttempts = attemptsForArm(attempts, familiarArm);
    const materialAttempts = attemptsForArm(attempts, materialArm);
    expect(familiarAttempts.length).toBe(2);
    expect(materialAttempts.length).toBe(1);   // a register-only rule would wrongly give this 3
    expect(familiarAttempts.some((a) => materialAttempts.includes(a))).toBe(false);
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
// I3 (fix round 1, reviewer-ruled): latency's medians used to render with no n at all, and the
// block silently spanned every session in the stream while implying "this session". `warmN`/
// `coldStartN`/`sessionCount` now travel alongside the figures they describe.
// ==========================================================================================
describe('I3 — latency and cost carry their own sample sizes and session scope', () => {
  it('warmN counts the warm-turn population behind medianMs/worst; coldStartN counts sessions with a timeable cold turn', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      turn(10, 't1', 'cold opener', 'tool_call', 2000),
      turn(20, 't2', 'warm one', 'tool_call', 300),
      turn(30, 't3', 'warm two', 'tool_call', 320),
      sessionStart(40, ARM),
      turn(50, 't4', 'second cold opener', 'tool_call', 1800),
    ];
    const agg = mkAgg(4, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.latency.warmN).toBe(2);       // t2, t3 — the two non-cold, timeable turns
    expect(model.latency.coldStartN).toBe(2);  // one cold row-1 per session, two sessions
    expect(model.latency.sessionCount).toBe(2);
  });

  it('a single-session stream reports sessionCount 1 on both latency and cost', () => {
    const events: TelemetryEvent[] = [sessionStart(0), turn(10, 't1', 'only turn', 'tool_call', 300)];
    const agg = mkAgg(1, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts(events));
    expect(model.latency.sessionCount).toBe(1);
    expect(model.cost.sessionCount).toBe(1);
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
    expect(model.cost).toEqual({ frames: 63, hints: 19, sessionCount: 2 });
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

// ==========================================================================================
// N5 (fix round 2, reviewer-ruled): latency/cost were still whole-sitting/all-arm even after C1
// scoped `agg`. Probe A reproduced a Terminal-headed card whose `medianMs`/`worst` were actually
// Guided's turns. `eventsForArm` scopes `opts.events` to only the sessions matching `arm` before
// either block reduces over it.
// ==========================================================================================
describe('N5 — latency and cost are scoped to the arm under test, not the whole sitting', () => {
  const guidedArm: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };
  const terminalArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'material' };

  it("a Guided session's turns never appear in a Terminal-headed card's latency/cost", () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, guidedArm),
      turn(10, 'g1', 'guided opener', 'tool_call', 5000),   // Guided's cold row-1
      turn(20, 'g2', 'guided warm', 'tool_call', 4900),      // would be "worst" if leaked in
      sessionComplete(30, 40, 10),                           // Guided's traffic
      sessionStart(40, terminalArm),
      turn(50, 't1', 'terminal opener', 'tool_call', 90),    // Terminal's cold row-1
      turn(60, 't2', 'terminal warm', 'tool_call', 100),
      sessionComplete(70, 5, 1),                             // Terminal's own traffic
    ];
    const agg = mkAgg(1, { completion: 1 });
    const model = scorecard(agg, [], [], terminalArm, opts(events));
    // Terminal's own session only: one warm turn (100ms), one cold turn (90ms).
    expect(model.latency.sessionCount).toBe(1);
    expect(model.latency.medianMs).toBe(100);
    expect(model.latency.worst).toEqual({ ms: 100, label: 'terminal warm' });
    expect(model.latency.coldStartMs).toBe(90);
    // Guided's 40 frames / 10 hints must not leak into Terminal's cost.
    expect(model.cost).toEqual({ frames: 5, hints: 1, sessionCount: 1 });
  });

  it('the reverse arm (Guided) gets its OWN session, not the Terminal one', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, guidedArm),
      turn(10, 'g1', 'guided opener', 'tool_call', 5000),
      turn(20, 'g2', 'guided warm', 'tool_call', 4900),
      sessionStart(40, terminalArm),
      turn(50, 't1', 'terminal opener', 'tool_call', 90),
      turn(60, 't2', 'terminal warm', 'tool_call', 100),
    ];
    const agg = mkAgg(1, { completion: 1 });
    const model = scorecard(agg, [], [], guidedArm, opts(events));
    expect(model.latency.sessionCount).toBe(1);
    expect(model.latency.worst).toEqual({ ms: 4900, label: 'guided warm' });
    expect(model.latency.coldStartMs).toBe(5000);
  });

  // P2 (fix round 3, reviewer-ruled — the Important finding): the round-2 re-review's exact Probe A
  // reproduction, at the `eventsForArm` level. A mid-session shell switch (no reconnect, so no new
  // `session_start`) used to leave the post-switch turn scored under the PRE-switch shell.
  it('a mid-session shell_switch moves the latency/cost boundary too, with no reconnect', () => {
    const familiarArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'familiar' };
    const materialArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'material' };
    const events: TelemetryEvent[] = [
      sessionStart(0, familiarArm),
      turn(10, 'f1', 'under familiar', 'tool_call', 100),        // the SESSION's cold row-1
      { t: 20, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true },
      turn(30, 'm1', 'under material', 'tool_call', 4900),        // a WARM turn — no connect happened here
    ];
    const aggFamiliar = mkAgg(1, { completion: 1 });
    const modelFamiliar = scorecard(aggFamiliar, [], [], familiarArm, opts(events));
    // Reproduced bug: without the fix, this would read 4900 (Material's turn, mis-scored).
    expect(modelFamiliar.latency.coldStartMs).toBe(100);
    expect(modelFamiliar.latency.medianMs).toBeNull(); // one turn total, and it's the cold one
    expect(modelFamiliar.latency.worst).toBeNull();

    // R2 (fix round 4, reviewer-ruled — a REGRESSION this test used to pin as correct). Round 3
    // asserted `coldStartMs === 4900` here, commented "Material's own cold row-1 (new arm, fresh
    // cold slot)". That rule is wrong: a shell switch reconnects nothing (that is the whole premise
    // of the fix above), so no turn after it can be a session connect. Material's post-switch turn
    // is a WARM turn — it belongs in Material's median, and Material has no cold figure at all
    // because the only connect this sitting made had already spent its row-1 under Familiar.
    const aggMaterial = mkAgg(1, { completion: 1 });
    const modelMaterial = scorecard(aggMaterial, [], [], materialArm, opts(events));
    expect(modelMaterial.latency.coldStartMs).toBeNull();
    expect(modelMaterial.latency.coldStartN).toBe(0);
    expect(modelMaterial.latency.medianMs).toBe(4900);
    expect(modelMaterial.latency.warmN).toBe(1);
    expect(modelMaterial.latency.worst).toEqual({ ms: 4900, label: 'under material' });
    // …and it is not a card claiming to cover zero sessions: the arm was live during session 1.
    expect(modelMaterial.latency.sessionCount).toBe(1);
    expect(modelMaterial.cost.sessionCount).toBe(1);
  });

  // R2 (fix round 4, reviewer-ruled): the re-review's Probe C, verbatim — connect under Familiar,
  // switch to Material BEFORE the first turn, one 5000 ms connect turn there, switch back, then two
  // warm turns. Round 3 reported Familiar's 120 ms warm turn as "cold start (session connect)" and
  // pulled it out of Familiar's own median, while the sitting's real 5000 ms connect turn appeared
  // on no card. The cold slot belongs to the SESSION and is spent by the session's first turn,
  // whichever arm was on screen when it happened.
  it('probe C — the connect turn lands on the arm that was live when it happened, and nowhere else', () => {
    const familiarArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'familiar' };
    const materialArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'material' };
    const events: TelemetryEvent[] = [
      sessionStart(0, familiarArm),
      { t: 5, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true },
      turn(10, 'm1', 'the connect turn', 'tool_call', 5000),      // the session's row 1, under Material
      { t: 20, type: 'shell_switch', from: 'material', to: 'familiar', midSession: true },
      turn(30, 'f1', 'warm one', 'tool_call', 120),
      turn(40, 'f2', 'warm two', 'tool_call', 130),
    ];
    const modelFamiliar = scorecard(mkAgg(2, { completion: 1 }), [], [], familiarArm, opts(events));
    expect(modelFamiliar.latency.coldStartMs).toBeNull();   // round 3 read 120 here — a warm turn
    expect(modelFamiliar.latency.coldStartN).toBe(0);
    expect(modelFamiliar.latency.medianMs).toBe(120);        // …and 120 was missing from this median
    expect(modelFamiliar.latency.warmN).toBe(2);

    const modelMaterial = scorecard(mkAgg(1, { completion: 1 }), [], [], materialArm, opts(events));
    expect(modelMaterial.latency.coldStartMs).toBe(5000);    // the connect turn is on exactly one card
    expect(modelMaterial.latency.coldStartN).toBe(1);
    expect(modelMaterial.latency.warmN).toBe(0);
  });

  // R2 (fix round 4): a turn that is row-1 of a session but has no timeable first response still
  // SPENDS the session's cold slot (round 3's documented doctrine, preserved through the rewrite) —
  // the next turn is warm, not a second cold start.
  it('an untimeable row-1 turn still spends its session cold slot', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      turn(10, 't1', 'lost transcript', 'transcription_lost', null),
      turn(20, 't2', 'the next one', 'tool_call', 300),
    ];
    const model = scorecard(mkAgg(2, { completion: 1 }), [], [], ARM, opts(events));
    expect(model.latency.coldStartMs).toBeNull();
    expect(model.latency.coldStartN).toBe(0);
    expect(model.latency.medianMs).toBe(300);
    expect(model.latency.warmN).toBe(1);
  });

  // R2 (fix round 4): cold start means SESSION CONNECT. A stream fragment with no `session_start`
  // at all scopes to nothing (there is no arm to match), and a scoped stream entered at a shell
  // boundary never opens a cold slot of its own — the only opener is a real `session_start`.
  it('no session_start anywhere means no card, and never an invented cold start', () => {
    const events: TelemetryEvent[] = [
      { t: 0, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true },
      turn(10, 't1', 'orphan turn', 'tool_call', 900),
    ];
    const model = scorecard(mkAgg(1, { completion: 1 }), [], [], ARM, opts(events));
    expect(model.latency.coldStartMs).toBeNull();
    expect(model.latency.coldStartN).toBe(0);
    expect(model.latency.medianMs).toBeNull();
    expect(model.latency.sessionCount).toBe(0);
  });
});

// ==========================================================================================
// N8 (fix round 2, reviewer-ruled): M4's `completed (n/N)` line and M7's "Guided is the control
// arm" message shipped in fix round 1 with no test naming them directly — both survived a mutation
// deleting/altering them while `src/eval` stayed green. Pinned directly here.
// ==========================================================================================
describe('N8 — M4 and M7 lines are pinned directly', () => {
  it('M4: a session with completions shows "completed (n/N)" under Good at', () => {
    const agg = mkAgg(10, { completion: 0.7, refusal: 0.3 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.goodAt).toContain('completed (7/10)');
  });

  it('M4: zero completions renders NO "completed" line at all (not "completed (0/N)")', () => {
    const agg = mkAgg(5, { refusal: 1 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.goodAt.some((l) => l.startsWith('completed ('))).toBe(false);
  });

  it('M7: Guided with no control gets the "IS the control arm" sentence, verbatim substring', () => {
    const agg = mkAgg(UNDERPOWERED_N, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([])); // ARM.register === 'guided', no control
    expect(model.comparison).toBe(`Guided is the control arm — there is no non-tautological comparison to run against itself (n=${UNDERPOWERED_N})`);
  });
});

// ==========================================================================================
// N2 (fix round 2, reviewer-ruled): the scorecard model itself must be able to say a run was
// abandoned, not just completed — spec §5.6, "abandonment is data, not absence" applied to the
// card's own self-description, not only the ledger's rows.
// ==========================================================================================
describe('N2 — ScorecardModel.abandoned reflects opts.abandoned, defaulting to false', () => {
  it('opts.abandoned omitted -> model.abandoned is false', () => {
    const agg = mkAgg(3, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([]));
    expect(model.abandoned).toBe(false);
  });

  it('opts.abandoned: true -> model.abandoned is true', () => {
    const agg = mkAgg(3, { completion: 1 });
    const model = scorecard(agg, [], [], ARM, opts([], { abandoned: true }));
    expect(model.abandoned).toBe(true);
  });
});

// ==========================================================================================
// R1 (fix round 4, reviewer-ruled — the Important finding): the SUBJECT of a card (which arm it is
// built for and named after) is now derived from the stream by `currentArmFrom`, the same
// `advanceArm` machine the three walkers scope with, instead of from the connect-time
// `SessionConfig.arm` that `shellSwitch` never updates. Unit-pinned here; pinned end-to-end through
// the real singleton in telemetry.test.ts's own R1 block.
// ==========================================================================================
describe('R1 — currentArmFrom reads the arm in effect at the END of the stream', () => {
  const familiarArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'familiar' };
  const materialArm: Arm = { register: 'terminal', dials: DEFAULT_DIALS, shell: 'material' };

  it('a mid-session shell switch moves the subject arm, with no reconnect in the stream', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, familiarArm),
      turn(10, 'f1', 'under familiar', 'tool_call', 100),
      { t: 20, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true },
    ];
    expect(currentArmFrom(events)).toEqual(materialArm);
    // …and the card built for it is Material's, carrying Material's own scope.
    const model = scorecard(mkAgg(1, { completion: 1 }), [], [], currentArmFrom(events)!, opts(events));
    expect(model.headline.startsWith('Terminal · Material')).toBe(true);
  });

  it('the LAST session_start wins over an earlier one, and a later shell switch over that', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, materialArm),
      sessionStart(10, familiarArm),
      { t: 20, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true },
      { t: 30, type: 'shell_switch', from: 'material', to: 'familiar', midSession: true },
    ];
    expect(currentArmFrom(events)).toEqual(familiarArm);
  });

  it('a stream with no session_start has no arm — undefined, never a guess', () => {
    expect(currentArmFrom([])).toBeUndefined();
    expect(currentArmFrom([{ t: 0, type: 'shell_switch', from: 'familiar', to: 'material', midSession: true }])).toBeUndefined();
  });
});
