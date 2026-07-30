/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The attempt — the unit of evaluation (spec docs/superpowers/specs/2026-07-29-evaluation-logging-design.md
// §1, types verbatim except two disclosed deviations noted on the fields below). Every later
// consumer — the capability ledger, the arm aggregates, the eval deck, the live-model battery —
// grades through `Attempt` records produced by `deriveAttempts` (./deriveAttempts.ts).

import type { ProgramId } from '../scenarios';
import type { Arm, TelemetryEvent } from '../telemetry';

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
  // DEVIATION 2 (ordered by task-3 brief): same reasoning as `program` — `arm` STARTS from
  // `session_start.config.arm`, which is itself optional on `SessionConfig` (`arm?: Arm`). A
  // stream with no `session_start` yields attempts with a null-ish arm; this module uses the
  // `Arm` type's existing optionality rather than inventing a default arm. P2 (fix round 3): not
  // the ONLY source any more — a `shell_switch` event (no reconnect, so no new `session_start`)
  // also updates it mid-stream; see `deriveAttempts.ts`'s own `shell_switch` case / `advanceArm`.
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
 *  identical predicate. P10 (fix round 3, corrected): round 2's placement reasoning cited an
 *  import-cycle risk that does not exist — `scorecard.ts`'s import of `LedgerRow` from
 *  `capabilityLedger.ts` is `import type`, erased at compile time, so it forbids nothing either
 *  way. The placement is still right for a plainer reason: `./types.ts` is a genuine runtime
 *  LEAF (every one of ITS OWN imports is `import type` too), so putting shared logic here can
 *  never itself create a cycle, regardless of what any future caller's import turns out to be.
 *
 *  What "dials excluded" actually buys: P9 (fix round 3, corrected — round 2's version of this
 *  paragraph named a "dials effect" that does not exist). `register: 'custom'` is stamped in
 *  exactly ONE place, `App.tsx`'s `telemetry.start()` call inside the voice provider's `onOpen`
 *  callback (`arm: { register: registerKeyRef.current ?? 'custom', ... }`) — CONNECT-TIME only,
 *  not on every twiddle. So excluding `dials` from this comparison is inert for a session that
 *  twiddled a `promptDialsKey` dial (autonomy/feedback/traceView/…): that reconnects, so the NEXT
 *  `session_start` re-stamps `'custom'` (or a matching named register) fresh, and comparing dials
 *  too would not have changed which bucket it lands in. It is NOT inert, and this rule does not
 *  claim to handle, a twiddle of a dial OUTSIDE `promptDialsKey` (confirmGoals/markings/…): that
 *  reconnects nothing, re-stamps nothing, and the attempt keeps whatever arm the session already
 *  had — a real, disclosed gap in what dial changes this rule can ever see, not just in what it
 *  chooses to compare. Two 'custom' arms with genuinely different dials are (perhaps surprisingly)
 *  treated as the SAME arm by this rule regardless — 'custom' is not any named register, so there
 *  is no "roll up to the base register" happening either. */
export function sameArm(a: Arm | undefined, b: Arm): boolean {
  return a?.register === b.register && a?.shell === b.shell;
}

/** P2 (fix round 3, reviewer-ruled — the Important finding): advances the "current arm" a
 *  stream-walker is tracking, given the NEXT event — shared so `deriveAttempts.ts`,
 *  `capabilityLedger.ts`'s pass 2, and `scorecard.ts`'s `eventsForArm` cannot drift out of sync on
 *  which events move the arm-attribution boundary (they drifted once already: all three tracked
 *  `session_start` only, and a comment asserted that was the ONLY place arm is ever recorded).
 *  `session_start` carries the WHOLE arm — a genuine reconnect. `shell_switch` does NOT reconnect
 *  (`App.tsx`'s `handleSkinSelect` dispatches the desk-skin change and emits this telemetry marker
 *  only; the only reconnect triggers in the app are the `promptDialsKey`/`voiceBackend`/
 *  `activeProgram` effects) — it is the one other event type that moves the boundary, updating
 *  only `.shell` on whatever arm is already current. `register_switch` needs no case here: every
 *  register pair differs in at least one `promptDialsKey` dial, so a register switch already always
 *  reconnects and already always writes its own `session_start`. Every other event type leaves the
 *  current arm unchanged. Returns `undefined` unchanged (a `shell_switch` before any `session_start`
 *  has nothing to attach a shell to, and is not guessed onto one). */
export function advanceArm(current: Arm | undefined, ev: TelemetryEvent): Arm | undefined {
  if (ev.type === 'session_start') return ev.config.arm;
  if (ev.type === 'shell_switch') return current ? { ...current, shell: ev.to } : current;
  return current;
}

/** R1 (fix round 4, reviewer-ruled — the Important finding): the arm a stream ENDS in, i.e. the one
 *  actually in effect at the moment a card is drawn. `advanceArm` folded over the whole sitting.
 *
 *  This exists because the SUBJECT of a scorecard — the arm the card is scoped TO and named after —
 *  was read from `SessionConfig.arm` (`telemetry.ts`'s `this.config`, mirrored at App.tsx's
 *  `snap.config?.arm`), which is stamped at CONNECT and never updated: `shellSwitch`
 *  (`telemetry.ts`) pushes an event and touches nothing else, because a shell switch deliberately
 *  does not reconnect (`docs/superpowers/specs/2026-07-28-desktop-metaphor-shell-design.md` §9:
 *  "switch shells mid-session and confirm the session survives"). So after a mid-session shell
 *  switch the three stream-walkers that use `advanceArm` (deriveAttempts, capabilityLedger,
 *  scorecard's own scoping) had moved on while the subject had not: the card was built FOR the
 *  pre-switch arm, headlined with a shell no longer on screen, and every post-switch trial, ledger
 *  row and turn was silently absent from it — the only card the app could ask for. Both call sites
 *  now derive the subject here instead, from the same machine the walkers use, so subject and scope
 *  cannot disagree.
 *
 *  Returns `undefined` for a stream with no `session_start` (nothing was ever recorded to have an
 *  arm) — callers treat that exactly as they treated an absent `config.arm`: no card, said plainly.
 *  For a sitting that never switched shells this is byte-identical to `config.arm`, since the
 *  current run's `session_start` carries that very object. */
export function currentArmFrom(events: TelemetryEvent[]): Arm | undefined {
  let arm: Arm | undefined;
  for (const e of events) arm = advanceArm(arm, e);
  return arm;
}
