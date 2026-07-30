/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The per-arm roll-up (spec §4). Takes whatever list of `Attempt`s the caller has already scoped
// to one arm — this module does not group by arm itself; Tasks 5/8 (`winsWhen`, the eval deck) own
// that split, since they know which arm is control and which is under test — and reduces it to
// rates + medians + n.
//
// ANTI-FLATTERY, THE MECHANISM (spec §5.4/§5.8, "derived metrics can invert silently — pin them" /
// "sample size travels with every number"): every one of the six named rates below shares ONE
// denominator, `n` (the total attempts passed in). This is deliberate, not an oversight — the
// codebase has already shipped the alternative and it broke: `telemetry.ts`'s `correctionRate` was
// once computed over a widening/narrowing subset of actions, and an arm that provoked MORE
// refusals scored a LOWER correction rate for having refused its way out of needing correction. A
// single shared denominator makes that inversion structurally impossible here: refusing more, or
// abandoning more, can only ever GROW `n` and shrink every rate that isn't itself the one going up
// — it can never flatter completion by shrinking the base it's measured against.
//
// FIELD LIST (reconciling two sources): the task-4 brief's inline type comment names five rates —
// "completion/corrected/wrong/refusal/ask" — but the SAME brief's anti-flattery test requirement
// asserts `abandoned.value === 0` on an all-refusals aggregate, which only typechecks if `abandoned`
// is itself a field. The spec's own §5.6 ("abandonment is data, not absence" — "the most dangerous
// record ... must appear") independently argues the same way: leaving abandonment out of the one
// struct meant to summarise an arm is exactly the silent omission that section exists to forbid. A
// sixth field, `abandoned`, is included below.
//
// REVISED (fix round 2, I1, reviewer-ruled): the first version of this module gave `ungradeable`
// NO rate field, reasoning that spec §5.7 wants a GATE on trust ("if the ungradeable share ...
// exceeds a stated threshold, the session's aggregates are reported as unreliable"), not one more
// rate — and that inferring the share by subtracting six floats from 1 was visibility enough. The
// reviewer ruled that non-compliant: §5.7 says the share must be VISIBLE, and an implicit remainder
// nobody computes directly is not visibility, it's an exercise left to the reader. `ungradeable` is
// now a seventh rate field below, same shared-`n` denominator as the other six. The §5.7 GATE itself
// (deciding a session is "unreliable" past some threshold and excluding it from the corpus) is still
// a Task 5/8-shaped concern layered on TOP of this number — `armAggregate` reports the share
// honestly; it does not decide what a caller does once the share is high. Task 8's scorecard is
// expected to render `ungradeable` under its own unreliability rule rather than silently drop it.
//
// completion/corrected/wrong/refusal/ask/abandoned/ungradeable are mutually exclusive by
// construction — every `Attempt` has exactly one `outcome` — so all seven numerators now partition
// `n` exactly (their seven `value`s sum to 1 for any non-empty `attempts`, modulo floating point).

import type { Attempt } from './types';

/** `underpowered` is a threshold on `n`, not a statistical judgement (spec §9: "deliberately
 *  crude, because a crude honest signal beats a sophisticated one nobody can audit"). Single-
 *  sourced here — Task 5 (`winsWhen`) and Task 8 (the eval deck) both import this constant rather
 *  than restating the number, so the threshold can only ever be changed in one place. */
export const UNDERPOWERED_N = 8;

// `count` (fix round 1, M2, reviewer-ruled): the integer numerator alongside `value`/`n`. Before
// this field existed, the one caller that needed a whole number back (scorecard.ts's `withN`
// lines) reconstructed it as `Math.round(value * n)` — a float round-trip through a number this
// module already had as an integer before it ever divided. Numerically safe at any realistic n,
// but it was the one place the card could disagree with the aggregate it claims to be the face of.
// Carrying the integer directly removes the round-trip permanently.
export interface Rate { value: number; n: number; count: number }

export interface ArmAggregate {
  n: number;               // total attempts this aggregate was computed over
  completion: Rate;        // outcome === 'completed'
  corrected: Rate;         // outcome === 'corrected'
  wrong: Rate;             // outcome === 'wrong' — the undo-makes-it-wrong rule, rolled up
  refusal: Rate;           // outcome === 'refused-honestly' — never a failure rate (§5.1)
  ask: Rate;                // outcome === 'asked-and-answered' | 'asked-and-dropped' — a neutral
                             // collaborative-behaviour rate (same doctrine as telemetry.ts's own
                             // `asks` block: "asks kept deliberately separate from errors"), not a
                             // success or a failure rate by itself
  abandoned: Rate;          // outcome === 'abandoned' — see the file-header FIELD LIST note
  ungradeable: Rate;         // outcome === 'ungradeable' — visibility for §5.7, not a verdict:
                             // this field reports the share; deciding a run "unreliable" past some
                             // threshold is Task 5/8's to do with this number, not this module's
  // Population statistics over WHATEVER `attempts` this call was given — not narrowed to
  // 'completed' outcomes only, despite spec §4's shorthand "median turns to completion". Restricting
  // to completions only would hide exactly the turn-cost of the row classes an evaluation ledger
  // most wants visible (corrected/wrong/abandoned all still carry a real `turns` count). A caller
  // wanting the narrower "to completion" figure filters `attempts` by outcome before calling this
  // function — this module aggregates whatever population it's handed, never assumes one.
  medianTurns: { value: number | null; n: number };
  // `durationMs` is `null` on many attempts (see deriveAttempts.ts's C1 note: no settling `turn`
  // event, or a boundary close with nothing to source from) — those are excluded from the median
  // rather than coerced to 0, and the exclusion's own count travels as this field's `n` (spec §5.8:
  // "no rate is ever reported without its n" — extended here to the medians for the same reason: a
  // median computed from 2 samples and one from 200 must not read as the same kind of number).
  medianDurationMs: { value: number | null; n: number };
}

/** Lower median (stated per the task-4 brief: "median with even counts: lower median"). For a
 *  sorted array of length L, the lower-median index is `floor((L - 1) / 2)` for BOTH odd and even
 *  L — e.g. L=5 -> index 2 (the true middle); L=4 -> index 1 (the smaller of the two middle
 *  values, [1,2,3,4] -> 2, not the conventional averaged 2.5). Returns `null` for an empty input,
 *  never 0 — an empty population has no median, and 0 would misreport it as one that does.
 *  Exported (fix round 1, M7): scorecard.ts needs the identical rule for its own cold/warm-turn
 *  medians, which armAggregate.ts's `ArmAggregate` has no field for. It used to duplicate this
 *  four-line function rather than import it — both copies lived in `src/eval/` with no
 *  import-direction problem, so duplicating bought nothing but a second place to keep in sync. */
export function lowerMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

const rate = (count: number, n: number): Rate => ({ value: n ? count / n : 0, n, count });

export function armAggregate(attempts: Attempt[]): ArmAggregate {
  const n = attempts.length;
  const count = (outcome: Attempt['outcome']) => attempts.filter((a) => a.outcome === outcome).length;
  const askCount = attempts.filter((a) => a.outcome === 'asked-and-answered' || a.outcome === 'asked-and-dropped').length;

  const turns = attempts.map((a) => a.turns);
  const durations = attempts.map((a) => a.durationMs).filter((d): d is number => d !== null);

  return {
    n,
    completion: rate(count('completed'), n),
    corrected: rate(count('corrected'), n),
    wrong: rate(count('wrong'), n),
    refusal: rate(count('refused-honestly'), n),
    ask: rate(askCount, n),
    abandoned: rate(count('abandoned'), n),
    ungradeable: rate(count('ungradeable'), n),
    medianTurns: { value: lowerMedian(turns), n: turns.length },
    medianDurationMs: { value: lowerMedian(durations), n: durations.length },
  };
}
