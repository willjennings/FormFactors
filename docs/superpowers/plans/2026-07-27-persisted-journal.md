# Persisted Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desk survives a reload — every event shaping the user's material journals through the island stores' own pure reducers, the journal persists to localStorage, and restore is replay.

**Architecture:** Pure core first (journal → store registry → snapshot/compaction → storage), then the keystone replay-equals-live test, then the `App.tsx` wiring (boot replay via lazy initializers, journal-wrapped dispatch, debounced save), the user-only "New desk" eraser, and a keyless browser drive. One mechanism serves blindspot B-1 *and* the roadmap's S5 journal substrate.

**Tech Stack:** TypeScript, React 19, vitest (pure-function tests, colocated `*.test.ts`), `tsc --noEmit` as lint. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-persisted-journal-design.md`

## Global Constraints

- **Run the FULL suite on every task** — `npx vitest run`, never a directory-scoped subset (this lesson has cost this project three times). Baseline at plan time: **696 tests / 91 files passing** — treat stated counts as minimums, not exact predictions; every plan this quarter has been off by a few.
- **`npx tsc --noEmit` clean** and **`npx vite build` succeeds** before every commit.
- **Reducers stay PURE** — no `Date.now()`, no `Math.random()`, no storage reads inside any reducer. Timestamps arrive on events. Replay determinism is the entire premise.
- **Fail-soft storage** — every localStorage touch wrapped in try/catch; in-memory behaviour is never held hostage by storage. A failed LOAD is visible + quarantined, never a silent empty desk.
- **This repo does not unit-test component/DOM rendering.** Component work is verified by `tsc`, `vite build`, and the browser drive in Task 8. No DOM harness.
- No new npm dependencies. Commit per task, conventional-commit style.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/journal/journal.ts` | **Create** — `JournalEntry`, `StoreSpec`, `JournalRegistry`, `appendEntry`, `replay`, `compact`. | 1, 3 |
| `src/journal/registry.ts` | **Create** — the workspace + dials reducers (journal-owned stores) and `JOURNAL_REGISTRY` binding all four stores to their REAL reducers. | 2 |
| `src/artifacts/types.ts` + `artifactStore.ts` | Modify — add the journal-only `artifact.restore` event. | 3 |
| `src/goal/goalStore.ts` | Modify — add the journal-only `goal.restore` event. | 3 |
| `src/journal/persistence.ts` | **Create** — `loadJournal` / `saveJournal` / `clearJournal`, version stamp, quarantine. | 4 |
| `src/journal/replayEqualsLive.test.ts` | **Create** — the keystone test. | 5 |
| `src/journal/boot.ts` | **Create** — one-shot memoized boot: load → replay → `{ states, failure }`. | 6 |
| `src/App.tsx` | Modify — lazy initializers from boot, journal-wrapped dispatch, `doc.set`/`program.set`/`dials.set` at the existing commit sites, debounced save, failed-load notice. | 6 |
| `src/shell/DebugDrawer.tsx` (or its Control Center section) | Modify — the "New desk" control, two-step confirm. | 7 |

---

### Task 1: Journal core

**Files:**
- Create: `src/journal/journal.ts`
- Create: `src/journal/journal.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `JournalEntry { seq, t, store, event, label? }`; `StoreSpec<S, E> { initial: () => S; reduce: (s: S, e: E) => S; snapshotEvent: (s: S) => E }`; `JournalRegistry = Record<string, StoreSpec<any, any>>`; `appendEntry(entries, store, event, t, label?): JournalEntry[]`; `replay(entries, registry): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Create `src/journal/journal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { appendEntry, replay, type JournalRegistry, type StoreSpec } from './journal';

// A tiny counter store — enough to prove the journal folds through reducers it does not know.
type CounterEvent = { type: 'add'; n: number } | { type: 'counter.restore'; value: number };
const counter: StoreSpec<number, CounterEvent> = {
  initial: () => 0,
  reduce: (s, e) => (e.type === 'add' ? s + e.n : e.value),
  snapshotEvent: (s) => ({ type: 'counter.restore', value: s }),
};
const registry: JournalRegistry = { counter };

describe('appendEntry', () => {
  it('appends with a monotonic 1-based seq and never mutates the input', () => {
    const a = appendEntry([], 'counter', { type: 'add', n: 1 }, 1000);
    const b = appendEntry(a, 'counter', { type: 'add', n: 2 }, 2000, 'second');
    expect(a).toHaveLength(1);
    expect(b.map((e) => e.seq)).toEqual([1, 2]);
    expect(b[1]).toEqual({ seq: 2, t: 2000, store: 'counter', event: { type: 'add', n: 2 }, label: 'second' });
  });
});

describe('replay', () => {
  it('folds each entry through its store reducer', () => {
    let j = appendEntry([], 'counter', { type: 'add', n: 2 }, 1);
    j = appendEntry(j, 'counter', { type: 'add', n: 3 }, 2);
    expect(replay(j, registry)).toEqual({ counter: 5 });
  });
  it('an empty journal yields every store initial', () => {
    expect(replay([], registry)).toEqual({ counter: 0 });
  });
  it('SKIPS unknown store keys — a newer build\'s journal must not brick this one', () => {
    let j = appendEntry([], 'counter', { type: 'add', n: 2 }, 1);
    j = appendEntry(j, 'mystery', { type: 'whatever' }, 2);
    expect(replay(j, registry)).toEqual({ counter: 2 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/journal/journal.test.ts`
Expected: FAIL — `Failed to resolve import "./journal"`.

- [ ] **Step 3: Write the implementation**

Create `src/journal/journal.ts`:

```ts
// The session journal (spec §3): an append-only event log over the island stores, folded
// through each store's OWN pure reducer. Determinism is inherited, not new — reducers never
// read the clock (the S1-S3 rule), so replay of the same entries always yields the same
// states. `t` is provenance for humans; no reducer may ever read it.
export interface JournalEntry {
  seq: number;                 // monotonically increasing, 1-based
  t: number;                   // wall-clock at APPEND time — never read by reducers
  store: string;               // registry key
  event: unknown;              // the store's own event type, opaque to the journal
  label?: string;              // human-readable provenance, e.g. 'pinned a3'
}

export interface StoreSpec<S, E> {
  initial: () => S;
  reduce: (state: S, event: E) => S;
  /** One event that reconstructs this exact state from initial — compaction's raw material.
   *  Journal-only: no tool maps to restore events, same discipline as artifact.close. */
  snapshotEvent: (state: S) => E;
}

export type JournalRegistry = Record<string, StoreSpec<any, any>>;

export function appendEntry(
  entries: JournalEntry[], store: string, event: unknown, t: number, label?: string,
): JournalEntry[] {
  return [...entries, { seq: entries.length + 1, t, store, event, ...(label ? { label } : {}) }];
}

/** Fold every entry through its store's reducer. Unknown store keys are SKIPPED: a journal
 *  written by a newer build may name stores this build lacks — skipping is honest degradation,
 *  crashing would hold the whole desk hostage to one unknown entry. */
export function replay(entries: JournalEntry[], registry: JournalRegistry): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const key of Object.keys(registry)) states[key] = registry[key].initial();
  for (const e of entries) {
    const spec = registry[e.store];
    if (!spec) continue;
    states[e.store] = spec.reduce(states[e.store], e.event);
  }
  return states;
}
```

(`compact` arrives in Task 3, when restore events exist.)

- [ ] **Step 4: Run the test, then the full gates**

Run: `npx vitest run src/journal/journal.test.ts` → PASS (5 tests).
Run: `npx vitest run && npx tsc --noEmit` → PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/journal/journal.ts src/journal/journal.test.ts
git commit -m "feat(journal): pure core — append, replay through the stores' own reducers"
```

---

### Task 2: The store registry — workspace, dials, and the real reducers

**Files:**
- Create: `src/journal/registry.ts`
- Create: `src/journal/registry.test.ts`

**Interfaces:**
- Consumes: `StoreSpec`, `JournalRegistry` (Task 1); the REAL reducers: `reduce`/`initialArtifactState` from `src/artifacts/artifactStore.ts`, `reduce as goalReduce`/`initialGoalState` from `src/goal/goalStore.ts`; `seedCorpus` from `src/artifacts/seeds.ts`; `DEFAULT_PROGRAM`, `ProgramId`, `MockDoc` from `src/scenarios.ts`; `DEFAULT_DIALS` from `src/register/registry.ts`, `DialValues` from `src/register/types.ts`.
- Produces: `WorkspaceState { corpus, activeProgram }`, `WorkspaceEvent` (`doc.set` | `program.set` | `workspace.restore`); `DialsState { dials, registerKey }`, `DialsEvent` (`dials.set`); `workspaceReduce`, `initialWorkspaceState`, `dialsReduce`, `initialDialsState`; `JOURNAL_REGISTRY` with keys `artifacts`, `workspace`, `goal`, `dials`.

Note: `snapshotEvent` for `artifacts` and `goal` needs the restore events Task 3 adds. To keep this task self-contained and green, `JOURNAL_REGISTRY` lands here with `snapshotEvent` for `workspace` and `dials` (whose events natively reconstruct state) and TEMPORARY throwing stubs for `artifacts`/`goal` carrying a `// Task 3 replaces with artifact.restore / goal.restore` comment — compaction does not exist yet, so nothing can reach them.

- [ ] **Step 1: Write the failing test**

Create `src/journal/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  workspaceReduce, initialWorkspaceState, dialsReduce, initialDialsState, JOURNAL_REGISTRY,
} from './registry';
import { reduce as artifactReduce, initialArtifactState } from '../artifacts/artifactStore';
import { reduce as goalReduce, initialGoalState } from '../goal/goalStore';
import { seedCorpus } from '../artifacts/seeds';
import { DEFAULT_PROGRAM } from '../scenarios';

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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/journal/registry.test.ts` → FAIL: `Failed to resolve import "./registry"`.

- [ ] **Step 3: Write the implementation**

Create `src/journal/registry.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests, then the full gates**

Run: `npx vitest run src/journal/registry.test.ts` → PASS (7 tests).
Run: `npx vitest run && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/journal/registry.ts src/journal/registry.test.ts
git commit -m "feat(journal): registry — workspace + dials stores, real reducers bound by identity"
```

---

### Task 3: Restore events and compaction

**Files:**
- Modify: `src/artifacts/types.ts` (add `artifact.restore` to `ArtifactEvent`)
- Modify: `src/artifacts/artifactStore.ts` (the case)
- Modify: `src/goal/goalStore.ts` (add `goal.restore` + case)
- Modify: `src/journal/registry.ts` (replace the two throwing stubs)
- Modify: `src/journal/journal.ts` (add `compact`)
- Modify: `src/journal/journal.test.ts`, `src/artifacts/artifactStore.test.ts`, `src/goal/goalStore.test.ts` (if present; else assertions live in `journal.test.ts`)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: `{ type: 'artifact.restore'; state: ArtifactState }` (journal-only), `{ type: 'goal.restore'; state: GoalState }` (journal-only); `compact(entries, registry, cap): JournalEntry[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/journal/journal.test.ts`:

```ts
import { compact } from './journal';
import { JOURNAL_REGISTRY } from './registry';
import { appendEntry as ae } from './journal';

describe('compact', () => {
  // Build a real artifact history: create → revise → close → create, plus a doc edit.
  const seed = () => {
    let j: ReturnType<typeof ae> = [];
    j = ae(j, 'artifacts', { type: 'artifact.create', artifact: { kind: 'doc', title: 'One', sources: ['word'], content: 'alpha', createdAt: 1 } }, 1);
    j = ae(j, 'artifacts', { type: 'artifact.revise', id: 'a1', baseRev: 1, patch: { op: 'replace-part', index: 1, text: 'beta' }, owner: 'agent', at: 2 }, 2);
    j = ae(j, 'artifacts', { type: 'artifact.close', id: 'a1' }, 3);
    j = ae(j, 'artifacts', { type: 'artifact.create', artifact: { kind: 'doc', title: 'Two', sources: ['word'], content: 'gamma', createdAt: 4 } }, 4);
    j = ae(j, 'workspace', { type: 'program.set', program: 'excel' }, 5);
    return j;
  };

  it('is a no-op under the cap', () => {
    const j = seed();
    expect(compact(j, JOURNAL_REGISTRY, 100)).toBe(j);
  });

  it('post-compact replay equals pre-compact replay — the definition of correct', () => {
    const j = seed();
    const c = compact(j, JOURNAL_REGISTRY, 2);
    expect(replay(c, JOURNAL_REGISTRY)).toEqual(replay(j, JOURNAL_REGISTRY));
  });

  it('compacts to one snapshot entry per store, seq restarting, labelled', () => {
    const c = compact(seed(), JOURNAL_REGISTRY, 2);
    expect(c).toHaveLength(Object.keys(JOURNAL_REGISTRY).length);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(c.every((e) => e.label?.includes('compacted'))).toBe(true);
  });

  it('nextId survives compaction — artifact ids are NEVER reused', () => {
    const j = seed();                              // a1 created+closed, a2 live → nextId 3
    const c = compact(j, JOURNAL_REGISTRY, 2);
    const after = JOURNAL_REGISTRY.artifacts.reduce(
      (replay(c, JOURNAL_REGISTRY) as any).artifacts,
      { type: 'artifact.create', artifact: { kind: 'doc', title: 'Three', sources: ['word'], content: 'x', createdAt: 9 } },
    );
    expect(after.artifacts.map((a: any) => a.id)).toContain('a3'); // not a recycled a1
  });

  it('artifact rev history rides INSIDE the snapshot — lossless for artifacts', () => {
    const j = seed();
    const before = (replay(j, JOURNAL_REGISTRY) as any).artifacts;
    const after = (replay(compact(j, JOURNAL_REGISTRY, 2), JOURNAL_REGISTRY) as any).artifacts;
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/journal/journal.test.ts`
Expected: FAIL — `compact` is not exported (and the registry stubs throw when reached).

- [ ] **Step 3: Add the restore events**

In `src/artifacts/types.ts`, append to `ArtifactEvent`:

```ts
  // JOURNAL-ONLY (spec §7): emitted solely by journal compaction to reconstruct state in one
  // step. No tool maps to it and no UI dispatches it — same discipline as artifact.close.
  | { type: 'artifact.restore'; state: ArtifactState }
```

In `src/artifacts/artifactStore.ts`, add before `default:`:

```ts
    case 'artifact.restore':
      // Journal compaction only. Restores verbatim — including nextId (ids are never reused;
      // see the a${n} minting comment above) and rejectedAtCap/rejectedStale counters.
      return event.state;
```

In `src/goal/goalStore.ts`: add `| { type: 'goal.restore'; state: GoalState }` to `GoalEvent` with the same journal-only comment, and `case 'goal.restore': return event.state;` in `reduce`.

- [ ] **Step 4: Replace the registry stubs and add `compact`**

In `src/journal/registry.ts`, replace the two throwing `snapshotEvent` stubs:

```ts
    snapshotEvent: (s: ArtifactState) => ({ type: 'artifact.restore' as const, state: s }),
```
```ts
    snapshotEvent: (s: GoalState) => ({ type: 'goal.restore' as const, state: s }),
```

In `src/journal/journal.ts`, add:

```ts
/** Deterministic compaction (spec §7): when over cap, replay everything and rebuild the
 *  journal as ONE snapshot entry per store. The trade is stated, not hidden: fine-grained
 *  history older than the snapshot is discarded (cross-reload archaeology, which nothing
 *  consumes yet); artifact rev history survives INSIDE the state snapshot. `t` values carry
 *  over from the last entry so compaction invents no clock reads. */
export function compact(entries: JournalEntry[], registry: JournalRegistry, cap: number): JournalEntry[] {
  if (entries.length <= cap) return entries;
  const states = replay(entries, registry);
  const t = entries[entries.length - 1]?.t ?? 0;
  let out: JournalEntry[] = [];
  for (const key of Object.keys(registry)) {
    out = appendEntry(out, key, registry[key].snapshotEvent(states[key]), t, `compacted ${entries.length} entries`);
  }
  return out;
}
```

- [ ] **Step 5: Run the tests, then the full gates**

Run: `npx vitest run src/journal/journal.test.ts src/journal/registry.test.ts` → PASS.
Run: `npx vitest run && npx tsc --noEmit && npx vite build` → PASS (the new `ArtifactEvent` variant must not break any existing exhaustiveness).

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/types.ts src/artifacts/artifactStore.ts src/goal/goalStore.ts src/journal/journal.ts src/journal/journal.test.ts src/journal/registry.ts
git commit -m "feat(journal): restore events + deterministic compaction, lossless for artifact history"
```

---

### Task 4: Storage — load, save, quarantine

**Files:**
- Create: `src/journal/persistence.ts`
- Create: `src/journal/persistence.test.ts`

**Interfaces:**
- Consumes: `JournalEntry` (Task 1).
- Produces: `JOURNAL_KEY = 'ff-journal'`, `QUARANTINE_KEY = 'ff-journal-quarantine'`, `JOURNAL_VERSION = 1`, `JOURNAL_CAP = 500`; `type LoadResult = { ok: JournalEntry[] } | { empty: true } | { failed: string }`; `loadJournal(storage?): LoadResult`; `saveJournal(entries, storage?): boolean`; `clearJournal(storage?): void`. All take an optional `StorageLike` (`getItem`/`setItem`/`removeItem`) defaulting to `globalThis.localStorage`, so tests inject fakes and the node test env (no localStorage) still fails soft.

- [ ] **Step 1: Write the failing test**

Create `src/journal/persistence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadJournal, saveJournal, clearJournal, JOURNAL_KEY, QUARANTINE_KEY } from './persistence';
import { appendEntry } from './journal';

const fake = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    _m: m,
  };
};

describe('journal persistence', () => {
  const entries = appendEntry([], 'dials', { type: 'dials.set', dials: {}, registerKey: null }, 1000);

  it('round-trips', () => {
    const s = fake();
    expect(saveJournal(entries, s)).toBe(true);
    expect(loadJournal(s)).toEqual({ ok: entries });
  });
  it('first run is EMPTY, not failed — silence is correct only when there was nothing', () => {
    expect(loadJournal(fake())).toEqual({ empty: true });
  });
  it('corrupt JSON fails VISIBLY and quarantines the payload', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, '{not json');
    const r = loadJournal(s);
    expect('failed' in r && r.failed.length > 0).toBe(true);
    expect(s.getItem(QUARANTINE_KEY)).toBe('{not json');
    expect(s.getItem(JOURNAL_KEY)).toBeNull(); // cleared so the next boot is a clean first run
  });
  it('a wrong version is a failed load (v1 has no migrations)', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 99, entries: [] }));
    const r = loadJournal(s);
    expect('failed' in r && r.failed).toMatch(/version/i);
  });
  it('a shape violation is a failed load, not a crash', () => {
    const s = fake();
    s.setItem(JOURNAL_KEY, JSON.stringify({ v: 1, entries: [{ nope: true }] }));
    expect('failed' in loadJournal(s)).toBe(true);
  });
  it('a throwing storage fails soft on save', () => {
    const s = { ...fake(), setItem: () => { throw new Error('quota'); } };
    expect(saveJournal(entries, s as any)).toBe(false);
  });
  it('clearJournal removes journal AND quarantine', () => {
    const s = fake();
    saveJournal(entries, s);
    s.setItem(QUARANTINE_KEY, 'old');
    clearJournal(s);
    expect(s.getItem(JOURNAL_KEY)).toBeNull();
    expect(s.getItem(QUARANTINE_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/journal/persistence.test.ts` → import failure.

- [ ] **Step 3: Write the implementation**

Create `src/journal/persistence.ts`:

```ts
// Journal <-> localStorage (spec §5). Fail-soft in the missions/persistence.ts style, with one
// difference the spec demands: a failed LOAD is not silent. The caller receives the reason and
// must show it — the user HAD material, and its absence must be explained. The unparseable
// payload is preserved under a quarantine key so a bug report has evidence.
import type { JournalEntry } from './journal';

export const JOURNAL_KEY = 'ff-journal';
export const QUARANTINE_KEY = 'ff-journal-quarantine';
export const JOURNAL_VERSION = 1;
export const JOURNAL_CAP = 500;                    // compaction threshold (spec §7)

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const defaultStorage = (): StorageLike | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export type LoadResult = { ok: JournalEntry[] } | { empty: true } | { failed: string };

function isEntry(x: unknown): x is JournalEntry {
  const e = x as JournalEntry;
  return !!e && typeof e === 'object'
    && typeof e.seq === 'number' && typeof e.t === 'number' && typeof e.store === 'string'
    && 'event' in e;
}

export function loadJournal(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { empty: true };            // no storage at all = nothing to restore
  let raw: string | null = null;
  try { raw = storage.getItem(JOURNAL_KEY); } catch { return { empty: true }; }
  if (raw === null) return { empty: true };
  const fail = (reason: string): LoadResult => {
    // Quarantine BEFORE clearing: the evidence outlives the failure (spec §5). Overwrites the
    // previous quarantine — one incident of evidence is the contract.
    try { storage.setItem(QUARANTINE_KEY, raw!); storage.removeItem(JOURNAL_KEY); } catch { /* fail-soft */ }
    return { failed: reason };
  };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fail('not an object');
    if (parsed.v !== JOURNAL_VERSION) return fail(`unsupported version ${String(parsed.v)}`);
    if (!Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) return fail('malformed entries');
    return { ok: parsed.entries };
  } catch {
    return fail('corrupt JSON');
  }
}

export function saveJournal(entries: JournalEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, entries }));
    return true;
  } catch { return false; }                        // quota etc. — in-memory life goes on
}

export function clearJournal(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(JOURNAL_KEY); storage?.removeItem(QUARANTINE_KEY); } catch { /* fail-soft */ }
}
```

- [ ] **Step 4: Run tests + full gates** — target file PASS (7 tests); `npx vitest run && npx tsc --noEmit` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/journal/persistence.ts src/journal/persistence.test.ts
git commit -m "feat(journal): storage — versioned, fail-soft, visible failure with quarantine"
```

---

### Task 5: The keystone — replay equals live

**Files:**
- Create: `src/journal/replayEqualsLive.test.ts`

**Interfaces:** consumes Tasks 1-3 plus the real app modules; produces no exports — this is the standing tripwire (spec §9) against any future reducer growing a clock read.

- [ ] **Step 1: Write the test** (it should PASS immediately — it pins an invariant, so verify it fails by sabotage in Step 2)

Create `src/journal/replayEqualsLive.test.ts`:

```ts
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
```

- [ ] **Step 2: Prove the test discriminates.** Temporarily add `at: Date.now()` mutation inside `artifactStore.ts`'s revise case (or any clock read altering state), run the artifacts case, watch it fail, restore. State in your report that you did this and what failed.

- [ ] **Step 3: Run + gates** — `npx vitest run src/journal/replayEqualsLive.test.ts` PASS; full suite + tsc PASS.

- [ ] **Step 4: Commit**

```bash
git add src/journal/replayEqualsLive.test.ts
git commit -m "test(journal): keystone — replay equals live for all four persisted stores"
```

---

### Task 6: App wiring — boot replay, journaled dispatch, debounced save

`src/App.tsx` is ~4000 lines. Locate every seam by its surrounding code, not line numbers.

**Files:**
- Create: `src/journal/boot.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `bootJournal(): { entries: JournalEntry[]; states: Record<string, unknown> | null; failure: string | null }` — memoized module-level one-shot.

- [ ] **Step 1: Write `src/journal/boot.ts`**

```ts
// One-shot boot restore (spec §6): load → replay BEFORE first render, memoized so StrictMode's
// double-invoke and multiple lazy initializers all read the same result. No model-facing
// framing is needed: the standing hints derive from state, and a freshly connected model never
// had the prior session's memory — a restored desk is simply the desk.
import { replay, type JournalEntry } from './journal';
import { JOURNAL_REGISTRY } from './registry';
import { loadJournal } from './persistence';

export interface BootResult {
  entries: JournalEntry[];                      // the journal to keep appending to
  states: Record<string, unknown> | null;       // null = nothing restored (fresh or failed)
  failure: string | null;                       // non-null = MUST be shown to the user
}

let memo: BootResult | null = null;
export function bootJournal(): BootResult {
  if (memo) return memo;
  const r = loadJournal();
  if ('ok' in r) memo = { entries: r.ok, states: replay(r.ok, JOURNAL_REGISTRY), failure: null };
  else if ('failed' in r) memo = { entries: [], states: null, failure: r.failed };
  else memo = { entries: [], states: null, failure: null };
  return memo;
}
/** Test/reset hook: forget the memo (New desk uses this after clearing storage). */
export function resetBootMemo(): void { memo = null; }
```

- [ ] **Step 2: Restore into the lazy initializers in `App.tsx`**

Add imports: `bootJournal`, `resetBootMemo` from `./journal/boot`; `appendEntry`, `compact`, type `JournalEntry` from `./journal/journal`; `JOURNAL_REGISTRY`, plus `WorkspaceState`, `DialsState` types from `./journal/registry`; `saveJournal`, `clearJournal`, `JOURNAL_CAP` from `./journal/persistence`.

At module scope (above the component, beside other module-level constants):

```tsx
const journalBoot = bootJournal();
const bootStates = journalBoot.states as {
  artifacts?: import('./artifacts/types').ArtifactState;
  workspace?: import('./journal/registry').WorkspaceState;
  goal?: import('./goal/goalStore').GoalState;
  dials?: import('./journal/registry').DialsState;
} | null;
```

Change the five initializers (locate each by its current form):
- `useReducer(artifactReduce, undefined, initialArtifactState)` → `useReducer(artifactReduce, undefined, () => bootStates?.artifacts ?? initialArtifactState())`
- `useState<MockDoc>(() => seedCorpus()[DEFAULT_PROGRAM])` → `useState<MockDoc>(() => bootStates?.workspace ? (bootStates.workspace.corpus[bootStates.workspace.activeProgram] ?? seedCorpus()[bootStates.workspace.activeProgram]) : seedCorpus()[DEFAULT_PROGRAM])`
- `useState<ProgramId>(DEFAULT_PROGRAM)` (activeProgram) → `useState<ProgramId>(() => bootStates?.workspace?.activeProgram ?? DEFAULT_PROGRAM)`
- `useState<Partial<Record<ProgramId, MockDoc>>>(seedCorpus)` (corpus) → `useState<Partial<Record<ProgramId, MockDoc>>>(() => bootStates?.workspace?.corpus ?? seedCorpus())`
- `useReducer(goalReduce, undefined, initialGoalState)` → `useReducer(goalReduce, undefined, () => bootStates?.goal ?? initialGoalState())`
- `useState<DialValues>(DEFAULT_DIALS)` → `useState<DialValues>(() => bootStates?.dials?.dials ?? DEFAULT_DIALS)` and `useState<string | null>('guided')` (registerKey) → `useState<string | null>(() => bootStates?.dials ? bootStates.dials.registerKey : 'guided')`

Any ref mirrors initialized from those states (e.g. `mockDocRef`, `corpusRef`, `artifactStateRef`) already read the state's initial value — verify each mirror's init reads the STATE, not a literal; fix any that hardcode seeds.

- [ ] **Step 3: The journal ref + append/save plumbing**

Beside the other refs:

```tsx
  // The live journal (spec §6): restored entries + everything appended this session. Saves are
  // debounced and fail-soft; compaction keeps the on-disk journal within JOURNAL_CAP.
  const journalRef = useRef<JournalEntry[]>(journalBoot.entries);
  const journalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const journalAppend = (store: string, event: unknown, label?: string) => {
    journalRef.current = appendEntry(journalRef.current, store, event, Date.now(), label);
    if (journalSaveTimer.current) clearTimeout(journalSaveTimer.current);
    journalSaveTimer.current = setTimeout(() => {
      journalRef.current = compact(journalRef.current, JOURNAL_REGISTRY, JOURNAL_CAP);
      if (!saveJournal(journalRef.current)) addLog('info', 'Journal save failed (storage unavailable or full) — the desk will not survive a reload.');
    }, 500);
  };
```

(`Date.now()` here is legal: it stamps the ENTRY's provenance `t` at append time, outside any reducer.)

- [ ] **Step 4: Journal every persisted mutation**

1. **Artifacts** — find every `artifactDispatch(` call site (~10). Do NOT hand-edit each: define, directly under the `useReducer` line,

```tsx
  const artifactDispatchJ = (event: ArtifactEvent, label?: string) => { journalAppend('artifacts', event, label); artifactDispatch(event); };
```

then rename every OTHER `artifactDispatch(` call site (all except the `useReducer` destructure itself) to `artifactDispatchJ(`. Rejected events journal too — that is spec §3, and the reducer no-ops identically on replay.

2. **Docs** — at every `setMockDoc(<committed doc>)` site that represents a COMMIT (applyAction commit, revise-confirm, direct-manip commit, undo restore, reset reseed — locate each `setMockDoc(` and judge: draft-flush sites inside the revise branch do NOT journal; committed results DO), add `journalAppend('workspace', { type: 'doc.set', program: activeProgramRef.current ?? activeProgram, doc: <the same doc> });` using whichever of `activeProgram`/its ref is in scope at that site.

3. **Program swap** — in `handleProgramChange`, journal the outgoing doc then the swap: `journalAppend('workspace', { type: 'doc.set', program: activeProgram, doc: mockDocRef.current });` followed by `journalAppend('workspace', { type: 'program.set', program: id });`.

4. **Goal** — same wrapper pattern as artifacts: `goalDispatchJ` wrapping `goalDispatch`, rename call sites.

5. **Dials** — an effect (beside the other dial effects): 

```tsx
  const dialsBootSkip = useRef(true);
  useEffect(() => {
    if (dialsBootSkip.current) { dialsBootSkip.current = false; return; }
    journalAppend('dials', { type: 'dials.set', dials, registerKey });
  }, [dials, registerKey]);
```

- [ ] **Step 5: The failed-load notice**

On mount (a one-shot effect): if `journalBoot.failure`, `addLog('info', ...)` AND `emitFeedback({ outcome: 'error', label: `Your previous desk couldn't be restored (${journalBoot.failure}). Starting fresh.` })`. Never silent (spec §5).

- [ ] **Step 6: Gates + a manual sanity run**

`npx vitest run && npx tsc --noEmit && npx vite build` — all green. Then `npx vite --port 3001`, open `?artifacts=1`, wait for the scripted artifacts, reload: the artifacts must come back (rev chips intact). If they do not, debug before committing.

- [ ] **Step 7: Commit**

```bash
git add src/journal/boot.ts src/App.tsx
git commit -m "feat(journal): the desk survives reload — boot replay, journaled dispatch, debounced save"
```

---

### Task 7: "New desk" — the only eraser

**Files:**
- Modify: `src/shell/DebugDrawer.tsx` (place beside the existing reset control; if reset lives elsewhere, put New desk next to IT — one home for destructive desk actions)
- Modify: `src/App.tsx` (the handler + prop)

- [ ] **Step 1: The handler in App**

```tsx
  // NEW DESK (spec §8): the ONLY eraser of persistence. User-only, confirm-gated — the
  // artifact.close discipline applied to the whole desk. Clears storage then reloads: a reload
  // is the honest restart (every store, ref, gate and session rebuilds from seed — no risk of
  // a half-reset in-memory desk disagreeing with the now-empty journal).
  const handleNewDesk = () => {
    clearJournal();
    resetBootMemo();
    window.location.reload();
  };
```

- [ ] **Step 2: The control**

In the drawer, beside the existing reset button, a two-step inline confirm (no `window.confirm` — this repo builds its own affordances):

```tsx
  const [confirmNewDesk, setConfirmNewDesk] = useState(false);
  // …
  {!confirmNewDesk ? (
    <Button variant="ghost" size="sm" className="hit-24" onClick={() => setConfirmNewDesk(true)}>New desk…</Button>
  ) : (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[var(--text-secondary)]">Erase all saved material?</span>
      <Button variant="primary" size="sm" className="hit-24" aria-label="Confirm: erase the desk" onClick={onNewDesk}>Erase</Button>
      <Button variant="ghost" size="sm" className="hit-24" onClick={() => setConfirmNewDesk(false)}>Keep</Button>
    </div>
  )}
```

Thread `onNewDesk={handleNewDesk}` through the drawer's props. Match the drawer's actual Button variants/sizes to its neighbours (read the file; adjust `variant`/`size` to the local idiom, keep `hit-24` + accessible names).

- [ ] **Step 3: Gates** — `npx vitest run && npx tsc --noEmit && npx vite build` green.

- [ ] **Step 4: Commit**

```bash
git add src/shell/DebugDrawer.tsx src/App.tsx
git commit -m "feat(journal): New desk — user-only, confirm-gated, the sole eraser of persistence"
```

---

### Task 8: Browser drive

The first time restore runs against the real app. An unobserved item is a FAILED item.

- [ ] **Step 1:** `npx vite --port 3001` (port 3000 belongs to another project). Prefer JS-driven interaction; the first CDP click after load reliably misses. **`.env` in this checkout contains a real API key — do not read or print it; nothing in this drive needs a session.**

- [ ] **Step 2: Drive, recording what you actually observe per item:**

| # | Check |
|---|---|
| J1 | `?artifacts=1`: scripted artifacts appear → reload → artifacts return with rev chips, provenance lines, and history disclosures intact |
| J2 | Pin a card, refine via demo, reload → the pinned artifact and the refined rev history both survive |
| J3 | Edit the Word doc (type in it, commit an action), swap to Excel, reload → Excel is active, swap back → the Word edit survived |
| J4 | Flip a dial (fork to Custom), reload → dials and the ✎ Custom pill held |
| J5 | In devtools: `localStorage.setItem('ff-journal', '{corrupt')` → reload → visible "couldn't be restored" notice, seed desk, `ff-journal-quarantine` holds the corrupt payload |
| J6 | New desk → two-step confirm → desk resets to seed, `ff-journal` and quarantine both gone |
| J7 | The mutation-count probe from prior drives still settles on `?rail=1` (no save/replay loop) |
| J8 | Build >JOURNAL_CAP entries is impractical by hand — instead run `compact` sanity in console: after a session with edits, `JSON.parse(localStorage.getItem('ff-journal')).entries.length` is bounded and sane |
| J9 | The tray, rail cards, and any pending witness card do NOT survive a reload (they must not — conversation is not material) |

- [ ] **Step 3:** Fix anything that fails; re-run all three gates; record failure + fix.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(journal): browser drive — the desk survives reload, failures visible"
```

---

## Self-Review

**Spec coverage:** §3 data model → T1 · §4 registry incl. the unified workspace ruling → T2 · §5 persistence/quarantine/version → T4 · §6 restore-on-load + no-framing rationale → T6 · §7 compaction + restore events + artifact-lossless → T3 · §8 New desk → T7 · §9 keystone + registry-identity + browser drive → T2 (identity), T5 (keystone), T8 (drive) · §10 risks → each mitigation lands with its risk's task.

**Deviations, recorded:** (1) §2's table places the workspace/dials reducers in `registry.ts` — kept, they are journal-owned stores. (2) The spec's `StoreSpec` had no `snapshotEvent`; compaction needs one event per store that reconstructs state, so the plan adds it plus journal-only `artifact.restore`/`goal.restore` events — §7's "the store's canonical `*.set` / rebuild event" made concrete. (3) New desk reloads the page rather than resetting stores in place: a reload is the honest restart; a half-reset in-memory desk could disagree with the now-empty journal.

**Type consistency:** `appendEntry`/`replay`/`compact` signatures match across T1/T3/T5/T6. `JOURNAL_REGISTRY` keys (`artifacts`/`workspace`/`goal`/`dials`) are identical in T2/T5/T6. `LoadResult`'s three shapes match `boot.ts`'s handling. `snapshotEvent` exists on every registered spec by end of T3 (T2's stubs are unreachable until `compact` exists, and T3 replaces them in the same plan).
