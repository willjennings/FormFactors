import { describe, it, expect } from 'vitest';
import { wideCorpus } from './wideCorpus';
import { serializeMockDoc, PROGRAM_IDS } from '../scenarios';
import { initialArtifactState, reduce as artifactReduce, MAX_ARTIFACTS } from './artifactStore';

// Task 6 (performance-realism spec §3): the wide corpus removes the default seedCorpus()'s
// ceiling effect. These tests hold the generator to the brief's exact contract.
describe('wideCorpus determinism', () => {
  it('the same seed produces deep-equal output on two separate calls', () => {
    expect(wideCorpus(42)).toEqual(wideCorpus(42));
    expect(wideCorpus(7)).toEqual(wideCorpus(7));
  });
  it('a different seed produces different output somewhere', () => {
    const a = wideCorpus(42);
    const b = wideCorpus(7);
    expect(a).not.toEqual(b);
    // Sharpen the assertion: the excel cells (the seed-driven numbers/project picks) actually
    // differ, not just some incidental field.
    if (a.corpus.excel.kind !== 'excel' || b.corpus.excel.kind !== 'excel') throw new Error('kinds');
    expect(a.corpus.excel.cells).not.toEqual(b.corpus.excel.cells);
  });
  it('defaults to seed 42 when called with no argument', () => {
    expect(wideCorpus()).toEqual(wideCorpus(42));
  });
});

describe('wideCorpus schema validity', () => {
  const { corpus } = wideCorpus(42);
  it('produces all four programs with the right MockDoc kind', () => {
    for (const id of PROGRAM_IDS) expect(corpus[id].kind).toBe(id);
  });
  it('serializeMockDoc never contains the literal string "undefined" for any generated doc', () => {
    for (const id of PROGRAM_IDS) {
      const s = serializeMockDoc(corpus[id]);
      expect(s).not.toContain('undefined');
    }
  });
});

describe('wideCorpus size — the ceiling becomes measurable', () => {
  const { corpus } = wideCorpus(42);
  it('the spreadsheet has 30+ rows (header + 30+ data rows)', () => {
    if (corpus.excel.kind !== 'excel') throw new Error('kind');
    const rowNumbers = new Set(
      Object.keys(corpus.excel.cells).map((ref) => Number(ref.slice(1))),
    );
    expect(rowNumbers.size).toBeGreaterThanOrEqual(31); // header row 1 + 30+ data rows
  });
  it('the word and powerpoint docs are longer than the default seedCorpus() equivalents', () => {
    if (corpus.word.kind !== 'word' || corpus.powerpoint.kind !== 'powerpoint') throw new Error('kind');
    expect(corpus.word.text.length).toBeGreaterThan(300);
    expect(corpus.powerpoint.slides.length).toBeGreaterThanOrEqual(6);
  });
});

describe('wideCorpus near-collision labels — the deixis stressor', () => {
  it('at least three label pairs share a token (e.g. "Revenue" / "Net Revenue")', () => {
    const { corpus } = wideCorpus(42);
    if (corpus.excel.kind !== 'excel') throw new Error('kind');
    const labels = Object.entries(corpus.excel.cells)
      .filter(([ref]) => /^A\d+$/.test(ref) && ref !== 'A1')
      .map(([, v]) => v);
    const tokenOf = (label: string) => label.split(' ').filter((w) => w.length > 3);
    let collidingPairs = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        if (labels[i] === labels[j]) continue;
        const a = tokenOf(labels[i]);
        const b = tokenOf(labels[j]);
        if (a.some((t) => b.includes(t))) collidingPairs++;
      }
    }
    expect(collidingPairs).toBeGreaterThanOrEqual(3);
    // Name the literal pair the brief calls out, so the test fails loudly if that specific
    // near-collision ever gets renamed away rather than silently passing on some OTHER pair.
    expect(labels).toContain('Revenue');
    expect(labels).toContain('Net Revenue');
    expect(labels).toContain('Revenue Q2');
  });
});

describe('wideCorpus pre-seeded artifacts — real events through the real reducer', () => {
  it('folding artifactEvents through artifactReduce yields live artifacts with zero cap rejection', () => {
    const { artifactEvents } = wideCorpus(42);
    let state = initialArtifactState();
    for (const event of artifactEvents) state = artifactReduce(state, event);
    // CONTRACT NOTE (flagged, not silently resolved — see the comment at the seeding site in
    // wideCorpus.ts): the spec asked for 8-10 pre-seeded artifacts; MAX_ARTIFACTS is 6 and
    // "reject, never evict" is a standing product invariant (artifactStore.ts). The cap wins:
    // this generator seeds exactly MAX_ARTIFACTS artifacts, not 8-10.
    expect(artifactEvents).toHaveLength(MAX_ARTIFACTS);
    expect(state.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(state.rejectedAtCap).toBe(0);
    expect(state.rejectedStale).toBe(0);
  });
  it('a 7th create on top of the 6 seeded artifacts is rejected — the cap still holds', () => {
    const { artifactEvents, corpus } = wideCorpus(42);
    let state = initialArtifactState();
    for (const event of artifactEvents) state = artifactReduce(state, event);
    const seventh = artifactReduce(state, {
      type: 'artifact.create',
      artifact: { kind: 'doc', title: 'One Too Many', sources: ['word', 'excel'], content: 'x', createdAt: 1 },
    });
    expect(seventh.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(seventh.rejectedAtCap).toBe(1);
    expect(corpus.word.kind).toBe('word'); // sanity: corpus untouched by this probe
  });
});
