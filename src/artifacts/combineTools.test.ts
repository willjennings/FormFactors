import { describe, it, expect } from 'vitest';
import { validateCombineCall, validSourceIds, sourceDetail, COMBINE_TOOL, READ_SOURCES_TOOL } from './combineTools';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';
import { serializeArtifacts } from './serialize';
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
  it('a live-path cap rejection carries atCap + the event so the caller can dispatch it — the reducer counts it and [ARTIFACTS] surfaces the note (spec §7)', () => {
    let arts = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) arts = reduce(arts, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`, sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now);
    expect(r).toHaveProperty('error');
    if ('error' in r) {
      expect(r.atCap).toBe(true);
      expect(r.event?.type).toBe('artifact.create');
      // The App dispatches the refused event on atCap: reducer refuses, counter increments, nothing evicted.
      const after = reduce(arts, r.event!);
      expect(after.artifacts).toHaveLength(MAX_ARTIFACTS);
      expect(after.rejectedAtCap).toBe(arts.rejectedAtCap + 1);
      expect(serializeArtifacts(after)).toContain(`1 creation was rejected at the ${MAX_ARTIFACTS}-artifact cap`);
    }
  });
  it('non-cap validation failures carry NO atCap/event — nothing to dispatch', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: '' }, corpus, initialArtifactState(), now);
    if ('error' in r) {
      expect(r.atCap).toBeUndefined();
      expect(r.event).toBeUndefined();
    } else {
      expect.fail('expected an error result');
    }
  });
});

describe('validSourceIds — validity is DERIVED from corpus presence, never asserted (final review C1)', () => {
  it('names only corpus-present programs plus live artifact ids', () => {
    const partial = { word: seedCorpus().word, excel: seedCorpus().excel }; // powerpoint/photo never visited
    const arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'p', createdAt: 1 } });
    expect(validSourceIds(partial, arts)).toEqual(['word', 'excel', 'a1']);
  });
  it('agrees with what resolveSources accepts and what the rejection message must name', () => {
    const partial = { word: seedCorpus().word };
    expect(validSourceIds(partial, initialArtifactState())).toEqual(['word']);
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

describe('duplicate-combine gate (live smoke 2026-07-16: model repetition created one artifact 3x in a turn)', () => {
  const dupArgs = { sources: ['word', 'excel'], kind: 'doc', title: 'Project Update', content: 'x' };
  it('same title + same sources as an EXISTING artifact → honest rejection naming it', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Project Update', sources: ['word', 'excel'], content: 'v1', createdAt: 1 } });
    const r = validateCombineCall(dupArgs, corpus, st, now);
    expect('error' in r && r.error).toMatch(/a1/);
    expect('error' in r && r.error).toMatch(/already/i);
    expect((r as { event?: unknown }).event).toBeUndefined(); // nothing to dispatch — not a cap rejection
  });
  it('title match is case-insensitive and source order does not matter', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'project update', sources: ['excel', 'word'], content: 'v1', createdAt: 1 } });
    const r = validateCombineCall(dupArgs, corpus, st, now);
    expect('error' in r).toBe(true);
  });
  it('same title with DIFFERENT sources is a legitimate new artifact', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Project Update', sources: ['word', 'photo'], content: 'v1', createdAt: 1 } });
    const r = validateCombineCall(dupArgs, corpus, st, now);
    expect('event' in r && r.event?.type).toBe('artifact.create');
  });
  it('re-creating after the user closed the original is allowed (no ghost cooldown state)', () => {
    let st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Project Update', sources: ['word', 'excel'], content: 'v1', createdAt: 1 } });
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    const r = validateCombineCall(dupArgs, corpus, st, now);
    expect('event' in r && r.event?.type).toBe('artifact.create');
  });
});

describe('sourceDetail feed provenance (final review M2 — the one surface the provenance pass missed)', () => {
  it('widget detail carries the same LIVE/SIMULATED summary as hint and chips', () => {
    const st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: {
      kind: 'widget', title: 'Board', sources: ['word', 'excel'], createdAt: 1,
      fields: [{ label: 'Time', feed: 'clock' }, { label: 'MERI', feed: 'stock' }] } });
    const d = sourceDetail('a1', corpus, st)!;
    expect(d).toContain('feeds: clock LIVE, stock SIMULATED');
  });
});

describe('sourceDetail — revision history (task-3)', () => {
  it('sourceDetail doubles as the history reader — no separate tool', () => {
    const artifacts = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'ALPHA', createdAt: 1, rev: 2,
      meta: { rev: 2, at: 9, owner: 'agent' as const, note: 'tightened intro' },
      history: [{ rev: 1, title: 'Brief', content: 'alpha',
                  meta: { rev: 1, at: 1, owner: 'agent' as const } }] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    const out = sourceDetail('a1', {}, artifacts)!;
    expect(out).toContain('rev 1 (agent)');
    expect(out).toContain('rev 2 (agent, "tightened intro")');
  });
});
