import { describe, it, expect } from 'vitest';
import * as demo from './demo';
import { ARTIFACT_DEMO_ARGS, ARTIFACT_DEMO_WIDGET_ARGS } from './demo';
import { validateCombineCall } from './combineTools';
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
});
