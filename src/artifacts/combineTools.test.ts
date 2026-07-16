import { describe, it, expect } from 'vitest';
import { validateCombineCall, sourceDetail, COMBINE_TOOL, READ_SOURCES_TOOL } from './combineTools';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';
import { seedCorpus } from './seeds';

const corpus = seedCorpus();
const now = 5000;

describe('combine validation (spec §4/§5/§7)', () => {
  it('declares the two tools', () => {
    expect(COMBINE_TOOL.name).toBe('combine');
    expect(READ_SOURCES_TOOL.name).toBe('read_sources');
  });
  it('valid doc combine → create event + provenance line', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'Exec summary', content: 'Q3 in brief…' }, corpus, initialArtifactState(), now);
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.event.type).toBe('artifact.create');
      expect(r.provenance).toBe('from: word + excel');
    }
  });
  it('fewer than 2 sources → error pointing at single-target verbs', () => {
    const r = validateCombineCall({ sources: ['word'], kind: 'doc', title: 'T', content: 'x' }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/at least 2|two sources/i);
  });
  it('unknown source fails the WHOLE call naming valid ids (incl. live artifact ids)', () => {
    let arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'p', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'nope'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now) as { error: string };
    expect(r.error).toContain('nope');
    expect(r.error).toContain('a1');
    expect(r.error).toContain('excel');
  });
  it('artifact ids are valid sources (closure under composition)', () => {
    const arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'p', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['a1', 'photo'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now);
    expect('error' in r).toBe(false);
  });
  it('at capacity → rejection naming the cap (never relies on the reducer alone)', () => {
    let arts = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) arts = reduce(arts, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`, sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now) as { error: string };
    expect(r.error).toContain(`${MAX_ARTIFACTS}`);
    expect(r.error).toMatch(/close/i);
  });
  it('doc kind requires non-empty content; M1 rejects widget kind honestly', () => {
    expect(validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: '' }, corpus, initialArtifactState(), now)).toHaveProperty('error');
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'x' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/widget/i); // replaced by real support in Task 7
  });
});

describe('sourceDetail (read_sources → [CORPUS DETAIL])', () => {
  it('returns full doc text for programs, artifact content for artifacts, null for unknown', () => {
    expect(sourceDetail('word', corpus, initialArtifactState())).toContain('Meridian');
    const arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'PREV-CONTENT', createdAt: 1 } });
    expect(sourceDetail('a1', corpus, arts)).toContain('PREV-CONTENT');
    expect(sourceDetail('zzz', corpus, arts)).toBeNull();
  });
  it('the photo detail is its caption/metadata line, never pretend pixel-reading', () => {
    const d = sourceDetail('photo', corpus, initialArtifactState())!;
    expect(d).toContain('Riverside Tower');
    expect(d).toContain('caption');
  });
});
