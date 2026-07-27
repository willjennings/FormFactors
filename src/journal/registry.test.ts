import { describe, it, expect } from 'vitest';
import {
  workspaceReduce, initialWorkspaceState, dialsReduce, initialDialsState, JOURNAL_REGISTRY,
} from './registry';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import { reduce as goalReduce, initialGoalState } from '../goal/goalStore';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_PROGRAM } from '../scenarios';
import { replay, appendEntry } from './journal';

describe('workspace store', () => {
  it('boots on the seed corpus and the default program', () => {
    const s = initialWorkspaceState();
    expect(s.activeProgram).toBe(DEFAULT_PROGRAM);
    expect(s.corpus).toEqual(seedCorpus());
  });
  it('doc.set folds the doc into the corpus under its program', () => {
    const doc = { ...seedCorpus().word, text: 'edited' } as any;
    const s = workspaceReduce(initialWorkspaceState(), { type: 'doc.set', program: 'word', doc });
    expect(s.corpus.word).toBe(doc);
    expect(s.activeProgram).toBe(DEFAULT_PROGRAM); // unchanged
  });
  it('program.set switches the active program without touching the corpus', () => {
    const s = workspaceReduce(initialWorkspaceState(), { type: 'program.set', program: 'excel' });
    expect(s.activeProgram).toBe('excel');
    expect(s.corpus).toEqual(seedCorpus());
  });
  it('workspace.restore replaces the whole state — the compaction snapshot', () => {
    const target = { corpus: { word: seedCorpus().word }, activeProgram: 'excel' as const };
    expect(workspaceReduce(initialWorkspaceState(), { type: 'workspace.restore', state: target })).toEqual(target);
  });
});

describe('dials store', () => {
  it('dials.set replaces both dials and register key', () => {
    const s0 = initialDialsState();
    const s1 = dialsReduce(s0, { type: 'dials.set', dials: { ...s0.dials, honest: !s0.dials.honest }, registerKey: null });
    expect(s1.registerKey).toBeNull();
    expect(s1.dials.honest).toBe(!s0.dials.honest);
  });
});

describe('JOURNAL_REGISTRY binds the REAL reducers', () => {
  // A registry pointing at copies would fork behaviour from the live app (spec §9).
  it('artifacts and goal are identity-equal to the imported reducers', () => {
    expect(JOURNAL_REGISTRY.artifacts.reduce).toBe(artifactReduce);
    expect(JOURNAL_REGISTRY.artifacts.initial).toBe(initialArtifactState);
    expect(JOURNAL_REGISTRY.goal.reduce).toBe(goalReduce);
    expect(JOURNAL_REGISTRY.goal.initial).toBe(initialGoalState);
  });
  it('registers exactly the four persisted stores', () => {
    expect(Object.keys(JOURNAL_REGISTRY).sort()).toEqual(['artifacts', 'dials', 'goal', 'workspace']);
  });
});

describe('replay with multi-store registry', () => {
  it('replays only dials when journal has only dials.set entry; other stores initialize', () => {
    // Create a journal with only one dials.set entry
    const dialsEvent = { type: 'dials.set' as const, dials: { ...initialDialsState().dials, honest: true }, registerKey: null };
    const entries = appendEntry([], 'dials', dialsEvent, Date.now());

    // Replay through JOURNAL_REGISTRY
    const states = replay(entries, JOURNAL_REGISTRY);

    // Assert dials reflects the event, others are at initial
    expect(states.dials).toEqual({ dials: { ...initialDialsState().dials, honest: true }, registerKey: null });
    expect(states.workspace).toEqual(initialWorkspaceState());
    expect(states.artifacts).toEqual(initialArtifactState());
    expect(states.goal).toEqual(initialGoalState());
  });
});
