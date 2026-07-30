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
// the ack that settles the turn fires. So in ARRAY order, `action` precedes its own `turn`. Rule
// 1's "attempt opens on a turn event" describes the CONCEPTUAL open (the utterance that starts
// it); it does not mean the `turn` TelemetryEvent is the first thing this module sees for that
// exchange. The state machine below is therefore built to be agnostic to which of `action`/`turn`
// a given exchange's events arrive in: signals are folded into a `Pending` accumulator that may
// not yet have an identity (id/askedAt/request), and a `turn` event supplies that identity the
// first time it is missing, whichever order things actually arrived in.
//
// CORRECTED (fix round 1, C1 — the first version of this comment had the causality backwards):
// the exported `turn` event's `t` is NOT its open time. `telemetry.push()` stamps every event's
// `t` as `Date.now() - startedAt` AT THE MOMENT the pusher calls it — and `telemetry.turn()` is
// called with no `t` argument at all (App.tsx's own comment: "ClosedTurn.t is absolute epoch ms
// here, and nothing reads it: telemetry.turn() takes no `t`"). So the exported `t` is close to
// SETTLEMENT time, same clock family as the `action` event that resolved it (confirmed live: an
// `action()` call, a busy-wait, then `turn()` — the turn's exported `t` came out LATER, not
// earlier). `askedAt` below is still sourced from this `t` — it is the best per-exchange
// timestamp this schema exports, but it is a settle-adjacent value, not a true open time; this is
// a disclosed schema limitation (the true open time lives only in the ephemeral `OpenTurn` inside
// App.tsx and is never exported). Because of this, `askedAt` is NEVER used to compute `durationMs`
// — see `settle()` below, which sources duration from `turn.settledMs` instead: that field is
// computed INSIDE turns.ts's `closeTurn`, from the true open time, before it gets lost on export.
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
import { advanceArm } from './types';

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
  rejectedVerb: string | null;    // C1 fix (fix round 2, reviewer-flagged "vanishing refusal"):
                                   // which verb was actually rejected. `p.verb` alone can't gate
                                   // the retry carve-out because EVERY action event overwrites it,
                                   // including one for a totally different, unrelated tool — this
                                   // field is the one thing in `Pending` that stays pinned to what
                                   // was actually refused, so the commit branch below can tell a
                                   // genuine retry from an unrelated success landing in the same
                                   // still-open window.
  splitRejectedVerb: string | null; // C2 fix (fix round 3, reviewer-flagged "vanished success"):
                                   // set the moment a same-window, no-intervening-turn commit for
                                   // an UNRELATED verb is seen (see the 'action' case) — remembers
                                   // that this window must produce TWO attempts when it settles,
                                   // not one. Kept separate from `rejectedVerb` (which is cleared/
                                   // superseded the instant a commit lands, matched or not) so
                                   // `settle()` still knows, once the window resolves, that a real
                                   // rejection happened here even though `p.decided` now reflects
                                   // the unrelated commit's own outcome.
  sawAction: boolean;             // any action/ask ever touched this window — the
                                   // tool-call-without-action guard
  decided: AttemptOutcome | null; // set by a commit (rules 2-4/6) or a dropped ask (rule 6); once
                                   // set, only a subsequent `turn` event (or the final boundary)
                                   // still needs to fire to push it, since `turn` is what carries
                                   // the identity when an action arrived before its own turn event
  lastT: number;                  // MAX `t` seen touching this window — used ONLY as the identity
                                   // fallback in `settle()` for a malformed stream with no `turn`
                                   // event at all; never used to compute durationMs (see the
                                   // file-header C1 note) and never used to decide outcomes
  settledMs: number | null;       // the most recent `turn` event's own `settledMs` — computed
                                   // inside turns.ts from the TRUE open time, so (unlike `askedAt`)
                                   // it survives export uncorrupted. Sourced for `durationMs`
                                   // directly; for a multi-turn attempt (an ask flow) this is only
                                   // the RESOLVING turn's own open-to-settle span, not the whole
                                   // attempt's ask-to-resolution length — the schema exports no
                                   // event that would let this module reconstruct the latter.
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
    correctedBeforeCommit: false, askAnswered: false, rejectedPending: false, rejectedVerb: null,
    splitRejectedVerb: null, sawAction: false, decided: null, lastT: 0, settledMs: null,
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
  // M1: `refused-honestly` was considered and rejected for this case (a `tool_call` turn with no
  // `action` event at all — e.g. the M4 unknown/hallucinated-tool ack path, which answers the
  // model honestly but never goes through validate.ts's gate). Rejected because `refused-honestly`
  // is rule 5's outcome for a GRADED refusal — an `action` event with `decision: 'rejected'`, the
  // gate's own `{error}` verdict. A hallucinated tool name never reaches that gate at all; calling
  // it "refused" would credit the gate for a decision it never made. `ungradeable` says, correctly,
  // that this module cannot tell from the ontology it has whether the system behaved well here.
  const TOOL_CALL_NOTHING = { outcome: 'ungradeable' as const, reason: 'tool-call-without-action' };
  const SPEECH_NOTHING = { outcome: 'abandoned' as const, reason: null }; // rule 7, the survivorship fix

  const settle = (p: Pending, outcome: AttemptOutcome, reason: string | null): void => {
    // Defensive fallback for a malformed/truncated stream where a `turn` event never arrived to
    // supply identity (never exercised by a well-formed stream — every exchange this module
    // grades produces exactly one `turn` event, per src/eval/turns.ts): still a well-formed
    // record rather than a dropped one.
    const baseId = p.id ?? `unidentified-${attempts.length}`;
    // Shared across every record `settle()` can produce for this window (one or two — see below):
    // identity/program/arm/witness state don't differ between the split halves of a same-window
    // rejection+unrelated-commit, only outcome/verb/turns/duration/request do.
    const shared = { askedAt: p.askedAt ?? p.lastT, program: p.program, arm: p.arm, witnessed: p.witnessed };
    if (p.splitRejectedVerb !== null) {
      // C2 fix (fix round 3, reviewer-flagged "vanished success"): a same-window commit for a verb
      // UNRELATED to the one that was rejected, with no intervening `turn` event to give it its own
      // identity (see the `turn` case's guard 1 above, which handles the cross-turn version of this
      // same situation) — pushed here as TWO records instead of the one `outcome` normally produces.
      // Round 2's fix silently discarded this commit's effect (a bare `break`); that traded one
      // failure mode for its mirror — a real success credited nowhere, violating spec §2 exactly as
      // much as guessing does. The REJECTION keeps this window's real, turn-reported identity — it
      // is chronologically the first thing that happened, and the turn's verbatim genuinely
      // describes it. The unrelated commit's OWN record gets a synthetic id (`-split` suffix, never
      // colliding with a real turn id) and an EMPTY request: the schema exports no independent
      // verbatim for a second, nested tool call sharing one exchange with a rejection, and copying
      // the rejected request's text onto it would reopen C1's exact misattribution through this
      // second door. `turns`/`durationMs` are left at 0/null for the same reason — neither is
      // independently knowable for a call that never settled its own turn.
      attempts.push({
        ...shared, id: baseId, request: p.request ?? '', verb: p.splitRejectedVerb,
        outcome: 'refused-honestly', turns: p.turns, corrections: p.corrections, undos: p.undos,
        durationMs: p.settledMs, ungradeableReason: null,
      });
      attempts.push({
        ...shared, id: `${baseId}-split`, request: '', verb: p.verb, outcome,
        turns: 0, corrections: 0, undos: 0, durationMs: null, ungradeableReason: reason,
      });
      // The split (commit) record is the one actually eligible for a later undo — it is the one
      // that touched the document; the rejection never did.
      if (p.committed) undoWindow = attempts.length - 1;
      return;
    }
    attempts.push({
      ...shared, id: baseId, request: p.request ?? '', verb: p.verb, outcome,
      turns: p.turns, corrections: p.corrections, undos: p.undos,
      // C1 fix: NOT `lastT - askedAt` (both are settle-adjacent exported timestamps, so that
      // subtraction collapsed to ~0 for nearly every ordinary attempt). `turn.settledMs` is
      // computed inside turns.ts from the true open time and survives export correctly; when no
      // turn ever settled this window (transcription_lost/speech_only/no_response, or a boundary
      // close with no turn event at all), it stays honestly null rather than fabricated.
      durationMs: p.settledMs,
      ungradeableReason: reason,
    });
    if (p.committed) undoWindow = attempts.length - 1; // only a real commit can later be undone
  };

  const closeUndoWindow = () => { undoWindow = null; };

  /** Fires on a program swap or session end: whatever is still pending gets graded from what is
   *  known, never left out of the corpus (rule 6, §5.6: abandonment is data, not absence). */
  const closeAtBoundary = (): void => {
    if (pending) {
      const { outcome, reason } = resolve(pending, TOOL_CALL_NOTHING);
      settle(pending, outcome, reason);
      pending = null;
    }
    // UNCONDITIONAL, and after any settle (2026-07-30, found writing the multi-run tests): this used
    // to sit behind an `if (!pending) return;` guard, so a boundary reached with NOTHING pending left
    // the undo window open — and a `correction` recorded in the NEXT run then retroactively convicted
    // a commit from a previous connection as `wrong`. Unreachable until the recorder began archiving
    // runs instead of wiping them (telemetry.ts priorRuns), because before that a stream could only
    // ever hold one `session_start`. After the settle rather than before, so the attempt this
    // boundary just closed is not itself left undo-eligible across the boundary either.
    closeUndoWindow();
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'session_start': {
        // The nearest honest signal this schema carries for a program swap: the live app wipes
        // and restarts the event stream on any mid-session reconnect (register/backend/PROGRAM
        // change all reconnect — App.tsx; P2, fix round 3, corrected: SHELL change does not, see
        // the `shell_switch` case below), so a genuine program swap would show up here as exactly
        // a second `session_start`. No `guidance` event `kind` denotes a program change — despite
        // the design spec's shorthand "program swap (`guidance`/`session` markers)" — so this
        // module treats `guidance` events as carrying no boundary signal at all (see the `default`
        // case below).
        if (seenSessionStart) closeAtBoundary();
        seenSessionStart = true;
        currentProgram = ev.config.program as ProgramId;
        currentArm = advanceArm(currentArm, ev);
        break;
      }

      // P2 (fix round 3, reviewer-ruled — the Important finding): a shell switch (App.tsx's
      // `handleSkinSelect`) is the ONE arm change the app makes WITHOUT reconnecting — no new
      // `session_start`, so nothing else in this switch would ever see it. Before this case
      // existed, every attempt from here to the session's end kept the PRE-switch shell, silently
      // (Probe A, round-2 re-review: a Terminal sitting that switched Familiar->Material mid-run
      // reported the post-switch attempt, its deixis miss and its latency all as Familiar). No
      // boundary close here — unlike `session_start`, a shell switch does not end the current
      // pending exchange; it only changes what arm the NEXT attempt(s) get stamped with.
      case 'shell_switch':
        currentArm = advanceArm(currentArm, ev);
        break;

      case 'turn': {
        let p = ensurePending();
        // C1 fix (fix round 2, reviewer-flagged "vanishing refusal"): a SECOND `turn` event
        // touching an already-identified window (`p.id !== null` — this is not the rejected
        // exchange's own settling turn, which is what assigns `p.id` in the first place) is the
        // one unambiguous signal this schema carries for "a new utterance started" (spec §2's
        // boundary rule: an attempt closes on "a program change... or session end" — a NEW turn
        // is the missing case: it means the PREVIOUS exchange is over). If a rejection is still
        // sitting unresolved (`rejectedPending`, `!decided`) when that happens, this is not a
        // retry — a genuine same-verb retry's `action` event would have arrived BEFORE now (the
        // file-header ORDERING DISCOVERY: action precedes its own turn) and already cleared
        // `rejectedPending` via the verb-matched carve-out below. So: seal the rejection as its
        // own `refused-honestly` attempt right here, using what this window actually knows (the
        // ORIGINAL request, verbatim), and open a fresh pending for whatever THIS turn event
        // introduces. Before this fix, a later unrelated ask+commit silently inherited the
        // rejected request's identity — the "vanishing refusal" — because `p.id === null` never
        // re-fired once the first turn had already claimed it.
        //
        // EXPLICIT (per round-1 re-review): this guard fires BEFORE the `ev.outcome` branches
        // below, so it applies uniformly regardless of what kind of turn just arrived — tool_call,
        // speech_only, no_response, or transcription_lost are all, equally, "a new utterance
        // started" (the schema affords no finer signal). And it wins unconditionally over the
        // verb-matched retry carve-out in the `action` case below: ONCE a second turn event has
        // intervened, even a SAME-verb commit that follows is no longer treated as a retry of the
        // sealed rejection — it opens its own fresh attempt on the new pending created here. Seal
        // beats verb-match; verb-match only ever applies to same-window commits (see the `action`
        // case), never across a turn boundary.
        if (p.id !== null && p.rejectedPending && !p.decided) {
          const { outcome, reason } = resolve(p, TOOL_CALL_NOTHING); // sawAction is true (the
            // rejection itself), so this always resolves via the `rejectedPending` branch, not
            // `nothingHappened` — `TOOL_CALL_NOTHING` is passed only because `resolve` requires it.
          settle(p, outcome, reason);
          pending = null;
          p = ensurePending(); // fresh pending for this turn's own content, identity assigned below
        }
        p.lastT = Math.max(p.lastT, ev.t);
        if (p.id === null) {
          p.id = ev.id;
          p.askedAt = ev.t; // settle-adjacent, not a true open time — see the file-header C1 note
          p.request = ev.request;
          closeUndoWindow(); // a new utterance ends any pending undo window from a PRIOR attempt
        }
        p.turns += 1;
        // The most recent turn's own settlement span. For a `rejected`-then-boundary-close
        // resolution (rule 5, no retry) this is captured HERE, before the window later closes at
        // `closeAtBoundary` with no turn event of its own to source it from — `ack()` always calls
        // `closeTurn` with a real `settledAt`, success or failure alike, so a rejected exchange's
        // turn is genuinely settled even though `decided` stays null until the boundary.
        p.settledMs = ev.settledMs;
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
        let p = ensurePending();
        p.sawAction = true;
        p.lastT = Math.max(p.lastT, ev.t);
        // C3 fix (fix round 4, reviewer-flagged "cross-exchange contamination"): round 3's split
        // (below, Case A) was only honest when NO settling `turn` event had fired for this pending
        // since the rejection — i.e. that really was the same still-open, never-yet-identified
        // window the rejection itself opened. `p.turns > 0` here means the rejection's OWN turn had
        // ALREADY settled: the shape guard 1 (in the `turn` case above) exists to catch is reject →
        // its turn (tool_call, nothing else decided, pending stays open) → a completely SEPARATE
        // ordinary exchange's commit arrives here. THE ROUND-3 BUG (now fixed by Case B below, not
        // still present): guard 1 only fires on a SECOND `turn` event, but round 3's `action` case
        // set `p.rejectedPending = false` unconditionally on any commit (a few lines down), and per
        // the file-header ORDERING DISCOVERY an action precedes its own turn — so that unconditional
        // clear ran BEFORE the separate exchange's own turn event ever arrived, and guard 1 never got
        // the chance: by the time that turn arrived, the window already looked "decided", and it
        // silently piled its identity/turns/duration onto the stale pending — contaminating a CORRECT
        // refusal record and discarding the real, available identity of the second exchange. Case B
        // below is what closes that gap: it is guard 1's seal, just triggered by the signal that
        // actually arrives first on this shape (the commit) rather than the second `turn` event guard
        // 1 waits for. It seals the rejection immediately, using `p.turns`/`p.settledMs` exactly as
        // they stand — reflecting only the rejection's own settled turn, because (as argued above) no
        // second turn can have touched `p` yet: guard 1 would have already sealed and reset it the
        // moment one arrived, so by the time ANY `action` event reaches here with `rejectedPending`
        // still true, at most the rejection's own turn has touched `p`. Then open a fresh pending for
        // this commit — it gets its own real identity from its own, still-to-come `turn` event,
        // exactly like any ordinary exchange; no `-split` placeholder needed here, because (unlike
        // Case A) a real identity genuinely exists and simply hasn't arrived yet.
        if (ev.decision === 'commit' && p.rejectedPending && ev.verb !== p.rejectedVerb && p.turns > 0) {
          const { outcome, reason } = resolve(p, TOOL_CALL_NOTHING); // sawAction is true (the
            // rejection itself), so this always resolves via the `rejectedPending` branch.
          settle(p, outcome, reason);
          pending = null;
          p = ensurePending(); // fresh pending for this commit — re-stamp what the top of this
                                // case already stamped on the now-sealed old `p`
          p.sawAction = true;
          p.lastT = Math.max(p.lastT, ev.t);
        }
        p.verb = ev.verb;
        if (ev.decision === 'witness') {
          p.witnessed = true;
          // Double-count guard (spec §5.5): witness never closes the boundary by itself — the
          // commit that follows for the same action is what does. One attempt, not two.
        } else if (ev.decision === 'commit') {
          // C1 fix (fix round 2, reviewer-flagged "vanishing refusal"): the carve-out below only
          // supersedes a PENDING rejection for a genuine same-verb retry — same window (no `turn`
          // event has intervened; see the guard at the top of the `turn` case above, which is the
          // primary defence and handles the far more common cross-turn case), same verb. Before
          // this fix, ANY commit — for ANY verb — cleared `rejectedPending` unconditionally, so an
          // unrelated success arriving later in the SAME still-open window (spec §2: "nested tool
          // calls belong to the open attempt" — a second, unrelated tool call within one exchange)
          // could also silently erase a real refusal, one step later than the turn-event case.
          //
          // C2 fix (fix round 3, reviewer-flagged "vanished success"): round 2's version of this
          // branch stopped at "a same-window commit for a different verb is not a retry" and threw
          // the commit away with a bare `break` — correct that it wasn't a retry, wrong that it was
          // therefore nothing. It is a real commit, and dropping its effect on the floor is the
          // MIRROR of C1 (a real outcome credited nowhere instead of a real refusal erased) — spec
          // §2's "mark ungradeable rather than guessing" forbids guessing AND forbids silence; this
          // branch was doing neither loudly, which is its own kind of wrong. Fix: don't discard —
          // remember the rejected verb (`splitRejectedVerb`) and let THIS commit decide `p.decided`
          // normally below, same as any other commit. `settle()` (see its own comment) is what
          // turns a window with `splitRejectedVerb` set into TWO attempts once it resolves: the
          // rejection, and this commit's own outcome. Unlike guard 1's cross-turn seal, this does
          // NOT eagerly push a record here — there is no second `turn` event yet to supply this
          // commit its own identity, so both halves stay pending together until one arrives.
          //
          // C3 fix (fix round 4): this branch is now ONLY reachable in the `p.turns === 0` shape —
          // Case B above already sealed-and-reset the `p.turns > 0` shape before this line ever
          // runs, so `p.rejectedPending` is guaranteed false here whenever Case B fired. The check
          // below is therefore exactly Case A: a genuine same-window, no-turn-yet mismatch.
          if (p.rejectedPending && ev.verb !== p.rejectedVerb) {
            p.splitRejectedVerb = p.rejectedVerb;
          }
          p.rejectedPending = false; // either a genuine same-verb retry, or (see above) a
                                      // same-window unrelated commit that `settle()` will split —
                                      // either way this window is no longer "awaiting a retry"
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
          p.rejectedVerb = ev.verb;
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
          // happened to be edited. STICKY BY CONSTRUCTION (fix round 1, I1): this branch only ever
          // sets `a.outcome = 'wrong'`, never un-sets it — a LATER correction in the same window
          // with `overAgent: false` (a plain ramble edit, not a further undo) still increments
          // `corrections` but cannot flip a `wrong` verdict back to whatever it was before. A
          // "last correction wins" rewrite (recomputing `outcome` from just the newest correction
          // on every event) would silently un-convict an undone commit — see
          // deriveAttempts.test.ts's two-corrections-one-window test, written specifically to fail
          // under that rewrite.
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
               // pin, combine_tray, artifact_created, eval_card, eval_deck_abandoned (R4, fix
               // round 4: added — it landed in the same commit as the `shell_switch` move below and
               // was left out of a list that reads as exhaustive; like `eval_card` it records what
               // the DECK did, never how an attempt graded). `shell_switch` moved OUT of this
               // list (fix round 3, P2) — it has its own case above; it carries no GRADING signal
               // either, but it does carry an arm-attribution one, which is why it is no longer
               // lumped in as inert. `eval_card` in particular is a
               // deliberate no-op here: it records which TRIAL was run and how the deck graded it,
               // which must never feed back into how this module grades the attempt — the deck
               // reads deriveAttempts (via the scorecard), not the other way round.
    }
  }

  closeAtBoundary(); // session end
  return attempts;
}
