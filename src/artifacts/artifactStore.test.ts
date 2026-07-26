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
