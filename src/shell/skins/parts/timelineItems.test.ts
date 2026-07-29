import { describe, it, expect } from 'vitest';
import { timelineItems, WAITING_TEXT } from './timelineItems';
import type { ActivityEntry } from '../../activityStore';

const e = (over: Partial<ActivityEntry> & Pick<ActivityEntry, 'kind'>): ActivityEntry =>
  ({ text: 'x', at: 1, ...over });

describe('timelineItems', () => {
  it('is empty for an empty trace', () => {
    expect(timelineItems([], 5)).toEqual([]);
  });

  it('an OPEN agent ask yields an agent row AND a trailing waiting lane', () => {
    const rows = timelineItems([e({ kind: 'ask', callId: 'c1', text: 'Which heading?', at: 7 })], 5);
    expect(rows).toEqual([
      { actor: 'agent', text: 'Which heading?', at: 7 },
      { actor: 'waiting', text: WAITING_TEXT, at: 7 },
    ]);
  });

  it("the waiting lane says the present tense, not a claim about the past", () => {
    expect(WAITING_TEXT).toBe('waiting — nothing written until you answer');
  });

  it('a user utterance (ask with NO callId) is a `you` row and opens no waiting lane', () => {
    // Both flavours arrive as kind 'ask' (App.tsx: processInputTranscript for the user's own
    // words, the tool ack for the gate's question). callId is the only discriminator, and
    // rendering the user's own sentence as "the agent asked, waiting on you" would be a lie.
    expect(timelineItems([e({ kind: 'ask', text: 'make it bolder', at: 3 })], 5)).toEqual([
      { actor: 'you', text: 'make it bolder', at: 3 },
    ]);
  });

  it('a completed call is witnessed; a dispatch, a pending witness and a rejection are the agent', () => {
    const rows = timelineItems([
      e({ kind: 'call', callId: 'c1', text: 'save_file', at: 1 }),
      e({ kind: 'witness', callId: 'c2', text: 'wb_beautify — awaiting your confirm', at: 2 }),
      e({ kind: 'error', callId: 'c3', text: 'set_text: rejected', at: 3 }),
      e({ kind: 'done', callId: 'c4', text: 'set_text (Heading)', at: 4 }),
    ], 10);
    expect(rows.map(r => r.actor)).toEqual(['agent', 'agent', 'agent', 'witnessed']);
    expect(rows[3]).toEqual({ actor: 'witnessed', text: 'set_text (Heading)', at: 4 });
  });

  it('no waiting lane once anything has happened after the ask', () => {
    const rows = timelineItems([
      e({ kind: 'ask', callId: 'c1', text: 'Which heading?', at: 1 }),
      e({ kind: 'done', callId: 'c1', text: 'set_text', at: 2 }),
    ], 10);
    expect(rows.map(r => r.actor)).toEqual(['agent', 'witnessed']);
  });

  it('caps at `limit`, keeping the MOST RECENT — newest last', () => {
    const rows = timelineItems([
      e({ kind: 'done', text: 'one', at: 1 }),
      e({ kind: 'done', text: 'two', at: 2 }),
      e({ kind: 'done', text: 'three', at: 3 }),
    ], 2);
    expect(rows.map(r => r.text)).toEqual(['two', 'three']);
  });

  it('the waiting lane counts against the cap — the row it belongs to is never cut off alone', () => {
    const rows = timelineItems([
      e({ kind: 'done', text: 'one', at: 1 }),
      e({ kind: 'ask', callId: 'c1', text: 'Which heading?', at: 2 }),
    ], 2);
    expect(rows).toEqual([
      { actor: 'agent', text: 'Which heading?', at: 2 },
      { actor: 'waiting', text: WAITING_TEXT, at: 2 },
    ]);
  });

  it('a limit of zero or less yields nothing rather than a negative slice', () => {
    expect(timelineItems([e({ kind: 'done', text: 'one', at: 1 })], 0)).toEqual([]);
    expect(timelineItems([e({ kind: 'done', text: 'one', at: 1 })], -3)).toEqual([]);
  });
});
