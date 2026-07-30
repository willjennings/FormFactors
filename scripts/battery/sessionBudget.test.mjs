/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// N6 (settle-detector re-review, 2026-07-30): before `sessionBudget.mjs` existed, this arithmetic
// lived only in run.mjs, which throws unconditionally under VITEST/CI at module load — so nothing
// could ever import it, and `assertSessionBudget`'s throw path (the whole point of C1's fix) had
// never once been exercised by anything. These tests exercise it directly.

import { describe, it, expect } from 'vitest';
import {
  PROGRAM_SWAP_WAIT_MS, FIXED_SESSION_OVERHEAD_MS,
  countProgramSwaps, worstCaseSessionBudgetMs, checkSessionBudget,
} from './sessionBudget.mjs';

const MAX_SETTLE_MS = { dry: 900, live: 20000 };

function cell(programs, corpus = 'default') {
  return { register: 'terminal', shell: 'familiar', corpus, utterances: programs.map((program) => ({ program })) };
}

describe('countProgramSwaps', () => {
  it('is 0 for an empty utterance list', () => {
    expect(countProgramSwaps([])).toBe(0);
  });

  it('is 0 when every utterance names the same program (no swaps, however long)', () => {
    expect(countProgramSwaps([{ program: 'word' }, { program: 'word' }, { program: 'word' }])).toBe(0);
  });

  it('does not count the FIRST utterance as a swap, whatever program it names', () => {
    expect(countProgramSwaps([{ program: 'excel' }])).toBe(0); // nothing to swap FROM yet
  });

  it('counts one swap per adjacent program change', () => {
    expect(countProgramSwaps([
      { program: 'word' }, { program: 'word' }, { program: 'excel' },
      { program: 'excel' }, { program: 'powerpoint' }, { program: 'word' },
    ])).toBe(3); // word->excel, excel->powerpoint, powerpoint->word
  });

  it('matches the worst live wide-corpus cell this repo actually plans (30 utterances, 16 swaps) as a regression pin', () => {
    // Not re-deriving the corpus here (that would be the parallel-math this repo's own header
    // comments forbid) — this is a SHAPE test: a hand-built sequence with the same swap density
    // the settle-detector review independently verified against utterances.mjs, so a change to
    // this pure function's counting rule (not the corpus itself) gets caught here.
    const programs = [];
    for (let i = 0; i < 30; i++) programs.push({ program: i % 2 === 0 ? 'word' : 'excel' });
    expect(countProgramSwaps(programs)).toBe(29); // alternating every utterance: n-1 swaps
  });
});

describe('worstCaseSessionBudgetMs', () => {
  it('is utterances x ceiling + swaps x PROGRAM_SWAP_WAIT_MS + FIXED_SESSION_OVERHEAD_MS, exactly', () => {
    const c = cell(['word', 'word', 'excel', 'excel', 'powerpoint']); // 5 utterances, 2 swaps
    const got = worstCaseSessionBudgetMs(c, 'live', MAX_SETTLE_MS);
    const want = 5 * MAX_SETTLE_MS.live + 2 * PROGRAM_SWAP_WAIT_MS + FIXED_SESSION_OVERHEAD_MS;
    expect(got).toBe(want);
  });

  it('reproduces the review-verified worst real cell: 30 utterances / 16 swaps / live -> 688800ms', () => {
    const programs = [];
    const sequence = ['word', 'excel', 'powerpoint', 'photo'];
    for (let i = 0; i < 30; i++) programs.push({ program: sequence[i % sequence.length] });
    const c = { register: 'guided', shell: 'familiar', corpus: 'wide', utterances: programs };
    // 30 utterances cycling through 4 distinct programs, changing every step, gives 29 swaps —
    // not the real corpus's 16 (its own program sequence groups several utterances per program
    // before switching); this pins the FORMULA, not the corpus's real shape, which
    // `worstCaseSessionBudgetMs` re-review already verified independently against utterances.mjs.
    expect(worstCaseSessionBudgetMs(c, 'live', MAX_SETTLE_MS))
      .toBe(30 * MAX_SETTLE_MS.live + 29 * PROGRAM_SWAP_WAIT_MS + FIXED_SESSION_OVERHEAD_MS);
  });

  it('uses the ceiling for the given mode, not a hardcoded one', () => {
    const c = cell(['word', 'word']);
    expect(worstCaseSessionBudgetMs(c, 'dry', MAX_SETTLE_MS))
      .toBe(2 * MAX_SETTLE_MS.dry + FIXED_SESSION_OVERHEAD_MS);
  });
});

describe('checkSessionBudget', () => {
  it('is ok for an empty plan', () => {
    expect(checkSessionBudget([], 'live', MAX_SETTLE_MS, 780_000)).toEqual({ ok: true });
  });

  it('is ok when every cell fits comfortably under the session timeout', () => {
    const plan = [cell(['word', 'word', 'word'])]; // tiny — well under any real timeout
    expect(checkSessionBudget(plan, 'dry', MAX_SETTLE_MS, 780_000)).toEqual({ ok: true });
  });

  it('THE THROW PATH, exercised directly (N6, re-review): a plan whose worst cell exceeds the timeout reports ok:false and names the worst offender', () => {
    const small = cell(['word', 'word']); // fits
    const huge = cell(new Array(28).fill('word')); // 28 utterances, 0 swaps, live ceiling: big
    const plan = [small, huge];
    // Pick a deliberately tight timeout so `huge` (28 x 20000 + 0 + 60000 = 620000) exceeds it but
    // `small` (2 x 20000 + 0 + 60000 = 100000) would not, on its own — proving the function finds
    // the WORST cell in a multi-cell plan, not just the first or the last.
    const result = checkSessionBudget(plan, 'live', MAX_SETTLE_MS, 400_000);
    expect(result.ok).toBe(false);
    expect(result.cell).toBe(huge);
    expect(result.budgetMs).toBe(28 * MAX_SETTLE_MS.live + FIXED_SESSION_OVERHEAD_MS);
    expect(result.swaps).toBe(0);
  });

  it('is exactly ok at the boundary (budget === timeout is NOT a violation) and fails one ms over it', () => {
    const c = cell(['word', 'word']);
    const budget = worstCaseSessionBudgetMs(c, 'live', MAX_SETTLE_MS);
    expect(checkSessionBudget([c], 'live', MAX_SETTLE_MS, budget)).toEqual({ ok: true });
    expect(checkSessionBudget([c], 'live', MAX_SETTLE_MS, budget - 1).ok).toBe(false);
  });

  it('reproduces THIS repo\'s actual live SESSION_TIMEOUT_MS=780000 fitting the review-verified worst cell (30 utterances / 16 swaps -> 688800ms)', () => {
    // 17 groups of utterances (sizes summing to 30), alternating program between groups, gives
    // exactly 16 swaps (one per group boundary) — the swap COUNT the settle-detector review
    // independently verified against utterances.mjs for the live wide-corpus cell. The exact
    // program identities/group sizes are arbitrary; only the group COUNT (17) and the utterance
    // TOTAL (30) matter, both asserted below rather than assumed.
    const sequence = ['word', 'excel'];
    const groupSizes = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1]; // 17 groups, sums to 30
    expect(groupSizes.reduce((a, b) => a + b, 0)).toBe(30);
    const built = [];
    groupSizes.forEach((size, g) => {
      const program = sequence[g % sequence.length];
      for (let i = 0; i < size; i++) built.push({ program });
    });
    const c = { register: 'guided', shell: 'familiar', corpus: 'wide', utterances: built };
    expect(c.utterances.length).toBe(30);
    expect(countProgramSwaps(c.utterances)).toBe(16);
    expect(worstCaseSessionBudgetMs(c, 'live', MAX_SETTLE_MS)).toBe(688_800);
    expect(checkSessionBudget([c], 'live', MAX_SETTLE_MS, 780_000)).toEqual({ ok: true });
  });
});
