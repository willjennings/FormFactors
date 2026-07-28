import { describe, it, expect } from 'vitest';
import {
  askCallToState, ASK_CONTENT_TOOL, MAX_CANDIDATES, ASK_FIELDS,
  askChips, chipRowFor, isAskCandidateChip, chipCloseOfAsk, answeredFromCandidate, gateAskAck, type AskState,
} from './askContent';
import { validateActionCall } from './validate';
import { seedCorpus } from '../artifacts/seeds';

describe('ASK_CONTENT_TOOL', () => {
  it('has flat parameters — nested object-arrays are the d24abef schema hazard', () => {
    for (const p of Object.values(ASK_CONTENT_TOOL.parameters.properties as Record<string, any>)) {
      expect(p.type === 'object').toBe(false);
    }
    expect(ASK_CONTENT_TOOL.parameters.required).toEqual(['field', 'question']);
  });
});

describe('askCallToState', () => {
  it('accepts a question with candidates', () => {
    const v = askCallToState({ field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] });
    expect(v).toEqual({ ask: { field: 'heading', question: 'What would you like the heading to say?', candidates: ['Q3 Summary', 'Meridian Q3'] } });
  });
  it('accepts a bare question — the model asks plainly rather than padding', () => {
    const v = askCallToState({ field: 'body', question: 'What should it say?' }) as any;
    expect(v.ask.candidates).toEqual([]);
  });
  it('rejects an empty question', () => {
    expect((askCallToState({ field: 'heading', question: '  ' }) as any).error).toBeTruthy();
  });
  it('rejects an unknown field, naming the valid ones', () => {
    const v = askCallToState({ field: 'nonsense', question: 'What?' }) as any;
    expect(v.error).toContain('heading');
    expect(v.error).toContain('slideTitle');
  });
  it(`caps candidates at ${MAX_CANDIDATES} rather than truncating silently`, () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['a', 'b', 'c', 'd'] }) as any;
    expect(v.error).toContain(String(MAX_CANDIDATES));
  });
  it('refuses non-string candidates rather than stringifying them into chips', () => {
    // `map(String)` before the blank-filter turned [null, undefined, {}] into three FIREABLE chips
    // reading "null", "undefined", "[object Object]" — and "null" is not in PLACEHOLDERS, so the
    // gate would have passed it and the literal word null would land in the document. That is the
    // origin bug in a different costume, manufactured by the surface meant to prevent it.
    for (const junk of [[null], [undefined], [{}], ['Real', null], [['nested']]]) {
      const v = askCallToState({ field: 'heading', question: 'What?', candidates: junk }) as any;
      expect(v.ask).toBeUndefined();
      expect(v.error).toMatch(/string/i);
    }
  });
  it('drops blank candidates instead of rendering empty chips', () => {
    const v = askCallToState({ field: 'heading', question: 'What?', candidates: ['Real', '  ', ''] }) as any;
    expect(v.ask.candidates).toEqual(['Real']);
  });
});

const ask = (candidates: string[]): AskState => ({ field: 'heading', question: 'What?', candidates });

describe('askChips — the ask owns the chip row', () => {
  it('maps candidates to digit-fireable chips carrying the candidate text verbatim', () => {
    const chips = askChips(ask(['Q3 Summary', 'Meridian Q3']));
    expect(chips.map(c => c.phrase)).toEqual(['Q3 Summary', 'Meridian Q3']);
    expect(chips.map(c => c.key)).toEqual(['ask-0', 'ask-1']);       // stable keys, index-ordered
    expect(new Set(chips.map(c => c.color)).size).toBe(1);           // one colour: this is one row
  });
  it('no ask, or an ask with no candidates, offers nothing — silence is not a default answer', () => {
    expect(askChips(null)).toEqual([]);
    expect(askChips(ask([]))).toEqual([]);
  });
});

describe('chipRowFor — an ask takes the row only when it has something to put in it', () => {
  const normal = [{ key: 'k', label: 'Bold', phrase: 'make it bold', color: '1,2,3' }];
  it('candidates own the row, replacing the normal chips', () => {
    expect(chipRowFor(ask(['Q3 Summary']), normal).map(c => c.phrase)).toEqual(['Q3 Summary']);
  });
  it('an ask with NO candidates leaves the normal chips alone', () => {
    // The gate backstop opens exactly this ask — the origin path. Blanking the row there would
    // cost the user every chip and hand back none, on the one path this whole plan exists for.
    expect(chipRowFor(ask([]), normal)).toEqual(normal);
    expect(chipRowFor(null, normal)).toEqual(normal);
  });
});

describe('isAskCandidateChip — whose chip was that', () => {
  it('only the ask\'s own chips are the ask\'s', () => {
    const a = ask(['Q3 Summary', 'Meridian Q3']);
    expect(isAskCandidateChip(a, 'ask-0')).toBe(true);
    expect(isAskCandidateChip(a, 'ask-1')).toBe(true);
    // The word program's own chip ("Add a heading here") sits in the row under a BARE ask, and
    // firing it must not be recorded as the user answering the question — that phrase mentions
    // "heading", which was chain A of the origin bug reaching the document.
    expect(isAskCandidateChip(a, 'word.heading')).toBe(false);
    expect(isAskCandidateChip(a, 'ask-2')).toBe(false);       // beyond the candidates offered
    expect(isAskCandidateChip(ask([]), 'word.heading')).toBe(false);
    expect(isAskCandidateChip(null, 'ask-0')).toBe(false);
  });
});

describe('chipCloseOfAsk — one verdict per keypress, not one per layer', () => {
  it('an ordinary chip under a BARE ask closes the question without answering it', () => {
    // The licence layer already refused to treat this as an answer (isAskCandidateChip above);
    // the quick-fire call site passed `answered: true` regardless, so the same keypress was an
    // answer to telemetry and not an answer to the gate — and the wrong one fed `asks.answered`,
    // the headline number of the whole classification.
    expect(chipCloseOfAsk(ask([]), 'word.heading', 'Add a heading here'))
      .toEqual({ answered: false, viaChip: false });
    // No text either: `answered` with no answer is the shape that made it possible.
    expect(chipCloseOfAsk(ask([]), 'word.heading', 'Add a heading here').text).toBeUndefined();
    // Same under an ask that HAS candidates, when the chip fired is not one of them.
    expect(chipCloseOfAsk(ask(['Q3 Summary']), 'word.heading', 'Add a heading here'))
      .toEqual({ answered: false, viaChip: false });
  });
  it('one of the ask\'s OWN chips is an answer, and carries the words the user chose', () => {
    expect(chipCloseOfAsk(ask(['Q3 Summary', 'Meridian Q3']), 'ask-1', 'Meridian Q3'))
      .toEqual({ answered: true, viaChip: true, text: 'Meridian Q3' });
  });
  it('answered is never claimed without the text that justifies it', () => {
    for (const [a, key] of [[ask([]), 'word.heading'], [ask(['Q3']), 'ask-0'],
                            [null, 'ask-0'], [ask(['Q3']), 'ask-9']] as const) {
      const c = chipCloseOfAsk(a, key, 'whatever');
      expect(c.answered).toBe(!!c.text?.trim());
    }
  });
});

describe('answeredFromCandidate — was the offer actually used', () => {
  it('matches a candidate regardless of case, padding or collapsed whitespace', () => {
    expect(answeredFromCandidate(ask(['Q3 Summary']), '  q3   summary ')).toBe(true);
  });
  it('survives the transcript cleaner, which strips the punctuation we offered', () => {
    // App's processInputTranscript drops any character outside [a-zA-Z0-9\s.,?!'":;-] before
    // this ever runs, so the answer never comes back byte-identical to the candidate.
    expect(answeredFromCandidate(ask(['Meridian — Q3']), 'Meridian Q3')).toBe(true);
    expect(answeredFromCandidate(ask(['Q3 Summary.']), 'Q3 summary')).toBe(true);
  });
  it('the user\'s own words are not a candidate answer', () => {
    expect(answeredFromCandidate(ask(['Q3 Summary']), 'Revenue, honestly')).toBe(false);
    expect(answeredFromCandidate(ask(['Q3 Summary']), '')).toBe(false);
    expect(answeredFromCandidate(null, 'Q3 Summary')).toBe(false);
    expect(answeredFromCandidate(ask([]), '')).toBe(false);
  });
});

describe('the gate hands off to the ask surface (bound to seedCorpus — the doc the app boots)', () => {
  it('the origin bug: "add a heading" asks the user instead of writing the word "Heading"', () => {
    const v = validateActionCall('edit_content', { target: 'heading' }, seedCorpus().word) as any;
    expect(v.needsContent.question).toBe('What would you like the heading to say?');
    const a = gateAskAck('edit_content', v.needsContent);
    expect(a.success).toBe(false);
    expect(a.ask).toBe(v.needsContent.question);        // the USER's half is the bare question
    expect(a.error).toContain('ask_content');           // the MODEL's half names the tool it has
    expect(a.error).toContain('edit_content');          // …and the verb to retry
    expect(a.error).toMatch(/never send a placeholder/i);
    expect(a.error).not.toMatch(/do NOT call a tool/i); // the Task-4 interim wording is gone
  });
  it('every field the gate can name is a field ask_content accepts — the halves cannot drift', () => {
    const corpus = seedCorpus();
    for (const [doc, target] of [[corpus.word, 'heading'], [corpus.word, 'Document body'],
                                 [corpus.powerpoint, 'Slide canvas']] as const) {
      const v = validateActionCall('edit_content', { target }, doc) as any;
      expect(ASK_FIELDS).toContain(v.needsContent.field);
      const st = askCallToState({ field: v.needsContent.field, question: v.needsContent.question,
                                  candidates: ['One good answer'] }) as any;
      expect(st.error).toBeUndefined();
      expect(askChips(st.ask).map(c => c.phrase)).toEqual(['One good answer']);
    }
  });
});
