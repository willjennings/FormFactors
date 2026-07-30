import { describe, it, expect } from 'vitest';
import { openTurn, noteFirstResponse, updateRequest, closeTurn, turnOpenAttr } from './turns';
import type { OpenTurn } from './turns';

describe('openTurn', () => {
  it('opens fresh with no previous turn: closedPrev is null', () => {
    const { open, closedPrev } = openTurn(null, 't1', 1000, 'voice', 'add a heading');
    expect(open).toEqual({ id: 't1', t: 1000, modality: 'voice', request: 'add a heading', firstResponseAt: null });
    expect(closedPrev).toBeNull();
  });

  it('opening over an open turn with no first response closes it as no_response, null millis', () => {
    const prev: OpenTurn = { id: 'a', t: 500, modality: 'voice', request: 'sum this column', firstResponseAt: null };
    const { open, closedPrev } = openTurn(prev, 'b', 900, 'voice', 'next thing');
    expect(closedPrev).toEqual({
      id: 'a', t: 500, modality: 'voice', request: 'sum this column',
      outcome: 'no_response', firstResponseMs: null, settledMs: null,
    });
    expect(open.id).toBe('b');
  });

  it('opening over an open turn that had a first response closes it as speech_only, with firstResponseMs relative to its own open', () => {
    const prev: OpenTurn = { id: 'a', t: 500, modality: 'voice', request: 'sum this column', firstResponseAt: 700 };
    const { closedPrev } = openTurn(prev, 'b', 2000, 'voice', 'next thing');
    expect(closedPrev).toEqual({
      id: 'a', t: 500, modality: 'voice', request: 'sum this column',
      outcome: 'speech_only', firstResponseMs: 200, settledMs: null,
    });
  });

  it('references the closing turn\'s own open time, not the new turn\'s open time, for firstResponseMs', () => {
    // If firstResponseMs were computed against the NEW turn's t (2000) instead of prev's own
    // t (500), this would come out negative/wrong (700 - 2000 = -1300) instead of 200.
    const prev: OpenTurn = { id: 'a', t: 500, modality: 'typed', request: 'x', firstResponseAt: 700 };
    const { closedPrev } = openTurn(prev, 'b', 2000, 'typed', 'y');
    expect(closedPrev!.firstResponseMs).toBe(200);
  });
});

describe('noteFirstResponse', () => {
  it('sets firstResponseAt on the first call', () => {
    const open: OpenTurn = { id: 'a', t: 100, modality: 'voice', request: 'x', firstResponseAt: null };
    const next = noteFirstResponse(open, 150);
    expect(next.firstResponseAt).toBe(150);
  });

  it('is idempotent: the first timestamp wins over a later call', () => {
    const open: OpenTurn = { id: 'a', t: 100, modality: 'voice', request: 'x', firstResponseAt: null };
    const first = noteFirstResponse(open, 150);
    const second = noteFirstResponse(first, 400);
    expect(second.firstResponseAt).toBe(150);
  });

  it('does not mutate its input (pure)', () => {
    const open: OpenTurn = { id: 'a', t: 100, modality: 'voice', request: 'x', firstResponseAt: null };
    noteFirstResponse(open, 150);
    expect(open.firstResponseAt).toBeNull();
  });
});

describe('turnOpenAttr', () => {
  it('is "0" for no open turn and no closeReason (default: settled)', () => {
    expect(turnOpenAttr(null)).toBe('0');
  });

  it('is "0" for no open turn, closeReason "settled" explicit', () => {
    expect(turnOpenAttr(null, 'settled')).toBe('0');
  });

  it('is "f" for no open turn, closeReason "flushed"', () => {
    expect(turnOpenAttr(null, 'flushed')).toBe('f');
  });

  it('is "1" for an open turn regardless of closeReason (closeReason is only consulted when open is null)', () => {
    const open: OpenTurn = { id: 'a', t: 100, modality: 'voice', request: 'x', firstResponseAt: null };
    expect(turnOpenAttr(open)).toBe('1');
    expect(turnOpenAttr(open, 'flushed')).toBe('1');
    expect(turnOpenAttr({ ...open, firstResponseAt: 150 })).toBe('1');
  });
});

describe('updateRequest', () => {
  it('returns a new object with the request replaced, everything else preserved', () => {
    const open: OpenTurn = { id: 'a', t: 100, modality: 'voice', request: 'add a head', firstResponseAt: null };
    const next = updateRequest(open, 'add a heading here');
    expect(next).toEqual({ id: 'a', t: 100, modality: 'voice', request: 'add a heading here', firstResponseAt: null });
    expect(open.request).toBe('add a head'); // input untouched
  });
});

describe('closeTurn', () => {
  it('computes firstResponseMs and settledMs relative to the given t', () => {
    const open: OpenTurn = { id: 'a', t: 1000, modality: 'voice', request: 'sum this column', firstResponseAt: 1300 };
    const closed = closeTurn(open, 1000, { kind: 'tool_call' }, 1800);
    expect(closed).toEqual({
      id: 'a', t: 1000, modality: 'voice', request: 'sum this column',
      outcome: 'tool_call', firstResponseMs: 300, settledMs: 800,
    });
  });

  it('settledMs is null when no settlement time is given', () => {
    const open: OpenTurn = { id: 'a', t: 1000, modality: 'voice', request: 'x', firstResponseAt: 1300 };
    const closed = closeTurn(open, 1000, { kind: 'speech_only' }, null);
    expect(closed.settledMs).toBeNull();
    expect(closed.firstResponseMs).toBe(300);
  });

  it('firstResponseMs is null when the turn never got a response', () => {
    const open: OpenTurn = { id: 'a', t: 1000, modality: 'voice', request: 'x', firstResponseAt: null };
    const closed = closeTurn(open, 1000, { kind: 'no_response' }, null);
    expect(closed.firstResponseMs).toBeNull();
  });

  it('a transcription_lost close carries null millis even if response/settlement times were recorded', () => {
    const open: OpenTurn = { id: 'a', t: 1000, modality: 'voice', request: 'x', firstResponseAt: 1200 };
    const closed = closeTurn(open, 1000, { kind: 'transcription_lost' }, 1500);
    expect(closed.outcome).toBe('transcription_lost');
    expect(closed.firstResponseMs).toBeNull();
    expect(closed.settledMs).toBeNull();
  });
});
