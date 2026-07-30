/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The attempt — the unit of evaluation (spec docs/superpowers/specs/2026-07-29-evaluation-logging-design.md
// §1, types verbatim except two disclosed deviations noted on the fields below). Every later
// consumer — the capability ledger, the arm aggregates, the eval deck, the live-model battery —
// grades through `Attempt` records produced by `deriveAttempts` (./deriveAttempts.ts).

import type { ProgramId } from '../scenarios';
import type { Arm } from '../telemetry';

export type AttemptOutcome =
  | 'completed'          // the asked-for change is in the committed state
  | 'corrected'          // completed, but the user had to fix it first
  | 'wrong'              // completed, then undone by the user — retroactively a failure
  | 'refused-honestly'   // the system said it couldn't, and that was true
  | 'asked-and-answered' // the gate asked, the user answered, it landed
  | 'asked-and-dropped'  // the gate asked and the user never answered
  | 'abandoned'          // the intent was never satisfied and the session moved on
  | 'ungradeable';       // we genuinely cannot tell — never a synonym for success

export interface Attempt {
  id: string;
  askedAt: number;
  request: string;          // the user's words, verbatim
  // DEVIATION 1 (ordered by task-3 brief, "context the brief cannot know"): the spec's code block
  // types this `ProgramId` (non-optional), matching `arm` below — but `program` is read from
  // `session_start.config.program`, exactly as `arm` is read from `session_start.config.arm`. A
  // stream with no `session_start` (a hand-authored fixture that never boots a session, or a
  // fragment of a stream) has no program to report either, and this module never invents one.
  program: ProgramId | undefined;
  verb: string | null;      // null when no tool call resulted
  outcome: AttemptOutcome;
  turns: number;            // exchanges from request to outcome
  corrections: number;      // user corrections during the attempt (any `correction` event touching it)
  undos: number;            // the subset of `corrections` with `overAgent: true` — the user reversing
                             // what the agent did, the signal rule 2 (`wrong`) fires on
  witnessed: boolean;       // did a witness card gate it
  durationMs: number | null;
  // DEVIATION 2 (ordered by task-3 brief): same reasoning as `program` — `arm` comes from
  // `session_start.config.arm`, which is itself optional on `SessionConfig` (`arm?: Arm`). A
  // stream with no `session_start` yields attempts with a null-ish arm; this module uses the
  // `Arm` type's existing optionality rather than inventing a default arm.
  arm: Arm | undefined;
  // DEVIATION 3: not in the spec's code block, but required by the spec's OWN prose — §2 says
  // "Anything the rules cannot place → `ungradeable`, with the reason recorded." The interface
  // block and the prose disagree; the prose is binding (it is what §5's anti-flattery doctrine is
  // about — an unexplained `ungradeable` is exactly the kind of silent failure this file exists to
  // prevent). Present only when `outcome === 'ungradeable'`; null otherwise.
  ungradeableReason: string | null;
}

// The verdict a `winsWhen` predicate (Task 5, spec §4) returns when checking a register or shell
// skin's pre-registered `probe` against an `ArmAggregate`. `because` is not optional prose — every
// verdict must name the actual numbers compared, or it is exactly the unearned flattery §5 forbids.
export type ProbeVerdict = { verdict: 'met' | 'not-met' | 'underpowered'; because: string };

/** Arm identity, shared (fix round 2, N1/N6): two arms are "the same" iff `register` AND `shell`
 *  match — `dials` are excluded. This is scorecard.ts's `attemptsForArm` rule, factored out here
 *  (rather than left there, or moved into capabilityLedger.ts) so BOTH modules can use the
 *  identical predicate without an import cycle: scorecard.ts already value-imports
 *  capabilityLedger.ts for `LedgerRow`, so capabilityLedger.ts cannot import scorecard.ts back.
 *  `./types.ts` is a leaf both already sit downstream of.
 *
 *  What "dials excluded" actually buys: a hand-twiddled arm stamps `register: 'custom'`
 *  (App.tsx's dials effect: `registerKeyRef.current ?? 'custom'`), so it already lands in its own
 *  bucket by register alone — excluding dials from the comparison changes nothing for that case;
 *  it is inert rather than load-bearing, because a non-'custom' register key already implies that
 *  register's preset dials. Two 'custom' arms with genuinely different dials are (perhaps
 *  surprisingly) treated as the SAME arm by this rule — a known, disclosed gap, not a claim that
 *  they roll up "back to" a named register (they do not; 'custom' is not any named register). */
export function sameArm(a: Arm | undefined, b: Arm): boolean {
  return a?.register === b.register && a?.shell === b.shell;
}
