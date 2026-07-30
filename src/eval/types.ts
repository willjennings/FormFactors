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
