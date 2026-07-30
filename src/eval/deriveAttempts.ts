/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The heart of the evaluation cycle: a session's telemetry stream in, graded `Attempt` records
// out. Every later consumer — the capability ledger, the arm aggregates, the eval deck's
// scorecard, the live-model battery — grades through this one function.
//
// Signature drops the journal param the design spec's code block carries
// (`deriveAttempts(events, journal)`): document-state confirmation comes entirely from `action`
// decisions (`commit`/`witness`/`rejected`) plus `correction`/`turn` events, never from replaying
// the journal's document snapshots — so the journal is not read here at all. Pure: no Date.now(),
// no DOM; every timestamp comes from the events themselves.
//
// ORDERING DISCOVERY (not in the task brief; found reading App.tsx, load-bearing for this whole
// file's shape): for a normal tool-call exchange, the real app pushes the `action` event BEFORE
// the `turn` event that reports it — `handleVoiceToolCall`'s `ack()` calls `telemetry.action(...)`
// and only THEN closes the turn (`pushTurn(closeTurn(...))`), because the decision is known before
// the ack that settles the turn fires. So in ARRAY order, `action` precedes its own `turn`, even
// though the turn's `t` field (its own open time) is chronologically earlier. Rule 1's "attempt
// opens on a turn event" describes the CONCEPTUAL open (the utterance that starts it); it does not
// mean the `turn` TelemetryEvent is the first thing this module sees for that exchange. The state
// machine below is therefore built to be agnostic to which of `action`/`turn` a given exchange's
// events arrive in: signals are folded into a `Pending` accumulator that may not yet have an
// identity (id/askedAt/request), and a `turn` event supplies that identity the first time it is
// missing, whichever order things actually arrived in.
//
// DISCLOSED LIMITATION: because a `turn` event with outcome `tool_call` and nothing else attached
// is genuinely ambiguous — it is the same shape whether the tool was unknown/hallucinated (nothing
// will ever follow) or the first half of an ask flow (`unspecified_ask` + a later commit are still
// to come, on a LATER turn) — this module keeps such a pending attempt open across subsequent
// `tool_call`-outcome turns rather than guessing which case it is. If the user's next utterance is
// a genuinely unrelated new request, the schema exposes no signal that separates it from a
// continuation, so it folds into the same pending attempt (`turns` counts both). Telemetry has no
// event that would disambiguate this; a lone `tool_call` turn with nothing ever following before a
// program swap or session end resolves honestly as `ungradeable`, reason `tool-call-without-action`.

import type { TelemetryEvent, Arm } from '../telemetry';
import type { ProgramId } from '../scenarios';
import type { Attempt, AttemptOutcome } from './types';

interface Pending {
  id: string | null;
  askedAt: number | null;
  request: string | null;
  program: ProgramId | undefined;
  arm: Arm | undefined;
  verb: string | null;
  turns: number;
  corrections: number;
  undos: number;
  witnessed: boolean;
  committed: boolean;            // a `commit` action landed (only true when `decided` is one of
                                  // corrected/asked-and-answered/completed) — gates the undo window
  correctedBeforeCommit: boolean; // rule 3
  askAnswered: boolean;           // rule 6, the answered half — awaiting the commit that fulfils it
  rejectedPending: boolean;       // rule 5, tentative — a later commit in this window (a retry)
                                   // supersedes it; see the "no successful retry" carve-out
  sawAction: boolean;             // any action/ask ever touched this window — the
                                   // tool-call-without-action guard
  decided: AttemptOutcome | null; // set by a commit (rules 2-4/6) or a dropped ask (rule 6); once
                                   // set, only a subsequent `turn` event (or the final boundary)
                                   // still needs to fire to push it, since `turn` is what carries
                                   // the identity when an action arrived before its own turn event
  lastT: number;                  // MAX `t` seen touching this window (not "last written" — a
                                   // `turn` event's own `t` is its OPEN time, chronologically
                                   // EARLIER than the action that resolved it in real streams; a
                                   // plain overwrite would corrupt durationMs) — passed through to
                                   // durationMs only, per the task-3 brief; never used to decide outcomes
}

export function deriveAttempts(events: TelemetryEvent[]): Attempt[] {
  const attempts: Attempt[] = [];
  let currentProgram: ProgramId | undefined;
  let currentArm: Arm | undefined;
  let seenSessionStart = false;
  let pending: Pending | null = null;
  // Index into `attempts` eligible for a retroactive flip to `wrong` (rule 2): the commit just
  // closed, but an undo — a later `correction` with `overAgent` — can still arrive and retroactively
  // convict it. Open from the moment a commit-derived attempt is pushed until the next genuinely
  // new utterance (`turn` assigning fresh identity), a program swap, or session end.
  let undoWindow: number | null = null;

  const blank = (): Pending => ({
    id: null, askedAt: null, request: null, program: currentProgram, arm: currentArm,
    verb: null, turns: 0, corrections: 0, undos: 0, witnessed: false, committed: false,
    correctedBeforeCommit: false, askAnswered: false, rejectedPending: false,
    sawAction: false, decided: null, lastT: 0,
  });
  const ensurePending = (): Pending => { if (!pending) pending = blank(); return pending; };

  /** Priority chain for "what do we know right now" — shared by a turn event that forces
   *  resolution and by the final program-swap/session-end boundary. `forcedReason`, when given
   *  (transcription_lost), short-circuits everything else: a lost transcript never reached the
   *  model, so nothing else recorded about this window can explain what happened to the user's
   *  actual words. `nothingHappened` is the outcome for "sawAction is false and nothing else
   *  applies" — the ONE branch whose right answer depends on why we're resolving at all: a
   *  `tool_call` turn (or the final boundary) with nothing else attached is `ungradeable` (we
   *  can't tell a hallucinated tool from an ask flow that never got its next turn — see the
   *  file-header note); a `speech_only`/`no_response` turn with nothing else attached is rule 7's
   *  `abandoned` outright — it did not fail to explain itself, it explains itself as nothing. */
  const resolve = (
    p: Pending,
    nothingHappened: { outcome: AttemptOutcome; reason: string | null },
    forcedReason?: string,
  ): { outcome: AttemptOutcome; reason: string | null } => {
    if (p.decided) return { outcome: p.decided, reason: null }; // rules 2-4 (wrong resolved via
      // the undo window, not here — see below) / rule 6's asked-and-answered / rule 6's dropped-ask
    if (forcedReason) return { outcome: 'ungradeable', reason: forcedReason }; // rule 8
    if (p.rejectedPending) return { outcome: 'refused-honestly', reason: null }; // rule 5
    if (p.askAnswered) return { outcome: 'abandoned', reason: null }; // answered, but no commit ever
      // landed before the boundary — rule 7: the intent was never satisfied and the session moved on
    if (!p.sawAction) return nothingHappened;
    return { outcome: 'ungradeable', reason: 'ambiguous-boundary' }; // rule 9 — never guessed
  };
  const TOOL_CALL_NOTHING = { outcome: 'ungradeable' as const, reason: 'tool-call-without-action' };
  const SPEECH_NOTHING = { outcome: 'abandoned' as const, reason: null }; // rule 7, the survivorship fix

  const settle = (p: Pending, outcome: AttemptOutcome, reason: string | null): void => {
    attempts.push({
      // Defensive fallback for a malformed/truncated stream where a `turn` event never arrived to
      // supply identity (never exercised by a well-formed stream — every exchange this module
      // grades produces exactly one `turn` event, per src/eval/turns.ts): still a well-formed
      // record rather than a dropped one.
      id: p.id ?? `unidentified-${attempts.length}`,
      askedAt: p.askedAt ?? p.lastT,
      request: p.request ?? '',
      program: p.program,
      verb: p.verb,
      outcome,
      turns: p.turns,
      corrections: p.corrections,
      undos: p.undos,
      witnessed: p.witnessed,
      durationMs: p.lastT - (p.askedAt ?? p.lastT),
      arm: p.arm,
      ungradeableReason: reason,
    });
    if (p.committed) undoWindow = attempts.length - 1; // only a real commit can later be undone
  };

  const closeUndoWindow = () => { undoWindow = null; };

  /** Fires on a program swap or session end: whatever is still pending gets graded from what is
   *  known, never left out of the corpus (rule 6, §5.6: abandonment is data, not absence). */
  const closeAtBoundary = (): void => {
    if (!pending) return;
    const { outcome, reason } = resolve(pending, TOOL_CALL_NOTHING);
    settle(pending, outcome, reason);
    pending = null;
    closeUndoWindow();
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'session_start': {
        // The nearest honest signal this schema carries for a program swap: the live app wipes
        // and restarts the event stream on any mid-session reconnect (register/shell/backend/
        // PROGRAM change all reconnect — App.tsx), so a genuine program swap would show up here as
        // exactly a second `session_start`. No `guidance` event `kind` denotes a program change —
        // despite the design spec's shorthand "program swap (`guidance`/`session` markers)" — so
        // this module treats `guidance` events as carrying no boundary signal at all (see the
        // `default` case below).
        if (seenSessionStart) closeAtBoundary();
        seenSessionStart = true;
        currentProgram = ev.config.program as ProgramId;
        currentArm = ev.config.arm;
        break;
      }

      case 'turn': {
        const p = ensurePending();
        p.lastT = Math.max(p.lastT, ev.t);
        if (p.id === null) {
          p.id = ev.id;
          p.askedAt = ev.t;
          p.request = ev.request;
          closeUndoWindow(); // a new utterance ends any pending undo window from a PRIOR attempt
        }
        p.turns += 1;
        if (ev.outcome === 'transcription_lost') {
          const { outcome, reason } = resolve(p, TOOL_CALL_NOTHING, 'transcription-lost'); // rule 8
          settle(p, outcome, reason);
          pending = null;
        } else if (ev.outcome === 'speech_only' || ev.outcome === 'no_response') {
          // A turn that settled with no tool call closes whatever is pending — rule 7 when nothing
          // else was ever attached (the fresh case: no attempt events, straight to `abandoned`);
          // `resolve` also correctly reaches `refused-honestly`/`abandoned`/the ungradeable
          // fallback for a continuation turn that trails a rejection, an answered-but-uncommitted
          // ask, or a witness nobody confirmed.
          const { outcome, reason } = resolve(p, SPEECH_NOTHING);
          settle(p, outcome, reason);
          pending = null;
        } else if (p.decided) {
          // outcome === 'tool_call' and the action(s) for this exchange already arrived (in array
          // order) before this turn event — this turn is only here to supply identity/turns; the
          // decision is already known.
          settle(p, p.decided, null);
          pending = null;
        }
        // else: outcome === 'tool_call', nothing decided yet — leave `pending` open, awaiting more
        // (see the file-header disclosed limitation).
        break;
      }

      case 'action': {
        const p = ensurePending();
        p.sawAction = true;
        p.lastT = Math.max(p.lastT, ev.t);
        p.verb = ev.verb;
        if (ev.decision === 'witness') {
          p.witnessed = true;
          // Double-count guard (spec §5.5): witness never closes the boundary by itself — the
          // commit that follows for the same action is what does. One attempt, not two.
        } else if (ev.decision === 'commit') {
          p.rejectedPending = false; // a successful retry supersedes an earlier `rejected` — rule 5's carve-out
          p.committed = true;
          // Rule 2 (`wrong`, the single most important rule in the file) can never be decided
          // here: a reversing correction always arrives chronologically AFTER its commit (the user
          // acts to undo something already committed). It is applied retroactively via
          // `undoWindow`, once this attempt is actually pushed (in the `turn` case, or here if
          // identity is already known). What CAN be decided now:
          //   rule 3 corrected            — a correction preceded this commit, not (yet) reversed
          //   rule 6 asked-and-answered   — a gate ask (answered) preceded this commit
          //   rule 4 completed            — neither: a clean commit
          // `corrected` is checked first: evidence something needed fixing outranks the fact that
          // a gate asked and got an answer. Both outrank the bare `completed` fallback, which is
          // reserved for a commit with nothing else going on.
          p.decided = p.correctedBeforeCommit ? 'corrected' : p.askAnswered ? 'asked-and-answered' : 'completed';
        } else {
          // 'rejected' — tentative, not a boundary close by itself (see rule 5's comment above).
          p.rejectedPending = true;
        }
        break;
      }

      case 'correction': {
        if (pending && pending.committed && ev.overAgent) {
          // Reverses a commit not yet pushed to `attempts` (its confirming `turn` event has not
          // arrived) — flip directly. Same rule as the `undoWindow` branch below, just before the
          // attempt exists as a pushed record.
          pending.decided = 'wrong';
          pending.undos += 1;
          pending.corrections += 1;
          pending.lastT = Math.max(pending.lastT, ev.t);
        } else if (pending && pending.decided === null) {
          // Rule 3: a correction before this attempt's own commit.
          pending.corrections += 1;
          pending.correctedBeforeCommit = true;
          if (ev.overAgent) pending.undos += 1;
          pending.lastT = Math.max(pending.lastT, ev.t);
        } else if (undoWindow !== null) {
          // Rule 2: an action the user reverses is a failure that was caught, not a success that
          // happened to be edited.
          const a = attempts[undoWindow];
          a.corrections += 1;
          if (ev.overAgent) { a.undos += 1; a.outcome = 'wrong'; }
        }
        // A correction attributable to nothing open and no active undo window is dropped, honestly
        // — never guessed onto an unrelated attempt.
        break;
      }

      case 'unspecified_ask': {
        const p = ensurePending();
        p.sawAction = true;
        p.lastT = Math.max(p.lastT, ev.t);
        if (ev.answered) {
          p.askAnswered = true; // rule 6's answered half — stays open, awaiting the fulfilling commit
        } else {
          p.decided = 'asked-and-dropped'; // rule 1 + 6: the dropped ask is itself a boundary closer
        }
        break;
      }

      default:
        break; // no grading signal in this module: deixis, grounding, map, fill, gap_question,
               // readback, stall, session_complete, error, guidance, mission_*, register_switch,
               // shell_switch, pin, combine_tray.
    }
  }

  closeAtBoundary(); // session end
  return attempts;
}
