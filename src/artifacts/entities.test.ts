import { describe, it, expect } from 'vitest';
import { artifactEntities } from './entities';
import { initialArtifactState, reduce } from './artifactStore';
import type { ArtifactState } from './types';

const state: ArtifactState = {
  artifacts: [
    { id: 'a1', kind: 'doc', title: 'Q3 Status Brief', sources: ['word', 'excel'], content: 'x', createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' }, history: [] },
    { id: 'a2', kind: 'widget', title: 'Status Board', sources: ['a1'], fields: [], createdAt: 2, rev: 1, meta: { rev: 1, at: 2, owner: 'agent' }, history: [] },
  ],
  nextId: 3,
  rejectedAtCap: 0,
  rejectedStale: 0,
};

describe('artifactEntities', () => {
  it('maps each artifact to a pointable, resolvable entity', () => {
    const es = artifactEntities(state, { 'artifact-a1': [10, 20, 30, 40] });
    // artifactEntities' contract widened in Task 4 to also return part entities (sub: true);
    // this test is about WHOLE artifacts, so it counts/indexes only the sub:false slice.
    const whole = es.filter((e) => !e.sub);
    expect(whole).toHaveLength(2);
    expect(whole[0].id).toBe('artifact-a1');
    expect(whole[0].title).toBe('Q3 Status Brief');
    expect(whole[0].category).toBe('content');
    expect(whole[0].sub).toBe(false);
    expect(whole[0].bbox).toEqual([10, 20, 30, 40]);
    // Resolvable via id, title, and "the <kind>" — the aliases a model would echo back.
    expect(whole[0].aliases).toEqual(expect.arrayContaining(['a1', 'q3 status brief', 'the doc']));
    expect(whole[1].id).toBe('artifact-a2');
    expect(whole[1].aliases).toEqual(expect.arrayContaining(['a2', 'status board', 'the widget']));
  });

  it('degrades honestly to a zero bbox when the window has not been measured yet', () => {
    const es = artifactEntities(state, {});
    expect(es[0].bbox).toEqual([0, 0, 0, 0]);
    expect(es[1].bbox).toEqual([0, 0, 0, 0]);
  });

  it('empty artifact state yields no entities', () => {
    expect(artifactEntities({ artifacts: [], nextId: 1, rejectedAtCap: 0, rejectedStale: 0 }, {})).toEqual([]);
  });
});

describe('kind-alias collision (final review M3 — "the doc" must not silently pick one of two)', () => {
  const mk = (title: string) => ({ type: 'artifact.create' as const, artifact: { kind: 'doc' as const, title, sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
  it('a lone doc artifact keeps the "the doc" alias', () => {
    const st = reduce(initialArtifactState(), mk('Summary'));
    const es = artifactEntities(st, {});
    expect(es[0].aliases).toContain('the doc');
  });
  it('two doc artifacts → NEITHER carries the ambiguous kind alias; titles still resolve', () => {
    let st = reduce(initialArtifactState(), mk('Summary'));
    st = reduce(st, mk('Update'));
    const es = artifactEntities(st, {});
    for (const e of es) expect(e.aliases).not.toContain('the doc');
    expect(es[0].aliases).toContain('summary');
    expect(es[1].aliases).toContain('update');
  });
});

describe('artifact sub-entities (paragraphs and fields)', () => {
  it('derives pointable doc paragraphs with ordinal and first-words aliases', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'Revenue reached 12M\n\nHarbor is behind schedule',
      createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    const ents = artifactEntities(st, { 'artifact-a1-para-2': [10, 20, 30, 40] });
    const p2 = ents.find((e) => e.id === 'artifact-a1-para-2')!;
    expect(p2.sub).toBe(true);
    expect(p2.bbox).toEqual([10, 20, 30, 40]);
    expect(p2.aliases).toContain('paragraph 2');
    expect(p2.aliases).toContain('second paragraph');
    expect(p2.aliases.some((a) => a.includes('harbor'))).toBe(true);
  });

  // Fix round 1: resolveEchoedTarget's ≥2-token overlap floor guards only the bare-overlap
  // fallback branch — a one-word alias exact-matches (or subset-matches) a one-word echo and
  // wins outright, unprotected. A single common word like "Approved" must not become a
  // silently-grounding alias; the honest outcome for that ambiguity is no first-words alias at
  // all, not a coin flip. The part must stay reachable via "paragraph N" and its ordinal form.
  it('a single-word paragraph gets no first-words alias, but keeps ordinal + ordinal-word forms', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'Approved',
      createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    const p1 = artifactEntities(st, {}).find((e) => e.id === 'artifact-a1-para-1')!;
    expect(p1.aliases).toContain('paragraph 1');
    expect(p1.aliases).toContain('first paragraph');
    expect(p1.aliases).not.toContain('approved');
    expect(p1.aliases.some((a) => a.includes('approved'))).toBe(false);
  });

  it('derives widget fields aliased by their label', () => {
    const st = { artifacts: [{ id: 'a2', kind: 'widget' as const, title: 'Board',
      sources: ['word'], fields: [{ label: 'Lead project', value: 'Harbor' }],
      createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 3, rejectedAtCap: 0, rejectedStale: 0 };
    const f1 = artifactEntities(st, {}).find((e) => e.id === 'artifact-a2-field-1')!;
    expect(f1.sub).toBe(true);
    expect(f1.aliases).toContain('lead project');
  });

  it('an unmeasured part degrades to a zero bbox — never a guessed position', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'only one', createdAt: 1, rev: 1,
      meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    expect(artifactEntities(st, {}).find((e) => e.id === 'artifact-a1-para-1')!.bbox).toEqual([0, 0, 0, 0]);
  });

  // Renumbering guard: entity order feeds a numbered-selection UI elsewhere in the app, so
  // whole-artifact entities must keep their pre-Task-4 relative order and positions — parts are
  // appended after ALL wholes, never interleaved between them (which would have shifted a2 from
  // index 1 to index later, silently renumbering an existing pointable target).
  it('keeps whole-artifact entities in original relative order, with parts appended after — never interleaved', () => {
    const es = artifactEntities(state, {});
    const whole = es.filter((e) => !e.sub);
    const parts = es.filter((e) => e.sub);
    expect(whole.map((e) => e.id)).toEqual(['artifact-a1', 'artifact-a2']);
    expect(es.indexOf(whole[0])).toBe(0);
    expect(es.indexOf(whole[1])).toBe(1);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => es.indexOf(p) > es.indexOf(whole[1]))).toBe(true);
  });
});
