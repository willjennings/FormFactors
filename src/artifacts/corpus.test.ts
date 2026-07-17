import { describe, it, expect } from 'vitest';
import { saveAndLoad } from './corpus';
import { seedCorpus } from './seeds';
import type { MockDoc } from '../scenarios';

describe('corpus persistence (spec §3: docs survive program swaps)', () => {
  it('saves the outgoing doc and loads a previously saved incoming doc', () => {
    const edited: MockDoc = { kind: 'word', text: 'EDITED', bold: true, saved: false };
    const r1 = saveAndLoad({}, 'word', edited, 'excel');
    expect(r1.corpus.word).toEqual(edited);
    expect(r1.doc.kind).toBe('excel'); // seeded fallback
    const backToWord = saveAndLoad(r1.corpus, 'excel', r1.doc, 'word');
    expect(backToWord.doc).toEqual(edited); // NOT reset — the fix this module exists for
  });
  it('falls back to the Meridian seed for a never-visited program', () => {
    const r = saveAndLoad({}, 'word', seedCorpus().word, 'powerpoint');
    expect(r.doc).toEqual(seedCorpus().powerpoint);
  });
});
