/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { capabilityLedger, type LedgerRow } from './capabilityLedger';
import { deriveAttempts } from './deriveAttempts';
import { DEFAULT_DIALS } from '../register/registry';
import type { TelemetryEvent, Arm, SessionConfig } from '../telemetry';
import type { Attempt } from './types';

// ---- fixture builders — same shapes as deriveAttempts.test.ts, kept in sync deliberately -------

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

const ask = (t: number, field: string, answered: boolean, viaChip = false): TelemetryEvent =>
  ({ t, type: 'unspecified_ask', field, answered, viaChip });

const deixis = (
  t: number, keyword: string, resolved: string | null, target: string | null,
  correct: boolean | null, confidence: 'high' | 'low' = 'high',
): TelemetryEvent => ({ t, type: 'deixis', keyword, resolved, target, confidence, correct, modality: 'voice' });

const grounding = (
  t: number, appReferent: string | null, modelTarget: string | null, agree: boolean | null,
): TelemetryEvent => ({ t, type: 'grounding', appReferent, modelTarget, agree, resolution: 'structural' });

// Manually built Attempt, for tests that don't need a full event-derivation round trip.
let seq = 0;
const attempt = (overrides: Partial<Attempt> = {}): Attempt => {
  seq += 1;
  return {
    id: `a${seq}`, askedAt: seq * 1000, request: `request ${seq}`, program: 'word',
    verb: 'set_heading', outcome: 'refused-honestly', turns: 1, corrections: 0, undos: 0,
    witnessed: false, durationMs: 100, arm: ARM, ungradeableReason: null,
    ...overrides,
  };
};

const rowFor = (rows: LedgerRow[], kind: LedgerRow['kind'], key: string) =>
  rows.find((r) => r.kind === kind && r.key === key);

// ==========================================================================================
// Refusals populate the ledger (never a failure rate — that's armAggregate's job; here we just
// check the row exists with the right shape).
// ==========================================================================================
describe('refusals populate the ledger', () => {
  it('a real gate refusal (action decision rejected, no successful retry) produces a refusal row keyed by verb/program', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'powerpoint'),
      action(100, 'insert_object', 'rejected'),
      turn(105, 't1', 'insert an average of the sales column', 'tool_call', 50, 40),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('refused-honestly');
    const rows = capabilityLedger(events, attempts);
    const row = rowFor(rows, 'refusal', 'insert_object/powerpoint');
    expect(row).toBeDefined();
    expect(row!.n).toBe(1);
    expect(row!.examples).toEqual(['insert an average of the sales column']);
  });
});

// ==========================================================================================
// no-op-turn rows come from abandoned speech-only/no-response attempts
// ==========================================================================================
describe('no-op-turn rows', () => {
  it('a speech_only turn with nothing else attached (abandoned) becomes a no-op-turn row carrying the verbatim request', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'excel'),
      turn(100, 't1', 'what does this button do', 'speech_only'),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('abandoned');
    const rows = capabilityLedger(events, attempts);
    const row = rowFor(rows, 'no-op-turn', 'speech-only/excel');
    expect(row).toBeDefined();
    expect(row!.n).toBe(1);
    expect(row!.examples).toEqual(['what does this button do']);
  });

  it('a no_response turn also becomes a no-op-turn row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'word'),
      turn(100, 't1', 'never mind', 'no_response'),
    ];
    const attempts = deriveAttempts(events);
    const rows = capabilityLedger(events, attempts);
    expect(rowFor(rows, 'no-op-turn', 'speech-only/word')!.n).toBe(1);
  });
});

// ==========================================================================================
// Hallucinated-tool decision: folded into 'refusal', distinct key, never confused with a real
// gate refusal.
// ==========================================================================================
describe('hallucinated tool call', () => {
  it('a tool_call turn with no action event at all (ungradeable/tool-call-without-action) becomes its own refusal-kind row, keyed unknown-tool/<program>', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'photo'),
      turn(100, 't1', 'sharpen the whole image with the magic wand', 'tool_call'),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('ungradeable');
    expect(attempts[0].ungradeableReason).toBe('tool-call-without-action');
    const rows = capabilityLedger(events, attempts);
    const row = rowFor(rows, 'refusal', 'unknown-tool/photo');
    expect(row).toBeDefined();
    expect(row!.examples).toEqual(['sharpen the whole image with the magic wand']);
    // Never lands in a real verb-keyed refusal row.
    expect(rowFor(rows, 'refusal', 'set_heading/photo')).toBeUndefined();
  });

  it('other ungradeable reasons (ambiguous-boundary) do NOT appear in the ledger at all', () => {
    const attempts = [attempt({ outcome: 'ungradeable', ungradeableReason: 'ambiguous-boundary', verb: null })];
    const rows = capabilityLedger([], attempts);
    expect(rows).toHaveLength(0);
  });
});

// ==========================================================================================
// asked-and-answered vs asked-and-dropped land where §5 says: only the dropped one is a ledger
// row; the answered one is success-shaped and must never appear.
// ==========================================================================================
describe('ask rows — only dropped asks are a limit', () => {
  it('an unanswered gate ask produces an ask-kind row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'word'),
      ask(100, 'heading', false),
      turn(105, 't1', 'add a heading', 'tool_call', 50, 30),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('asked-and-dropped');
    const rows = capabilityLedger(events, attempts);
    expect(rowFor(rows, 'ask', 'ask/word')!.n).toBe(1);
  });

  it('an answered ask that lands produces NO row at all — success-shaped, never in the ledger', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'word'),
      ask(100, 'heading', true),
      action(110, 'set_heading', 'commit'),
      turn(115, 't1', 'add a heading', 'tool_call', 50, 30),
    ];
    const attempts = deriveAttempts(events);
    expect(attempts[0].outcome).toBe('asked-and-answered');
    const rows = capabilityLedger(events, attempts);
    expect(rows).toHaveLength(0);
  });
});

// ==========================================================================================
// deixis: correct === null (ungraded) must NEVER produce a deixis-miss row; correct === false
// must.
// ==========================================================================================
describe('deixis-miss rows', () => {
  it('correct === false produces a deixis-miss row with keyword/resolved/target in the example', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'photo'),
      deixis(100, 'this one', 'the left photo', 'the right photo', false),
    ];
    const rows = capabilityLedger(events, []);
    const row = rowFor(rows, 'deixis-miss', 'this one/photo');
    expect(row).toBeDefined();
    expect(row!.n).toBe(1);
    expect(row!.examples[0]).toContain('this one');
    expect(row!.examples[0]).toContain('the left photo');
    expect(row!.examples[0]).toContain('the right photo');
  });

  it('correct === null (ungraded, no ground truth) never produces a row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'photo'),
      deixis(100, 'this one', 'the left photo', null, null),
    ];
    const rows = capabilityLedger(events, []);
    expect(rows.filter((r) => r.kind === 'deixis-miss')).toHaveLength(0);
  });

  it('correct === true never produces a row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'photo'),
      deixis(100, 'this one', 'the left photo', 'the left photo', true),
    ];
    const rows = capabilityLedger(events, []);
    expect(rows.filter((r) => r.kind === 'deixis-miss')).toHaveLength(0);
  });
});

// ==========================================================================================
// grounding: agree === false → row; agree === null (ungraded) never does.
// ==========================================================================================
describe('grounding-disagree rows', () => {
  it('agree === false produces a grounding-disagree row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'excel'),
      grounding(100, 'B2', 'B3', false),
    ];
    const rows = capabilityLedger(events, []);
    const row = rowFor(rows, 'grounding-disagree', 'B2/excel');
    expect(row).toBeDefined();
    expect(row!.examples[0]).toContain('B2');
    expect(row!.examples[0]).toContain('B3');
  });

  it('agree === null never produces a row', () => {
    const events: TelemetryEvent[] = [
      sessionStart(0, 'excel'),
      grounding(100, null, 'B3', null),
    ];
    const rows = capabilityLedger(events, []);
    expect(rows.filter((r) => r.kind === 'grounding-disagree')).toHaveLength(0);
  });
});

// ==========================================================================================
// Examples cap at 5, first-seen order — no reordering as counts grow.
// ==========================================================================================
describe('examples cap at 5, first-seen order', () => {
  it('a row with 7 occurrences keeps exactly the first 5 verbatim requests, in the order they occurred', () => {
    const attempts = Array.from({ length: 7 }, (_, i) =>
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: `request ${i}` }));
    const rows = capabilityLedger([], attempts);
    const row = rowFor(rows, 'refusal', 'insert_object/powerpoint')!;
    expect(row.n).toBe(7);
    expect(row.examples).toEqual(['request 0', 'request 1', 'request 2', 'request 3', 'request 4']);
  });

  it('adding an 8th and 9th occurrence still leaves examples unchanged — n grows, examples do not', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: `request ${i}` }));
    const nine = [...seven,
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: 'request 7' }),
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: 'request 8' }),
    ];
    const rowsBefore = capabilityLedger([], seven);
    const rowsAfter = capabilityLedger([], nine);
    const before = rowFor(rowsBefore, 'refusal', 'insert_object/powerpoint')!;
    const after = rowFor(rowsAfter, 'refusal', 'insert_object/powerpoint')!;
    expect(before.examples).toEqual(after.examples); // unchanged
    expect(after.n).toBe(9);
    expect(before.n).toBe(7);
  });
});

// ==========================================================================================
// Ranked by n desc.
// ==========================================================================================
describe('ranked by n desc', () => {
  // I2 (fix round 2, reviewer-ruled): the original fixture here inserted the eventual high-n row
  // FIRST, so a mutation that dropped the sort entirely (plain insertion order) still passed —
  // the assertion was decorative. This fixture inverts that: the LOW-n row is inserted first, the
  // eventual HIGH-n row's occurrences come later, so only a real sort-by-n puts it first.
  it('rows sort with the highest-n row first, even when it was NOT the first row created', () => {
    const attempts = [
      attempt({ outcome: 'abandoned', verb: null, program: 'word', request: 'low-n, inserted first' }), // n=1
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: 'r1' }),
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: 'r2' }),
      attempt({ outcome: 'refused-honestly', verb: 'insert_object', program: 'powerpoint', request: 'r3' }), // n=3, created AFTER the n=1 row above
    ];
    const rows = capabilityLedger([], attempts);
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe('insert_object/powerpoint'); // n=3 sorts first despite being created second
    expect(rows[0].n).toBe(3);
    expect(rows[1].key).toBe('speech-only/word');
    expect(rows[1].n).toBe(1);
  });

  // I2's tie-break requirement: stated in capabilityLedger.ts's file header ("ties keep first-seen
  // row order... Array.prototype.sort is stable"), pinned here rather than left implicit.
  it('a tie in n is broken by first-seen row order, never re-sorted', () => {
    const attempts = [
      attempt({ outcome: 'refused-honestly', verb: 'verbA', program: 'word', request: 'a1' }), // key A first-seen here
      attempt({ outcome: 'refused-honestly', verb: 'verbB', program: 'word', request: 'b1' }), // key B first-seen here
      attempt({ outcome: 'refused-honestly', verb: 'verbA', program: 'word', request: 'a2' }), // A -> n=2
      attempt({ outcome: 'refused-honestly', verb: 'verbB', program: 'word', request: 'b2' }), // B -> n=2, same as A
    ];
    const rows = capabilityLedger([], attempts);
    expect(rows.map((r) => ({ key: r.key, n: r.n }))).toEqual([
      { key: 'verbA/word', n: 2 },
      { key: 'verbB/word', n: 2 },
    ]);
  });
});
