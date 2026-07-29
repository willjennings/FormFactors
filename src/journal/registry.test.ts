import { describe, it, expect } from 'vitest';
import {
  workspaceReduce, initialWorkspaceState, dialsReduce, initialDialsState, JOURNAL_REGISTRY,
  DEFAULT_DESK_RECT,
} from './registry';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import { reduce as goalReduce, initialGoalState } from '../goal/goalStore';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_PROGRAM } from '../scenarios';
import { replay, appendEntry, compact } from './journal';
import { deskReduce, initialDeskState, programWindowId } from '../shell/desk/deskStore';
import type { DeskEvent } from '../shell/desk/types';

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
  it('registers exactly the five persisted stores', () => {
    expect(Object.keys(JOURNAL_REGISTRY).sort()).toEqual(['artifacts', 'desk', 'dials', 'goal', 'workspace']);
  });
});

describe('desk store (registry-bound)', () => {
  it('boots on the default program at the default boot rect, one window, familiar skin', () => {
    const s = JOURNAL_REGISTRY.desk.initial();
    expect(s).toEqual(initialDeskState(DEFAULT_PROGRAM, DEFAULT_DESK_RECT));
  });
  it('is identity-equal to the imported deskReduce — no forked behaviour from the live app', () => {
    expect(JOURNAL_REGISTRY.desk.reduce).toBe(deskReduce);
  });
});

describe('desk events survive a real replay round-trip', () => {
  it('open -> minimize -> skin switch: final state has the minimized window and the new skin', () => {
    const winId = 'artifact:a1';
    let j = appendEntry([], 'desk', {
      type: 'window.open', id: winId, kind: 'artifact', refId: 'a1',
      rect: { x: 10, y: 10, w: 200, h: 200 }, origin: 'you', at: 1,
    } satisfies DeskEvent, 1);
    j = appendEntry(j, 'desk', { type: 'window.minimize', id: winId } satisfies DeskEvent, 2);
    j = appendEntry(j, 'desk', { type: 'desk.skin', skin: 'material' } satisfies DeskEvent, 3);

    const states = replay(j, JOURNAL_REGISTRY);
    const desk = states.desk as ReturnType<typeof initialDeskState>;

    const win = desk.windows.find((w) => w.id === winId);
    expect(win?.minimized).toBe(true);
    expect(desk.skin).toBe('material');
    // The sparse-start program window from initial() is still present, untouched.
    expect(desk.windows.some((w) => w.id === programWindowId(DEFAULT_PROGRAM))).toBe(true);
  });
});

describe('compaction snapshot restores the full desk (windows + skin together)', () => {
  it('one desk.restore event carries BOTH the minimized window and the switched skin', () => {
    const winId = 'artifact:a1';
    let j = appendEntry([], 'desk', {
      type: 'window.open', id: winId, kind: 'artifact', refId: 'a1',
      rect: { x: 10, y: 10, w: 200, h: 200 }, origin: 'you', at: 1,
    } satisfies DeskEvent, 1);
    j = appendEntry(j, 'desk', { type: 'window.minimize', id: winId } satisfies DeskEvent, 2);
    j = appendEntry(j, 'desk', { type: 'desk.skin', skin: 'material' } satisfies DeskEvent, 3);

    const preCompact = replay(j, JOURNAL_REGISTRY).desk;
    const compacted = compact(j, JOURNAL_REGISTRY, 0); // cap 0 forces compaction

    const deskEntries = compacted.filter((e) => e.store === 'desk');
    expect(deskEntries).toHaveLength(1);               // ONE snapshot event, not two
    expect((deskEntries[0].event as DeskEvent).type).toBe('desk.restore');

    const postCompact = replay(compacted, JOURNAL_REGISTRY).desk;
    expect(postCompact).toEqual(preCompact);
    const restored = postCompact as ReturnType<typeof initialDeskState>;
    expect(restored.windows.find((w) => w.id === winId)?.minimized).toBe(true);
    expect(restored.skin).toBe('material');
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
