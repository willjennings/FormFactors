import { describe, it, expect } from 'vitest';
import { validateRefineCall, validPartIds, describePatch, REFINE_TOOL } from './refineTools';
import type { Artifact, ArtifactState } from './types';

const art = (over: Partial<Artifact> = {}): Artifact => ({
  id: 'a1', kind: 'doc', title: 'Brief', sources: ['word', 'excel'],
  content: 'alpha\n\nbeta', createdAt: 1000, rev: 2,
  meta: { rev: 2, at: 1000, owner: 'agent' }, history: [], ...over,
});
const state = (artifacts: Artifact[]): ArtifactState =>
  ({ artifacts, nextId: artifacts.length + 1, rejectedAtCap: 0, rejectedStale: 0 });

const call = (over: Record<string, any> = {}) =>
  ({ artifactId: 'a1', baseRev: 2, op: 'replace-part', index: 1, text: 'ALPHA', ...over });

describe('REFINE_TOOL', () => {
  it('takes flat args — nested object-arrays are the d24abef Gemini schema hazard', () => {
    for (const p of Object.values(REFINE_TOOL.parameters.properties as Record<string, any>)) {
      expect(p.type).not.toBe('array');
      expect(p.type).not.toBe('object');
    }
    expect(REFINE_TOOL.parameters.required).toEqual(['artifactId', 'baseRev', 'op']);
  });
});

describe('validateRefineCall', () => {
  it('produces a revise event for a legal call', () => {
    const v = validateRefineCall(call({ note: 'shouted it' }), state([art()]), 5000);
    expect(v).toEqual({ event: { type: 'artifact.revise', id: 'a1', baseRev: 2,
      patch: { op: 'replace-part', index: 1, text: 'ALPHA', label: undefined },
      owner: 'agent', at: 5000, note: 'shouted it' } });
  });

  it('unknown id names the LIVE ids', () => {
    const v = validateRefineCall(call({ artifactId: 'a9' }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('a1');
  });

  it('an empty desk says so instead of naming nothing', () => {
    const v = validateRefineCall(call(), state([]), 5000) as { error: string };
    expect(v.error).toContain('no artifacts');
  });

  it('stale baseRev states the REAL rev', () => {
    const v = validateRefineCall(call({ baseRev: 1 }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('a1 is at rev 2');
    expect(v.error).toContain('rev 1');
  });

  it('out-of-range index names the valid part ids — DERIVED, not asserted', () => {
    const a = art();
    const v = validateRefineCall(call({ index: 9 }), state([a]), 5000) as { error: string };
    // The remedy names exactly the ids that would succeed. This is the C1 discipline.
    for (const id of validPartIds(a)) expect(v.error).toContain(id);
    expect(v.error).not.toContain('para-9');
  });

  it('a feed-bound value write explains the field is live and offers the rename', () => {
    const w = art({ id: 'a2', kind: 'widget', content: undefined,
      fields: [{ label: 'Time', feed: 'clock' }] });
    const v = validateRefineCall(call({ artifactId: 'a2', index: 1, text: '9:00' }), state([w]), 5000) as { error: string };
    expect(v.error).toContain('clock');
    expect(v.error).toContain('rename');
  });

  it('a no-op says the text already reads exactly that', () => {
    const v = validateRefineCall(call({ text: 'alpha' }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('already reads');
  });

  it('empty text on replace-part is refused as empty, not misreported as a no-op', () => {
    const v = validateRefineCall(call({ text: '' }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('non-empty text');
    expect(v.error).toContain('remove-part');
    expect(v.error).not.toContain('already reads');
  });

  it('whitespace-only text on replace-part is refused as empty, not misreported as a no-op', () => {
    const v = validateRefineCall(call({ text: '   ' }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('non-empty text');
    expect(v.error).toContain('remove-part');
    expect(v.error).not.toContain('already reads');
  });

  it('an empty label on a widget field is refused as empty, not misreported as a no-op', () => {
    const w = art({ id: 'a2', kind: 'widget', content: undefined,
      fields: [{ label: 'Time', value: '9:00' }] });
    const v = validateRefineCall(call({ artifactId: 'a2', index: 1, text: undefined, label: '  ' }),
      state([w]), 5000) as { error: string };
    expect(v.error).toContain('non-empty label');
    expect(v.error).not.toContain('already reads');
  });

  it('removing the last part refuses rather than emptying the artifact', () => {
    const v = validateRefineCall(call({ op: 'remove-part', index: 1 }),
      state([art({ content: 'only one' })]), 5000) as { error: string };
    expect(v.error).toContain('no content');
  });

  it('an unknown op names the valid ops', () => {
    const v = validateRefineCall(call({ op: 'frobnicate' }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('replace-part');
    expect(v.error).toContain('retitle');
  });

  it('a missing baseRev is refused with the current rev, not defaulted', () => {
    const v = validateRefineCall(call({ baseRev: undefined }), state([art()]), 5000) as { error: string };
    expect(v.error).toContain('rev 2');
  });
});

describe('describePatch', () => {
  it('renders the before and after the witness card shows', () => {
    expect(describePatch(art(), { op: 'replace-part', index: 2, text: 'BETA' }))
      .toEqual({ partLabel: 'paragraph 2', before: 'beta', after: 'BETA' });
  });
  it('an add has no before', () => {
    expect(describePatch(art(), { op: 'add-part', text: 'gamma' }))
      .toEqual({ partLabel: 'paragraph 3', before: '', after: 'gamma' });
  });
  it('a retitle describes the title', () => {
    expect(describePatch(art(), { op: 'retitle', title: 'Short' }))
      .toEqual({ partLabel: 'title', before: 'Brief', after: 'Short' });
  });

  // C1: a label-only rename must render the LABEL changing, not the value fall back to the OLD
  // label — the pre-fix bug rendered {before:"42", after:"Cost"} for a value->label mismatch.
  const widget = (): Artifact => ({
    id: 'w1', kind: 'widget', title: 'Stats', sources: ['excel'],
    fields: [{ label: 'Cost', value: '42' }], createdAt: 1000, rev: 3,
    meta: { rev: 3, at: 1000, owner: 'agent' }, history: [],
  });

  it('a label-only rename describes the LABEL changing, both sides true', () => {
    expect(describePatch(widget(), { op: 'replace-part', index: 1, label: 'Total cost' }))
      .toEqual({ partLabel: 'field 1', before: 'Cost', after: 'Total cost' });
  });

  it('a value-only change describes the VALUE changing, unaffected by the current label', () => {
    expect(describePatch(widget(), { op: 'replace-part', index: 1, text: '99' }))
      .toEqual({ partLabel: 'field 1', before: '42', after: '99' });
  });

  it('a patch changing both text and label renders a representation true of both', () => {
    expect(describePatch(widget(), { op: 'replace-part', index: 1, text: '99', label: 'Total cost' }))
      .toEqual({ partLabel: 'field 1', before: 'Cost: 42', after: 'Total cost: 99' });
  });
});
