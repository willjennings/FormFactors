import { describe, it, expect } from 'vitest';
import { artifactEntities } from './entities';
import { initialArtifactState, reduce } from './artifactStore';
import type { ArtifactState } from './types';

const state: ArtifactState = {
  artifacts: [
    { id: 'a1', kind: 'doc', title: 'Q3 Status Brief', sources: ['word', 'excel'], content: 'x', createdAt: 1 },
    { id: 'a2', kind: 'widget', title: 'Status Board', sources: ['a1'], fields: [], createdAt: 2 },
  ],
  nextId: 3,
  rejectedAtCap: 0,
};

describe('artifactEntities', () => {
  it('maps each artifact to a pointable, resolvable entity', () => {
    const es = artifactEntities(state, { 'artifact-a1': [10, 20, 30, 40] });
    expect(es).toHaveLength(2);
    expect(es[0].id).toBe('artifact-a1');
    expect(es[0].title).toBe('Q3 Status Brief');
    expect(es[0].category).toBe('content');
    expect(es[0].sub).toBe(false);
    expect(es[0].bbox).toEqual([10, 20, 30, 40]);
    // Resolvable via id, title, and "the <kind>" — the aliases a model would echo back.
    expect(es[0].aliases).toEqual(expect.arrayContaining(['a1', 'q3 status brief', 'the doc']));
    expect(es[1].id).toBe('artifact-a2');
    expect(es[1].aliases).toEqual(expect.arrayContaining(['a2', 'status board', 'the widget']));
  });

  it('degrades honestly to a zero bbox when the window has not been measured yet', () => {
    const es = artifactEntities(state, {});
    expect(es[0].bbox).toEqual([0, 0, 0, 0]);
    expect(es[1].bbox).toEqual([0, 0, 0, 0]);
  });

  it('empty artifact state yields no entities', () => {
    expect(artifactEntities({ artifacts: [], nextId: 1, rejectedAtCap: 0 }, {})).toEqual([]);
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
