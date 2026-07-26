import { describe, it, expect } from 'vitest';
import * as demo from './demo';
import { ARTIFACT_DEMO_ARGS, ARTIFACT_DEMO_WIDGET_ARGS, ARTIFACT_DEMO_REFINE_ARGS } from './demo';
import { validateCombineCall } from './combineTools';
import { validateRefineCall } from './refineTools';
import { initialArtifactState, reduce } from './artifactStore';
import { seedCorpus } from './seeds';

// Final review I1: the corpus boots from seedCorpus() (spec §3 — it "ships with a seed set"),
// so the demo replays against the REAL boot corpus with no hand-injected sources.
describe('?artifacts=1 demo replay against the boot corpus (spec §3/§10)', () => {
  it('both scripted combines validate against seedCorpus() alone — no injected sources', () => {
    const bootCorpus = seedCorpus();
    let arts = initialArtifactState();
    const doc = validateCombineCall(ARTIFACT_DEMO_ARGS, bootCorpus, arts, 1000);
    expect('error' in doc).toBe(false);
    if ('error' in doc) return;
    arts = reduce(arts, doc.event);
    const widget = validateCombineCall(ARTIFACT_DEMO_WIDGET_ARGS, bootCorpus, arts, 2000);
    expect('error' in widget).toBe(false);
    if ('error' in widget) return;
    arts = reduce(arts, widget.event);
    expect(arts.artifacts.map((a) => a.kind)).toEqual(['doc', 'widget']);
    expect(arts.artifacts[1].fields?.some((f) => f.feed === 'clock')).toBe(true);
    expect(arts.artifacts[1].fields?.some((f) => f.feed === 'stock')).toBe(true);
  });
  it('the excel hand-injection crutch is gone — the boot corpus makes it unnecessary', () => {
    expect('ARTIFACT_DEMO_EXCEL_SOURCE' in demo).toBe(false);
  });
  it('the scripted refine validates and applies against the demo artifact', () => {
    // Brief's literal fixture named only 'word', but ARTIFACT_DEMO_ARGS.sources is
    // ['word', 'excel'] — resolveSources would reject 'excel' as unknown. Added it here
    // (minimal stub, matching the shape used elsewhere) so the combine actually resolves.
    const corpus = { word: { kind: 'word' as const, text: 'x' }, excel: { kind: 'excel' as const, cells: {}, currency: [], chart: false, saved: false } } as any;
    const created = validateCombineCall(ARTIFACT_DEMO_ARGS, corpus, initialArtifactState(), 1000);
    expect('event' in created).toBe(true);
    let st = reduce(initialArtifactState(), (created as any).event);
    const v = validateRefineCall(ARTIFACT_DEMO_REFINE_ARGS, st, 2000);
    expect('event' in v).toBe(true);
    st = reduce(st, (v as any).event);
    expect(st.artifacts[0].rev).toBe(2);
    expect(st.artifacts[0].history).toHaveLength(1);
  });
});
