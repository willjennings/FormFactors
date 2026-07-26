# Artifact Revise Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make synthesized artifacts material — versioned with history, addressable paragraph by paragraph, and changeable in place by the agent (dial-gated, witnessed when the dials say so) and by the user (directly).

**Architecture:** Extend the existing self-contained `src/artifacts/` subsystem. Pure modules first (types → parts → reducer → serializer → entities → tool validation), then the `App.tsx` seams (routing, witness/confirm, undo), then the two component surfaces (stamping + history disclosure, inline editing), then the keyless demo. Every part-addressing operation carries a `(baseRev, index)` handshake so positional ids stay honest across revisions.

**Tech Stack:** TypeScript, React 19, vitest (pure-function tests, colocated `*.test.ts`), `tsc --noEmit` as lint. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-26-artifact-revise-core-design.md`

## Global Constraints

- **Run the FULL suite on every task** — `npx vitest run`, never a directory-scoped subset. This is the explicit PLAN LESSON from the ramble phase machine, where four probes pinning old behaviour broke silently across three tasks because gates were scoped to `src/ramble/`. Baseline at the start of this plan: **588 tests, 84 files, passing.**
- **Reducers stay pure — never call `Date.now()` inside a reducer.** Timestamps arrive on the event (`at`). The S5 journal will replay these reducers, and a reducer reading the clock breaks replay determinism.
- **Errors are data, and remedies are DERIVED, never asserted.** Any message naming valid ids must compute them from the same function the resolver uses. Naming an id that would itself fail is a lie to the model (combinatory-artifacts final review C1).
- **Never evict, never silently drop.** A refused operation leaves state otherwise unchanged and increments a visible counter.
- 1-based part indices everywhere, matching the existing `Cell A1` / `Slide 2` convention and the user's language ("the second paragraph").
- No new npm dependencies.
- Commit after every task with the repo's conventional-commit style (`feat(artifacts):`, `fix(artifacts):`, `test(artifacts):`).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/artifacts/types.ts` | Modify — `rev`, `meta`, `history` on `Artifact`; `RevisionMeta`, `ArtifactVersion`, `ArtifactPatch`; two new events; `rejectedStale` | 1 |
| `src/artifacts/parts.ts` | **Create** — `splitParagraphs`, `artifactParts`, `applyPatch`. The single source of part identity | 1 |
| `src/artifacts/parts.test.ts` | **Create** | 1 |
| `src/artifacts/artifactStore.ts` | Modify — creation stamps `rev`/`meta`/`history`; `artifact.revise` + `artifact.revertTo` cases | 1, 2 |
| `src/artifacts/combineTools.ts` | Modify — `Omit` type widened; `sourceDetail` gains the revision list | 1, 3 |
| `src/artifacts/serialize.ts` | Modify — `rev N` in items, `rejectedStale` note | 3 |
| `src/artifacts/entities.ts` | Modify — part sub-entities | 4 |
| `src/artifacts/refineTools.ts` | **Create** — `REFINE_TOOL`, `validateRefineCall`, `describePatch` | 5 |
| `src/artifacts/refineTools.test.ts` | **Create** | 5 |
| `src/scenarios.ts` | Modify — `VERB_CLASS.refine_artifact` | 6 |
| `src/App.tsx` | Modify — tool registration, routing branch, `pendingAction` variant, double staleness guard, tagged `undoStack` | 6, 7 |
| `src/artifacts/ArtifactWindow.tsx` | Modify — part stamping, `rev` chip + history disclosure + revert, ticker re-key, inline editing | 4, 8, 9 |
| `src/artifacts/demo.ts` | Modify — scripted revise args | 10 |

---

### Task 1: Data model + part identity

Creation must stamp the new fields in the same task that adds them, or the reducer won't typecheck. `parts.ts` lands here too because `applyPatch` is what Task 2's reducer calls.

**Files:**
- Modify: `src/artifacts/types.ts` (whole file)
- Create: `src/artifacts/parts.ts`
- Create: `src/artifacts/parts.test.ts`
- Modify: `src/artifacts/artifactStore.ts:5-17` (initial state + create case)
- Modify: `src/artifacts/combineTools.ts:95` (the `Omit` annotation)
- Modify: `src/artifacts/artifactStore.test.ts` (assert the new creation fields)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Artifact` (now with `rev: number`, `meta: RevisionMeta`, `history: ArtifactVersion[]`); `ArtifactPatch`; `ArtifactState.rejectedStale: number`; `splitParagraphs(content?: string): string[]`; `Part {index, id, label?, text}`; `artifactParts(a: Artifact): Part[]`; `applyPatch(a: Artifact, p: ArtifactPatch): Artifact | null`

- [ ] **Step 1: Write the failing test for part identity**

Create `src/artifacts/parts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitParagraphs, artifactParts, applyPatch } from './parts';
import type { Artifact } from './types';

const doc = (content: string): Artifact => ({
  id: 'a1', kind: 'doc', title: 'Brief', sources: ['word', 'excel'], content,
  createdAt: 1000, rev: 1, meta: { rev: 1, at: 1000, owner: 'agent' }, history: [],
});

const widget = (fields: Artifact['fields']): Artifact => ({
  id: 'a2', kind: 'widget', title: 'Board', sources: ['word', 'excel'], fields,
  createdAt: 1000, rev: 1, meta: { rev: 1, at: 1000, owner: 'agent' }, history: [],
});

describe('splitParagraphs', () => {
  it('matches the renderer split exactly — blank runs collapse, empties drop', () => {
    expect(splitParagraphs('one\n\ntwo\n\n\nthree\n')).toEqual(['one', 'two', 'three']);
  });
  it('is empty for undefined content', () => {
    expect(splitParagraphs(undefined)).toEqual([]);
  });
});

describe('artifactParts', () => {
  it('numbers doc paragraphs 1-based — the language the user speaks', () => {
    expect(artifactParts(doc('alpha\n\nbeta'))).toEqual([
      { index: 1, id: 'para-1', text: 'alpha' },
      { index: 2, id: 'para-2', text: 'beta' },
    ]);
  });
  it('numbers widget fields 1-based, carrying labels', () => {
    expect(artifactParts(widget([{ label: 'Lead', value: 'Harbor' }, { label: 'Time', feed: 'clock' }])))
      .toEqual([
        { index: 1, id: 'field-1', label: 'Lead', text: 'Harbor' },
        { index: 2, id: 'field-2', label: 'Time', text: '' },
      ]);
  });
});

describe('applyPatch', () => {
  it('replaces a doc paragraph', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'replace-part', index: 2, text: 'gamma' });
    expect(next?.content).toBe('alpha\n\ngamma');
  });
  it('inserts at the 1-based position the new part will occupy, shifting the rest down', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'add-part', index: 2, text: 'mid' });
    expect(splitParagraphs(next?.content)).toEqual(['alpha', 'mid', 'beta']);
  });
  it('appends when index is omitted', () => {
    const next = applyPatch(doc('alpha'), { op: 'add-part', text: 'beta' });
    expect(splitParagraphs(next?.content)).toEqual(['alpha', 'beta']);
  });
  it('removes a paragraph', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'remove-part', index: 1 });
    expect(splitParagraphs(next?.content)).toEqual(['beta']);
  });
  it('retitles', () => {
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: 'Shorter' })?.title).toBe('Shorter');
  });

  // The null cases — "no legal result". Each one is a distinct honesty rule.
  it('refuses an out-of-range index', () => {
    expect(applyPatch(doc('alpha'), { op: 'replace-part', index: 4, text: 'x' })).toBeNull();
  });
  it('refuses to leave an artifact with no content', () => {
    expect(applyPatch(doc('alpha'), { op: 'remove-part', index: 1 })).toBeNull();
  });
  it('refuses a no-op replace — the text already reads exactly that', () => {
    expect(applyPatch(doc('alpha\n\nbeta'), { op: 'replace-part', index: 1, text: 'alpha' })).toBeNull();
  });
  it('refuses a replace carrying neither text nor label', () => {
    expect(applyPatch(doc('alpha'), { op: 'replace-part', index: 1 })).toBeNull();
  });
  it('refuses a VALUE write to a feed-bound field — that value is LIVE, not authored', () => {
    const w = widget([{ label: 'Time', feed: 'clock' }]);
    expect(applyPatch(w, { op: 'replace-part', index: 1, text: '9:00 AM' })).toBeNull();
  });
  it('ALLOWS renaming a feed-bound field — only its value is the feed\'s', () => {
    const w = widget([{ label: 'Time', feed: 'clock' }, { label: 'Lead', value: 'Harbor' }]);
    const next = applyPatch(w, { op: 'replace-part', index: 1, label: 'Local time' });
    expect(next?.fields?.[0]).toEqual({ label: 'Local time', feed: 'clock' });
  });
  it('refuses an empty or unchanged retitle', () => {
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: '  ' })).toBeNull();
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: 'Brief' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/artifacts/parts.test.ts`
Expected: FAIL — `Failed to resolve import "./parts"`.

- [ ] **Step 3: Extend the types**

Replace the whole of `src/artifacts/types.ts` with:

```ts
// Synthesized artifacts: what the agent makes from N sources. Artifacts are MATERIAL — they
// carry a revision number and an append-only history, and both the agent (via refine_artifact,
// dial-gated) and the user (directly) can change them. `artifact.close` and `artifact.revertTo`
// stay USER-ONLY: no tool maps to either. The agent can only propose forward.
export type FeedId = 'clock' | 'weather' | 'stock';

export interface WidgetField { label: string; value?: string; feed?: FeedId }

/** Who made a revision and why. `at` arrives on the event — reducers never read the clock,
 *  because the session journal (S5) replays them and a clock read breaks determinism. */
export interface RevisionMeta { rev: number; at: number; owner: 'agent' | 'user'; note?: string }

/** A snapshot of one PRIOR version, with the meta of the revision that produced it. */
export interface ArtifactVersion {
  rev: number; title: string; content?: string; fields?: WidgetField[]; meta: RevisionMeta;
}

export interface Artifact {
  id: string;                       // 'a1', 'a2', … deterministic
  kind: 'doc' | 'widget';
  title: string;
  sources: string[];                // program ids and/or artifact ids — the provenance line
  content?: string;                 // kind 'doc'
  fields?: WidgetField[];           // kind 'widget'
  createdAt: number;
  rev: number;                      // creation = 1
  meta: RevisionMeta;               // how THIS revision came to be
  history: ArtifactVersion[];       // prior versions only, append-only, oldest first
}

/** The one patch vocabulary, shared by the reducer, the tool validator, and the witness card.
 *  Indices are 1-BASED. For `add-part`, `index` is the position the new part will OCCUPY
 *  (later parts shift down); omitting it appends. `label` is widget-fields-only. */
export type ArtifactPatch =
  | { op: 'replace-part'; index: number; text?: string; label?: string }
  | { op: 'add-part'; index?: number; text: string; label?: string }
  | { op: 'remove-part'; index: number }
  | { op: 'retitle'; title: string };

export type ArtifactEvent =
  | { type: 'artifact.create'; artifact: Omit<Artifact, 'id' | 'rev' | 'meta' | 'history'> }
  | { type: 'artifact.close'; id: string }                                        // user-only
  | { type: 'artifact.revise'; id: string; baseRev: number; patch: ArtifactPatch;
      owner: 'agent' | 'user'; at: number; note?: string }
  | { type: 'artifact.revertTo'; id: string; toRev: number; at: number };         // user-only

export interface ArtifactState {
  artifacts: Artifact[];
  nextId: number;
  rejectedAtCap: number;
  rejectedStale: number;
}
```

- [ ] **Step 4: Write `parts.ts`**

Create `src/artifacts/parts.ts`:

```ts
// Part identity — the SINGLE definition of "paragraph 2" / "field 3", consumed by the reducer,
// the entity deriver, AND the renderer. If any of the three reimplemented the split, the user
// could point at what the screen calls paragraph 2 while the model received paragraph 3.
import type { Artifact, ArtifactPatch, WidgetField } from './types';

export interface Part { index: number; id: string; label?: string; text: string }

/** Byte-identical to the split ArtifactWindow has always rendered with — do not "improve" it
 *  here without changing the renderer in the same commit, or ids drift from pixels. */
export function splitParagraphs(content: string | undefined): string[] {
  return (content ?? '').split(/\n+/).filter(Boolean);
}

export function artifactParts(a: Artifact): Part[] {
  if (a.kind === 'widget') {
    return (a.fields ?? []).map((f, i) => ({
      index: i + 1, id: `field-${i + 1}`, label: f.label, text: f.value ?? '',
    }));
  }
  return splitParagraphs(a.content).map((text, i) => ({ index: i + 1, id: `para-${i + 1}`, text }));
}

/** Apply a patch, or return null meaning "no legal result". Null is not an error message —
 *  validateRefineCall pre-checks each rule so the MODEL gets a specific remedy; null is the
 *  reducer's last line of defence and the no-op detector. */
export function applyPatch(a: Artifact, p: ArtifactPatch): Artifact | null {
  if (p.op === 'retitle') {
    const title = p.title.trim();
    if (!title || title === a.title) return null;
    return { ...a, title };
  }

  const parts = artifactParts(a);

  if (p.op === 'add-part') {
    const at = p.index ?? parts.length + 1;
    if (at < 1 || at > parts.length + 1) return null;
    const text = (p.text ?? '').trim();
    if (!text) return null;
    if (a.kind === 'widget') {
      const label = (p.label ?? '').trim();
      if (!label) return null;                       // a nameless field is unpointable
      const fields = [...(a.fields ?? [])];
      fields.splice(at - 1, 0, { label, value: text });
      return { ...a, fields };
    }
    const paras = splitParagraphs(a.content);
    paras.splice(at - 1, 0, text);
    return { ...a, content: paras.join('\n\n') };
  }

  // replace-part / remove-part address an EXISTING part.
  if (p.index < 1 || p.index > parts.length) return null;

  if (p.op === 'remove-part') {
    if (parts.length === 1) return null;             // never leave an artifact with nothing
    if (a.kind === 'widget') {
      return { ...a, fields: (a.fields ?? []).filter((_, i) => i !== p.index - 1) };
    }
    return { ...a, content: splitParagraphs(a.content).filter((_, i) => i !== p.index - 1).join('\n\n') };
  }

  const text = p.text?.trim();
  const label = p.label?.trim();
  if (text === undefined && label === undefined) return null;
  if (text !== undefined && !text) return null;
  if (label !== undefined && !label) return null;

  if (a.kind === 'widget') {
    const fields = [...(a.fields ?? [])];
    const current = fields[p.index - 1];
    // A feed-bound field's VALUE is fetched live and chipped LIVE/SIMULATED. Letting a refine
    // write it would launder authored text as real data — the exact seam the chips protect.
    if (text !== undefined && current.feed) return null;
    const next: WidgetField = { ...current };
    if (label !== undefined) next.label = label;
    if (text !== undefined) next.value = text;
    if (next.label === current.label && next.value === current.value) return null;
    fields[p.index - 1] = next;
    return { ...a, fields };
  }

  if (label !== undefined) return null;              // docs have no field labels
  const paras = splitParagraphs(a.content);
  if (paras[p.index - 1] === text) return null;      // already reads exactly that
  paras[p.index - 1] = text!;
  return { ...a, content: paras.join('\n\n') };
}
```

- [ ] **Step 5: Run the parts test to verify it passes**

Run: `npx vitest run src/artifacts/parts.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Stamp the new fields at creation**

In `src/artifacts/artifactStore.ts`, change `initialArtifactState` and the create case:

```ts
export function initialArtifactState(): ArtifactState {
  return { artifacts: [], nextId: 1, rejectedAtCap: 0, rejectedStale: 0 };
}
```

and inside `case 'artifact.create'`, replace the artifact construction line with:

```ts
      const artifact: Artifact = {
        ...event.artifact,
        id: `a${state.nextId}`,
        rev: 1,
        // The creating meta reuses createdAt — the reducer must not read the clock.
        meta: { rev: 1, at: event.artifact.createdAt, owner: 'agent' },
        history: [],
      };
```

Also update the create case's return to carry `rejectedStale` through:

```ts
      return { ...state, artifacts: [...state.artifacts, artifact], nextId: state.nextId + 1 };
```

- [ ] **Step 7: Widen the combineTools annotation**

In `src/artifacts/combineTools.ts`, line 95, change:

```ts
  let artifact: Omit<Artifact, 'id'>;
```

to:

```ts
  let artifact: Omit<Artifact, 'id' | 'rev' | 'meta' | 'history'>;
```

- [ ] **Step 8: Add a creation assertion to the store test**

Append inside the existing `describe('artifactStore', …)` block in `src/artifacts/artifactStore.test.ts`:

```ts
  it('creation starts at rev 1 with empty history', () => {
    const st = reduce(initialArtifactState(), mk('One'));
    expect(st.artifacts[0].rev).toBe(1);
    expect(st.artifacts[0].history).toEqual([]);
    expect(st.artifacts[0].meta).toEqual({ rev: 1, at: 1000, owner: 'agent' });
  });
```

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Test count rises from 588 to **603** (14 new in `parts.test.ts` + 1 in `artifactStore.test.ts`).
If `tsc` reports errors elsewhere, they are real — other files constructing `Artifact` literals (test fixtures) need the new fields. Fix them by adding `rev: 1, meta: { rev: 1, at: <createdAt>, owner: 'agent' }, history: []`.

- [ ] **Step 10: Commit**

```bash
git add src/artifacts/types.ts src/artifacts/parts.ts src/artifacts/parts.test.ts \
        src/artifacts/artifactStore.ts src/artifacts/artifactStore.test.ts src/artifacts/combineTools.ts
git commit -m "feat(artifacts): rev + history on Artifact; parts.ts is the single part identity"
```

---

### Task 2: Revise and revert reducer cases

**Files:**
- Modify: `src/artifacts/artifactStore.ts` (add two cases)
- Modify: `src/artifacts/artifactStore.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `applyPatch`, `artifactParts` from `./parts`; `ArtifactPatch`, `ArtifactVersion` from `./types` (Task 1)
- Produces: reducer handling of `artifact.revise` and `artifact.revertTo`; `ArtifactState.rejectedStale` now reachable

- [ ] **Step 1: Write the failing tests**

Append to `src/artifacts/artifactStore.test.ts` (and extend the import on line 2 to include `MAX_ARTIFACTS` if not already there — it is):

```ts
describe('artifactStore — revisions', () => {
  const seed = () => reduce(initialArtifactState(), {
    type: 'artifact.create' as const,
    artifact: { kind: 'doc' as const, title: 'Brief', sources: ['word', 'excel'],
                content: 'alpha\n\nbeta', createdAt: 1000 },
  });
  const revise = (id: string, baseRev: number, patch: any, at = 2000, owner: 'agent' | 'user' = 'agent', note?: string) =>
    ({ type: 'artifact.revise' as const, id, baseRev, patch, owner, at, note });

  it('applies a revision, bumps rev, and pushes the PRIOR version onto history', () => {
    const st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }, 2000, 'agent', 'shouted it'));
    const a = st.artifacts[0];
    expect(a.rev).toBe(2);
    expect(a.content).toBe('ALPHA\n\nbeta');
    expect(a.meta).toEqual({ rev: 2, at: 2000, owner: 'agent', note: 'shouted it' });
    expect(a.history).toHaveLength(1);
    expect(a.history[0].rev).toBe(1);
    expect(a.history[0].content).toBe('alpha\n\nbeta');
  });

  it('REJECTS a stale baseRev — counts it, changes nothing else', () => {
    let st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }));
    const before = st.artifacts[0];
    st = reduce(st, revise('a1', 1, { op: 'replace-part', index: 2, text: 'BETA' }, 3000));
    expect(st.rejectedStale).toBe(1);
    expect(st.artifacts[0]).toEqual(before); // untouched — no partial application
  });

  it('an illegal patch is a clean no-op (the validator makes this unreachable live)', () => {
    const st0 = seed();
    expect(reduce(st0, revise('a1', 1, { op: 'replace-part', index: 9, text: 'x' }))).toEqual(st0);
  });

  it('an unknown id is a clean no-op — replay must be deterministic', () => {
    const st0 = seed();
    expect(reduce(st0, revise('zzz', 1, { op: 'retitle', title: 'x' }))).toEqual(st0);
  });

  it('revising NEVER runs the capacity cap — a revise succeeds with the desk full', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) {
      st = reduce(st, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`,
        sources: ['word', 'excel'], content: 'alpha', createdAt: 1000 } });
    }
    st = reduce(st, revise('a1', 1, { op: 'retitle', title: 'Renamed' }));
    expect(st.artifacts[0].title).toBe('Renamed');
    expect(st.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(st.rejectedAtCap).toBe(0);
  });

  it('revertTo mints a NEW revision — the timeline stays append-only', () => {
    let st = reduce(seed(), revise('a1', 1, { op: 'replace-part', index: 1, text: 'ALPHA' }));
    st = reduce(st, { type: 'artifact.revertTo', id: 'a1', toRev: 1, at: 4000 });
    const a = st.artifacts[0];
    expect(a.rev).toBe(3);                       // not 1 — nothing is erased
    expect(a.content).toBe('alpha\n\nbeta');     // rev 1's content is back
    expect(a.meta).toEqual({ rev: 3, at: 4000, owner: 'user', note: 'reverted to rev 1' });
    expect(a.history.map((v) => v.rev)).toEqual([1, 2]);
  });

  it('revertTo an unknown rev is a no-op', () => {
    const st0 = seed();
    expect(reduce(st0, { type: 'artifact.revertTo', id: 'a1', toRev: 7, at: 4000 })).toEqual(st0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/artifacts/artifactStore.test.ts`
Expected: FAIL — the revise/revert events fall through to `default` and return state unchanged, so the first, second, fifth and sixth tests fail on rev/history/counter assertions.

- [ ] **Step 3: Implement the two cases**

In `src/artifacts/artifactStore.ts`, add the import and the two cases before `default:`:

```ts
import { applyPatch } from './parts';
import type { ArtifactState, ArtifactEvent, Artifact, ArtifactVersion } from './types';
```

```ts
    case 'artifact.revise': {
      const i = state.artifacts.findIndex((a) => a.id === event.id);
      if (i < 0) return state;
      const a = state.artifacts[i];
      // Three-layer staleness, layer 3 (tool-time and confirm-time are in refineTools/App):
      // the model addressed a revision that no longer exists. Refuse and COUNT — [ARTIFACTS]
      // surfaces the counter so the model can see it is working from a stale read.
      if (event.baseRev !== a.rev) return { ...state, rejectedStale: state.rejectedStale + 1 };
      const patched = applyPatch(a, event.patch);
      if (!patched) return state;
      const prior: ArtifactVersion = {
        rev: a.rev, title: a.title, content: a.content, fields: a.fields, meta: a.meta,
      };
      const next: Artifact = {
        ...patched,
        rev: a.rev + 1,
        meta: { rev: a.rev + 1, at: event.at, owner: event.owner, note: event.note },
        history: [...a.history, prior],
      };
      // NOTE: no capacity check. A revision creates nothing, so MAX_ARTIFACTS must not apply —
      // otherwise a full desk would silently freeze every artifact on it.
      return { ...state, artifacts: state.artifacts.map((x, j) => (j === i ? next : x)) };
    }
    case 'artifact.revertTo': {
      const i = state.artifacts.findIndex((a) => a.id === event.id);
      if (i < 0) return state;
      const a = state.artifacts[i];
      const target = a.history.find((v) => v.rev === event.toRev);
      if (!target) return state;
      // A revert is itself a FORWARD revision: the abandoned branch stays in history, so the
      // user can revert the revert. Nothing in this store is ever erased.
      const prior: ArtifactVersion = {
        rev: a.rev, title: a.title, content: a.content, fields: a.fields, meta: a.meta,
      };
      const next: Artifact = {
        ...a,
        title: target.title, content: target.content, fields: target.fields,
        rev: a.rev + 1,
        meta: { rev: a.rev + 1, at: event.at, owner: 'user', note: `reverted to rev ${event.toRev}` },
        history: [...a.history, prior],
      };
      return { ...state, artifacts: state.artifacts.map((x, j) => (j === i ? next : x)) };
    }
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `npx vitest run src/artifacts/artifactStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **610 tests**.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/artifactStore.ts src/artifacts/artifactStore.test.ts
git commit -m "feat(artifacts): revise + revertTo reducer — stale counted, revert is a forward revision"
```

---

### Task 3: Model-facing revision surfaces

The model cannot pass a correct `baseRev` unless it can read the current one. This task makes the handshake possible.

**Files:**
- Modify: `src/artifacts/serialize.ts:32-37`
- Modify: `src/artifacts/combineTools.ts:56-69` (`sourceDetail`)
- Modify: `src/artifacts/serialize.test.ts`
- Modify: `src/artifacts/combineTools.test.ts`

**Interfaces:**
- Consumes: `Artifact.rev`, `Artifact.meta`, `Artifact.history`, `ArtifactState.rejectedStale` (Tasks 1-2)
- Produces: `[ARTIFACTS]` items carrying `rev N`; `sourceDetail` carrying a revision list

- [ ] **Step 1: Write the failing tests**

Append to `src/artifacts/serialize.test.ts`:

```ts
  it('carries rev N so the model can hand it back as baseRev', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word', 'excel'], content: 'alpha', createdAt: 1,
      rev: 3, meta: { rev: 3, at: 9, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    expect(serializeArtifacts(st)).toContain('a1 "Brief" (doc, rev 3, from: word + excel)');
  });

  it('surfaces rejectedStale with the remedy', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word', 'excel'], content: 'alpha', createdAt: 1,
      rev: 2, meta: { rev: 2, at: 9, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 2 };
    const out = serializeArtifacts(st)!;
    expect(out).toContain('2 revisions were rejected as stale');
    expect(out).toContain('read the current rev before revising');
  });
```

Append to `src/artifacts/combineTools.test.ts` (inside the `sourceDetail` describe block, or a new one):

```ts
  it('sourceDetail doubles as the history reader — no separate tool', () => {
    const artifacts = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'ALPHA', createdAt: 1, rev: 2,
      meta: { rev: 2, at: 9, owner: 'agent' as const, note: 'tightened intro' },
      history: [{ rev: 1, title: 'Brief', content: 'alpha',
                  meta: { rev: 1, at: 1, owner: 'agent' as const } }] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    const out = sourceDetail('a1', {}, artifacts)!;
    expect(out).toContain('rev 1 (agent)');
    expect(out).toContain('rev 2 (agent, "tightened intro")');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/artifacts/serialize.test.ts src/artifacts/combineTools.test.ts`
Expected: FAIL — no `rev` in the item string, no stale note, no revision list.

- [ ] **Step 3: Implement the serializer change**

In `src/artifacts/serialize.ts`, change the `items` map and add the stale note:

```ts
  const items = state.artifacts.map((a) => {
    const feeds = a.kind === 'widget' ? feedsSummary(a.fields) : null;
    return `${a.id} "${a.title}" (${a.kind}, rev ${a.rev}, from: ${a.sources.join(' + ')}${feeds ? `; feeds: ${feeds}` : ''})`;
  });
  const capNote = state.rejectedAtCap > 0 ? ` ${state.rejectedAtCap} creation${state.rejectedAtCap === 1 ? ' was' : 's were'} rejected at the ${MAX_ARTIFACTS}-artifact cap — the user must close one first.` : '';
  // The rev in each item IS the handshake: refine_artifact must echo it back as baseRev, which
  // is what makes positional part ids ("paragraph 2") safe across revisions.
  const staleNote = state.rejectedStale > 0 ? ` ${state.rejectedStale} revision${state.rejectedStale === 1 ? ' was' : 's were'} rejected as stale — read the current rev before revising.` : '';
  return `[ARTIFACTS: ${items.join('; ') || 'none'}.${capNote}${staleNote} Artifacts are valid combine sources; refine_artifact changes one in place. DO NOT acknowledge this update.]`;
```

- [ ] **Step 4: Implement the sourceDetail change**

In `src/artifacts/combineTools.ts`, inside `sourceDetail`'s artifact branch, build a revision list and append it:

```ts
  if (art) {
    const feeds = art.kind === 'widget' ? feedsSummary(art.fields) : null;
    // The history reader: every version, who made it, and why. read_sources already exists and
    // the model already knows to call it before acting on content — no new tool needed.
    const revs = [...art.history.map((v) => v.meta), art.meta]
      .map((m) => `rev ${m.rev} (${m.owner}${m.note ? `, "${m.note}"` : ''})`)
      .join(' · ');
    return `${art.id} "${art.title}" (${art.kind}, rev ${art.rev}, from: ${art.sources.join(' + ')}${feeds ? `; feeds: ${feeds}` : ''}): ${art.content ?? art.fields?.map((f) => `${f.label}: ${f.value ?? f.feed}`).join('; ') ?? ''} [revisions: ${revs}]`;
  }
```

- [ ] **Step 5: Run the target tests, then the full suite**

Run: `npx vitest run src/artifacts/serialize.test.ts src/artifacts/combineTools.test.ts`
Expected: PASS.

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **613 tests**. Existing `serialize.test.ts` cases asserting the old item string will fail — update them to include `rev 1`. That is a correct pin of new behaviour, not a regression.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/serialize.ts src/artifacts/serialize.test.ts src/artifacts/combineTools.ts src/artifacts/combineTools.test.ts
git commit -m "feat(artifacts): [ARTIFACTS] carries rev + stale note; sourceDetail reads history"
```

---

### Task 4: Artifact sub-entities

**Files:**
- Modify: `src/artifacts/entities.ts`
- Modify: `src/artifacts/entities.test.ts`
- Modify: `src/artifacts/ArtifactWindow.tsx:88-127` (stamp parts, use `splitParagraphs`)

**Interfaces:**
- Consumes: `artifactParts`, `splitParagraphs` (Task 1)
- Produces: `artifactEntities(state, layout)` now returns part entities with ids `artifact-<id>-para-N` / `artifact-<id>-field-N` and `sub: true`

- [ ] **Step 1: Write the failing tests**

Append to `src/artifacts/entities.test.ts`:

```ts
  it('derives pointable doc paragraphs with ordinal and first-words aliases', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'Revenue reached 12M\n\nHarbor is behind schedule',
      createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    const ents = artifactEntities(st, { 'artifact-a1-para-2': [10, 20, 30, 40] });
    const p2 = ents.find((e) => e.id === 'artifact-a1-para-2')!;
    expect(p2.sub).toBe(true);
    expect(p2.bbox).toEqual([10, 20, 30, 40]);
    expect(p2.aliases).toContain('paragraph 2');
    expect(p2.aliases).toContain('second paragraph');
    expect(p2.aliases.some((a) => a.includes('harbor'))).toBe(true);
  });

  it('derives widget fields aliased by their label', () => {
    const st = { artifacts: [{ id: 'a2', kind: 'widget' as const, title: 'Board',
      sources: ['word'], fields: [{ label: 'Lead project', value: 'Harbor' }],
      createdAt: 1, rev: 1, meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 3, rejectedAtCap: 0, rejectedStale: 0 };
    const f1 = artifactEntities(st, {}).find((e) => e.id === 'artifact-a2-field-1')!;
    expect(f1.sub).toBe(true);
    expect(f1.aliases).toContain('lead project');
  });

  it('an unmeasured part degrades to a zero bbox — never a guessed position', () => {
    const st = { artifacts: [{ id: 'a1', kind: 'doc' as const, title: 'Brief',
      sources: ['word'], content: 'only one', createdAt: 1, rev: 1,
      meta: { rev: 1, at: 1, owner: 'agent' as const }, history: [] }],
      nextId: 2, rejectedAtCap: 0, rejectedStale: 0 };
    expect(artifactEntities(st, {}).find((e) => e.id === 'artifact-a1-para-1')!.bbox).toEqual([0, 0, 0, 0]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/artifacts/entities.test.ts`
Expected: FAIL — `artifact-a1-para-2` is undefined; only whole-artifact entities exist.

- [ ] **Step 3: Implement the deriver**

In `src/artifacts/entities.ts`, add the import and append part entities. Replace the `return state.artifacts.map(...)` with a `flatMap`:

```ts
import { artifactParts } from './parts';

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** First few words, for "the part about the budget". resolveEchoedTarget's ≥2-token overlap
 *  floor (R2) is what stops a one-word coincidence from grounding here. */
function firstWords(text: string): string { return text.split(/\s+/).slice(0, 5).join(' '); }
```

then, inside the existing `.map` body, change the `return` to build both the whole-artifact entity and its parts:

```ts
  return state.artifacts.flatMap((a) => {
    const id = `artifact-${a.id}`;
    const aliases = Array.from(new Set([
      normText(a.id), normText(a.title),
      ...(kindCount.get(a.kind) === 1 ? [normText(`the ${a.kind}`)] : []),
    ]));
    const whole: SceneEntity = {
      id: asId(id), title: a.title, url: '', category: 'content',
      aliases, bbox: layout[id] ?? [0, 0, 0, 0], sub: false,
    };
    // Parts are `sub: true` — the C1 discriminator. It is also what keeps them out of
    // blockedElementNumbers; the C1 final review caught slide ordinals leaking into the
    // soft-block set for exactly this reason.
    const parts = artifactParts(a).map((p): SceneEntity => {
      const partId = `${id}-${p.id}`;
      const noun = a.kind === 'widget' ? 'field' : 'paragraph';
      const partAliases = a.kind === 'widget'
        ? [normText(p.label ?? ''), normText(`${noun} ${p.index}`)]
        : [normText(`${noun} ${p.index}`),
           ...(ORDINALS[p.index] ? [normText(`${ORDINALS[p.index]} ${noun}`)] : []),
           ...(p.text ? [normText(firstWords(p.text))] : [])];
      return {
        id: asId(partId),
        title: a.kind === 'widget' ? `${p.label} — "${a.title}"` : `Paragraph ${p.index} — "${a.title}"`,
        url: '', category: 'content',
        aliases: Array.from(new Set(partAliases.filter(Boolean))),
        bbox: layout[partId] ?? [0, 0, 0, 0],
        sub: true,
      };
    });
    return [whole, ...parts];
  });
```

- [ ] **Step 4: Run the entity tests to verify they pass**

Run: `npx vitest run src/artifacts/entities.test.ts`
Expected: PASS.

- [ ] **Step 5: Stamp the parts in the renderer**

In `src/artifacts/ArtifactWindow.tsx`, import `splitParagraphs` and stamp each part. Replace the doc branch (line 89-91):

```tsx
        {artifact.kind === 'doc' && splitParagraphs(artifact.content).map((p, i) => (
          <p key={i} data-entity-id={`artifact-${artifact.id}-para-${i + 1}`} className="mb-2 last:mb-0">{p}</p>
        ))}
```

and add the stamp to the widget field row (the outer `<div key={i}>` at line 101):

```tsx
                <div key={i} data-entity-id={`artifact-${artifact.id}-field-${i + 1}`} className="flex flex-col gap-0.5 text-[11px] font-mono">
```

Add to the imports at the top of the file:

```tsx
import { splitParagraphs } from './parts';
```

Measurement needs no App change: `App.tsx:911` already scans `.artifact-window [data-entity-id]` and writes `artifactLayoutRef`.

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS, **616 tests**.

- [ ] **Step 7: Commit**

```bash
git add src/artifacts/entities.ts src/artifacts/entities.test.ts src/artifacts/ArtifactWindow.tsx
git commit -m "feat(artifacts): paragraphs and fields are pointable sub-entities"
```

---

### Task 5: The refine tool and its validator

**Files:**
- Create: `src/artifacts/refineTools.ts`
- Create: `src/artifacts/refineTools.test.ts`

**Interfaces:**
- Consumes: `artifactParts`, `applyPatch` (Task 1); `ArtifactState`, `ArtifactEvent`, `ArtifactPatch` (Task 1)
- Produces:
  - `REFINE_TOOL: VoiceTool`
  - `validPartIds(a: Artifact): string[]`
  - `validateRefineCall(args: any, state: ArtifactState, now: number): { event: ArtifactEvent } | { error: string }`
  - `describePatch(a: Artifact, p: ArtifactPatch): { partLabel: string; before: string; after: string }`

- [ ] **Step 1: Write the failing test**

Create `src/artifacts/refineTools.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/artifacts/refineTools.test.ts`
Expected: FAIL — `Failed to resolve import "./refineTools"`.

- [ ] **Step 3: Implement `refineTools.ts`**

Create `src/artifacts/refineTools.ts`:

```ts
// refine_artifact: change an EXISTING artifact in place (spec §7). Mirrors combineTools' shape —
// pure validation, errors-as-data, every remedy DERIVED from the same functions the resolver
// uses. Flat args only: nested object-arrays were the d24abef Gemini schema hazard.
import type { VoiceTool } from '../voice/types';
import type { Artifact, ArtifactState, ArtifactEvent, ArtifactPatch } from './types';
import { artifactParts, applyPatch } from './parts';

const OPS = ['replace-part', 'add-part', 'remove-part', 'retitle'] as const;

export const REFINE_TOOL: VoiceTool = {
  name: 'refine_artifact',
  description: 'Change an EXISTING artifact in place instead of creating a new one — rewrite a paragraph or field, add one, remove one, or retitle. Read the artifact\'s current "rev N" from [ARTIFACTS] and pass it as baseRev; address parts by their 1-based index (paragraph 2 = index 2). If the call is refused as stale, re-read [ARTIFACTS] and re-issue against the current revision. Revisions are reversible and do NOT count against the artifact cap.',
  parameters: { type: 'object', properties: {
    artifactId: { type: 'string', description: 'The artifact id from [ARTIFACTS], e.g. "a1".' },
    baseRev: { type: 'number', description: 'The rev N you read from [ARTIFACTS] for this artifact.' },
    op: { type: 'string', enum: [...OPS], description: 'What to do.' },
    index: { type: 'number', description: '1-based part index. For add-part, the position the new part will occupy; omit to append.' },
    text: { type: 'string', description: 'The new paragraph text, or a widget field value.' },
    label: { type: 'string', description: 'Widget fields only: the field label.' },
    title: { type: 'string', description: 'op=retitle: the new title.' },
    note: { type: 'string', description: 'Short reason, e.g. "tightened intro" — shown in the revision history.' },
  }, required: ['artifactId', 'baseRev', 'op'] },
};

/** The part ids that would actually resolve right now. Every "valid parts" message must be
 *  derived from THIS — naming a part that would fail is a lie to the model (combine C1). */
export function validPartIds(a: Artifact): string[] {
  return artifactParts(a).map((p) => p.id);
}

function partNoun(a: Artifact): string { return a.kind === 'widget' ? 'field' : 'paragraph'; }

/** The before/after the witness card renders — pure, so the card and the tests agree. */
export function describePatch(a: Artifact, p: ArtifactPatch): { partLabel: string; before: string; after: string } {
  if (p.op === 'retitle') return { partLabel: 'title', before: a.title, after: p.title.trim() };
  const parts = artifactParts(a);
  const noun = partNoun(a);
  if (p.op === 'add-part') {
    const at = p.index ?? parts.length + 1;
    return { partLabel: `${noun} ${at}`, before: '', after: (p.text ?? '').trim() };
  }
  const current = parts[p.index - 1];
  const before = current?.text ?? '';
  if (p.op === 'remove-part') return { partLabel: `${noun} ${p.index}`, before, after: '' };
  return { partLabel: `${noun} ${p.index}`, before, after: (p.text ?? current?.label ?? '').trim() };
}

export function validateRefineCall(
  args: any, state: ArtifactState, now: number,
): { event: ArtifactEvent } | { error: string } {
  const id = String(args?.artifactId ?? '');
  const a = state.artifacts.find((x) => x.id === id);
  if (!a) {
    const live = state.artifacts.map((x) => x.id);
    return { error: live.length
      ? `Unknown artifact "${id}". Live artifacts: ${live.join(', ')}.`
      : `Unknown artifact "${id}" — there are no artifacts on the desk. Use combine to create one first.` };
  }

  // Staleness layer 1 of 3 (tool time). Layer 2 is the confirm-time guard in App; layer 3 is
  // the reducer's own baseRev check, which counts what slips past both.
  const baseRev = Number(args?.baseRev);
  if (!Number.isFinite(baseRev)) {
    return { error: `refine_artifact needs baseRev — ${a.id} is at rev ${a.rev}. Read it from [ARTIFACTS] and pass it back.` };
  }
  if (baseRev !== a.rev) {
    return { error: `${a.id} is at rev ${a.rev}, you addressed rev ${baseRev} — re-read [ARTIFACTS] and re-issue against the current revision.` };
  }

  const op = String(args?.op ?? '');
  if (!(OPS as readonly string[]).includes(op)) {
    return { error: `Unknown op "${op}". Valid ops: ${OPS.join(', ')}.` };
  }

  const parts = artifactParts(a);
  const noun = partNoun(a);
  const rawIndex = args?.index;
  const hasIndex = rawIndex !== undefined && rawIndex !== null;
  const index = Number(rawIndex);

  let patch: ArtifactPatch;
  if (op === 'retitle') {
    const title = String(args?.title ?? '').trim();
    if (!title) return { error: 'refine_artifact op "retitle" needs a non-empty title.' };
    if (title === a.title) return { error: `${a.id} is already titled "${a.title}".` };
    patch = { op: 'retitle', title };
  } else if (op === 'add-part') {
    const text = String(args?.text ?? '').trim();
    if (!text) return { error: `refine_artifact op "add-part" needs text for the new ${noun}.` };
    if (hasIndex && (!Number.isInteger(index) || index < 1 || index > parts.length + 1)) {
      return { error: `index ${rawIndex} is out of range — ${a.id} has ${parts.length} ${noun}s, so add-part takes 1..${parts.length + 1} (or omit index to append).` };
    }
    if (a.kind === 'widget' && !String(args?.label ?? '').trim()) {
      return { error: 'a new widget field needs a label — an unlabeled field cannot be named or pointed at.' };
    }
    patch = { op: 'add-part', ...(hasIndex ? { index } : {}), text,
              ...(a.kind === 'widget' ? { label: String(args.label).trim() } : {}) };
  } else {
    if (!hasIndex || !Number.isInteger(index) || index < 1 || index > parts.length) {
      return { error: `index ${hasIndex ? rawIndex : '(missing)'} is not a ${noun} of ${a.id}. Valid parts: ${validPartIds(a).join(', ')}.` };
    }
    if (op === 'remove-part') {
      if (parts.length === 1) {
        return { error: `that would leave ${a.id} with no content. Refine the ${noun} instead, or ask the user to close the artifact.` };
      }
      patch = { op: 'remove-part', index };
    } else {
      const text = args?.text === undefined ? undefined : String(args.text).trim();
      const label = args?.label === undefined ? undefined : String(args.label).trim();
      if (text === undefined && label === undefined) {
        return { error: `refine_artifact op "replace-part" needs text${a.kind === 'widget' ? ' or label' : ''}.` };
      }
      if (a.kind === 'doc' && label !== undefined) {
        return { error: 'a doc has no field labels — use text to rewrite the paragraph, or op "retitle" for the artifact title.' };
      }
      const field = a.kind === 'widget' ? a.fields?.[index - 1] : undefined;
      if (text !== undefined && field?.feed) {
        // The chips say LIVE/SIMULATED. Authoring that value would launder authored text as
        // fetched data — the one thing the feed provenance surface exists to prevent.
        return { error: `field ${index} "${field.label}" is bound to the ${field.feed} feed — its value is live and cannot be authored. You can rename it with label, or remove it.` };
      }
      patch = { op: 'replace-part', index, text, label };
    }
  }

  // applyPatch is the final authority AND the no-op detector: every specific rule has its own
  // message above, so a null here means "the artifact already reads exactly that".
  if (!applyPatch(a, patch)) {
    const { partLabel } = describePatch(a, patch);
    return { error: `${a.id} ${partLabel} already reads exactly that — nothing to change.` };
  }

  const note = args?.note === undefined ? undefined : String(args.note).trim() || undefined;
  return { event: { type: 'artifact.revise', id: a.id, baseRev, patch, owner: 'agent', at: now, note } };
}
```

- [ ] **Step 4: Run the refine tests to verify they pass**

Run: `npx vitest run src/artifacts/refineTools.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, **630 tests**.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/refineTools.ts src/artifacts/refineTools.test.ts
git commit -m "feat(artifacts): refine_artifact tool + validator — remedies derived, never asserted"
```

---

### Task 6: Wire refine into the live tool path

**Files:**
- Modify: `src/scenarios.ts:497-508` (`VERB_CLASS`)
- Modify: `src/App.tsx:112` (import), `:368` (tool list), `:658` (`pendingAction` type), new routing branch after the `read_sources` branch (~`:1423`), `confirmPendingAction` (`:1695`)

**Interfaces:**
- Consumes: `REFINE_TOOL`, `validateRefineCall`, `describePatch` (Task 5); `artifactParts` (Task 1); existing `decideCommit`, `artifactDispatch`, `artifactStateRef`, `dialsRef`, `traceActivity`, `emitFeedback`, `telemetry`
- Produces: a live `refine_artifact` path; `pendingAction` carrying `artifactId`/`baseRev`/`patch`

- [ ] **Step 1: Add the verb class**

In `src/scenarios.ts`, add to `VERB_CLASS`:

```ts
  refine_artifact: 'mutate',
```

- [ ] **Step 2: Register the tool**

In `src/App.tsx` line 112, extend the import:

```ts
import { COMBINE_TOOL, READ_SOURCES_TOOL, validateCombineCall, sourceDetail, validSourceIds } from './artifacts/combineTools';
import { REFINE_TOOL, validateRefineCall, describePatch } from './artifacts/refineTools';
```

and add `REFINE_TOOL` to the tool list at line 368, after `READ_SOURCES_TOOL`:

```ts
    () => [...VOICE_TOOLS, ...buildActionTools(activeProgram), ...ANNOTATE_TOOLS, ...(activeProgram === 'word' ? [REVISE_TOOL] : []), ACT_TOOL, ...GOAL_TOOLS, ...WB_TOOLS, BEAUTIFY_TOOL, ...TEACH_TOOLS, COMBINE_TOOL, READ_SOURCES_TOOL, REFINE_TOOL],
```

- [ ] **Step 3: Widen the pendingAction type**

At `src/App.tsx:658`, add the artifact fields:

```ts
  const [pendingAction, setPendingAction] = useState<{ verb: string; label: string; target: string; detail?: string; confirmed: boolean; note?: string; charStart?: number; charEnd?: number; newText?: string; oldText?: string; artifactId?: string; baseRev?: number; patch?: ArtifactPatch } | null>(null);
```

and add `ArtifactPatch` to the artifacts types import in App.tsx.

- [ ] **Step 4: Add the routing branch**

In `handleVoiceToolCall`, immediately after the `read_sources` branch closes (before `} else if (ACTION_VERB_NAMES.includes(fc.name)) {`), insert:

```tsx
    } else if (fc.name === 'refine_artifact') {
      // Refine changes an artifact IN PLACE (spec §7). Unlike revise_text — which is hardcoded
      // to always witness — refine routes through the dials: its friction is a measured
      // variable across the register arms, and every revision is reversible either way.
      const v = validateRefineCall(fc.args, artifactStateRef.current, Date.now());
      if ('error' in v) {
        addLog('tool', `Tool Call: refine_artifact REJECTED — ${v.error}`);
        // ack() already calls callDeduper.forget() on success:false, so a corrected retry is
        // re-processed rather than acked as a fake deduped success (the G9 wrapper, App.tsx:1325).
        ack({ success: false, error: v.error });
      } else {
        const ev = v.event as Extract<ArtifactEvent, { type: 'artifact.revise' }>;
        const target = artifactStateRef.current.artifacts.find((a) => a.id === ev.id)!;
        const { partLabel, before, after } = describePatch(target, ev.patch);
        const decision = decideCommit('mutate', dialsRef.current.autonomy, false);
        telemetry.action('refine_artifact', 'mutate', decision, lastInputModalityRef.current);
        if (decision === 'witness') {
          addLog('tool', `Tool Call: refine_artifact(witness) — ${ev.id} ${partLabel}: "${before}" → "${after}"`);
          setPendingAction({ verb: 'refine_artifact', label: 'Refine', target: `${ev.id} ${partLabel}`,
            detail: `"${before}" → "${after}"`, confirmed: false,
            artifactId: ev.id, baseRev: ev.baseRev, patch: ev.patch, oldText: before, newText: after });
          emitFeedback({ outcome: 'needs-confirm', verbClass: 'mutate', label: `Confirm refine: ${ev.id} ${partLabel}` });
          ack({ success: true, witnessed: true });
        } else {
          artifactDispatch(ev);
          const nextState = artifactReduce(artifactStateRef.current, ev);
          artifactStateRef.current = nextState;
          setUndoStack((s) => [...s, { kind: 'artifact' as const, id: ev.id, toRev: ev.baseRev, label: `Refine ${ev.id}` }]);
          addLog('tool', `Tool Call: refine_artifact — ${ev.id} ${partLabel} (rev ${ev.baseRev} → ${ev.baseRev + 1})`);
          emitFeedback({ outcome: 'committed', verbClass: 'mutate', label: `Refined ${ev.id} ${partLabel}` });
          recordMissionCommit('refine_artifact', 'mutate');
          ack({ success: true, rev: ev.baseRev + 1, note: `${ev.id} is now at rev ${ev.baseRev + 1}.` });
        }
      }
```

- [ ] **Step 5: Add the artifact branch to confirmPendingAction**

In `src/App.tsx`, inside `confirmPendingAction` at line 1695, insert immediately after `if (!p || p.confirmed) return;` and BEFORE `const prevDoc = mockDocRef.current;` — the existing body calls `applyAction` on the mock doc unconditionally, so the artifact path must return before reaching it:

```tsx
    if (p.verb === 'refine_artifact' && p.artifactId && p.patch && p.baseRev !== undefined) {
      const live = artifactStateRef.current.artifacts.find((a) => a.id === p.artifactId);
      const currentPart = live ? describePatch(live, p.patch).before : null;
      // DOUBLE STALENESS GUARD (spec §7.4). Layer 2 of 3. Both conditions matter: the rev
      // catches another revision landing, the text catches the user hand-editing the very
      // paragraph under the witnessed card. Mirrors the revise stale-span guard below, which
      // came out of the 2026-07-16 smoke where confirms spliced ".ary.ary.y." into the doc.
      if (!live || live.rev !== p.baseRev || currentPart !== p.oldText) {
        setPendingAction(null);
        addLog('info', `Refine DROPPED — ${p.artifactId} changed since it was witnessed.`);
        emitFeedback({ outcome: 'error', label: 'Refine dropped — the artifact changed since it was witnessed' });
        const hint = serializeArtifacts(artifactStateRef.current);
        providerRef.current?.sendTextHint(`[SYSTEM: the pending refine was DROPPED — ${p.artifactId} changed since you addressed it, so applying it would have overwritten someone else's change. ${hint ?? ''} Re-read the artifact and call refine_artifact again with the current baseRev. DO NOT acknowledge this message.]`);
        return;
      }
      const ev: ArtifactEvent = { type: 'artifact.revise', id: p.artifactId, baseRev: p.baseRev,
        patch: p.patch, owner: 'agent', at: Date.now() };
      artifactDispatch(ev);
      artifactStateRef.current = artifactReduce(artifactStateRef.current, ev);
      setUndoStack((s) => [...s, { kind: 'artifact' as const, id: p.artifactId!, toRev: p.baseRev!, label: `Refine ${p.artifactId}` }]);
      telemetry.action('refine_artifact', 'mutate', 'commit', 'direct');
      recordMissionCommit('refine_artifact', 'mutate');
      emitFeedback({ outcome: 'committed', verbClass: 'mutate', label: `Refined ${p.artifactId}` });
      setPendingAction({ ...p, confirmed: true });
      providerRef.current?.sendTextHint(`[SYSTEM: the user confirmed via button — ${p.artifactId} is now at rev ${p.baseRev + 1}. Do not re-call the tool; do not acknowledge.]`);
      return;
    }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. The `setUndoStack` calls will fail until Task 7 widens the stack type — if so, **do Task 7's Step 1 now** and return here. (They are split because Task 7 carries the ⌘Z behaviour and its own test.)

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run && npx vite build`
Expected: PASS, **630 tests** (no new tests — this task is component wiring, verified by build + the Task 10 browser drive, per the repo's test boundary).

- [ ] **Step 8: Commit**

```bash
git add src/scenarios.ts src/App.tsx
git commit -m "feat(artifacts): refine_artifact live — dial-gated, double staleness guard on confirm"
```

---

### Task 7: Tagged undo stack

**Files:**
- Modify: `src/App.tsx:634` (state type), `:3355-3372` (`handleUndo`), `:3576` + `:3804` (undo count reads)

**Interfaces:**
- Consumes: `artifactDispatch`, `artifact.revertTo` (Task 2)
- Produces: `undoStack` entries typed `{ kind: 'doc'; doc: MockDoc; label: string } | { kind: 'artifact'; id: string; toRev: number; label: string }`

- [ ] **Step 1: Widen the stack type**

At `src/App.tsx:634`:

```tsx
  // Undo stack: pre-commit mementos. Doc entries restore a snapshot (applyAction is pure);
  // artifact entries revert to a revision — which the store records as a NEW revision, so
  // undoing is itself undoable and nothing is ever erased.
  const [undoStack, setUndoStack] = useState<(
    | { kind: 'doc'; doc: MockDoc; label: string }
    | { kind: 'artifact'; id: string; toRev: number; label: string }
  )[]>([]);
```

- [ ] **Step 2: Tag the existing doc pushes**

There are two: `App.tsx:1477` and inside `confirmPendingAction` (`:1714`). Change both from
`{ doc: prevDoc, label: … }` to `{ kind: 'doc' as const, doc: prevDoc, label: … }`.

Run `npx tsc --noEmit` and fix any other push sites it names the same way.

- [ ] **Step 3: Branch in handleUndo**

In `handleUndo` (`App.tsx:3355`), after `const last = undoStack[undoStack.length - 1];`, insert:

```tsx
    if (last.kind === 'artifact') {
      const ev: ArtifactEvent = { type: 'artifact.revertTo', id: last.id, toRev: last.toRev, at: Date.now() };
      artifactDispatch(ev);
      artifactStateRef.current = artifactReduce(artifactStateRef.current, ev);
      setUndoStack(undoStack.slice(0, -1));
      addLog('info', `Undo — ${last.label} (reverted to rev ${last.toRev})`);
      emitFeedback({ outcome: 'committed', verbClass: 'mutate', label: `Undid ${last.label}` });
      return;
    }
```

The remaining body reads `last.doc`, which now typechecks because the artifact case returned.

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: PASS, **630 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(artifacts): tagged undo stack — ⌘Z reverts an artifact revision"
```

---

### Task 8: Revision chip, history disclosure, and the ticker fix

**Files:**
- Modify: `src/artifacts/ArtifactWindow.tsx` (title bar, disclosure panel, effect deps)
- Modify: `src/App.tsx:3510` (pass `onRevert`)

**Interfaces:**
- Consumes: `Artifact.rev`, `Artifact.meta`, `Artifact.history` (Tasks 1-2)
- Produces: `ArtifactWindow` prop `onRevert: (toRev: number) => void`

- [ ] **Step 1: Fix the feed ticker's dead assumption**

In `src/artifacts/ArtifactWindow.tsx`, replace the stale comment at lines 30-33 and the dep array at line 65:

```tsx
  // Fields are NO LONGER create-only (2026-07-26 revise core): refine_artifact and direct user
  // edits can add or remove a feed-bound field, so the ticker must re-establish on every
  // revision — keying on id alone would leave a new feed unread or a removed one still polling.
```

```tsx
  }, [artifact.kind, artifact.id, artifact.rev]);
```

- [ ] **Step 2: Add the rev chip and history disclosure**

Change the component signature and add disclosure state:

```tsx
export function ArtifactWindow({ artifact, index, onClose, onRevert }: {
  artifact: Artifact; index: number; onClose: () => void; onRevert: (toRev: number) => void;
}) {
  const fields = artifact.fields ?? [];
  const [statuses, setStatuses] = React.useState<Record<number, FieldStatus>>({});
  const [historyOpen, setHistoryOpen] = React.useState(false);
```

In the title bar, add the chip before the close button:

```tsx
        <div className="flex items-center gap-1.5 shrink-0">
          {/* The rev chip is the user-facing half of the (baseRev, index) handshake the model
              uses — and the entry to the history. It is always visible, like provenance. */}
          <button
            aria-label={`Revision ${artifact.rev} — show history`}
            aria-expanded={historyOpen}
            className="hit-24 text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--card-border)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setHistoryOpen((o) => !o)}
          >rev {artifact.rev}</button>
          <button aria-label="Close artifact" className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClose}><X size={13} /></button>
        </div>
```

(replacing the existing lone close `<button>` at line 81).

Then, immediately after the provenance line `</div>` (line 87), add the disclosure panel. Mark it `data-shell` so it reads as chrome, not pointable content:

```tsx
      {historyOpen && (
        <div data-shell className="px-3 py-1.5 border-b border-[var(--card-border)] flex flex-col gap-1 max-h-28 overflow-y-auto">
          {artifact.history.length === 0 && (
            <div className="text-[9px] font-mono text-[var(--text-secondary)]">No earlier revisions — this is the original.</div>
          )}
          {artifact.history.map((v) => (
            <div key={v.rev} className="flex items-center justify-between gap-2 text-[9px] font-mono">
              <span className="text-[var(--text-secondary)] truncate">
                rev {v.rev} · {v.meta.owner === 'user' ? 'you' : 'agent'}{v.meta.note ? ` · ${v.meta.note}` : ''}
              </span>
              <button
                className="hit-24 shrink-0 px-1.5 text-[var(--accent-color)] hover:underline"
                onClick={() => { onRevert(v.rev); setHistoryOpen(false); }}
              >revert</button>
            </div>
          ))}
          <div className="text-[9px] font-mono text-[var(--text-primary)]">
            rev {artifact.rev} · {artifact.meta.owner === 'user' ? 'you' : 'agent'}{artifact.meta.note ? ` · ${artifact.meta.note}` : ''} · now
          </div>
        </div>
      )}
```

- [ ] **Step 3: Pass `onRevert` at the mount site**

At `src/App.tsx:3510`:

```tsx
            <ArtifactWindow key={a.id} artifact={a} index={i}
              onClose={() => artifactDispatch({ type: 'artifact.close', id: a.id })}
              onRevert={(toRev) => {
                const ev: ArtifactEvent = { type: 'artifact.revertTo', id: a.id, toRev, at: Date.now() };
                artifactDispatch(ev);
                artifactStateRef.current = artifactReduce(artifactStateRef.current, ev);
                addLog('info', `Reverted ${a.id} to rev ${toRev}`);
                emitFeedback({ outcome: 'committed', verbClass: 'mutate', label: `Reverted ${a.id} to rev ${toRev}` });
              }} />
```

- [ ] **Step 4: Typecheck, full suite, build**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: PASS, **630 tests**.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts/ArtifactWindow.tsx src/App.tsx
git commit -m "feat(artifacts): rev chip + history disclosure with per-revision revert; ticker re-keys on rev"
```

---

### Task 9: Direct user editing

**Files:**
- Modify: `src/artifacts/ArtifactWindow.tsx` (editable parts)
- Modify: `src/App.tsx:3510` (pass `onEditPart`)

**Interfaces:**
- Consumes: `artifact.revise` with `owner: 'user'` (Task 2)
- Produces: `ArtifactWindow` prop `onEditPart: (patch: ArtifactPatch, baseRev: number) => void`

- [ ] **Step 1: Add edit state and the editor**

In `src/artifacts/ArtifactWindow.tsx`, extend the signature:

```tsx
export function ArtifactWindow({ artifact, index, onClose, onRevert, onEditPart }: {
  artifact: Artifact; index: number; onClose: () => void;
  onRevert: (toRev: number) => void;
  onEditPart: (patch: ArtifactPatch, baseRev: number) => void;
}) {
```

Add editing state next to `historyOpen`:

```tsx
  // Direct editing: the user changing their own material needs no witness — the witness gate
  // exists for the agent's INTERPRETATION being wrong. A commit mints a revision owned by the
  // user. `editing` holds the 1-based part index.
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState('');

  const startEdit = (index1: number, text: string) => { setEditing(index1); setDraft(text); };
  const commitEdit = (index1: number, original: string) => {
    const text = draft.trim();
    setEditing(null);
    if (!text || text === original) return;          // no-op edits mint no revision
    onEditPart({ op: 'replace-part', index: index1, text }, artifact.rev);
  };
```

- [ ] **Step 2: Make doc paragraphs editable**

Replace the doc branch from Task 4 with:

```tsx
        {artifact.kind === 'doc' && splitParagraphs(artifact.content).map((p, i) => (
          editing === i + 1 ? (
            // A textarea is an editable target, so isEditableTarget (src/shell/quickFire.ts:25)
            // already stops the backtick register chord and quick-fire digits from firing here.
            <textarea
              key={i}
              autoFocus
              aria-label={`Edit paragraph ${i + 1}`}
              className="w-full mb-2 min-h-6 rounded border border-[var(--accent-color)] bg-transparent p-1 text-[12px] leading-relaxed text-[var(--text-primary)]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitEdit(i + 1, p)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(i + 1, p); }
              }}
            />
          ) : (
            <p
              key={i}
              data-entity-id={`artifact-${artifact.id}-para-${i + 1}`}
              className="mb-2 last:mb-0 cursor-text hover:bg-[var(--card-border)]/20 rounded"
              onDoubleClick={() => startEdit(i + 1, p)}
              title="Double-click to edit"
            >{p}</p>
          )
        ))}
```

Double-click, not single: a single click on a paragraph is how the user POINTS at it, and pointing must not be hijacked by editing (the 2026-07-18 finding that pointing and asking must not fight each other).

- [ ] **Step 3: Make widget field values editable**

In the widget branch, replace the value `<span>` (line 116) with:

```tsx
                      {editing === i + 1 && !descriptor ? (
                        <input
                          autoFocus
                          aria-label={`Edit ${f.label}`}
                          className="min-h-6 w-24 rounded border border-[var(--accent-color)] bg-transparent px-1 text-[11px] text-[var(--text-primary)]"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit(i + 1, f.value ?? '')}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(i + 1, f.value ?? ''); }
                          }}
                        />
                      ) : (
                        <span
                          className={descriptor ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)] cursor-text hover:bg-[var(--card-border)]/20 rounded px-0.5'}
                          onDoubleClick={descriptor ? undefined : () => startEdit(i + 1, f.value ?? '')}
                          title={descriptor ? 'Live feed value — not editable' : 'Double-click to edit'}
                        >{displayValue}</span>
                      )}
```

A feed-bound field is not editable by the user for the same reason the model cannot author it: the value is fetched, and the chip says so.

- [ ] **Step 4: Wire `onEditPart`**

At `src/App.tsx:3510`, add to the `ArtifactWindow` props:

```tsx
              onEditPart={(patch, baseRev) => {
                const ev: ArtifactEvent = { type: 'artifact.revise', id: a.id, baseRev, patch,
                  owner: 'user', at: Date.now(), note: 'edited by hand' };
                artifactDispatch(ev);
                artifactStateRef.current = artifactReduce(artifactStateRef.current, ev);
                setUndoStack((s) => [...s, { kind: 'artifact' as const, id: a.id, toRev: baseRev, label: `Edit ${a.id}` }]);
                addLog('info', `You edited ${a.id} (rev ${baseRev} → ${baseRev + 1})`);
                // The model must learn the material changed under it — otherwise its next
                // baseRev is stale and it will be refused without knowing why.
                const hint = serializeArtifacts(artifactStateRef.current);
                if (hint) providerRef.current?.sendTextHint(hint);
              }}
```

- [ ] **Step 5: Typecheck, full suite, build**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: PASS, **630 tests**.

- [ ] **Step 6: Commit**

```bash
git add src/artifacts/ArtifactWindow.tsx src/App.tsx
git commit -m "feat(artifacts): direct user editing — double-click a part, commit mints a user revision"
```

---

### Task 10: Keyless demo and end-to-end drive

**Files:**
- Modify: `src/artifacts/demo.ts` (add revise args)
- Modify: `src/artifacts/demo.test.ts`
- Modify: `src/App.tsx:3240-3255` (chain a scripted revise after the widget)

**Interfaces:**
- Consumes: everything above
- Produces: `ARTIFACT_DEMO_REFINE_ARGS`

- [ ] **Step 1: Write the failing test**

Append to `src/artifacts/demo.test.ts`:

```ts
import { ARTIFACT_DEMO_REFINE_ARGS } from './demo';
import { validateRefineCall } from './refineTools';
import { validateCombineCall } from './combineTools';
import { reduce, initialArtifactState } from './artifactStore';

it('the scripted refine validates and applies against the demo artifact', () => {
  const corpus = { word: { kind: 'word' as const, text: 'x' } } as any;
  const created = validateCombineCall(ARTIFACT_DEMO_ARGS, corpus, initialArtifactState(), 1000);
  expect('event' in created).toBe(true);
  let st = reduce(initialArtifactState(), (created as any).event);
  const v = validateRefineCall(ARTIFACT_DEMO_REFINE_ARGS, st, 2000);
  expect('event' in v).toBe(true);
  st = reduce(st, (v as any).event);
  expect(st.artifacts[0].rev).toBe(2);
  expect(st.artifacts[0].history).toHaveLength(1);
});
```

(If `demo.test.ts`'s existing imports already cover `ARTIFACT_DEMO_ARGS`, fold the new imports into them rather than duplicating.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/artifacts/demo.test.ts`
Expected: FAIL — `ARTIFACT_DEMO_REFINE_ARGS` is not exported.

- [ ] **Step 3: Add the demo args**

Append to `src/artifacts/demo.ts`:

```ts
/**
 * The scripted refine (spec §13): rewrites paragraph 1 of the doc artifact created by
 * ARTIFACT_DEMO_ARGS, replayed through the REAL validateRefineCall + reducer. This is what
 * makes the whole revise loop drivable with no API key — rev chip, history, and revert all
 * become reachable offline.
 */
export const ARTIFACT_DEMO_REFINE_ARGS = {
  artifactId: 'a1',
  baseRev: 1,
  op: 'replace-part' as const,
  index: 1,
  text: `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin — ahead of plan, led by ${MERIDIAN.projects[0]}.`,
  note: 'tightened the opening',
};
```

- [ ] **Step 4: Chain it in the demo effect**

In `src/App.tsx`, inside the widget `setTimeout` callback (after the widget hint is logged, ~line 3254), add a third chained step:

```tsx
        setTimeout(() => {
          const vr = validateRefineCall(ARTIFACT_DEMO_REFINE_ARGS, artifactStateRef.current, Date.now());
          if ('error' in vr) {
            addLog('tool', `Tool Call: refine_artifact (demo) REJECTED — ${vr.error}`);
            return;
          }
          artifactDispatch(vr.event);
          artifactStateRef.current = artifactReduce(artifactStateRef.current, vr.event);
          addLog('tool', `Tool Call: refine_artifact (demo) — a1 paragraph 1 (rev 1 → 2)`);
          emitFeedback({ outcome: 'committed', verbClass: 'mutate', label: 'Refined a1 paragraph 1' });
          const refineHint = serializeArtifacts(artifactStateRef.current);
          if (refineHint) addLog('info', refineHint);
        }, 900);
```

and extend the import at line 116 to include `ARTIFACT_DEMO_REFINE_ARGS`.

- [ ] **Step 5: Run the full suite, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: PASS, **631 tests**.

- [ ] **Step 6: Drive it in the browser**

```bash
npx vite --port 3001
```

Open `http://localhost:3001/?artifacts=1` and verify, one at a time:
- the doc artifact appears, then the widget, then the doc's first paragraph rewrites itself
- the doc window's chip reads **rev 2**
- clicking the chip discloses `rev 1 · agent` with a **revert** control, and the current line reads `rev 2 · agent · tightened the opening · now`
- clicking **revert** restores rev 1's text and the chip reads **rev 3** — nothing was erased
- ⌘Z after the revert steps back again
- double-clicking a paragraph opens the editor; typing and pressing Enter commits, the chip increments, and the history shows `you`
- pressing Escape mid-edit leaves the text untouched and mints no revision
- typing a digit while the editor is focused types the digit — it does not fire a quick-fire chip
- in the op-stream drawer, the `[ARTIFACTS]` line carries `rev N`

Fix anything that fails before committing.

- [ ] **Step 7: Commit**

```bash
git add src/artifacts/demo.ts src/artifacts/demo.test.ts src/App.tsx
git commit -m "feat(artifacts): scripted revise in ?artifacts=1 — the loop is drivable keyless"
```

---

## Owed human smoke (live, needs a key)

Add to the standing sitting doc (`docs/superpowers/smokes/2026-07-24-human-smoke-sitting.md`) rather than running here:

| # | Test | Verifies |
|---|---|---|
| S1 | Ask for a refine under Guided | Auto-commits, no witness card, activity ticker shows the dispatch, chip increments |
| S2 | Same refine under `manual` (Control Center) | Witness card with the before→after diff; confirm applies |
| S3 | Refine twice quickly without re-reading | Second call refused as stale, naming the real rev; the model re-reads and succeeds |
| S4 | Point at "the second paragraph" by voice, ask to tighten it | Part sub-entity grounds; the refine targets index 2 |
| S5 | Hand-edit a paragraph while a refine targeting it sits witnessed, then confirm | Honest drop, user's edit stands, model told to recompute |
| S6 | Refine a feed-bound widget field's value | Honest refusal naming the feed, offering the rename |

## Self-Review

**Spec coverage:** §3 data model → Task 1 · §3.1 patch vocabulary → Task 1 · §3.2 events → Tasks 1-2 · §4 part identity → Task 1 · §5 reducer semantics → Task 2 · §6 sub-entities → Task 4 · §7 tool + validation → Task 5 · §7.2 dial gating → Task 6 · §7.3 feed protection → Tasks 1, 5, 9 · §7.4 double staleness guard → Task 6 · §8 direct editing → Task 9 · §9 revert and undo → Tasks 7-8 · §10 model-facing surfaces → Task 3 · §11 ticker fix → Task 8 · §12 telemetry → Task 6 · §13 testing → every task + Task 10 · §14 risks → mitigations land in the tasks named above.

**Deviation from the spec, noted:** §7.4 says "rejections call `deduper.forget()`". That is already automatic — `ack()` calls `callDeduperRef.current.forget()` whenever `result.success === false` (`App.tsx:1325`). No work is required; Task 6 documents it at the call site instead.

**Type consistency:** `applyPatch` / `artifactParts` / `splitParagraphs` (Task 1) are consumed under those exact names in Tasks 2, 4, 5. `validateRefineCall(args, state, now)` and `describePatch(a, patch)` (Task 5) are called with that arity in Tasks 6 and 10. `ArtifactEvent`'s `at` field is supplied at every dispatch site (Tasks 6-10). The `undoStack` element type introduced in Task 7 matches every `setUndoStack` push in Tasks 6, 7 and 9.
