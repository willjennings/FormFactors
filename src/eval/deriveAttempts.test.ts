/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { deriveAttempts } from './deriveAttempts';
import { DEFAULT_DIALS } from '../register/registry';
import type { TelemetryEvent, Arm, SessionConfig } from '../telemetry';

// ---- fixture builders: real TelemetryEvent shapes, nothing invented ----------------------
//
// FIXTURE DISCIPLINE (fix round 1, C1): real streams stamp EVERY event's `t` via
// `telemetry.push`'s own `Date.now() - startedAt` at call time, and `telemetry.turn()` is called
// with no `t` argument (App.tsx never passes the turn's true open time through) — so a turn
// event's exported `t` is close to SETTLEMENT time, same clock family as the `action` event that
// resolved it, and typically slightly LATER (verified live by the round-1 reviewer: `action()`,
// a busy-wait, then `turn()` — the turn's exported `t` came out later). Every fixture below stamps
// `turn.t >= action.t` for that reason. The true open-to-settle span lives in `turn.settledMs`
// (computed inside turns.ts from the real open time, before it is lost on export) — fixtures pass
// it explicitly wherever `durationMs` is asserted.

const ARM: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };

const cfg = (program = 'word', arm: Arm | undefined = ARM): SessionConfig => ({
  backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program, honest: false,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop', ua: '' },
  arm,
});

const sessionStart = (t: number, program = 'word', arm: Arm | undefined = ARM): TelemetryEvent =>
  ({ t, type: 'session_start', config: cfg(program, arm) });

const turn = (
  t: number, id: string, request: string,
  outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost',
  firstResponseMs: number | null = 50, settledMs: number | null = null,
): TelemetryEvent => ({ t, type: 'turn', id, modality: 'voice', request, outcome, firstResponseMs, settledMs });

const action = (
  t: number, verb: string, decision: 'commit' | 'witness' | 'rejected', verbClass = 'mutate',
): TelemetryEvent => ({ t, type: 'action', verb, verbClass, decision, modality: 'voice' });

const correction = (t: number, overAgent?: boolean, slotId?: string): TelemetryEvent =>
  ({ t, type: 'correction', slotId, overAgent });

const ask = (t: number, field: string, answered: boolean, viaChip = false): TelemetryEvent =>
  ({ t, type: 'unspecified_ask', field, answered, viaChip });

// ==========================================================================================
// Rule 1 — boundary: opens on a turn, closes on commit; durationMs sourced from settledMs only
// ==========================================================================================
describe('rule 1 — attempt boundary', () => {
  it('askedAt comes from the turn event; durationMs comes from turn.settledMs, not from any t arithmetic', () => {
    const events = [
      sessionStart(0),
      action(180, 'set_heading', 'commit'), // arrives first in array order (ack fires after telemetry.action)
      turn(185, 't1', 'add a heading', 'tool_call', 50, 40), // turn.t >= action.t; settledMs is turns.ts's own true open-to-settle computation
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].askedAt).toBe(185);
    expect(attempts[0].durationMs).toBe(40); // from settledMs, NOT (turn.t - askedAt) — see C1
    expect(attempts[0].id).toBe('t1');
    expect(attempts[0].request).toBe('add a heading');
  });

  it('C1: durationMs is correct even when turn.t is far from any plausible open time — the exported t is settle-adjacent and must never be used for duration math', () => {
    // Under the OLD (reverted) implementation, durationMs was `lastT - askedAt`, both sourced from
    // exported `t`s that sit right next to each other in real time — here they are made to sit far
    // apart on purpose (50000 vs 50010) to prove the point either way: the old code would have
    // returned ~10 (or 0, since askedAt IS turn.t); the correct code returns exactly `settledMs`,
    // independent of how close or far the raw `t`s happen to be.
    const events = [
      sessionStart(0),
      action(50000, 'set_heading', 'commit'),
      turn(50010, 't1', 'add a heading', 'tool_call', 50, 37),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].durationMs).toBe(37);
  });

  it('durationMs stays null when no turn ever settled the window (a boundary close with no settlement to source)', () => {
    const events = [
      sessionStart(0),
      action(100, 'do_the_impossible', 'rejected'),
      turn(105, 't1', 'do the impossible thing', 'tool_call', 50, 60), // this turn DID settle (an ack always fires)...
      sessionStart(9999), // ...but a witness-only window with no settling turn at all stays null:
      action(9100, 'set_heading', 'witness'),
      // no turn event at all for this second window — session ends with nothing to source from
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].durationMs).toBe(60); // the rejected exchange's own ack DID settle its turn
    expect(attempts[1].durationMs).toBeNull(); // no turn event ever arrived for the witness-only window
  });
});

// ==========================================================================================
// Rule 2 — the undo-makes-it-wrong rule: THE single most important test in the file
// ==========================================================================================
describe('rule 2 — commit reversed by a correction (overAgent) → wrong', () => {
  it('a commit followed by a reversing correction, in-window, grades wrong — not completed', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
      correction(150, true), // the user undid it
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('wrong');
    expect(attempts[0].undos).toBe(1);
    expect(attempts[0].corrections).toBe(1);
  });

  it('a NON-reversing correction after commit (overAgent false/absent) does not flip the outcome', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
      correction(150), // a ramble edit, not blaming the agent
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('completed');
    expect(attempts[0].undos).toBe(0);
    expect(attempts[0].corrections).toBe(1); // still counted as a correction touching the attempt
  });

  it('I1: sticky — a reversing correction followed by a LATER non-reversing one in the same window does NOT un-flip wrong back to completed', () => {
    // Written to fail under a "last correction wins" rewrite (recomputing outcome from only the
    // most recent correction on every event, rather than a one-way flip): that mutation un-convicts
    // an undone commit the moment a second, unrelated edit lands in the same window — the exact
    // §5.2 anti-flattery violation rule 2 exists to prevent.
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
      correction(150, true),  // undo #1 — flips to wrong
      correction(200, false), // an unrelated later edit — must NOT un-flip it
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('wrong'); // stays wrong
    expect(attempts[0].undos).toBe(1); // only the reversing correction counts as an undo
    expect(attempts[0].corrections).toBe(2); // both corrections are counted
  });

  it('the undo window closes at the next new utterance: a correction after that belongs to nothing gradeable', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
      turn(200, 't2', 'sum this column', 'no_response'), // a genuinely new utterance closes the undo window
      correction(250, true), // arrives too late to convict t1's commit
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].outcome).toBe('completed'); // never flipped
    expect(attempts[0].undos).toBe(0);
    expect(attempts[1].outcome).toBe('abandoned');
  });
});

// ==========================================================================================
// Rule 3 — corrected
// ==========================================================================================
describe('rule 3 — a correction precedes the commit, not reversed → corrected', () => {
  it('grades corrected, not completed', () => {
    const events = [
      sessionStart(0),
      turn(100, 't1', 'add heading Quarterly', 'tool_call'), // opened fresh; nothing decided yet
      correction(150), // pre-commit correction
      action(200, 'set_heading', 'commit'), // decided here; the turn already supplied identity — session end flushes it
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('corrected');
    expect(attempts[0].corrections).toBe(1);
    expect(attempts[0].undos).toBe(0);
  });
});

// ==========================================================================================
// Rule 4 — clean commit → completed
// ==========================================================================================
describe('rule 4 — clean commit, no correction, no ask → completed', () => {
  it('grades completed', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('completed');
    expect(attempts[0].verb).toBe('set_heading');
    expect(attempts[0].witnessed).toBe(false);
  });
});

// ==========================================================================================
// Rule 5 — refused-honestly, and its "no successful retry" carve-out
// ==========================================================================================
describe('rule 5 — {error} refusal (action decision: rejected)', () => {
  it('no successful retry → refused-honestly (a refusal is never a failure)', () => {
    const events = [
      sessionStart(0),
      action(100, 'do_the_impossible', 'rejected'),
      turn(105, 't1', 'do the impossible thing', 'tool_call', 50, 20),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('refused-honestly');
    expect(attempts[0].verb).toBe('do_the_impossible');
  });

  it('a successful retry in the same window supersedes the rejection — grades on the retry, not refused-honestly', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'rejected'),
      turn(105, 't1', 'set the heading', 'tool_call', 50, 20),
      action(150, 'set_heading', 'commit'), // the retry
      turn(155, 't2', 'set the heading, retry', 'tool_call', 50, 25),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1); // one attempt, not two — the retry continues it
    expect(attempts[0].outcome).toBe('completed');
    expect(attempts[0].turns).toBe(2);
  });

  // ========================================================================================
  // C1 (fix round 2, reviewer-flagged) — the vanishing refusal. Reviewer's exact probe: a
  // rejected insert_object, then later an UNRELATED unspecified_ask + commit for set_heading.
  // Before the fix, the rejection vanished entirely and the unrelated success inherited the
  // rejected request's verbatim text: ONE attempt, `{ outcome: 'asked-and-answered', verb:
  // 'set_heading', request: 'insert a chart' }`. The ledger built over that list produced zero
  // refusal rows and the aggregate credited 100% ask success — exactly the failure mode §3/§5
  // exist to prevent, reproduced inside the artefact built to prevent it.
  // ========================================================================================
  it('C1 — a rejection followed by an UNRELATED ask+commit (a new utterance, its own turn event) yields TWO attempts, not one: refused-honestly (verbatim) + asked-and-answered', () => {
    const events = [
      sessionStart(0, 'excel'),
      action(100, 'insert_object', 'rejected'),
      turn(105, 't1', 'insert a chart', 'tool_call', 50, 20), // the rejected exchange's own settling turn
      turn(140, 't2', 'add a heading saying Q1 Results', 'tool_call', 50, 25), // a NEW utterance's own turn — this is the signal that seals the rejection
      ask(145, 'heading', true),
      action(150, 'set_heading', 'commit'), // unrelated verb — must NOT supersede the sealed rejection
      turn(155, 't3', 'call it Q1 Results', 'tool_call', 50, 30),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ id: 't1', request: 'insert a chart', verb: 'insert_object', outcome: 'refused-honestly' });
    expect(attempts[1]).toMatchObject({ id: 't2', request: 'add a heading saying Q1 Results', verb: 'set_heading', outcome: 'asked-and-answered' });
  });

  it('C1 defence-in-depth — same window (no intervening turn), a commit for an UNRELATED verb does not supersede the rejection either', () => {
    // No `turn` event at all between the rejection and the unrelated commit: the same-verb-match
    // guard on the `action` case is what has to catch this one (the turn-event guard above never
    // fires, because no second turn ever arrives to trigger it). There is no boundary here to
    // honestly split the single verbatim request into two attempts, so the unrelated commit's
    // effects are simply not credited — the rejection stands.
    const events = [
      sessionStart(0, 'powerpoint'),
      action(100, 'insert_object', 'rejected'),
      action(110, 'set_heading', 'commit'), // unrelated verb, same window, no turn in between
      turn(115, 't1', 'insert a chart', 'tool_call', 50, 20),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('refused-honestly');
    expect(attempts[0].verb).toBe('insert_object'); // not 'set_heading' — the unrelated commit never wins
  });
});

// ==========================================================================================
// Rule 6 — unspecified_ask: answered→commit = asked-and-answered; unanswered = asked-and-dropped
// ==========================================================================================
describe('rule 6 — unspecified_ask', () => {
  it('answered, then a commit lands → asked-and-answered', () => {
    const events = [
      sessionStart(0),
      turn(100, 't1', 'set the heading', 'tool_call', 50, 15), // the gate asks; no `action` event for ask_content itself
      ask(150, 'heading', true),
      action(250, 'set_heading', 'commit'),
      turn(255, 't2', 'Quarterly Report', 'tool_call', 50, 20), // the user's answer, relayed
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('asked-and-answered');
    expect(attempts[0].turns).toBe(2);
    expect(attempts[0].request).toBe('set the heading'); // verbatim FIRST utterance, not the answer
  });

  it('never answered → asked-and-dropped, itself a boundary closer', () => {
    const events = [
      sessionStart(0),
      turn(100, 't1', 'set the heading', 'tool_call', 50, 15),
      ask(150, 'heading', false),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('asked-and-dropped');
    expect(attempts[0].turns).toBe(1);
  });

  it('answered but no commit ever lands before the boundary → abandoned, not asked-and-answered', () => {
    const events = [
      sessionStart(0),
      turn(100, 't1', 'set the heading', 'tool_call', 50, 15),
      ask(150, 'heading', true),
      // session ends with no commit
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('abandoned');
  });
});

// ==========================================================================================
// Rule 7 — the survivorship fix: speech_only/no_response with no attempt events → abandoned
// ==========================================================================================
describe('rule 7 — abandoned', () => {
  it('speech_only with nothing else attached grades abandoned outright, not ungradeable', () => {
    const events = [sessionStart(0), turn(100, 't1', 'what does this button do', 'speech_only')];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('abandoned');
    expect(attempts[0].ungradeableReason).toBeNull();
  });

  it('no_response with nothing else attached also grades abandoned', () => {
    const events = [sessionStart(0), turn(100, 't1', 'sum this column', 'no_response')];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('abandoned');
  });
});

// ==========================================================================================
// Rule 8 — transcription_lost → ungradeable, with reason
// ==========================================================================================
describe('rule 8 — transcription_lost', () => {
  it('grades ungradeable with reason transcription-lost', () => {
    const events = [sessionStart(0), turn(100, 't1', '[unintelligible]', 'transcription_lost', null, null)];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[0].ungradeableReason).toBe('transcription-lost');
  });

  it('transcription_lost on a later turn still closes an in-progress attempt as ungradeable (never guessed onto whatever was pending)', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'witness'),
      turn(105, 't1', 'set the heading', 'tool_call', 50, 25),
      turn(200, 't2', '[dropped audio]', 'transcription_lost', null, null),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[0].ungradeableReason).toBe('transcription-lost');
  });
});

// ==========================================================================================
// Rule 9 — ambiguous boundary → ungradeable, never guessed
// ==========================================================================================
describe('rule 9 — ambiguous boundary', () => {
  it('a witness nobody confirmed, session ends → ungradeable, reason ambiguous-boundary (never guessed as abandoned)', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'witness'),
      turn(105, 't1', 'set the heading', 'tool_call', 50, 25),
      // session ends: witnessed, but no commit and no other signal
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[0].ungradeableReason).toBe('ambiguous-boundary');
  });

  it('a tool_call turn with no matching action event at all → ungradeable, reason tool-call-without-action (not completed, not abandoned)', () => {
    const events = [sessionStart(0), turn(100, 't1', 'do the thing', 'tool_call')];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[0].ungradeableReason).toBe('tool-call-without-action');
  });
});

// ==========================================================================================
// Required discriminating test 1 — the flattery test
// ==========================================================================================
describe('the flattery test', () => {
  it('a session of only honest refusals + answered asks has zero wrong/abandoned', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      action(50, 'do_the_impossible', 'rejected'),
      turn(55, 't1', 'do the impossible thing', 'tool_call', 50, 10),
      sessionStart(1000), // a second session boundary — closes the refusal cleanly before the next exchange
      turn(1100, 't2', 'set the heading', 'tool_call', 50, 15),
      ask(1150, 'heading', true),
      action(1250, 'set_heading', 'commit'),
      turn(1255, 't3', 'Quarterly Report', 'tool_call', 50, 20),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts.map(a => a.outcome)).toEqual(['refused-honestly', 'asked-and-answered']);
    const failureLike = attempts.filter(a => a.outcome === 'wrong' || a.outcome === 'abandoned');
    expect(failureLike).toHaveLength(0); // the doctrine, in one assertion
  });
});

// ==========================================================================================
// Required discriminating test 2 — the direction test, pinned numerically
// ==========================================================================================
describe('the direction test', () => {
  const completionRate = (attempts: ReturnType<typeof deriveAttempts>) =>
    attempts.filter(a => a.outcome === 'completed').length / attempts.length;

  it('adding two speech_only turns to a fixed session LOWERS completion rate', () => {
    const base: TelemetryEvent[] = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 20),
      action(300, 'sum_column', 'commit'),
      turn(305, 't2', 'sum this column', 'tool_call', 50, 20),
    ];
    const withNoise: TelemetryEvent[] = [
      ...base,
      turn(500, 't3', 'what does this do', 'speech_only'),
      turn(600, 't4', 'never mind', 'no_response'),
    ];
    const baseAttempts = deriveAttempts(base);
    const noisyAttempts = deriveAttempts(withNoise);
    expect(baseAttempts).toHaveLength(2);
    expect(noisyAttempts).toHaveLength(4);
    expect(completionRate(baseAttempts)).toBe(1); // 2/2
    expect(completionRate(noisyAttempts)).toBe(0.5); // 2/4 — pinned, not just "lower"
    expect(completionRate(noisyAttempts)).toBeLessThan(completionRate(baseAttempts));
  });
});

// ==========================================================================================
// Required discriminating test 3 — the double-count guard
// ==========================================================================================
describe('the double-count guard', () => {
  it('a witnessed-then-confirmed action (witness THEN commit for the same action) is ONE attempt, not two', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'witness'), // the witness card is shown
      action(150, 'set_heading', 'commit'),  // the user confirms it — same exchange, no new turn in between
      turn(155, 't1', 'set the heading', 'tool_call', 50, 40),
    ];
    const attempts = deriveAttempts(events);
    // DECISION (as ordered): a witness never closes the boundary by itself — only the commit that
    // follows for the same action does, so witness+commit collapses to ONE attempt, marked witnessed.
    expect(attempts).toHaveLength(1);
    expect(attempts[0].witnessed).toBe(true);
    expect(attempts[0].outcome).toBe('completed');
  });
});

// ==========================================================================================
// Required discriminating test 4 — re-derivation determinism
// ==========================================================================================
describe('determinism', () => {
  it('the same events produce deep-equal attempts on repeated derivation, and the input is never mutated', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 20),
      correction(150, true),
      turn(300, 't2', 'what does this do', 'speech_only'),
      action(500, 'do_x', 'rejected'),
      turn(505, 't3', 'do x', 'tool_call', 50, 15),
    ];
    const snapshot = JSON.parse(JSON.stringify(events));
    const first = deriveAttempts(events);
    const second = deriveAttempts(events);
    expect(second).toEqual(first);
    expect(events).toEqual(snapshot); // input array/objects untouched
  });
});

// ==========================================================================================
// Supporting structural tests: arm/program passthrough, ordering robustness
// ==========================================================================================
describe('arm and program passthrough', () => {
  it('carries program + arm from session_start.config; no session_start yields undefined, never a guessed default', () => {
    const events = [
      sessionStart(0, 'excel', ARM),
      action(100, 'set_cell', 'commit'),
      turn(105, 't1', 'set A1 to 5', 'tool_call', 50, 20),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].program).toBe('excel');
    expect(attempts[0].arm).toBe(ARM);

    const noSession = [action(100, 'set_cell', 'commit'), turn(105, 't1', 'set A1 to 5', 'tool_call', 50, 20)];
    const attemptsNoSession = deriveAttempts(noSession);
    expect(attemptsNoSession[0].program).toBeUndefined();
    expect(attemptsNoSession[0].arm).toBeUndefined();
  });

  it('a program swap (a second session_start) closes whatever was pending honestly rather than merging it into the new program', () => {
    const events = [
      sessionStart(0, 'word'),
      action(100, 'set_heading', 'witness'), // pending, nothing else — would be ambiguous at session end
      turn(105, 't1', 'set the heading', 'tool_call', 50, 25),
      sessionStart(500, 'excel'), // program swap
      action(600, 'set_cell', 'commit'),
      turn(605, 't2', 'set A1 to 5', 'tool_call', 50, 20),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].program).toBe('word');
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[1].program).toBe('excel');
    expect(attempts[1].outcome).toBe('completed');
  });
});

describe('ordering robustness', () => {
  it('grades identically whether the turn event or its resolving action arrives first in array order', () => {
    const actionThenTurn: TelemetryEvent[] = [
      sessionStart(0),
      action(180, 'set_heading', 'commit'),
      turn(185, 't1', 'add a heading', 'tool_call', 50, 40),
    ];
    const turnThenAction: TelemetryEvent[] = [
      sessionStart(0),
      turn(185, 't1', 'add a heading', 'tool_call', 50, 40),
      action(180, 'set_heading', 'commit'),
    ];
    const a = deriveAttempts(actionThenTurn);
    const b = deriveAttempts(turnThenAction);
    expect(a).toEqual(b);
    expect(a[0].durationMs).toBe(40);
  });
});
