import { describe, it, expect } from 'vitest';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';

const mk = (title = 'T') => ({ type: 'artifact.create' as const, artifact: { kind: 'doc' as const, title, sources: ['word', 'excel'], content: 'x', createdAt: 1000 } });

describe('artifactStore', () => {
  it('creates with deterministic ids', () => {
    let st = reduce(initialArtifactState(), mk('One'));
    st = reduce(st, mk('Two'));
    expect(st.artifacts.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
  it('REJECTS at MAX_ARTIFACTS — never evicts (spec §7, the beautify lesson)', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) st = reduce(st, mk(`A${i}`));
    const full = reduce(st, mk('overflow'));
    expect(full.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(full.artifacts.map((a) => a.title)).not.toContain('overflow');
    expect(full.artifacts[0].title).toBe('A0'); // the oldest SURVIVES
    expect(full.rejectedAtCap).toBe(1);
  });
  it('close removes exactly the named artifact; unknown id is a no-op', () => {
    let st = reduce(initialArtifactState(), mk('One'));
    st = reduce(st, mk('Two'));
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    expect(st.artifacts.map((a) => a.id)).toEqual(['a2']);
    expect(reduce(st, { type: 'artifact.close', id: 'zzz' })).toEqual(st);
  });
  it('a close frees capacity for a new create (and resets nothing else)', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) st = reduce(st, mk(`A${i}`));
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    st = reduce(st, mk('fits-now'));
    expect(st.artifacts.map((a) => a.title)).toContain('fits-now');
  });
  it('creation starts at rev 1 with empty history', () => {
    const st = reduce(initialArtifactState(), mk('One'));
    expect(st.artifacts[0].rev).toBe(1);
    expect(st.artifacts[0].history).toEqual([]);
    expect(st.artifacts[0].meta).toEqual({ rev: 1, at: 1000, owner: 'agent' });
  });
});

describe('artifactStore — revisions', () => {
  const seed = () => reduce(initialArtifactState(), {
    type: 'artifact.create' as const,
    artifact: { kind: 'doc' as const, title: 'Brief', sources: ['word', 'excel'],
                content: 'alpha\n\nbeta', createdAt: 1000 },
  });
  const revise = (id: string, baseRev: number, patch: any, at = 2000, owner: 'agent' | 'user' = 'agent', note?: string) =>
    ({ type: 'artifact.revise' as const, id, baseRev, patch, owner, at, note });

  it('applies a revision, bumps rev, and pushes the PRIOR version onto history', () => {
    const st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }, 2000, 'agent', 'shouted it'));
    const a = st.artifacts[0];
    expect(a.rev).toBe(2);
    expect(a.content).toBe('ALPHA\n\nbeta');
    expect(a.meta).toEqual({ rev: 2, at: 2000, owner: 'agent', note: 'shouted it' });
    expect(a.history).toHaveLength(1);
    expect(a.history[0].rev).toBe(1);
    expect(a.history[0].content).toBe('alpha\n\nbeta');
  });

  it('REJECTS a stale baseRev — counts it, changes nothing else', () => {
    let st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }));
    const before = st.artifacts[0];
    st = reduce(st, revise('a1', 1, { op: 'replace-part', index: 2, text: 'BETA' }, 3000));
    expect(st.rejectedStale).toBe(1);
    expect(st.artifacts[0]).toEqual(before); // untouched — no partial application
  });

  it('an illegal patch is a clean no-op (the validator makes this unreachable live)', () => {
    const st0 = seed();
    expect(reduce(st0, revise('a1', 1, { op: 'replace-part', index: 9, text: 'x' }))).toEqual(st0);
  });

  it('an unknown id is a clean no-op — replay must be deterministic', () => {
    const st0 = seed();
    expect(reduce(st0, revise('zzz', 1, { op: 'retitle', title: 'x' }))).toEqual(st0);
  });

  it('revising NEVER runs the capacity cap — a revise succeeds with the desk full', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) {
      st = reduce(st, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`,
        sources: ['word', 'excel'], content: 'alpha', createdAt: 1000 } });
    }
    st = reduce(st, revise('a1', 1, { op: 'retitle', title: 'Renamed' }));
    expect(st.artifacts[0].title).toBe('Renamed');
    expect(st.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(st.rejectedAtCap).toBe(0);
  });

  it('revertTo mints a NEW revision — the timeline stays append-only', () => {
    let st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }));
    st = reduce(st, { type: 'artifact.revertTo', id: 'a1', toRev: 1, at: 4000 });
    const a = st.artifacts[0];
    expect(a.rev).toBe(3);                       // not 1 — nothing is erased
    expect(a.content).toBe('alpha\n\nbeta');     // rev 1's content is back
    expect(a.meta).toEqual({ rev: 3, at: 4000, owner: 'user', note: 'reverted to rev 1' });
    expect(a.history.map((v) => v.rev)).toEqual([1, 2]);
  });

  it('revertTo an unknown rev is a no-op', () => {
    const st0 = seed();
    expect(reduce(st0, { type: 'artifact.revertTo', id: 'a1', toRev: 7, at: 4000 })).toEqual(st0);
  });
});
