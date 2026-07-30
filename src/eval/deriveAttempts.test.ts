/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { deriveAttempts } from './deriveAttempts';
import { DEFAULT_DIALS } from '../register/registry';
import type { TelemetryEvent, Arm, SessionConfig } from '../telemetry';

// ---- fixture builders: real TelemetryEvent shapes, nothing invented ----------------------

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
// Rule 1 — boundary: opens on a turn, closes on commit; askedAt/durationMs from real `t`s only
// ==========================================================================================
describe('rule 1 — attempt boundary', () => {
  it('askedAt is the turn\'s own open time; durationMs spans to the resolving action, using the MAX t seen (real streams push `action` before its own `turn` event)', () => {
    const events = [
      sessionStart(0),
      action(180, 'set_heading', 'commit'), // arrives first in array order (ack fires after telemetry.action)
      turn(120, 't1', 'add a heading', 'tool_call'), // turn.t is its OWN open time — earlier than the action that resolved it
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].askedAt).toBe(120);
    expect(attempts[0].durationMs).toBe(60); // 180 - 120, not corrupted by the turn event's own (earlier) t
    expect(attempts[0].id).toBe('t1');
    expect(attempts[0].request).toBe('add a heading');
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
      turn(90, 't1', 'add a heading', 'tool_call'),
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
      turn(90, 't1', 'add a heading', 'tool_call'),
      correction(150), // a ramble edit, not blaming the agent
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('completed');
    expect(attempts[0].undos).toBe(0);
    expect(attempts[0].corrections).toBe(1); // still counted as a correction touching the attempt
  });

  it('the undo window closes at the next new utterance: a correction after that belongs to nothing gradeable', () => {
    const events = [
      sessionStart(0),
      action(100, 'set_heading', 'commit'),
      turn(90, 't1', 'add a heading', 'tool_call'),
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
      turn(90, 't1', 'add a heading', 'tool_call'),
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
      turn(90, 't1', 'do the impossible thing', 'tool_call'),
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
      turn(90, 't1', 'set the heading', 'tool_call'),
      action(150, 'set_heading', 'commit'), // the retry
      turn(140, 't2', 'set the heading, retry', 'tool_call'),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts).toHaveLength(1); // one attempt, not two — the retry continues it
    expect(attempts[0].outcome).toBe('completed');
    expect(attempts[0].turns).toBe(2);
  });
});

// ==========================================================================================
// Rule 6 — unspecified_ask: answered→commit = asked-and-answered; unanswered = asked-and-dropped
// ==========================================================================================
describe('rule 6 — unspecified_ask', () => {
  it('answered, then a commit lands → asked-and-answered', () => {
    const events = [
      sessionStart(0),
      turn(100, 't1', 'set the heading', 'tool_call'), // the gate asks; no `action` event for ask_content itself
      ask(150, 'heading', true),
      action(250, 'set_heading', 'commit'),
      turn(240, 't2', 'Quarterly Report', 'tool_call'), // the user's answer, relayed
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
      turn(100, 't1', 'set the heading', 'tool_call'),
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
      turn(100, 't1', 'set the heading', 'tool_call'),
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
      turn(90, 't1', 'set the heading', 'tool_call'),
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
      turn(90, 't1', 'set the heading', 'tool_call'),
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
      turn(40, 't1', 'do the impossible thing', 'tool_call'),
      sessionStart(1000), // a second session boundary — closes the refusal cleanly before the next exchange
      turn(1100, 't2', 'set the heading', 'tool_call'),
      ask(1150, 'heading', true),
      action(1250, 'set_heading', 'commit'),
      turn(1240, 't3', 'Quarterly Report', 'tool_call'),
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
      turn(90, 't1', 'add a heading', 'tool_call'),
      action(300, 'sum_column', 'commit'),
      turn(290, 't2', 'sum this column', 'tool_call'),
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
      turn(90, 't1', 'set the heading', 'tool_call'),
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
      turn(90, 't1', 'add a heading', 'tool_call'),
      correction(150, true),
      turn(300, 't2', 'what does this do', 'speech_only'),
      action(500, 'do_x', 'rejected'),
      turn(490, 't3', 'do x', 'tool_call'),
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
      turn(90, 't1', 'set A1 to 5', 'tool_call'),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].program).toBe('excel');
    expect(attempts[0].arm).toBe(ARM);

    const noSession = [action(100, 'set_cell', 'commit'), turn(90, 't1', 'set A1 to 5', 'tool_call')];
    const attemptsNoSession = deriveAttempts(noSession);
    expect(attemptsNoSession[0].program).toBeUndefined();
    expect(attemptsNoSession[0].arm).toBeUndefined();
  });

  it('a program swap (a second session_start) closes whatever was pending honestly rather than merging it into the new program', () => {
    const events = [
      sessionStart(0, 'word'),
      action(100, 'set_heading', 'witness'), // pending, nothing else — would be ambiguous at session end
      turn(90, 't1', 'set the heading', 'tool_call'),
      sessionStart(500, 'excel'), // program swap
      action(600, 'set_cell', 'commit'),
      turn(590, 't2', 'set A1 to 5', 'tool_call'),
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
      turn(120, 't1', 'add a heading', 'tool_call'),
    ];
    const turnThenAction: TelemetryEvent[] = [
      sessionStart(0),
      turn(120, 't1', 'add a heading', 'tool_call'),
      action(180, 'set_heading', 'commit'),
    ];
    const a = deriveAttempts(actionThenTurn);
    const b = deriveAttempts(turnThenAction);
    expect(a).toEqual(b);
  });
});
