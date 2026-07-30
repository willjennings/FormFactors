/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { armAggregate, UNDERPOWERED_N } from './armAggregate';
import { DEFAULT_DIALS } from '../register/registry';
import type { Attempt, AttemptOutcome } from './types';
import type { Arm } from '../telemetry';

const ARM: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };

let seq = 0;
const attempt = (overrides: Partial<Attempt> = {}): Attempt => {
  seq += 1;
  return {
    id: `a${seq}`,
    askedAt: seq * 1000,
    request: `request ${seq}`,
    program: 'word',
    verb: 'set_heading',
    outcome: 'completed',
    turns: 1,
    corrections: 0,
    undos: 0,
    witnessed: false,
    durationMs: 100,
    arm: ARM,
    ungradeableReason: null,
    ...overrides,
  };
};

const outcomeAttempt = (outcome: AttemptOutcome, overrides: Partial<Attempt> = {}) =>
  attempt({ outcome, ...overrides });

describe('UNDERPOWERED_N', () => {
  it('is single-sourced at 8', () => {
    expect(UNDERPOWERED_N).toBe(8);
  });
});

describe('armAggregate — n and rate shape', () => {
  it('every rate field carries {value, n}, and n matches the total attempt count', () => {
    const attempts = [outcomeAttempt('completed'), outcomeAttempt('refused-honestly')];
    const agg = armAggregate(attempts);
    expect(agg.n).toBe(2);
    for (const rate of [agg.completion, agg.corrected, agg.wrong, agg.refusal, agg.ask, agg.abandoned, agg.ungradeable]) {
      expect(rate.n).toBe(2);
      expect(typeof rate.value).toBe('number');
    }
  });

  it('an empty attempt list produces n === 0 and every rate value 0, not NaN', () => {
    const agg = armAggregate([]);
    expect(agg.n).toBe(0);
    expect(agg.completion).toEqual({ value: 0, n: 0, count: 0 });
    expect(agg.wrong).toEqual({ value: 0, n: 0, count: 0 });
    expect(agg.medianTurns).toEqual({ value: null, n: 0 });
    expect(agg.medianDurationMs).toEqual({ value: null, n: 0 });
  });
});

// ==========================================================================================
// Anti-flattery: refusals never populate a failure rate (spec §5.1, task-4 brief's "assert the
// whole aggregate, not one field")
// ==========================================================================================
describe('anti-flattery — refusals score 0% failure, not 100%', () => {
  it('a session of only refused-honestly attempts: wrong, abandoned, corrected all read 0 — the whole aggregate, not one field', () => {
    const attempts = [
      outcomeAttempt('refused-honestly'),
      outcomeAttempt('refused-honestly'),
      outcomeAttempt('refused-honestly'),
    ];
    const agg = armAggregate(attempts);
    expect(agg).toEqual({
      n: 3,
      completion: { value: 0, n: 3, count: 0 },
      corrected: { value: 0, n: 3, count: 0 },
      wrong: { value: 0, n: 3, count: 0 },
      refusal: { value: 1, n: 3, count: 3 },
      ask: { value: 0, n: 3, count: 0 },
      abandoned: { value: 0, n: 3, count: 0 },
      ungradeable: { value: 0, n: 3, count: 0 },
      medianTurns: { value: 1, n: 3 },
      medianDurationMs: { value: 100, n: 3 },
    });
  });
});

describe('anti-flattery — asked-and-answered vs. asked-and-dropped land where §5 says', () => {
  it('asked-and-answered is success-shaped: it contributes to `ask` but not to `wrong`/`abandoned`', () => {
    const attempts = [outcomeAttempt('asked-and-answered')];
    const agg = armAggregate(attempts);
    expect(agg.ask.value).toBe(1);
    expect(agg.wrong.value).toBe(0);
    expect(agg.abandoned.value).toBe(0);
    expect(agg.completion.value).toBe(0); // it is its own outcome, not folded into completion either
  });

  it('asked-and-dropped is NOT success-shaped, but it is still counted in `ask`, not smuggled into `abandoned`', () => {
    const attempts = [outcomeAttempt('asked-and-dropped')];
    const agg = armAggregate(attempts);
    expect(agg.ask.value).toBe(1);
    expect(agg.abandoned.value).toBe(0);
    expect(agg.completion.value).toBe(0);
  });
});

// ==========================================================================================
// Direction test (spec §5.4): adding abandoned attempts must LOWER completion rate, pinned
// numerically — never inverted by a shifting denominator.
// ==========================================================================================
describe('direction — abandonment lowers completion rate', () => {
  it('adding two abandoned attempts to a fixed set of completions lowers the completion rate, exact numbers', () => {
    const base = [outcomeAttempt('completed'), outcomeAttempt('completed')];
    const before = armAggregate(base);
    expect(before.completion).toEqual({ value: 1, n: 2, count: 2 }); // 2/2 = 100%

    const withAbandoned = [...base, outcomeAttempt('abandoned'), outcomeAttempt('abandoned')];
    const after = armAggregate(withAbandoned);
    expect(after.completion).toEqual({ value: 0.5, n: 4, count: 2 }); // 2/4 = 50%, strictly lower than 1
    expect(after.completion.value).toBeLessThan(before.completion.value);
    expect(after.abandoned).toEqual({ value: 0.5, n: 4, count: 2 });
  });
});

describe('wrong — the undo-makes-it-wrong rule rolls up correctly', () => {
  it('a mix of completed/corrected/wrong attempts partitions the rates as expected', () => {
    const attempts = [
      outcomeAttempt('completed'),
      outcomeAttempt('corrected'),
      outcomeAttempt('wrong'),
      outcomeAttempt('wrong'),
    ];
    const agg = armAggregate(attempts);
    expect(agg.completion).toEqual({ value: 0.25, n: 4, count: 1 });
    expect(agg.corrected).toEqual({ value: 0.25, n: 4, count: 1 });
    expect(agg.wrong).toEqual({ value: 0.5, n: 4, count: 2 });
  });
});

// ==========================================================================================
// I1 (fix round 2, reviewer-ruled): §5.7 requires the ungradeable share to be VISIBLE, not
// inferred by subtracting the other rates from 1. `ungradeable` is a first-class rate field,
// same shared-n denominator as the rest — this is the number Task 5/8's unreliability gate acts
// on from the outside; this module just reports it honestly.
// ==========================================================================================
describe('ungradeable — visible as its own rate, not an inferred remainder', () => {
  it('a half-ungradeable session reports ungradeable.value === 0.5 directly', () => {
    const attempts = [
      outcomeAttempt('completed'),
      outcomeAttempt('completed'),
      outcomeAttempt('ungradeable', { ungradeableReason: 'ambiguous-boundary' }),
      outcomeAttempt('ungradeable', { ungradeableReason: 'tool-call-without-action' }),
    ];
    const agg = armAggregate(attempts);
    expect(agg.n).toBe(4);
    expect(agg.ungradeable).toEqual({ value: 0.5, n: 4, count: 2 });
    expect(agg.completion).toEqual({ value: 0.5, n: 4, count: 2 });
  });

  it('all seven named rates sum to 1 for any non-empty attempt list — the partition is exact, not a remainder', () => {
    const attempts = [
      outcomeAttempt('completed'),
      outcomeAttempt('corrected'),
      outcomeAttempt('wrong'),
      outcomeAttempt('refused-honestly'),
      outcomeAttempt('asked-and-answered'),
      outcomeAttempt('abandoned'),
      outcomeAttempt('ungradeable', { ungradeableReason: 'ambiguous-boundary' }),
    ];
    const agg = armAggregate(attempts);
    const sum = agg.completion.value + agg.corrected.value + agg.wrong.value + agg.refusal.value
      + agg.ask.value + agg.abandoned.value + agg.ungradeable.value;
    expect(sum).toBeCloseTo(1, 10);
  });

  // N9 (fix round 2, reviewer-ruled): the `value`-sums-to-1 test above pins the FLOAT partition;
  // nothing pinned the INTEGER one `Rate.count` exists to make exact (M2, fix round 1) — a
  // regression that made `count` drift from `value * n` (e.g. a copy-paste that filled `count`
  // from the wrong outcome) would not fail anything without this.
  it("all seven rates' counts sum to n EXACTLY — integers, no floating-point tolerance needed", () => {
    const attempts = [
      outcomeAttempt('completed'),
      outcomeAttempt('completed'),
      outcomeAttempt('corrected'),
      outcomeAttempt('wrong'),
      outcomeAttempt('refused-honestly'),
      outcomeAttempt('asked-and-answered'),
      outcomeAttempt('asked-and-dropped'),
      outcomeAttempt('abandoned'),
      outcomeAttempt('ungradeable', { ungradeableReason: 'ambiguous-boundary' }),
    ];
    const agg = armAggregate(attempts);
    const countSum = agg.completion.count + agg.corrected.count + agg.wrong.count + agg.refusal.count
      + agg.ask.count + agg.abandoned.count + agg.ungradeable.count;
    expect(countSum).toBe(agg.n);
    expect(countSum).toBe(9);
  });
});

// ==========================================================================================
// Median — lower median with even counts (stated per the task-4 brief)
// ==========================================================================================
describe('medianTurns / medianDurationMs — lower median on even counts', () => {
  it('odd count: the true middle value', () => {
    const attempts = [
      outcomeAttempt('completed', { turns: 1, durationMs: 10 }),
      outcomeAttempt('completed', { turns: 5, durationMs: 50 }),
      outcomeAttempt('completed', { turns: 3, durationMs: 30 }),
    ];
    const agg = armAggregate(attempts);
    expect(agg.medianTurns.value).toBe(3);
    expect(agg.medianDurationMs.value).toBe(30);
  });

  it('even count: the LOWER of the two middle values, not their average', () => {
    // turns sorted: [1, 2, 3, 4] — conventional median would average to 2.5; lower median is 2.
    const attempts = [
      outcomeAttempt('completed', { turns: 4, durationMs: 400 }),
      outcomeAttempt('completed', { turns: 1, durationMs: 100 }),
      outcomeAttempt('completed', { turns: 3, durationMs: 300 }),
      outcomeAttempt('completed', { turns: 2, durationMs: 200 }),
    ];
    const agg = armAggregate(attempts);
    expect(agg.medianTurns.value).toBe(2);
    expect(agg.medianDurationMs.value).toBe(200);
  });

  it('durationMs nulls are excluded from the median and from its own n, not coerced to 0', () => {
    const attempts = [
      outcomeAttempt('completed', { durationMs: 100 }),
      outcomeAttempt('abandoned', { durationMs: null }),
      outcomeAttempt('abandoned', { durationMs: null }),
    ];
    const agg = armAggregate(attempts);
    expect(agg.medianDurationMs).toEqual({ value: 100, n: 1 }); // n=1, NOT the arm's n=3
    expect(agg.medianTurns.n).toBe(3); // turns has no null case — every attempt reports a count
  });
});
