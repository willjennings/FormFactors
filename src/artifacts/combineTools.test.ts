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
  it('doc kind requires non-empty content', () => {
    expect(validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: '' }, corpus, initialArtifactState(), now)).toHaveProperty('error');
  });
});

describe('widget validation (spec §8 — M2 real support)', () => {
  it('valid widget combine (static + bound fields) → create event carrying fields', () => {
    const r = validateCombineCall({
      sources: ['word', 'excel'], kind: 'widget', title: 'Status board',
      fields: [{ label: 'Project', value: 'Riverside Tower' }, { label: 'Time', feed: 'clock' }, { label: 'MERI', feed: 'stock' }],
    }, corpus, initialArtifactState(), now);
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.event.type).toBe('artifact.create');
      const artifact = (r.event as Extract<typeof r.event, { type: 'artifact.create' }>).artifact;
      expect(artifact.kind).toBe('widget');
      expect(artifact.fields).toEqual([
        { label: 'Project', value: 'Riverside Tower' },
        { label: 'Time', feed: 'clock' },
        { label: 'MERI', feed: 'stock' },
      ]);
      expect(r.provenance).toBe('from: word + excel');
    }
  });
  it('needs at least one field', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/field/i);
  });
  it('rejects an empty label', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: '  ', value: 'x' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/label/i);
  });
  it('a field needs either a value or a feed', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'x' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/value|feed/i);
  });
  it('a field with BOTH a feed and a static value is rejected honestly, never silently dropped', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'Time', feed: 'clock', value: '9:00 AM' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toContain('Time');
    expect(r.error).toMatch(/both.*feed.*value|both.*value.*feed/i);
  });
  it('unknown feed id fails naming valid registry ids', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'x', feed: 'bitcoin' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toContain('bitcoin');
    expect(r.error).toContain('clock');
    expect(r.error).toContain('weather');
    expect(r.error).toContain('stock');
  });
  it('respects the same capacity rejection as doc kind', () => {
    let arts = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) arts = reduce(arts, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`, sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'x', feed: 'clock' }] }, corpus, arts, now) as { error: string };
    expect(r.error).toContain(`${MAX_ARTIFACTS}`);
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
