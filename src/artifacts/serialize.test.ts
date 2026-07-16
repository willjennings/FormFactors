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
});
