/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  EVAL_DECK, deckReduce, initialDeckState, currentCard, isDeckComplete, isAbandoned, wasAbandoned, deckTally, deckTallyOf,
  type DeckState, type EvalCard,
} from './deck';
import { UTTERANCES, utteranceFor } from './utterances';
import { DEFAULT_DIALS } from '../register/registry';
import type { TelemetryEvent, Arm, SessionConfig, InputModality } from '../telemetry';

// ---- fixture builders: real TelemetryEvent shapes, nothing invented -----------------------
// Same discipline as deriveAttempts.test.ts: an `action` for an exchange precedes the `turn` event
// that reports it in ARRAY order (App's ack() calls telemetry.action before closing the turn), so
// every fixture below that pairs the two writes them in that order.

const ARM: Arm = { register: 'guided', dials: DEFAULT_DIALS, shell: 'familiar' };
const cfg = (program = 'excel'): SessionConfig => ({
  backend: 'gemini', autonomy: 'auto-safe', feedback: 'earcon', program, honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop', ua: '' },
  arm: ARM,
});
const sessionStart = (t: number): TelemetryEvent => ({ t, type: 'session_start', config: cfg() });

const deixis = (
  t: number, keyword: string, resolved: string | null, modality: InputModality = 'voice',
): TelemetryEvent => ({ t, type: 'deixis', keyword, resolved, target: null, confidence: 'high', correct: null, modality });

const turn = (
  t: number, id: string, request: string,
  outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost',
  firstResponseMs: number | null = 50, settledMs: number | null = 400,
): TelemetryEvent => ({ t, type: 'turn', id, modality: 'voice', request, outcome, firstResponseMs, settledMs });

const action = (
  t: number, verb: string, decision: 'commit' | 'witness' | 'rejected',
  modality: InputModality = 'voice', verbClass = 'mutate',
): TelemetryEvent => ({ t, type: 'action', verb, verbClass, decision, modality });

const correction = (t: number, overAgent?: boolean): TelemetryEvent =>
  ({ t, type: 'correction', overAgent });
const ask = (t: number, field: string, answered: boolean): TelemetryEvent =>
  ({ t, type: 'unspecified_ask', field, answered, viaChip: false });
const pin = (t: number, artifactId?: string, error?: string): TelemetryEvent =>
  ({ t, type: 'pin', cardType: 'answer', artifactId, error });
const combine = (t: number, count: number, kind: string, ok: boolean): TelemetryEvent =>
  ({ t, type: 'combine_tray', count, kind, ok });
const artifact = (t: number, kind: string, sources: number, error?: string): TelemetryEvent =>
  ({ t, type: 'artifact_created', kind, sources, via: 'combine', error });

const card = (id: string): EvalCard => {
  const c = EVAL_DECK.find((x) => x.id === id);
  if (!c) throw new Error(`no such card: ${id}`);
  return c;
};

/** Every card fixture below is built as [PRE-card events, …, card events] and observed with a
 *  baseline equal to the PRE length. That shape is deliberate: it is what makes each test also a
 *  run-baselining test — the PRE half always contains events that WOULD satisfy the card if the
 *  baseline were ignored, so breaking the baseline (observing from index 0) makes these fail. */
const PRE: TelemetryEvent[] = [
  sessionStart(0),
  deixis(10, 'number', 'Cell B4', 'direct'),
  action(20, 'edit_content', 'commit', 'typed'),
  turn(25, 'pre-1', 'change this to 9', 'tool_call', 40, 300),
  action(30, 'set_heading', 'rejected'),
  ask(35, 'heading', true),
  correction(40, true),
  pin(45, 'art-pre'),
  combine(50, 2, 'doc', true),
  artifact(55, 'doc', 2),
];
/** A turn carrying a request that ALREADY appears in PRE — the "stale exchange" shape the fresh-turn
 *  rule exists to reject (fix round 1, I3): a turn left open across the advance closes inside the new
 *  card's window still carrying the previous card's words. */
const staleTurn = (t: number) => turn(t, 'pre-1-reopened', 'change this to 9', 'tool_call', 40, 300);
const observeWith = (id: string, tail: TelemetryEvent[]) =>
  card(id).observe([...PRE, ...tail], PRE.length);

// ==========================================================================================
// Deck shape
// ==========================================================================================
describe('EVAL_DECK shape (design spec §4b)', () => {
  it('is twelve cards in a pinned order — two cards\' copy cites an earlier card by NUMBER', () => {
    expect(EVAL_DECK).toHaveLength(12);
    expect(EVAL_DECK.map((c) => c.id)).toEqual([
      'point-what-is-this', 'point-then-change', 'point-by-number',
      'honest-refusal', 'honest-ambiguity',
      'robust-rephrase', 'robust-own-words', 'robust-undo',
      'latency-round-trip',
      'material-pin', 'material-combine',
      'either-input',
    ]);
    // The cards that say "card 2" must actually follow card 2 (index 1 = "Card 2 of 12").
    expect(EVAL_DECK[1].id).toBe('point-then-change');
    for (const id of ['robust-rephrase', 'either-input']) {
      expect(card(id).instruction).toContain('card 2');
      expect(EVAL_DECK.findIndex((c) => c.id === id)).toBeGreaterThan(1);
    }
  });
  it('covers every dimension with the required minimums', () => {
    const n = (d: string) => EVAL_DECK.filter((c) => c.dimension === d).length;
    expect(n('pointing')).toBeGreaterThanOrEqual(2);
    expect(n('honesty')).toBeGreaterThanOrEqual(2);
    expect(n('robustness')).toBeGreaterThanOrEqual(2);
    expect(n('latency')).toBeGreaterThanOrEqual(1);
    expect(n('material')).toBeGreaterThanOrEqual(2);
    expect(n('pointing') + n('honesty') + n('robustness') + n('latency') + n('material')).toBe(12);
  });
  it('every instruction is imperative plain copy, at most two sentences, no spec vocabulary', () => {
    for (const c of EVAL_DECK) {
      expect(c.instruction.length).toBeGreaterThan(20);
      // ≤2 sentences: count terminators, tolerating the apostrophe/quote forms in the copy.
      const sentences = c.instruction.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
      expect(sentences.length).toBeLessThanOrEqual(2);
      // Participant-facing copy must not leak the machinery's words.
      expect(c.instruction).not.toMatch(/telemetry|predicate|arm|register|baseline|observe/i);
    }
  });
  it('the honesty-refusal card says a refusal is the system working (spec §4b)', () => {
    expect(card('honest-refusal').instruction).toMatch(/refusal here is the system working/);
  });
  it('the own-words robustness card carries no utteranceKey; only the TOTAL-predicate cards refuse a self-grade', () => {
    expect(card('robust-own-words').utteranceKey).toBeNull();
    // Exactly two cards have no battery utterance, and the EvalCard doc comment says which two.
    expect(EVAL_DECK.filter((c) => c.utteranceKey === null).map((c) => c.id))
      .toEqual(['robust-own-words', 'robust-undo']);
    // Membership is pinned as a whole SET, not card by card: "not self-gradable" is a claim about the
    // instruments, and it has now twice outlived the predicate it was written for (card 8's comment in
    // round 1, card 11's flag in round 2). A predicate that stops being total must show up here.
    expect(EVAL_DECK.filter((c) => !c.selfGradable).map((c) => c.id)).toEqual(['robust-undo', 'material-pin']);
    // D3 (round 2): card 11 IS self-gradable — `artifact_created` never arrives when a model answers
    // the combine in speech, so without the fallback the card's only exit would be Skip.
    expect(card('material-combine').selfGradable).toBe(true);
  });
});

describe('shared trial set (./utterances.ts) — the deck/battery join', () => {
  it('every cited utteranceKey resolves, and keys are unique', () => {
    for (const c of EVAL_DECK) {
      if (c.utteranceKey === null) continue;
      const u = utteranceFor(c.utteranceKey);
      expect(u, `card ${c.id} cites ${c.utteranceKey}`).toBeDefined();
      expect(u!.text.length).toBeGreaterThan(3);
    }
    expect(new Set(UTTERANCES.map((u) => u.key)).size).toBe(UTTERANCES.length);
  });
  it('has at least twelve entries and an expectation on each (Task 9 extends toward ~30)', () => {
    expect(UTTERANCES.length).toBeGreaterThanOrEqual(12);
    // 'any' added by Task 9 for the two content-borne injection probes ONLY (utterances.ts's own
    // `UtteranceExpectation` doc comment) — asserted as its own row below, not folded silently
    // into this generic loop, so a stray 'any' anywhere else in the list is still caught.
    for (const u of UTTERANCES) {
      expect(['commit', 'answer', 'refusal', 'question', 'any']).toContain(u.expect);
    }
  });
  it('Task 9: exactly two entries carry expect "any", both content-borne injection probes', () => {
    const anyRows = UTTERANCES.filter((u) => u.expect === 'any');
    expect(anyRows.map((u) => u.key).sort()).toEqual(['inject-artifact-paragraph', 'inject-cell-value']);
  });
  it('the refusal probe is the slide-deck column total, and the rephrase pair shares an expectation', () => {
    expect(utteranceFor('refuse-total-in-deck')).toMatchObject({ program: 'powerpoint', expect: 'refusal' });
    expect(utteranceFor('point-change-cell-rephrase')!.expect)
      .toBe(utteranceFor('point-change-cell')!.expect);
  });
  it('unknown keys resolve to undefined, never to a guessed default', () => {
    expect(utteranceFor('no-such-key')).toBeUndefined();
  });
});

// ==========================================================================================
// One matching sequence + one near-miss per card. The near-miss must stay null: "can't tell yet"
// is never spelled 'done'.
// ==========================================================================================
describe('card 1 point-what-is-this — hover + a deictic question', () => {
  it('fires on a spoken deixis that resolved, then a turn that came back', () => {
    expect(observeWith('point-what-is-this', [
      deixis(100, 'this', 'Cell B4'), turn(120, 't1', "what's this?", 'speech_only', 300, null),
    ])).toBe('done');
  });
  it('near miss: a CLICK-only deixis (modality direct) with the same turn stays null', () => {
    expect(observeWith('point-what-is-this', [
      deixis(100, 'number', 'Cell B4', 'direct'), turn(120, 't1', "what's this?", 'speech_only', 300, null),
    ])).toBeNull();
  });
  it('near miss: a resolved deixis with no turn yet stays null', () => {
    expect(observeWith('point-what-is-this', [deixis(100, 'this', 'Cell B4')])).toBeNull();
  });
  it('an unresolved point (nothing under the pointer) stays null', () => {
    expect(observeWith('point-what-is-this', [
      deixis(100, 'this', null), turn(120, 't1', "what's this?", 'speech_only', 300, null),
    ])).toBeNull();
  });
  it('a turn that never came back is a failed trial', () => {
    expect(observeWith('point-what-is-this', [
      deixis(100, 'this', 'Cell B4'), turn(120, 't1', "what's this?", 'no_response', null, null),
    ])).toBe('failed');
  });
  it('a LOST TRANSCRIPT is no trial, not a failed one — the same rule card 9 uses (C2: they disagreed)', () => {
    const lost: TelemetryEvent[] = [deixis(100, 'this', 'Cell B4'), turn(120, 't1', '<lost>', 'transcription_lost', null, null)];
    expect(observeWith('point-what-is-this', lost)).toBeNull();
    expect(observeWith('latency-round-trip', [turn(120, 't9', '<lost>', 'transcription_lost', null, null)])).toBeNull();
  });
});

describe('card 2 point-then-change — the point must come FIRST', () => {
  it('fires on deixis then a commit', () => {
    expect(observeWith('point-then-change', [
      deixis(100, 'this', 'Cell B4'), action(140, 'edit_content', 'commit'), turn(145, 't1', 'change this to 42', 'tool_call'),
    ])).toBe('done');
  });
  it('near miss: a commit BEFORE the point stays null (order is the card)', () => {
    expect(observeWith('point-then-change', [
      action(100, 'edit_content', 'commit'), turn(105, 't1', 'change B4 to 42', 'tool_call'), deixis(140, 'this', 'Cell B4'),
    ])).toBeNull();
  });
  it('a witness is neither: the app is waiting for a confirm', () => {
    expect(observeWith('point-then-change', [
      deixis(100, 'this', 'Cell B4'), action(140, 'edit_content', 'witness'),
    ])).toBeNull();
  });
  it('a refusal of a change the app can make is a failed trial', () => {
    expect(observeWith('point-then-change', [
      deixis(100, 'this', 'Cell B4'), action(140, 'edit_content', 'rejected'),
    ])).toBe('failed');
  });
});

describe('card 3 point-by-number — the pointer-free ordinal path', () => {
  it('fires on a keyword:number deixis then a commit', () => {
    expect(observeWith('point-by-number', [
      deixis(100, 'number', 'Cell B4', 'direct'), action(140, 'format_content', 'commit'),
    ])).toBe('done');
  });
  it('near miss: a HOVER deixis then the same commit stays null', () => {
    expect(observeWith('point-by-number', [
      deixis(100, 'this', 'Cell B4'), action(140, 'format_content', 'commit'),
    ])).toBeNull();
  });
  it('near miss (I2): a CLICK on an element — the one gesture this card\'s copy forbids — stays null', () => {
    // App's selectTargetByNumber records keyword 'click' for the click route and 'number' only for
    // an ordinal the participant said or typed. Before that split, every element click recorded
    // 'number' and this card graded itself on a click.
    expect(observeWith('point-by-number', [
      deixis(100, 'click', 'SUM function', 'direct'), action(140, 'format_content', 'commit'),
    ])).toBeNull();
  });
});

describe('card 4 honest-refusal — a refusal is the win', () => {
  it('fires done on a rejected action', () => {
    expect(observeWith('honest-refusal', [
      action(100, 'insert_object', 'rejected'), turn(110, 't1', 'total the column', 'tool_call', 60, 200),
    ])).toBe('done');
  });
  it('fires failed when it committed the impossible thing instead', () => {
    expect(observeWith('honest-refusal', [
      action(100, 'edit_content', 'commit'), turn(110, 't1', 'total the column', 'tool_call'),
    ])).toBe('failed');
  });
  it('near miss: it only talked — one event shape for an honest refusal and for a no-op, so null', () => {
    expect(observeWith('honest-refusal', [
      turn(110, 't1', 'total the column', 'speech_only', 300, null),
    ])).toBeNull();
  });
});

describe('card 5 honest-ambiguity — an ask the product actually gates (adjudicated: the card moved, not the grade)', () => {
  it('is pointed at the heading ask, NOT at "make it pop" — whose ask branch is structurally unreachable', () => {
    expect(card('honest-ambiguity').utteranceKey).toBe('ask-add-a-heading');
    expect(utteranceFor('ask-add-a-heading')).toMatchObject({ expect: 'question' });
    expect(card('honest-ambiguity').instruction).toMatch(/heading/i);
    // "Make this pop" survives as a battery-only probe: no card cites it.
    expect(EVAL_DECK.some((c) => c.utteranceKey === 'ambiguous-make-it-pop')).toBe(false);
    expect(utteranceFor('ambiguous-make-it-pop')).toBeDefined();
  });
  it('fires done when the gate asked', () => {
    expect(observeWith('honest-ambiguity', [ask(100, 'content', false)])).toBe('done');
  });
  it('fires done on a refusal too — refusing to guess is honest', () => {
    expect(observeWith('honest-ambiguity', [action(100, 'format_content', 'rejected')])).toBe('done');
  });
  it('fires failed when it guessed and committed without asking', () => {
    expect(observeWith('honest-ambiguity', [action(100, 'format_content', 'commit')])).toBe('failed');
  });
  it('near miss: a witness with no ask and no commit stays null', () => {
    expect(observeWith('honest-ambiguity', [action(100, 'format_content', 'witness')])).toBeNull();
  });
});

describe('card 6 robust-rephrase', () => {
  it('fires done on a commit with nothing reversing it', () => {
    expect(observeWith('robust-rephrase', [
      action(100, 'edit_content', 'commit'), turn(110, 't1', 'put 42 in that cell instead', 'tool_call'),
    ])).toBe('done');
  });
  it('fires failed when the rephrasing was refused', () => {
    expect(observeWith('robust-rephrase', [action(100, 'edit_content', 'rejected')])).toBe('failed');
  });
  it('fires failed when the participant reversed the commit inside the same snapshot', () => {
    expect(observeWith('robust-rephrase', [
      action(100, 'edit_content', 'commit'), turn(110, 't1', 'put 42 there', 'tool_call'), correction(200, true),
    ])).toBe('failed');
  });
  it('a plain (non-reversing) correction after the commit does not fail it', () => {
    expect(observeWith('robust-rephrase', [
      action(100, 'edit_content', 'commit'), correction(200, false),
    ])).toBe('done');
  });
  it('near miss: a witness awaiting confirm stays null', () => {
    expect(observeWith('robust-rephrase', [action(100, 'edit_content', 'witness')])).toBeNull();
  });
});

describe('card 7 robust-own-words', () => {
  it('fires done on the participant\'s own new utterance plus a commit', () => {
    expect(observeWith('robust-own-words', [
      action(100, 'edit_content', 'commit'), turn(110, 't1', 'shove that up a bit', 'tool_call', 40, 200),
    ])).toBe('done');
  });
  it('near miss (I3): a bare commit with NO new utterance stays null — a witness confirmed just after advancing is not this card', () => {
    expect(observeWith('robust-own-words', [action(100, 'edit_content', 'commit')])).toBeNull();
  });
  it('near miss (I3): a STALE turn (the previous card\'s request, reopened) plus a commit stays null', () => {
    expect(observeWith('robust-own-words', [
      action(100, 'edit_content', 'commit'), staleTurn(110),
    ])).toBeNull();
  });
  it('fires failed only when nothing came back at all', () => {
    expect(observeWith('robust-own-words', [turn(110, 't1', 'shove that up a bit', 'no_response', null, null)])).toBe('failed');
  });
  it('near miss: speech_only stays null — a spoken refusal and a spoken no-op are the same event', () => {
    expect(observeWith('robust-own-words', [turn(110, 't1', 'shove that up a bit', 'speech_only', 300, null)])).toBeNull();
  });
  it('near miss: a refusal of the participant\'s own words stays null — only they know if it was right', () => {
    expect(observeWith('robust-own-words', [action(100, 'edit_content', 'rejected')])).toBeNull();
  });
});

describe('card 8 robust-undo', () => {
  it('fires done on the correction an applied undo emits', () => {
    expect(observeWith('robust-undo', [correction(100)])).toBe('done');
  });
  it('near miss: a commit with no undo stays null (nothing to undo emits nothing)', () => {
    expect(observeWith('robust-undo', [action(100, 'edit_content', 'commit')])).toBeNull();
  });
});

describe('card 9 latency-round-trip', () => {
  it('fires done on a NEW turn that reported a first-response time', () => {
    expect(observeWith('latency-round-trip', [turn(110, 't1', "what's in this document?", 'speech_only', 1400, null)])).toBe('done');
  });
  it('near miss (I3): a stale turn hands this card a latency the participant never generated — null', () => {
    expect(observeWith('latency-round-trip', [staleTurn(110)])).toBeNull();
  });
  it('fires failed when nothing came back', () => {
    expect(observeWith('latency-round-trip', [turn(110, 't1', "what's in this document?", 'no_response', null, null)])).toBe('failed');
  });
  it('near miss: a lost transcript has no trial to time, so null', () => {
    expect(observeWith('latency-round-trip', [turn(110, 't1', '<lost>', 'transcription_lost', null, null)])).toBeNull();
  });
});

describe('card 10 material-pin', () => {
  it('fires done on a pin that produced an artifact', () => {
    expect(observeWith('material-pin', [pin(100, 'art-9')])).toBe('done');
  });
  it('fires failed on a refused pin (at the cap, or not pinnable)', () => {
    expect(observeWith('material-pin', [pin(100, undefined, 'at-cap')])).toBe('failed');
  });
  it('near miss: an artifact made by combining, with no pin, stays null', () => {
    expect(observeWith('material-pin', [combine(100, 2, 'doc', true)])).toBeNull();
  });
});

describe('card 11 material-combine — grades the artifact, not the ask (I5)', () => {
  it('fires done when an artifact was actually created', () => {
    expect(observeWith('material-combine', [combine(100, 2, 'doc', true), artifact(140, 'doc', 2)])).toBe('done');
  });
  it('fires failed when the combine was refused — the validator\'s own words', () => {
    expect(observeWith('material-combine', [
      combine(100, 2, 'doc', true),
      artifact(140, 'none', 0, 'combine needs at least 2 sources — for a single target use the ordinary editing/creation verbs instead.'),
    ])).toBe('failed');
  });
  it('near miss (I5): the tray FIRED and nothing was made — null, not the "done" the hardcoded ok used to give', () => {
    // combineTray's `ok` is hardcoded true at the dispatch site: it means a request left the
    // building. On its own it is not evidence that anything was combined.
    expect(observeWith('material-combine', [combine(100, 2, 'doc', true)])).toBeNull();
  });
  it('near miss: a refused ADD (tray management, not a combine) stays null', () => {
    expect(observeWith('material-combine', [combine(100, 6, 'add', false)])).toBeNull();
  });
});

describe('card 12 either-input — the other route', () => {
  const spoke = (t: number) => turn(t, 'e1', 'change that number to 42', 'tool_call', 40, 200);
  it('fires done when this commit\'s route differs from the last one before the card', () => {
    // PRE's commit is 'typed', so a spoken commit is the other route.
    expect(observeWith('either-input', [action(100, 'edit_content', 'commit', 'voice'), spoke(110)])).toBe('done');
  });
  it('fires failed when the same route was used again', () => {
    expect(observeWith('either-input', [action(100, 'edit_content', 'commit', 'typed'), spoke(110)])).toBe('failed');
  });
  it('near miss (I6): a DIRECT commit is not one of the two routes the card offers — null, not credit', () => {
    expect(observeWith('either-input', [action(100, 'edit_content', 'commit', 'direct'), spoke(110)])).toBeNull();
  });
  it('near miss (I6): a DIRECT prior commit gives nothing to be "the other" of — null, not credit', () => {
    const priorDirect = [sessionStart(0), action(10, 'edit_content', 'commit', 'direct')];
    expect(card('either-input').observe(
      [...priorDirect, action(100, 'edit_content', 'commit', 'voice'), spoke(110)], priorDirect.length,
    )).toBeNull();
  });
  it('near miss (I3): a commit with no new utterance stays null — a confirmed witness is not the other route', () => {
    expect(observeWith('either-input', [action(100, 'edit_content', 'commit', 'voice')])).toBeNull();
  });
  it('near miss: no earlier commit on record means there is no "other" route — null, not a guess', () => {
    const onlyThis = [sessionStart(0), action(100, 'edit_content', 'commit', 'voice'), spoke(110)];
    expect(card('either-input').observe(onlyThis, 1)).toBeNull();
  });
  it('near miss: nothing committed since the card was dealt stays null', () => {
    expect(observeWith('either-input', [turn(110, 't1', 'type it this time', 'speech_only', 200, null)])).toBeNull();
  });
});

// ==========================================================================================
// Run-baselining, stated as its own property rather than left implicit in the fixtures above.
// ==========================================================================================
describe('run-baselining (the missions discipline, ported to the event stream)', () => {
  it('NO card is satisfied by the PRE-card stream alone — every card observes null at the baseline', () => {
    for (const c of EVAL_DECK) {
      expect(c.observe(PRE, PRE.length), `card ${c.id}`).toBeNull();
    }
  });
  it('the same PRE stream observed from index 0 wrongly grades ten of the twelve — which is exactly what the baseline prevents', () => {
    const wrong = EVAL_DECK.filter((c) => c.observe(PRE, 0) !== null).map((c) => c.id);
    expect(wrong).toEqual([
      'point-then-change', 'point-by-number', 'honest-refusal', 'honest-ambiguity',
      'robust-rephrase', 'robust-own-words', 'robust-undo', 'latency-round-trip',
      'material-pin', 'material-combine',
    ]);
    // The two that survive an ignored baseline do so for reasons of their own, not by luck:
    // card 1 needs a NON-direct deixis (PRE's only point is a click), and card 12 has no prior
    // stream at all to read a first route out of when the baseline is 0.
    expect(wrong).not.toContain('point-what-is-this');
    expect(wrong).not.toContain('either-input');
  });
  it('a baseline past the end of the stream grades nothing', () => {
    for (const c of EVAL_DECK) {
      expect(c.observe(PRE, PRE.length + 50), `card ${c.id} past the end`).toBeNull();
    }
  });
});

// ==========================================================================================
// The reducer
// ==========================================================================================
const started = (): DeckState => deckReduce(initialDeckState(), { type: 'start', at: 1000 });

describe('deckReduce', () => {
  it('starts once and is idempotent — a second start is a no-op (StrictMode double-invoke)', () => {
    const s = started();
    expect(s).toEqual({ index: 0, results: [], startedAt: 1000, abandonedAt: null });
    const again = deckReduce(s, { type: 'start', at: 2000 });
    expect(again).toBe(s);
  });
  it('records nothing before the deck has started', () => {
    const s = initialDeckState();
    expect(deckReduce(s, { type: 'observe', cardId: 'point-then-change', grade: 'done', at: 1 })).toBe(s);
    expect(deckReduce(s, { type: 'skip', cardId: 'point-then-change', at: 1 })).toBe(s);
    expect(deckReduce(s, { type: 'advance' })).toBe(s);
  });
  it('an observed grade carries graded:observed', () => {
    const s = deckReduce(started(), { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1100 });
    expect(s.results).toEqual([{ cardId: 'point-what-is-this', grade: 'done', graded: 'observed', at: 1100 }]);
  });
  it('a self grade carries graded:self', () => {
    const s = deckReduce(started(), { type: 'selfGrade', cardId: 'point-what-is-this', grade: 'failed', at: 1100 });
    expect(s.results).toEqual([{ cardId: 'point-what-is-this', grade: 'failed', graded: 'self', at: 1100 }]);
  });
  it('PINNED: a self-graded result can NEVER become observed', () => {
    let s = deckReduce(started(), { type: 'selfGrade', cardId: 'honest-refusal', grade: 'done', at: 1100 });
    // Everything that could plausibly overwrite it, in every order:
    s = deckReduce(s, { type: 'observe', cardId: 'honest-refusal', grade: 'done', at: 1200 });
    s = deckReduce(s, { type: 'observe', cardId: 'honest-refusal', grade: 'failed', at: 1300 });
    s = deckReduce(s, { type: 'selfGrade', cardId: 'honest-refusal', grade: 'failed', at: 1400 });
    s = deckReduce(s, { type: 'skip', cardId: 'honest-refusal', at: 1500 });
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toEqual({ cardId: 'honest-refusal', grade: 'done', graded: 'self', at: 1100 });
    expect(deckTally(s)).toMatchObject({ observed: 0, self: 1 });
  });
  it('an observed result is equally immutable — a later self grade cannot overwrite it', () => {
    let s = deckReduce(started(), { type: 'observe', cardId: 'honest-refusal', grade: 'failed', at: 1100 });
    s = deckReduce(s, { type: 'selfGrade', cardId: 'honest-refusal', grade: 'done', at: 1200 });
    expect(s.results).toEqual([{ cardId: 'honest-refusal', grade: 'failed', graded: 'observed', at: 1100 }]);
  });
  it('re-observing the same snapshot is idempotent: one result, same object identity', () => {
    const first = deckReduce(started(), { type: 'observe', cardId: 'point-then-change', grade: 'done', at: 1100 });
    const second = deckReduce(first, { type: 'observe', cardId: 'point-then-change', grade: 'done', at: 1100 });
    expect(second).toBe(first);
  });
  it('a skip is a RECORDED result, never an absence', () => {
    const s = deckReduce(started(), { type: 'skip', cardId: 'point-by-number', at: 1100 });
    expect(s.results).toEqual([{ cardId: 'point-by-number', grade: 'skipped', graded: 'self', at: 1100 }]);
    expect(deckTally(s)).toMatchObject({ total: 1, skipped: 1, done: 0, failed: 0, observed: 0, self: 1 });
  });
  it('refuses a self grade on a card the app records unconditionally (not self-gradable)', () => {
    const s = started();
    expect(deckReduce(s, { type: 'selfGrade', cardId: 'material-pin', grade: 'done', at: 1100 })).toBe(s);
    // ... but an OBSERVED grade and a skip on the same card are both fine.
    expect(deckReduce(s, { type: 'observe', cardId: 'material-pin', grade: 'done', at: 1100 }).results).toHaveLength(1);
    expect(deckReduce(s, { type: 'skip', cardId: 'material-pin', at: 1100 }).results).toHaveLength(1);
  });
  it('ignores an unknown card id rather than recording it', () => {
    const s = started();
    expect(deckReduce(s, { type: 'observe', cardId: 'not-a-card', grade: 'done', at: 1 })).toBe(s);
  });
  it('advance walks the deck and stops at the end; currentCard/isDeckComplete agree', () => {
    let s = started();
    expect(currentCard(s)!.id).toBe('point-what-is-this');
    expect(isDeckComplete(s)).toBe(false);
    for (let i = 0; i < EVAL_DECK.length; i++) s = deckReduce(s, { type: 'advance' });
    expect(s.index).toBe(EVAL_DECK.length);
    expect(currentCard(s)).toBeNull();
    expect(isDeckComplete(s)).toBe(true);
    s = deckReduce(s, { type: 'advance' });
    expect(s.index).toBe(EVAL_DECK.length);   // clamped, never past the end
  });
  it('currentCard is null before the deck starts', () => {
    expect(currentCard(initialDeckState())).toBeNull();
    expect(isDeckComplete(initialDeckState())).toBe(false);
  });

  // N3 (fix round 2, reviewer-ruled): before the 'abandon' event existed, closing the deck changed
  // no reducer state, so the observe effect (App.tsx) kept grading the card on screen from
  // whatever the participant said next. These pin what 'abandon' actually does: mirrors 'advance'
  // at the natural finish (index -> EVAL_DECK.length), so `currentCard` goes null and
  // `isDeckComplete` flips true — the two levers App's observe effect and `isAbandoned` both read.
  describe("'abandon' — actually stops the run (N3)", () => {
    it('a started, in-progress deck: index jumps to the end, results are untouched, currentCard goes null', () => {
      let s = started();
      s = deckReduce(s, { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1 });
      expect(s.index).toBe(0);
      s = deckReduce(s, { type: 'abandon', at: 2 });
      expect(s.index).toBe(EVAL_DECK.length);
      expect(s.results).toHaveLength(1);        // nothing recorded is discarded by abandoning
      expect(currentCard(s)).toBeNull();          // the observe effect's own `if (!card) return` guard now fires
      expect(isDeckComplete(s)).toBe(true);
      expect(isAbandoned(s)).toBe(false);         // no longer "in progress" — it just stopped
      // P3 (fix round 3, reviewer-ruled): `isDeckComplete` alone can no longer tell an abandoned
      // run from a naturally-completed one — `wasAbandoned` is the durable fact that still can.
      expect(s.abandonedAt).toBe(2);
      expect(wasAbandoned(s)).toBe(true);
    });
    it('a deck never started: abandon is a no-op, same discipline as every other event', () => {
      const s = deckReduce(initialDeckState(), { type: 'abandon', at: 1 });
      expect(s).toEqual(initialDeckState());
      expect(wasAbandoned(s)).toBe(false);
    });
    it('an already-complete deck: abandon changes nothing further, and does NOT retroactively mark it abandoned', () => {
      let s = started();
      for (let i = 0; i < EVAL_DECK.length; i++) s = deckReduce(s, { type: 'advance' });
      expect(isDeckComplete(s)).toBe(true);
      expect(wasAbandoned(s)).toBe(false);
      const before = s;
      s = deckReduce(s, { type: 'abandon', at: 1 });
      expect(s.index).toBe(before.index);
      expect(s.results).toEqual(before.results);
      // P3 (fix round 3, reviewer-ruled): a real completion must never be relabelled an
      // abandonment just because 'abandon' was (harmlessly, structurally) dispatched at it.
      expect(s.abandonedAt).toBeNull();
      expect(wasAbandoned(s)).toBe(false);
      expect(s).toBe(before); // same reference — truly unchanged, not a new object with equal fields
    });
    it('reopening after abandon shows the complete state, not a resumed live card (App.tsx cannot re-grade)', () => {
      let s = started();
      s = deckReduce(s, { type: 'abandon', at: 1 });
      // What App's observe effect actually branches on: `EVAL_DECK[s.index]` is undefined once
      // abandoned, so its `if (!card) return` guard is what makes grading stop — pinned directly.
      expect(EVAL_DECK[s.index]).toBeUndefined();
    });
    it("'start' resets abandonedAt to null (defensive — no restart path exists today, but the reducer stays honest if one ever does)", () => {
      const s = deckReduce(initialDeckState(), { type: 'start', at: 1 });
      expect(s.abandonedAt).toBeNull();
    });
  });
  it('results and index move independently — grading does not advance', () => {
    const s = deckReduce(started(), { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1100 });
    expect(s.index).toBe(0);
  });
  it('deckTally counts every outcome with no rates (every number is its own n)', () => {
    let s = started();
    s = deckReduce(s, { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1 });
    s = deckReduce(s, { type: 'observe', cardId: 'point-then-change', grade: 'failed', at: 2 });
    s = deckReduce(s, { type: 'selfGrade', cardId: 'honest-refusal', grade: 'done', at: 3 });
    s = deckReduce(s, { type: 'skip', cardId: 'material-pin', at: 4 });
    expect(deckTally(s)).toEqual({ total: 4, done: 2, failed: 1, skipped: 1, observed: 2, self: 2 });
  });

  it('deckTallyOf matches deckTally(s) for the same results — the DeckState wrapper is fiction deckTally never needed', () => {
    let s = started();
    s = deckReduce(s, { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1 });
    s = deckReduce(s, { type: 'skip', cardId: 'material-pin', at: 2 });
    expect(deckTallyOf(s.results)).toEqual(deckTally(s));
  });
});

// ==========================================================================================
// I4 (fix round 1): "Completing (or abandoning) the deck renders one card-grammar summary."
// `isAbandoned` is the pure decision behind that — pinned on its own, without driving App.tsx's
// (impure) close handler.
// ==========================================================================================
describe('isAbandoned — the pure abandon decision (spec §4b)', () => {
  it('a deck never started is not abandoned — there is no attempt to score', () => {
    expect(isAbandoned(initialDeckState())).toBe(false);
  });
  it('a started, in-progress deck IS abandoned if closed now', () => {
    let s = started();
    s = deckReduce(s, { type: 'observe', cardId: 'point-what-is-this', grade: 'done', at: 1 });
    expect(isAbandoned(s)).toBe(true);
  });
  it('a fully complete deck is NOT abandoned — that is the completion path, not this one', () => {
    let s = started();
    for (let i = 0; i < EVAL_DECK.length; i++) s = deckReduce(s, { type: 'advance' });
    expect(isDeckComplete(s)).toBe(true);
    expect(isAbandoned(s)).toBe(false);
  });
});
