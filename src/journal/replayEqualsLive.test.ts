import { describe, it, expect } from 'vitest';
import { appendEntry, replay, type JournalEntry } from './journal';
import { JOURNAL_REGISTRY, workspaceReduce, initialWorkspaceState, dialsReduce, initialDialsState } from './registry';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import { reduce as goalReduce, initialGoalState } from '../goal/goalStore';
import { validateCombineCall } from '../artifacts/combineTools';
import { validateRefineCall } from '../artifacts/refineTools';
import { pinEventFor } from '../artifacts/pin';
import { ARTIFACT_DEMO_ARGS, ARTIFACT_DEMO_REFINE_ARGS } from '../artifacts/demo';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_DIALS } from '../register/registry';

// THE KEYSTONE (spec §9): drive each store's REAL event stream live and via replay; the end
// states must be deeply equal. The day a reducer reads Date.now() internally, this fails.
describe('replay equals live', () => {
  it('artifacts — a real create → refine → pin → close stream', () => {
    const corpus = seedCorpus();
    let live = initialArtifactState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = artifactReduce(live, event); j = appendEntry(j, 'artifacts', event, j.length + 1); };

    const created = validateCombineCall(ARTIFACT_DEMO_ARGS, corpus, live, 1000);
    if (!('event' in created)) throw new Error('demo combine must validate');
    drive(created.event);
    const refined = validateRefineCall(ARTIFACT_DEMO_REFINE_ARGS, live, 2000);
    if (!('event' in refined)) throw new Error('demo refine must validate');
    drive(refined.event);
    const pinned = pinEventFor({ t: 'answer', band: 'solid', state: 'active', text: 'Keep this.' } as any, 'Seq', 3000);
    if (!('event' in pinned)) throw new Error('pin must build');
    drive(pinned.event);
    drive({ type: 'artifact.close', id: 'a2' });
    // A REJECTED event journals too (spec §3): stale revise no-ops identically both ways.
    drive({ type: 'artifact.revise', id: 'a1', baseRev: 1, patch: { op: 'retitle', title: 'X' }, owner: 'agent', at: 4000 });

    expect((replay(j, JOURNAL_REGISTRY) as any).artifacts).toEqual(live);
  });

  it('workspace — edits, swaps, and back', () => {
    let live = initialWorkspaceState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = workspaceReduce(live, event); j = appendEntry(j, 'workspace', event, j.length + 1); };
    drive({ type: 'doc.set', program: 'word', doc: { ...seedCorpus().word, text: 'edited' } });
    drive({ type: 'program.set', program: 'excel' });
    drive({ type: 'doc.set', program: 'excel', doc: seedCorpus().excel });
    drive({ type: 'program.set', program: 'word' });
    expect((replay(j, JOURNAL_REGISTRY) as any).workspace).toEqual(live);
  });

  it('goal — set, commit, done, clear', () => {
    let live = initialGoalState();
    let j: JournalEntry[] = [];
    const drive = (event: any) => { live = goalReduce(live, event); j = appendEntry(j, 'goal', event, j.length + 1); };
    drive({ type: 'goal.set', objective: 'Ship it', steps: [{ label: 'save the file', verb: 'save_file' }] });
    drive({ type: 'goal.actionCommitted', verb: 'save_file' });
    drive({ type: 'goal.clear' });
    expect((replay(j, JOURNAL_REGISTRY) as any).goal).toEqual(live);
  });

  it('dials — twiddle and land on custom', () => {
    let live = initialDialsState();
    let j: JournalEntry[] = [];
    const e = { type: 'dials.set' as const, dials: { ...DEFAULT_DIALS, honest: !DEFAULT_DIALS.honest }, registerKey: null };
    live = dialsReduce(live, e); j = appendEntry(j, 'dials', e, 1);
    expect((replay(j, JOURNAL_REGISTRY) as any).dials).toEqual(live);
  });
});
