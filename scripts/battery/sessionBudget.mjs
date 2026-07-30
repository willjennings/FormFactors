/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Pure budget-arithmetic for the settle-detector's C1 fix (settle-detector review, 2026-07-30),
// extracted out of run.mjs so it is IMPORTABLE — and therefore testable under vitest — despite
// run.mjs's own unconditional guard (module load, before any argument parsing) that throws under
// VITEST/CI and makes run.mjs itself impossible to import in a test (N6, settle-detector
// re-review, 2026-07-30: before this file existed, `assertSessionBudget`'s throw path had never
// been exercised by anything). No I/O, no CDP, no browser, no `sleep` — pure functions only, so
// every one of them is directly unit-testable with plain data in, plain data out.

/** The fixed sleep after a mid-session program swap (`driveSession`'s utterance loop, run.mjs) —
 *  exported here, not just inline there, so the budget arithmetic below and the actual
 *  `await sleep(PROGRAM_SWAP_WAIT_MS)` call in run.mjs can never disagree about what a swap costs. */
export const PROGRAM_SWAP_WAIT_MS = 1800;

// The fixed per-session cost OUTSIDE the utterance loop — everything `checkSessionBudget`'s
// worst-case arithmetic has to account for besides `utterances x ceiling` and `swaps x
// PROGRAM_SWAP_WAIT_MS`. Real components, all `driveSession` sleeps/polls in run.mjs, summed
// generously rather than measured exactly (each is itself a worst-case bound already, so summing
// worst-cases here is deliberately pessimistic):
//
//   BOOT_WAIT_MS ................................................ 2500
//   initial connect's own CONNECT_TIMEOUT_MS-bound poll ......... 15000  (almost always far faster)
//   initial program-switch settle (pre-loop, once) .................600
//   endSession's own CONNECT_TIMEOUT_MS-bound poll ............... 15000
//   endSession's trailing settle .....................................500
//   exportSession's drawer-open wait ...................................400
//   exportSession's download poll .................................. 10000
//   exportSession's size-stabilize loop (20 x 150) .................. 3000
//   Page.close's own bound (cleanup, `finally`) ...................... 5000
//                                                          total ≈ 52000ms
//
// Rounded up to 60000 for margin against anything this list missed. NOT a checked total — a
// CHECKLIST for a human editing run.mjs's `driveSession`: if you add a NEW `await sleep(...)` (or
// any other bounded wait) OUTSIDE the per-utterance loop, add its worst case to this list and bump
// the constant, or `checkSessionBudget` will silently under-count the real worst case (N5,
// settle-detector re-review, 2026-07-30 — this constant is hand-maintained, not derived; it is also
// NOT a proof against per-utterance CDP round-trip overhead, which this formula does not add at
// all — `pollTurnSettled`/`typeAndSubmit` each carry some, comfortably inside the margin today but
// unstated here on purpose, since this constant only ever covers the per-SESSION, non-loop cost).
export const FIXED_SESSION_OVERHEAD_MS = 60_000;

/** How many times consecutive utterances in `utterances` name a DIFFERENT `program` — i.e. how
 *  many mid-session reconnects (`driveSession`'s utterance loop) a cell's own utterance sequence
 *  forces. The FIRST utterance never counts (there is no reconnect before the first program is
 *  ever chosen — `driveSession` handles that as a one-time pre-loop switch, not a loop-body swap).
 *  Pure and total: any array in, including empty, a non-negative integer out. */
export function countProgramSwaps(utterances) {
  let count = 0;
  let current = null;
  for (const u of utterances) {
    if (current !== null && u.program !== current) count += 1;
    current = u.program;
  }
  return count;
}

/** The worst-case wall-clock ONE session of `cell` could legitimately need, computed from the REAL
 *  utterance list and REAL swap count rather than a hand-maintained estimate. `maxSettleMs` is
 *  run.mjs's `MAX_SETTLE_MS` object (`{ dry, live }`); `mode` selects which ceiling applies. */
export function worstCaseSessionBudgetMs(cell, mode, maxSettleMs) {
  return cell.utterances.length * maxSettleMs[mode]
    + countProgramSwaps(cell.utterances) * PROGRAM_SWAP_WAIT_MS
    + FIXED_SESSION_OVERHEAD_MS;
}

/** Pure check: does ANY cell in `plan` need more wall-clock than `sessionTimeoutMs` gives it?
 *  Returns `{ ok: true }`, or `{ ok: false, cell, budgetMs, swaps }` naming the worst offender.
 *  NEVER THROWS — this is what makes it directly unit-testable; run.mjs's `assertSessionBudget` is
 *  a one-line throwing wrapper around this function's result, not a duplicate of its logic. */
export function checkSessionBudget(plan, mode, maxSettleMs, sessionTimeoutMs) {
  if (!plan.length) return { ok: true };
  const worst = plan.reduce((acc, cell) => {
    const budgetMs = worstCaseSessionBudgetMs(cell, mode, maxSettleMs);
    return budgetMs > acc.budgetMs ? { cell, budgetMs } : acc;
  }, { cell: plan[0], budgetMs: worstCaseSessionBudgetMs(plan[0], mode, maxSettleMs) });
  if (worst.budgetMs > sessionTimeoutMs) {
    return { ok: false, cell: worst.cell, budgetMs: worst.budgetMs, swaps: countProgramSwaps(worst.cell.utterances) };
  }
  return { ok: true };
}
