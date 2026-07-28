import { describe, it, expect } from 'vitest';
import { validateActionCall, aggregateMode, reviseHeldAnswer, accumulateRun, runUtterance,
  EMPTY_RUN_ACCUM, INSERT_KINDS, type HeldAnswer } from './validate';
import { totalColumn } from './columnTotal';
import { seedCorpus } from '../artifacts/seeds';
import type { MockDoc } from '../scenarios';

const word = () => seedCorpus().word;
const excel = () => seedCorpus().excel;
const ppt = () => seedCorpus().powerpoint;
const cells = () => (excel() as { kind: 'excel'; cells: Record<string, string> }).cells;

describe('unspecified asks — authorial content only', () => {
  it('a heading with no text ASKS the user', () => {
    const v = validateActionCall('edit_content', { target: 'heading' }, word());
    expect(v).toEqual({ needsContent: { field: 'heading', question: 'What would you like the heading to say?' } });
  });
  it('the literal placeholder "heading" is not content', () => {
    const v = validateActionCall('edit_content', { target: 'Document body', detail: 'heading' }, word()) as any;
    expect(v.needsContent?.field).toBe('heading');
  });
  it('blank and whitespace detail ask too', () => {
    expect((validateActionCall('edit_content', { target: 'heading', detail: '   ' }, word()) as any).needsContent).toBeTruthy();
  });
  it('real heading text passes', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Q3 Summary' }, word())).toEqual({ ok: true });
  });
  it('body text and slide titles ask with their own field and question', () => {
    expect((validateActionCall('edit_content', { target: 'Document body' }, word()) as any).needsContent.field).toBe('body');
    expect((validateActionCall('edit_content', { target: 'Slide canvas' }, ppt()) as any).needsContent.field).toBe('slideTitle');
  });
  // REPLACES "CONFIRM OVERRIDES the placeholder check". That test asserted the defect: `confirm`
  // is a MODEL argument, not the app's confirm button, and in the `guided` register (honest:false,
  // and the control arm carrying DEFAULT_DIALS) the prompt tells the model to "call the verb with
  // confirm=true and do it immediately". So the origin bug reproduced verbatim in the default
  // register by way of the one line meant to respect the user's wishes.
  it('a model-asserted confirm does NOT license a placeholder — it is not the app\'s confirm button', () => {
    const v = validateActionCall('edit_content', { target: 'heading', detail: 'Heading', confirm: true }, word()) as any;
    expect(v.needsContent.field).toBe('heading');
    expect(v.ok).toBeUndefined();
  });
  it('the USER\'s own answer licenses the literal word — this is what confirm was pretending to be', () => {
    const said = { field: 'heading', text: 'Heading' };
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Heading' }, word(), said)).toEqual({ ok: true });
    // Case and surrounding punctuation are not meaning; the answer still has to BE the word.
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Heading' }, word(),
      { field: 'heading', text: '  heading.  ' })).toEqual({ ok: true });
  });
  it('MENTIONING the word is not asking for it — round 2\'s probe table, verbatim', () => {
    // Token containment could not tell these apart, and the question itself
    // ("What would you like the heading to say?") primes the user to say "heading".
    // The first line IS the origin bug: they asked for Q3 Summary and got "Heading".
    const gate = (detail: string, text: string) =>
      validateActionCall('edit_content', { target: 'heading', detail }, word(), { field: 'heading', text }) as any;
    expect(gate('Heading', 'the heading should say Q3 Summary').needsContent).toBeTruthy();
    expect(gate('Heading', 'the heading should be short').needsContent).toBeTruthy();
    expect(gate('title', 'give it a nice title please').needsContent).toBeTruthy();
    expect(gate('Heading', 'Q3 Summary').needsContent).toBeTruthy();
    // Chain A: the word program's OWN chip phrase, fired twice (scenarios.ts word.heading hint).
    expect(gate('Heading', 'Add a heading here').needsContent).toBeTruthy();
    // Chain C: a first spoken fragment, and the accumulated utterance it grows into.
    expect(gate('Heading', 'the heading').needsContent).toBeTruthy();
    // The model authoring its own licence: a candidate narrowed afterwards to the bare word.
    expect(gate('Heading', 'Heading for the Q3 report').needsContent).toBeTruthy();
  });
  it('someone else\'s answer, another field\'s answer, or no answer licenses nothing', () => {
    const ask = (a: any) => (validateActionCall('edit_content', { target: 'heading', detail: 'Heading' }, word(), a) as any).needsContent;
    expect(ask(null)).toBeTruthy();
    expect(ask({ field: 'body', text: 'Heading' })).toBeTruthy();          // answered a DIFFERENT question
    expect(ask({ field: 'heading', text: 'make it bold' })).toBeTruthy();  // never said the word
    expect(ask({ field: 'heading', text: '' })).toBeTruthy();
  });
  it('an answer never licenses a BLANK detail — silence is still not content', () => {
    const v = validateActionCall('edit_content', { target: 'heading', detail: '  ' }, word(),
      { field: 'heading', text: 'Heading' }) as any;
    expect(v.needsContent).toBeTruthy();
  });
});

describe('reviseHeldAnswer — an answer belongs to the utterance it came from', () => {
  const held = { field: 'heading', text: 'Q3', turn: 7 };
  const ev = (o: Partial<{ turn: number; voice: boolean; askOpen: boolean; accumulated: string }> = {}) =>
    ({ turn: 7, voice: true, askOpen: false, accumulated: 'Q3 Summary', ...o });

  it('grows the answer across the deltas of ITS OWN spoken turn', () => {
    // The ask closes on the first fragment, so the whole utterance only arrives afterwards.
    expect(reviseHeldAnswer(held, ev())).toEqual({ field: 'heading', text: 'Q3 Summary', turn: 7 });
  });
  it('a LATER turn drops the answer instead of rewriting it — round 3\'s exploit', () => {
    // Executed chain: answer "Q3 Summary" → the model's retry is refused for some other reason
    // (that branch returns above the spend), so the licence is still live → >3s later the
    // accumulator restarts → the user's next turn opens with the bare word ("Heading… can you
    // make that bigger?") → the old guard rewrote the licence to "Heading" and the literal word
    // was written, a turn after they said it, about something else.
    expect(reviseHeldAnswer(held, ev({ turn: 8, accumulated: 'Heading' }))).toBeNull();
    // …and it is dropped, not merely left alone: a fragment captured from an utterance that has
    // since ended can never be completed, so keeping it would preserve the same hazard.
    expect(reviseHeldAnswer({ field: 'heading', text: 'Heading', turn: 7 },
      ev({ turn: 9, accumulated: 'anything' }))).toBeNull();
  });
  it('typed text arrives complete, so it is never revised by later accumulation', () => {
    expect(reviseHeldAnswer(held, ev({ voice: false, accumulated: 'Q3 something else' }))).toEqual(held);
  });
  it('an open question owns what is being said now — the old answer is left alone', () => {
    expect(reviseHeldAnswer(held, ev({ askOpen: true }))).toEqual(held);
  });
  it('nothing held, or nothing to revise with, changes nothing', () => {
    expect(reviseHeldAnswer(null, ev())).toBeNull();
    expect(reviseHeldAnswer(held, ev({ accumulated: '   ' }))).toEqual(held);
  });
});

describe('accumulateRun — what the user actually said in this run', () => {
  const heard = (...deltas: string[]) => runUtterance(deltas.reduce(accumulateRun, EMPTY_RUN_ACCUM));

  it('a GROWING partial replaces the fragment it grew from', () => {
    // azure.ts / openai.ts deliver a one-word utterance as `transcription.delta "Heading"` then
    // `transcription.completed "Heading"`. Literal append ("Heading Heading") would leave the
    // literal-word user unable to say the word at all on voice.
    expect(heard('Head', 'Heading')).toBe('Heading');
    expect(heard('Heading', 'Heading')).toBe('Heading');
    expect(heard('the head', 'the heading should say Q3')).toBe('the heading should say Q3');
  });
  it('a NEW piece is appended — the utterance grows across deltas', () => {
    expect(heard('the heading', 'should say Q3 Summary')).toBe('the heading should say Q3 Summary');
  });
  it('the closing event restates the run, so it replaces it instead of doubling it', () => {
    // azure.ts/openai.ts send the full `ev.transcript` on `…transcription.completed`. Replacing is
    // safe only because it is a PREFIX of nothing lost — it contains everything already heard.
    expect(heard('the heading', 'should say Q3 Summary', 'the heading should say Q3 Summary'))
      .toBe('the heading should say Q3 Summary');
  });
  it('committed speech is APPEND-ONLY: no later delta can shrink the run to one of its words', () => {
    // The defect this exists for: "Q3 Summary" then "Head" then "Heading" must not end up as
    // "Heading". Only the fragment in flight is ever rewritten.
    expect(heard('Q3 Summary', 'Head', 'Heading')).toBe('Q3 Summary Heading');
    expect(heard('Q3 Summary', 'Heading')).toBe('Q3 Summary Heading');
  });
  it('blank and whitespace deltas change nothing', () => {
    expect(accumulateRun(EMPTY_RUN_ACCUM, '   ')).toEqual(EMPTY_RUN_ACCUM);
    expect(heard('Heading', '  ')).toBe('Heading');
    expect(runUtterance(EMPTY_RUN_ACCUM)).toBe('');
  });
});

describe('the licence across one spoken run — App.tsx\'s answer path, end to end', () => {
  // Mirrors processInputTranscript: every delta folds into the run, then revises the held answer.
  const speak = (held: HeldAnswer | null, deltas: string[], turn = 1) => {
    let acc = EMPTY_RUN_ACCUM;
    let out = held;
    for (const d of deltas) {
      acc = accumulateRun(acc, d);
      out = reviseHeldAnswer(out, { turn, voice: true, askOpen: false, accumulated: runUtterance(acc) });
    }
    return out;
  };
  const gate = (held: HeldAnswer | null) =>
    validateActionCall('edit_content', { target: 'heading', detail: 'Heading' }, word(), held) as any;

  it('a live licence cannot be rewritten to the bare placeholder INSIDE its own run', () => {
    // Round 3 closed this across runs; it reappeared within one, because the accumulation the
    // answer was revised against was the display one (App.tsx:2450 writes the raw delta back).
    // The user answered "Q3 Summary"; the run then carries "Head" → "Heading" (a prefix pair,
    // which is what every provider's partial-then-final looks like).
    const held = speak({ field: 'heading', text: 'Q3 Summary', turn: 1 }, ['Q3 Summary', 'Head', 'Heading']);
    expect(held?.text).toBe('Q3 Summary Heading');
    expect(gate(held).needsContent).toBeTruthy();      // asks again; writes nothing
    expect(gate(held).ok).toBeUndefined();
  });
  it('the user who really does want the word Heading is still licensed', () => {
    // The same prefix pair, but this time it IS the whole answer — the escape hatch has to survive
    // the fix, or refusing becomes unconditional on the primary modality.
    const held = speak({ field: 'heading', text: 'Head', turn: 1 }, ['Head', 'Heading']);
    expect(gate(held)).toEqual({ ok: true });
  });
  it('a longer answer that merely opens with the word is refused', () => {
    const held = speak({ field: 'heading', text: 'Heading', turn: 1 },
      ['Heading', 'is what I want it to say, plus the date']);
    expect(gate(held).needsContent).toBeTruthy();
  });
  it('a run that ENDS without further transcript leaves the answer standing', () => {
    // The drop is lazy on purpose: the user says "Heading", the model's turn start bumps the run,
    // and no new delta ever arrives. An eager drop at the boundary would kill the honest path.
    const held: HeldAnswer = { field: 'heading', text: 'Heading', turn: 1 };
    expect(speak(held, [], 2)).toEqual(held);
    expect(gate(held)).toEqual({ ok: true });
  });
});

describe('malformed calls — the model is addressed, never the user', () => {
  it('an Excel cell with no value is an ERROR, not an ask — the classification is the point', () => {
    const v = validateActionCall('edit_content', { target: 'Cell B5' }, excel()) as any;
    expect(v.error).toBeTruthy();
    expect(v.needsContent).toBeUndefined();   // a number the user stated is not authorial
    expect(v.error).toContain('B5');
  });
  it('an unknown object kind names the valid set, derived from the same constant', () => {
    const v = validateActionCall('insert_object', { target: 'grid', detail: 'widget' }, excel()) as any;
    for (const k of INSERT_KINDS) expect(v.error).toContain(k);
  });
  it('aggregate errors match totalColumn EXACTLY, so validator and reducer cannot drift', () => {
    const v = validateActionCall('insert_object', { target: 'Cell A2', detail: 'sum' }, excel()) as any;
    const direct = totalColumn(cells(), 'A', 'sum') as { error: string };
    expect(v.error).toBe(direct.error);
  });
  it('an aggregate outside a spreadsheet REFUSES — the PowerPoint blank-slide near-miss', () => {
    // insert_object is offered to excel AND powerpoint. The reducer's powerpoint branch reads
    // `detail` only for "dup" (scenarios.ts) and otherwise appends "Slide N", so "total that
    // column" in a deck used to fall through to {ok:true} and append a blank slide, acked
    // success/done. Same near-miss class as `detail:"total"` silently inserting a chart.
    for (const detail of ['total', 'sum', 'average']) {
      const v = validateActionCall('insert_object', { target: 'Slide canvas', detail }, ppt()) as any;
      expect(v.ok).toBeUndefined();
      expect(v.error).toMatch(/spreadsheet/i);
      // Names what IS insertable here — and never offers back the two words it just refused.
      for (const k of ['chart', 'slide', 'shape']) expect(v.error).toContain(k);
      expect(v.error).not.toMatch(/\bsum\b/);
      expect(v.error).not.toMatch(/\baverage\b/);
    }
    // A deck's real inserts are untouched.
    expect(validateActionCall('insert_object', { target: 'Slide canvas', detail: 'slide' }, ppt())).toEqual({ ok: true });
  });
  it('an ambiguous column asks which one', () => {
    const twoNumeric: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '1', A2: '2', B1: '3', B2: '4' } };
    const v = validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'total' }, twoNumeric) as any;
    expect(v.error).toContain('Which column');
  });
  it('a single numeric column is resolved without asking', () => {
    const one: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: 'Label', B1: 'n', B2: '10', B3: '20' } };
    expect(validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'sum' }, one)).toEqual({ ok: true });
  });
});

describe('exempt verbs and vocabulary', () => {
  it('format_content and save_file never gate', () => {
    expect(validateActionCall('format_content', { target: 'Document body' }, word())).toEqual({ ok: true });
    expect(validateActionCall('save_file', { target: 'Save' }, word())).toEqual({ ok: true });
  });
  it('"total" and "mean" are aggregate words — the observed near-miss that inserted a chart', () => {
    expect(aggregateMode('total')).toBe('sum');
    expect(aggregateMode('sum')).toBe('sum');
    expect(aggregateMode('mean')).toBe('average');
    expect(aggregateMode('avg')).toBe('average');
    expect(aggregateMode('chart')).toBeNull();
  });
  it('aggregateMode matches whole words, not substrings — "subtotal" is not "total"', () => {
    expect(aggregateMode('subtotal row')).toBeNull();
    expect(aggregateMode('meantime')).toBeNull();
    expect(aggregateMode('resume the chart')).toBeNull();
    expect(aggregateMode('total')).toBe('sum');
    expect(aggregateMode('mean')).toBe('average');
  });
  it('a NAMED column that turns out unusable is honoured, never silently swapped for another', () => {
    const doc: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '1', A2: '2', B1: 'x', B2: 'y' } };
    const v = validateActionCall('insert_object', { target: 'B', detail: 'sum' }, doc) as any;
    expect(v.error).toBeTruthy();
    expect(v.error).toContain('B');
    expect(v.ok).toBeUndefined();
  });
  it('confirm never bypasses a malformed call', () => {
    const v = validateActionCall('edit_content', { target: 'Cell B5', confirm: true }, excel()) as any;
    expect(v.error).toBeTruthy();
  });
  it('a genuine multi-word heading containing a placeholder word is real content', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Title of the report' }, word()))
      .toEqual({ ok: true });
  });
});
