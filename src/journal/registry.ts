// WHAT PERSISTS — the single list (spec §4): material + session shape. Conversation (rail,
// tray, grounding, witness cards, teaching) deliberately does not journal: restoring it for a
// model that no longer remembers it would manufacture false shared context.
import type { JournalRegistry, StoreSpec } from './journal';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import type { ArtifactState } from '../artifacts/types';
import { reduce as goalReduce, initialGoalState, type GoalState } from '../goal/goalStore';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_PROGRAM, type MockDoc, type ProgramId } from '../scenarios';
import { DEFAULT_DIALS } from '../register/registry';
import type { DialValues } from '../register/types';

// ---- workspace: corpus + active program as ONE store (spec §4) ----
// Unified deliberately: as separate stores, the active doc's latest edits (doc.set per commit)
// and the swap-saved corpus could disagree on restore, and without activeProgram a doc could
// restore into the wrong program. One state, no disagreement.
export interface WorkspaceState { corpus: Partial<Record<ProgramId, MockDoc>>; activeProgram: ProgramId }
export type WorkspaceEvent =
  | { type: 'doc.set'; program: ProgramId; doc: MockDoc }      // post-state snapshot at each doc commit
  | { type: 'program.set'; program: ProgramId }
  | { type: 'workspace.restore'; state: WorkspaceState };      // journal-only (compaction)

export const initialWorkspaceState = (): WorkspaceState =>
  ({ corpus: seedCorpus(), activeProgram: DEFAULT_PROGRAM });

export function workspaceReduce(s: WorkspaceState, e: WorkspaceEvent): WorkspaceState {
  switch (e.type) {
    case 'doc.set': return { ...s, corpus: { ...s.corpus, [e.program]: e.doc } };
    case 'program.set': return { ...s, activeProgram: e.program };
    case 'workspace.restore': return e.state;
    default: return s;
  }
}

// ---- dials: the desk's configuration is session shape ----
export interface DialsState { dials: DialValues; registerKey: string | null }
export type DialsEvent = { type: 'dials.set'; dials: DialValues; registerKey: string | null };

export const initialDialsState = (): DialsState => ({ dials: DEFAULT_DIALS, registerKey: 'guided' });

export function dialsReduce(s: DialsState, e: DialsEvent): DialsState {
  return e.type === 'dials.set' ? { dials: e.dials, registerKey: e.registerKey } : s;
}

// ---- the registry ----
export const JOURNAL_REGISTRY: JournalRegistry = {
  artifacts: {
    initial: initialArtifactState,
    reduce: artifactReduce,
    // Task 3 replaces with artifact.restore; unreachable until compact() exists.
    snapshotEvent: (_s: ArtifactState) => { throw new Error('artifact snapshotEvent lands in Task 3'); },
  } satisfies StoreSpec<ArtifactState, any>,
  workspace: {
    initial: initialWorkspaceState,
    reduce: workspaceReduce,
    snapshotEvent: (s: WorkspaceState): WorkspaceEvent => ({ type: 'workspace.restore', state: s }),
  } satisfies StoreSpec<WorkspaceState, WorkspaceEvent>,
  goal: {
    initial: initialGoalState,
    reduce: goalReduce,
    // Task 3 replaces with goal.restore; unreachable until compact() exists.
    snapshotEvent: (_s: GoalState) => { throw new Error('goal snapshotEvent lands in Task 3'); },
  } satisfies StoreSpec<GoalState, any>,
  dials: {
    initial: initialDialsState,
    reduce: dialsReduce,
    snapshotEvent: (s: DialsState): DialsEvent => ({ type: 'dials.set', dials: s.dials, registerKey: s.registerKey }),
  } satisfies StoreSpec<DialsState, DialsEvent>,
};
