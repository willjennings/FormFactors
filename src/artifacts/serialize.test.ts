import { describe, it, expect } from 'vitest';
import { serializeCorpus, serializeArtifacts } from './serialize';
import { seedCorpus } from './seeds';
import { initialArtifactState, reduce } from './artifactStore';

describe('serializeCorpus — gists, not dumps (spec §3/§12)', () => {
  it('names each doc with a one-line gist and NO full text', () => {
    const s = serializeCorpus(seedCorpus())!;
    expect(s).toMatch(/^\[CORPUS: /);
    expect(s).toContain('word:');
    expect(s).toContain('excel:');
    expect(s).not.toContain('crane availability'); // full report text must NOT be in standing context
    expect(s.length).toBeLessThan(600);
    expect(s).toContain('read_sources');
    expect(s).toContain('DO NOT acknowledge');
  });
  it('is null for an empty corpus', () => {
    expect(serializeCorpus({})).toBeNull();
  });
});

describe('serializeArtifacts', () => {
  it('lists id, kind, title, provenance; notes rejectedAtCap; null when empty', () => {
    expect(serializeArtifacts(initialArtifactState())).toBeNull();
    let st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Exec summary', sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const s = serializeArtifacts(st)!;
    expect(s).toMatch(/^\[ARTIFACTS: /);
    expect(s).toContain('a1 "Exec summary" (doc, from: word + excel)');
    const rejected = { ...st, rejectedAtCap: 2 };
    expect(serializeArtifacts(rejected)).toContain('2 creations were rejected at the 6-artifact cap');
  });
  it('widget entries carry per-field feed provenance (spec §8 — the hint never lets simulated pass as real)', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: {
      kind: 'widget', title: 'Status Board', sources: ['a1', 'excel'], createdAt: 1,
      fields: [{ label: 'Lead project', value: 'Riverside Tower' }, { label: 'Local time', feed: 'clock' }, { label: 'MERI', feed: 'stock' }],
    } });
    const s = serializeArtifacts(st)!;
    expect(s).toContain('a1 "Status Board" (widget, from: a1 + excel; feeds: clock LIVE, stock SIMULATED)');
  });
  it('a widget with only static fields gets no feeds clause', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: {
      kind: 'widget', title: 'Static Board', sources: ['word', 'excel'], createdAt: 1,
      fields: [{ label: 'Project', value: 'Riverside Tower' }],
    } });
    const s = serializeArtifacts(st)!;
    expect(s).toContain('a1 "Static Board" (widget, from: word + excel)');
    expect(s).not.toContain('feeds:');
  });
});

describe('[ARTIFACTS] retraction + cap-note grammar (final review M1 + nit)', () => {
  it('boot state (nothing ever created) stays null — no session-start noise', () => {
    expect(serializeArtifacts(initialArtifactState())).toBeNull();
  });
  it('empty AFTER artifacts existed → explicit "none" retraction so the model\'s map stays current', () => {
    let st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'T', sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    const s = serializeArtifacts(st)!;
    expect(s).toMatch(/\[ARTIFACTS: none/);
    expect(s).toMatch(/closed/i);
    expect(s).toContain('DO NOT acknowledge');
  });
  it('a single rejection reads "1 creation was rejected", not "1 creations were"', () => {
    const st = { ...initialArtifactState(), rejectedAtCap: 1 };
    expect(serializeArtifacts(st)).toContain('1 creation was rejected');
  });
});
