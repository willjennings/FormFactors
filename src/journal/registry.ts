// WHAT PERSISTS — the single list (spec §4): material + session shape. Conversation (rail,
// tray, grounding, witness cards, teaching) deliberately does not journal: restoring it for a
// model that no longer remembers it would manufacture false shared context.
import type { JournalRegistry, StoreSpec } from './journal';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import type { ArtifactState } from '../artifacts/types';
import { reduce as goalReduce, initialGoalState, type GoalState } from '../goal/goalStore';
import { seedCorpus } from '../artifacts/seeds';
import { wideCorpus } from '../artifacts/wideCorpus';
import { DEFAULT_PROGRAM, type MockDoc, type ProgramId } from '../scenarios';
import { DEFAULT_DIALS } from '../register/registry';
import type { DialValues } from '../register/types';
import { deskReduce, initialDeskState } from '../shell/desk/deskStore';
import type { DeskState, DeskEvent } from '../shell/desk/types';
import type { WindowRect } from '../shell/windowState';

// ---- workspace: corpus + active program as ONE store (spec §4) ----
// Unified deliberately: as separate stores, the active doc's latest edits (doc.set per commit)
// and the swap-saved corpus could disagree on restore, and without activeProgram a doc could
// restore into the wrong program. One state, no disagreement.
export interface WorkspaceState { corpus: Partial<Record<ProgramId, MockDoc>>; activeProgram: ProgramId }
export type WorkspaceEvent =
  | { type: 'doc.set'; program: ProgramId; doc: MockDoc }      // post-state snapshot at each doc commit
  | { type: 'program.set'; program: ProgramId }
  | { type: 'workspace.restore'; state: WorkspaceState };      // journal-only (compaction)

// ---- ?corpus= boot param (Task 6, spec §3 — "the wide corpus") ----
// 'wide' selects the generated ceiling-breaking corpus (src/artifacts/wideCorpus.ts); any other
// value, or none, is IGNORED and falls back to the default Meridian seed — the SAME resolveSkin
// convention as `?shell=` (src/shell/skins/registry.ts): a typo must never silently redecorate
// the desk with a DIFFERENT corpus, and it must never crash. This is a BOOT parameter, not
// journaled state — WorkspaceState/WorkspaceEvent gain no corpus field; see the reducer comment
// below for what "not journaled" means for replay.
export function isWideCorpusBoot(): boolean {
  return (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('corpus')
    : null) === 'wide';
}

/** The corpus a FRESH boot seeds. App.tsx's no-journal-yet fallback initializers call this
 *  (never `seedCorpus()` directly) so every one of them agrees with `initialWorkspaceState`
 *  below — same "one decision, no disagreement" discipline already documented on WorkspaceState
 *  itself. Seed 42 is fixed here (not user-choosable) — determinism across boots/battery runs
 *  is the whole point of a generated corpus. */
export function bootCorpus(): Record<ProgramId, MockDoc> {
  return isWideCorpusBoot() ? wideCorpus(42).corpus : seedCorpus();
}

export const initialWorkspaceState = (): WorkspaceState =>
  ({ corpus: bootCorpus(), activeProgram: DEFAULT_PROGRAM });

// Task 6 claim, verified against the reducer below (brief requires stating this, not assuming
// it): a `?corpus=wide` boot choice needs NO change to WorkspaceState/WorkspaceEvent and is safe
// to leave OUT of the journal. Why: `doc.set`'s payload is `e.doc`, a COMPLETE MockDoc snapshot,
// never a patch — the case below does `corpus: { ...s.corpus, [e.program]: e.doc }`, an
// unconditional whole-value replacement. So for any program the user actually edited, replay
// ends on the exact post-edit snapshot regardless of what `initial()` seeded that program with —
// true identically for both corpora, no reducer change needed. The one honest, STATED limit
// (never worked around): a program the user never touched in a wide session emits no `doc.set`,
// so on a reload WITHOUT `?corpus=wide` back in the URL, that untouched program's content reverts
// to the default seed at the next `initial()` call. That is the correct behavior of a boot
// parameter that is deliberately not journaled state, not a bug to fix here.
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

export const initialDialsState = (): DialsState => ({ dials: { ...DEFAULT_DIALS }, registerKey: 'guided' });

export function dialsReduce(s: DialsState, e: DialsEvent): DialsState {
  return e.type === 'dials.set' ? { dials: e.dials, registerKey: e.registerKey } : s;
}

// ---- desk: window inventory + skin as ONE store (same reasoning as workspace, above) ----
// Unified deliberately: as separate stores, a skin could restore without its windows, or windows
// without their skin, and disagree with each other. One state, no disagreement.
export const DEFAULT_DESK_RECT: WindowRect = { x: 48, y: 48, w: 680, h: 620 }; // App.tsx boot rect

// ---- the registry ----
export const JOURNAL_REGISTRY: JournalRegistry = {
  artifacts: {
    initial: initialArtifactState,
    reduce: artifactReduce,
    // Task 3: journal-only restore event, emitted by compaction only.
    snapshotEvent: (s: ArtifactState) => ({ type: 'artifact.restore' as const, state: s }),
  } satisfies StoreSpec<ArtifactState, any>,
  workspace: {
    initial: initialWorkspaceState,
    reduce: workspaceReduce,
    snapshotEvent: (s: WorkspaceState): WorkspaceEvent => ({ type: 'workspace.restore', state: s }),
  } satisfies StoreSpec<WorkspaceState, WorkspaceEvent>,
  goal: {
    initial: initialGoalState,
    reduce: goalReduce,
    // Task 3: journal-only restore event, emitted by compaction only.
    snapshotEvent: (s: GoalState) => ({ type: 'goal.restore' as const, state: s }),
  } satisfies StoreSpec<GoalState, any>,
  dials: {
    initial: initialDialsState,
    reduce: dialsReduce,
    snapshotEvent: (s: DialsState): DialsEvent => ({ type: 'dials.set', dials: s.dials, registerKey: s.registerKey }),
  } satisfies StoreSpec<DialsState, DialsEvent>,
  desk: {
    initial: () => initialDeskState(DEFAULT_PROGRAM, DEFAULT_DESK_RECT),
    reduce: deskReduce,
    snapshotEvent: (s: DeskState): DeskEvent => ({ type: 'desk.restore', state: s }),
  } satisfies StoreSpec<DeskState, DeskEvent>,
};
