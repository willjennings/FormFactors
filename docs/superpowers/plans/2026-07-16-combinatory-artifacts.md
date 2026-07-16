# Combinatory Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-referent synthesis — "take this and that, make something new" — per `docs/superpowers/specs/2026-07-16-combinatory-artifacts-design.md`: a persistent cross-program corpus seeded with the Meridian Structural story, a create-only `combine` tool producing pointable artifact windows (M1: merged docs; M2: widgets with LIVE/SIMULATED data feeds).

**Architecture:** New `src/artifacts/` subsystem: `seeds` (the Meridian ground-truth corpus + integrity test), `corpus` (persistence helper), `artifactStore` (pure reducer, reject-never-evict), `combineTools` (`combine` + `read_sources`, validation with capacity-by-simulation), `serialize` (`[CORPUS]` gists + `[ARTIFACTS]`), `feeds` (M2 registry), `ArtifactWindow` (floating, pointable, user-only close). App wiring: corpus survives program swaps, artifact windows register as measured entities (NOTE: `updateLayout` currently measures `[data-entity-id]` only inside `.program-window` — Task 6 extends it), hints deduped + gate-reset-on-open like all others.

**Tech Stack:** React 19 + TypeScript, vitest (node env; JSX verified by tsc+suite+build), the existing entity/hint/earcon/undo machinery.

## Global Constraints

- **Create-only agent** (spec §7): no agent path closes or mutates an artifact; closing is a user-only button. Never enforce by prompt alone.
- **Reject, never evict** (spec §7): `MAX_ARTIFACTS = 6`; at capacity, `validateCombineCall` fails errors-as-data AND the reducer itself refuses (`rejectedAtCap` counter surfaced in `[ARTIFACTS]`).
- **Provenance is the witness** (spec §5/§12): creation lands directly (no witness card, `create` earcon, undo closes newest); the artifact permanently renders "from: X + Y".
- **≥ 2 sources**; unknown ids fail the whole call naming valid ids (spec §4).
- **Gists in standing context, full text on demand** via `read_sources` → one-shot `[CORPUS DETAIL: …]` hint (spec §5/§12).
- **Feeds declare themselves** (spec §8, M2): `clock` LIVE (local, 1s) · `weather` LIVE (open-meteo, keyless, fixed demo coords, ~10 min refresh) · `stock` SIMULATED (deterministic walk, ~5s). Chip + last-updated on every bound field; failure → "feed unavailable" (stale values keep their OLD timestamp visible); the model never claims simulated is real.
- **Seed integrity is tested** (spec §3.1): report figures == spreadsheet figures; deck highlights ⊂ report; photo caption names a seeded project. `initialMockDoc` in `src/scenarios.ts` is NOT changed (dozens of tests depend on its exact strings) — seeds are a separate module the App boots from.
- Tests `npx vitest run <file>`; full gate `npx tsc --noEmit && npm test` (+ `npm run build` for JSX tasks). TDD every pure module.
- Commits `feat(artifacts): …` + trailers:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JLnWySYQtTUjkZfgHRNjGw
```

---

### Task 1: Seeds + corpus helper (the Meridian ground truth)

**Files:**
- Create: `src/artifacts/seeds.ts`, `src/artifacts/corpus.ts`
- Modify: `src/scenarios.ts` (photo variant gains `caption?: string` — one line in the `MockDoc` union)
- Test: `src/artifacts/seeds.test.ts`, `src/artifacts/corpus.test.ts`

**Interfaces:**
- Produces: `seedCorpus(): Record<ProgramId, MockDoc>` — the Meridian docs; `MERIDIAN` (exported fact constants used by the integrity test); `saveAndLoad(corpus, outgoingId, outgoingDoc, incomingId): { corpus: Partial<Record<ProgramId, MockDoc>>; doc: MockDoc }` — pure swap helper (falls back to `seedCorpus()[incomingId]`).
- Consumes: `MockDoc`, `ProgramId`, `initialMockDoc` from `../scenarios`.

- [ ] **Step 1: Add the caption field** — in `src/scenarios.ts`, change the photo variant of `MockDoc` to:

```ts
  | { kind: 'photo'; cropped: boolean; resized: boolean; brightness: number; bgRemoved: boolean; saved: boolean; caption?: string };
```

Also append the caption to `serializeMockDoc`'s photo case (so the model can read it — it is the ONLY thing the model may know about the photo):

```ts
    case 'photo':
      return `Photo — ${doc.cropped ? 'cropped, ' : ''}${doc.resized ? 'resized, ' : ''}brightness:+${doc.brightness}${doc.bgRemoved ? ', background removed' : ''}${doc.caption ? `, caption:"${doc.caption}"` : ''}, saved:${doc.saved ? 'yes' : 'no'}`;
```

- [ ] **Step 2: Write the failing seed-integrity test** — create `src/artifacts/seeds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedCorpus, MERIDIAN } from './seeds';

// Spec §3.1: the seeds are the GROUND TRUTH for the liberty audit — their cross-references
// must hold or the audit judges syntheses against a drifted baseline.
describe('Meridian seed corpus integrity', () => {
  const c = seedCorpus();
  it('seeds all four programs', () => {
    expect(c.word.kind).toBe('word');
    expect(c.excel.kind).toBe('excel');
    expect(c.powerpoint.kind).toBe('powerpoint');
    expect(c.photo.kind).toBe('photo');
  });
  it('the report cites the exact figures the spreadsheet holds', () => {
    if (c.word.kind !== 'word' || c.excel.kind !== 'excel') throw new Error('kinds');
    expect(c.word.text).toContain(MERIDIAN.revenue);
    expect(c.word.text).toContain(MERIDIAN.margin);
    expect(Object.values(c.excel.cells)).toContain(MERIDIAN.revenue);
    expect(Object.values(c.excel.cells)).toContain(MERIDIAN.margin);
  });
  it('the report and spreadsheet name both projects; the deck highlights are a subset of report facts', () => {
    if (c.word.kind !== 'word' || c.excel.kind !== 'excel' || c.powerpoint.kind !== 'powerpoint') throw new Error('kinds');
    for (const proj of MERIDIAN.projects) {
      expect(c.word.text).toContain(proj);
      expect(Object.values(c.excel.cells)).toContain(proj);
    }
    const highlights = c.powerpoint.slides[1];
    expect(highlights).toContain(MERIDIAN.revenue);
    expect(highlights).toContain(MERIDIAN.projects[0]);
  });
  it('the outlook slide plants the ONE unique fact (in no other doc)', () => {
    if (c.word.kind !== 'word' || c.powerpoint.kind !== 'powerpoint') throw new Error('kinds');
    expect(c.powerpoint.slides[2]).toContain(MERIDIAN.uniqueOutlookFact);
    expect(c.word.text).not.toContain(MERIDIAN.uniqueOutlookFact);
  });
  it('the photo caption names a seeded project (the model may know the caption, never the pixels)', () => {
    if (c.photo.kind !== 'photo') throw new Error('kinds');
    expect(c.photo.caption).toContain(MERIDIAN.projects[0]);
  });
  it('the excel seed stays inside the pointable A1..D6 grid', () => {
    if (c.excel.kind !== 'excel') throw new Error('kinds');
    for (const key of Object.keys(c.excel.cells)) expect(key).toMatch(/^[A-D][1-6]$/);
  });
});
```

- [ ] **Step 3: Verify RED**: `npx vitest run src/artifacts/seeds.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `src/artifacts/seeds.ts`**:

```ts
// The Meridian Structural Q3 2026 seed corpus (spec §3.1): one coherent story with
// cross-referenced facts so synthesis liberties are detectable against ground truth.
// initialMockDoc (scenarios.ts) is deliberately untouched — tests depend on its strings;
// the App boots its corpus from HERE.
import type { MockDoc, ProgramId } from '../scenarios';

export const MERIDIAN = {
  revenue: '$4.2M',
  margin: '18%',
  projects: ['Riverside Tower', 'Dockside Depot'] as const,
  uniqueOutlookFact: 'Harbor Bridge bid',
};

export function seedCorpus(): Record<ProgramId, MockDoc> {
  return {
    word: {
      kind: 'word', bold: false, saved: false,
      text: [
        'Meridian Structural — Q3 2026 report.',
        `Revenue reached ${MERIDIAN.revenue} at an ${MERIDIAN.margin} margin, led by ${MERIDIAN.projects[0]} and ${MERIDIAN.projects[1]}.`,
        `${MERIDIAN.projects[0]} topped out steel in September; ${MERIDIAN.projects[1]} remains two weeks behind schedule.`,
        'Risk note: crane availability constrains Q4 pours.',
      ].join(' '),
    },
    excel: {
      kind: 'excel', currency: [], chart: false, saved: false,
      cells: {
        A1: 'Metric', B1: 'Q3', C1: 'Project', D1: 'Status',
        A2: 'Revenue', B2: '$4.2M', C2: 'Riverside Tower', D2: 'On schedule',
        A3: 'Costs', B3: '$3.4M', C3: 'Dockside Depot', D3: '2 wks behind',
        A4: 'Margin', B4: '18%',
      },
    },
    powerpoint: {
      kind: 'powerpoint', saved: false,
      slides: [
        'Meridian Structural — Q3 2026 board review',
        `Highlights: revenue ${MERIDIAN.revenue}, margin ${MERIDIAN.margin}, ${MERIDIAN.projects[0]} steel topped out`,
        `Outlook: ${MERIDIAN.uniqueOutlookFact} submitted, decision expected Q4`,
      ],
    },
    photo: {
      kind: 'photo', cropped: false, resized: false, brightness: 0, bgRemoved: false, saved: false,
      caption: `${MERIDIAN.projects[0]} — steel topping out, Sept 2026`,
    },
  };
}
```

- [ ] **Step 5: Verify GREEN**, then write the failing corpus test — create `src/artifacts/corpus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { saveAndLoad } from './corpus';
import { seedCorpus } from './seeds';
import type { MockDoc } from '../scenarios';

describe('corpus persistence (spec §3: docs survive program swaps)', () => {
  it('saves the outgoing doc and loads a previously saved incoming doc', () => {
    const edited: MockDoc = { kind: 'word', text: 'EDITED', bold: true, saved: false };
    const r1 = saveAndLoad({}, 'word', edited, 'excel');
    expect(r1.corpus.word).toEqual(edited);
    expect(r1.doc.kind).toBe('excel'); // seeded fallback
    const backToWord = saveAndLoad(r1.corpus, 'excel', r1.doc, 'word');
    expect(backToWord.doc).toEqual(edited); // NOT reset — the fix this module exists for
  });
  it('falls back to the Meridian seed for a never-visited program', () => {
    const r = saveAndLoad({}, 'word', seedCorpus().word, 'powerpoint');
    expect(r.doc).toEqual(seedCorpus().powerpoint);
  });
});
```

- [ ] **Step 6: Verify RED, implement `src/artifacts/corpus.ts`**:

```ts
// Pure swap helper: the outgoing program's doc is preserved; the incoming one is restored
// (or seeded on first visit). Kills the reset in handleProgramChange that made
// "take the report and the numbers" inexpressible (spec §3).
import type { MockDoc, ProgramId } from '../scenarios';
import { seedCorpus } from './seeds';

export function saveAndLoad(
  corpus: Partial<Record<ProgramId, MockDoc>>, outgoingId: ProgramId, outgoingDoc: MockDoc, incomingId: ProgramId,
): { corpus: Partial<Record<ProgramId, MockDoc>>; doc: MockDoc } {
  const next = { ...corpus, [outgoingId]: outgoingDoc };
  return { corpus: next, doc: next[incomingId] ?? seedCorpus()[incomingId] };
}
```

- [ ] **Step 7: Verify GREEN; full gate; commit** `feat(artifacts): Meridian seed corpus (integrity-tested ground truth) + corpus persistence helper (TDD)`.

---

### Task 2: `types.ts` + `artifactStore.ts` — reject, never evict (TDD)

**Files:**
- Create: `src/artifacts/types.ts`, `src/artifacts/artifactStore.ts`
- Test: `src/artifacts/artifactStore.test.ts`

**Interfaces:**
- Produces: types below; `MAX_ARTIFACTS = 6`; `initialArtifactState(): ArtifactState`; `reduce(state, event): ArtifactState`.

- [ ] **Step 1: Create `src/artifacts/types.ts`**:

```ts
// Synthesized artifacts: what the agent makes from N sources. The agent's tool surface is
// CREATE-ONLY (spec §7) — artifact.close exists for the USER's × button, and no tool maps to it.
export type FeedId = 'clock' | 'weather' | 'stock';

export interface WidgetField { label: string; value?: string; feed?: FeedId }

export interface Artifact {
  id: string;                       // 'a1', 'a2', … deterministic
  kind: 'doc' | 'widget';
  title: string;
  sources: string[];                // program ids and/or artifact ids — the provenance line
  content?: string;                 // kind 'doc'
  fields?: WidgetField[];           // kind 'widget'
  createdAt: number;
}

export type ArtifactEvent =
  | { type: 'artifact.create'; artifact: Omit<Artifact, 'id'> }
  | { type: 'artifact.close'; id: string };  // user-only

export interface ArtifactState { artifacts: Artifact[]; nextId: number; rejectedAtCap: number }
```

- [ ] **Step 2: Write the failing tests** — create `src/artifacts/artifactStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';

const mk = (title = 'T') => ({ type: 'artifact.create' as const, artifact: { kind: 'doc' as const, title, sources: ['word', 'excel'], content: 'x', createdAt: 1000 } });

describe('artifactStore', () => {
  it('creates with deterministic ids', () => {
    let st = reduce(initialArtifactState(), mk('One'));
    st = reduce(st, mk('Two'));
    expect(st.artifacts.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
  it('REJECTS at MAX_ARTIFACTS — never evicts (spec §7, the beautify lesson)', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) st = reduce(st, mk(`A${i}`));
    const full = reduce(st, mk('overflow'));
    expect(full.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(full.artifacts.map((a) => a.title)).not.toContain('overflow');
    expect(full.artifacts[0].title).toBe('A0'); // the oldest SURVIVES
    expect(full.rejectedAtCap).toBe(1);
  });
  it('close removes exactly the named artifact; unknown id is a no-op', () => {
    let st = reduce(initialArtifactState(), mk('One'));
    st = reduce(st, mk('Two'));
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    expect(st.artifacts.map((a) => a.id)).toEqual(['a2']);
    expect(reduce(st, { type: 'artifact.close', id: 'zzz' })).toEqual(st);
  });
  it('a close frees capacity for a new create (and resets nothing else)', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) st = reduce(st, mk(`A${i}`));
    st = reduce(st, { type: 'artifact.close', id: 'a1' });
    st = reduce(st, mk('fits-now'));
    expect(st.artifacts.map((a) => a.title)).toContain('fits-now');
  });
});
```

- [ ] **Step 3: Verify RED. Step 4: Implement `src/artifacts/artifactStore.ts`**:

```ts
import type { ArtifactState, ArtifactEvent, Artifact } from './types';

export const MAX_ARTIFACTS = 6;

export function initialArtifactState(): ArtifactState {
  return { artifacts: [], nextId: 1, rejectedAtCap: 0 };
}

export function reduce(state: ArtifactState, event: ArtifactEvent): ArtifactState {
  switch (event.type) {
    case 'artifact.create': {
      // Reject, never evict (spec §7): a creation the user welcomes must never silently
      // destroy something they did not agree to lose. rejectedAtCap surfaces in [ARTIFACTS].
      if (state.artifacts.length >= MAX_ARTIFACTS) return { ...state, rejectedAtCap: state.rejectedAtCap + 1 };
      const artifact: Artifact = { ...event.artifact, id: `a${state.nextId}` };
      return { artifacts: [...state.artifacts, artifact], nextId: state.nextId + 1, rejectedAtCap: state.rejectedAtCap };
    }
    case 'artifact.close':
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== event.id) };
    default:
      return state;
  }
}
```

- [ ] **Step 5: Verify GREEN; full gate; commit** `feat(artifacts): artifactStore — deterministic ids, reject-never-evict cap, user-only close (TDD)`.

---

### Task 3: `combineTools.ts` — the tools + validation (TDD)

**Files:**
- Create: `src/artifacts/combineTools.ts`
- Test: `src/artifacts/combineTools.test.ts`

**Interfaces:**
- Consumes: `ArtifactState`/`Artifact` (Task 2), `MockDoc`/`ProgramId` from `../scenarios`, `reduce as artifactReduce` (Task 2 — capacity by simulation).
- Produces: `COMBINE_TOOL: VoiceTool` · `READ_SOURCES_TOOL: VoiceTool` · `validateCombineCall(args, corpus, artifacts): { event: ArtifactEvent; provenance: string } | { error: string }` · `resolveSources(sources, corpus, artifacts): string[] | { error: string }` · `sourceDetail(id, corpus, artifacts): string | null` (full text for `[CORPUS DETAIL]`).

- [ ] **Step 1: Write the failing tests** — create `src/artifacts/combineTools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateCombineCall, sourceDetail, COMBINE_TOOL, READ_SOURCES_TOOL } from './combineTools';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';
import { seedCorpus } from './seeds';

const corpus = seedCorpus();
const now = 5000;

describe('combine validation (spec §4/§5/§7)', () => {
  it('declares the two tools', () => {
    expect(COMBINE_TOOL.name).toBe('combine');
    expect(READ_SOURCES_TOOL.name).toBe('read_sources');
  });
  it('valid doc combine → create event + provenance line', () => {
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'Exec summary', content: 'Q3 in brief…' }, corpus, initialArtifactState(), now);
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.event.type).toBe('artifact.create');
      expect(r.provenance).toBe('from: word + excel');
    }
  });
  it('fewer than 2 sources → error pointing at single-target verbs', () => {
    const r = validateCombineCall({ sources: ['word'], kind: 'doc', title: 'T', content: 'x' }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/at least 2|two sources/i);
  });
  it('unknown source fails the WHOLE call naming valid ids (incl. live artifact ids)', () => {
    let arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'p', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'nope'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now) as { error: string };
    expect(r.error).toContain('nope');
    expect(r.error).toContain('a1');
    expect(r.error).toContain('excel');
  });
  it('artifact ids are valid sources (closure under composition)', () => {
    const arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'p', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['a1', 'photo'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now);
    expect('error' in r).toBe(false);
  });
  it('at capacity → rejection naming the cap (never relies on the reducer alone)', () => {
    let arts = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) arts = reduce(arts, { type: 'artifact.create', artifact: { kind: 'doc', title: `A${i}`, sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: 'x' }, corpus, arts, now) as { error: string };
    expect(r.error).toContain(`${MAX_ARTIFACTS}`);
    expect(r.error).toMatch(/close/i);
  });
  it('doc kind requires non-empty content; M1 rejects widget kind honestly', () => {
    expect(validateCombineCall({ sources: ['word', 'excel'], kind: 'doc', title: 'T', content: '' }, corpus, initialArtifactState(), now)).toHaveProperty('error');
    const r = validateCombineCall({ sources: ['word', 'excel'], kind: 'widget', title: 'T', fields: [{ label: 'x' }] }, corpus, initialArtifactState(), now) as { error: string };
    expect(r.error).toMatch(/widget/i); // replaced by real support in Task 7
  });
});

describe('sourceDetail (read_sources → [CORPUS DETAIL])', () => {
  it('returns full doc text for programs, artifact content for artifacts, null for unknown', () => {
    expect(sourceDetail('word', corpus, initialArtifactState())).toContain('Meridian');
    const arts = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Prev', sources: ['word', 'excel'], content: 'PREV-CONTENT', createdAt: 1 } });
    expect(sourceDetail('a1', corpus, arts)).toContain('PREV-CONTENT');
    expect(sourceDetail('zzz', corpus, arts)).toBeNull();
  });
  it('the photo detail is its caption/metadata line, never pretend pixel-reading', () => {
    const d = sourceDetail('photo', corpus, initialArtifactState())!;
    expect(d).toContain('Riverside Tower');
    expect(d).toContain('caption');
  });
});
```

- [ ] **Step 2: Verify RED. Step 3: Implement `src/artifacts/combineTools.ts`**:

```ts
// combine + read_sources: the combinatory grammar (spec §4-§5). Create-only; validation is
// all-or-error; capacity checks by SIMULATION through the real reducer (spec §7).
import type { VoiceTool } from '../voice/types';
import type { MockDoc, ProgramId } from '../scenarios';
import { serializeMockDoc } from '../scenarios';
import type { ArtifactState, ArtifactEvent, WidgetField } from './types';
import { reduce as artifactReduce, MAX_ARTIFACTS } from './artifactStore';

export const COMBINE_TOOL: VoiceTool = {
  name: 'combine',
  description: 'Create a NEW artifact by combining two or more sources (program docs by id: word/excel/powerpoint/photo, or artifact ids from [ARTIFACTS]). You author the synthesized content — read the sources first with read_sources. The new artifact appears as a window showing its provenance.',
  parameters: { type: 'object', properties: {
    sources: { type: 'array', items: { type: 'string' }, description: 'Two or more source ids.' },
    kind: { type: 'string', enum: ['doc', 'widget'] },
    title: { type: 'string', description: 'Short title for the new artifact.' },
    content: { type: 'string', description: 'kind=doc: your synthesized text.' },
    fields: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string' }, value: { type: 'string' },
      feed: { type: 'string', enum: ['clock', 'weather', 'stock'] } }, required: ['label'] },
      description: 'kind=widget: labeled fields; bind live data with feed.' },
  }, required: ['sources', 'kind', 'title'] },
};

export const READ_SOURCES_TOOL: VoiceTool = {
  name: 'read_sources',
  description: 'Request the FULL content of named sources before combining — the standing [CORPUS] hint carries only gists. Responds via a [CORPUS DETAIL] update.',
  parameters: { type: 'object', properties: {
    sources: { type: 'array', items: { type: 'string' } } }, required: ['sources'] },
};

const PROGRAM_IDS: ProgramId[] = ['word', 'excel', 'powerpoint', 'photo'];

export function resolveSources(
  sources: string[], corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState,
): string[] | { error: string } {
  const validPrograms = PROGRAM_IDS.filter((p) => corpus[p]);
  const validArtifacts = artifacts.artifacts.map((a) => a.id);
  const valid = new Set<string>([...validPrograms, ...validArtifacts]);
  const unknown = sources.filter((s) => !valid.has(s));
  if (unknown.length) {
    return { error: `Unknown source(s): ${unknown.join(', ')}. Valid sources: ${[...valid].join(', ')}.` };
  }
  return sources;
}

export function sourceDetail(
  id: string, corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState,
): string | null {
  const art = artifacts.artifacts.find((a) => a.id === id);
  if (art) return `${art.id} "${art.title}" (${art.kind}, from: ${art.sources.join(' + ')}): ${art.content ?? art.fields?.map((f) => `${f.label}: ${f.value ?? f.feed}`).join('; ') ?? ''}`;
  const doc = corpus[id as ProgramId];
  if (!doc) return null;
  return `${id}: ${serializeMockDoc(doc)}`; // photo → its caption line, never pixels
}

export function validateCombineCall(
  args: any, corpus: Partial<Record<ProgramId, MockDoc>>, artifacts: ArtifactState, now: number,
): { event: ArtifactEvent; provenance: string } | { error: string } {
  const sources: string[] = Array.isArray(args?.sources) ? [...new Set<string>(args.sources.map(String))] : [];
  if (sources.length < 2) return { error: 'combine needs at least 2 sources — for a single target use the ordinary editing/creation verbs instead.' };
  const resolved = resolveSources(sources, corpus, artifacts);
  if ('error' in (resolved as any)) return resolved as { error: string };
  const kind = args?.kind === 'widget' ? 'widget' : 'doc';
  const title = String(args?.title ?? '').trim();
  if (!title) return { error: 'combine needs a non-empty title.' };
  if (kind === 'widget') {
    return { error: 'widget artifacts are not available yet — use kind "doc".' }; // Task 7 replaces this
  }
  const content = String(args?.content ?? '').trim();
  if (!content) return { error: 'combine kind "doc" needs non-empty content — author the synthesis yourself from what read_sources returned.' };
  const event: ArtifactEvent = { type: 'artifact.create', artifact: { kind, title, sources, content, createdAt: now } };
  // Capacity by SIMULATION through the real reducer (spec §7).
  const simulated = artifactReduce(artifacts, event);
  if (simulated.rejectedAtCap > artifacts.rejectedAtCap) {
    return { error: `The desk already holds ${MAX_ARTIFACTS} artifacts — ask the user to close one first. Nothing may be evicted without their say.` };
  }
  return { event, provenance: `from: ${sources.join(' + ')}` };
}
```

- [ ] **Step 4: Verify GREEN; full gate; commit** `feat(artifacts): combine + read_sources tools — all-or-error validation, capacity by simulation (TDD)`.

---

### Task 4: `serialize.ts` — `[CORPUS]` gists + `[ARTIFACTS]` (TDD)

**Files:**
- Create: `src/artifacts/serialize.ts`
- Test: `src/artifacts/serialize.test.ts`

**Interfaces:**
- Consumes: `MockDoc`/`ProgramId` (scenarios), `ArtifactState` (Task 2).
- Produces: `serializeCorpus(corpus): string | null` · `serializeArtifacts(state): string | null`.

- [ ] **Step 1: Failing tests** — create `src/artifacts/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeCorpus, serializeArtifacts } from './serialize';
import { seedCorpus } from './seeds';
import { initialArtifactState, reduce } from './artifactStore';

describe('serializeCorpus — gists, not dumps (spec §3/§12)', () => {
  it('names each doc with a one-line gist and NO full text', () => {
    const s = serializeCorpus(seedCorpus())!;
    expect(s).toMatch(/^\[CORPUS: /);
    expect(s).toContain('word:');
    expect(s).toContain('excel:');
    expect(s).not.toContain('crane availability'); // full report text must NOT be in standing context
    expect(s.length).toBeLessThan(600);
    expect(s).toContain('read_sources');
    expect(s).toContain('DO NOT acknowledge');
  });
  it('is null for an empty corpus', () => {
    expect(serializeCorpus({})).toBeNull();
  });
});

describe('serializeArtifacts', () => {
  it('lists id, kind, title, provenance; notes rejectedAtCap; null when empty', () => {
    expect(serializeArtifacts(initialArtifactState())).toBeNull();
    let st = reduce(initialArtifactState(), { type: 'artifact.create', artifact: { kind: 'doc', title: 'Exec summary', sources: ['word', 'excel'], content: 'x', createdAt: 1 } });
    const s = serializeArtifacts(st)!;
    expect(s).toMatch(/^\[ARTIFACTS: /);
    expect(s).toContain('a1 "Exec summary" (doc, from: word + excel)');
    const rejected = { ...st, rejectedAtCap: 2 };
    expect(serializeArtifacts(rejected)).toContain('2 creations were rejected at the 6-artifact cap');
  });
});
```

- [ ] **Step 2: Verify RED. Step 3: Implement `src/artifacts/serialize.ts`**:

```ts
// The model's standing view of the combinable world: gists only (full text via read_sources).
import type { MockDoc, ProgramId } from '../scenarios';
import type { ArtifactState } from './types';
import { MAX_ARTIFACTS } from './artifactStore';

function gist(id: string, doc: MockDoc): string {
  switch (doc.kind) {
    case 'word': return `${id}: "${doc.text.slice(0, 40)}${doc.text.length > 40 ? '…' : ''}" (${doc.text.split(/\s+/).length} words)`;
    case 'excel': return `${id}: ${Object.keys(doc.cells).length} filled cells`;
    case 'powerpoint': return `${id}: ${doc.slides.length} slides ("${doc.slides[0]}")`;
    case 'photo': return `${id}: photo${doc.caption ? ` — caption "${doc.caption}"` : ''}`;
  }
}

export function serializeCorpus(corpus: Partial<Record<ProgramId, MockDoc>>): string | null {
  const entries = (Object.entries(corpus) as [ProgramId, MockDoc][]).filter(([, d]) => d);
  if (!entries.length) return null;
  return `[CORPUS: sources available to combine — ${entries.map(([id, d]) => gist(id, d)).join(' · ')}. Call read_sources for full content before combining. DO NOT acknowledge this update.]`;
}

export function serializeArtifacts(state: ArtifactState): string | null {
  if (!state.artifacts.length && state.rejectedAtCap === 0) return null;
  const items = state.artifacts.map((a) => `${a.id} "${a.title}" (${a.kind}, from: ${a.sources.join(' + ')})`);
  const capNote = state.rejectedAtCap > 0 ? ` ${state.rejectedAtCap} creations were rejected at the ${MAX_ARTIFACTS}-artifact cap — the user must close one first.` : '';
  return `[ARTIFACTS: ${items.join('; ') || 'none'}.${capNote} Artifacts are valid combine sources. DO NOT acknowledge this update.]`;
}
```

- [ ] **Step 4: Verify GREEN; full gate; commit** `feat(artifacts): [CORPUS] gists + [ARTIFACTS] serialization (TDD)`.

---

### Task 5: App wiring I — corpus persistence + hints + prompt

**Files:**
- Modify: `src/App.tsx` (corpus state, `handleProgramChange`, boot-from-seeds, two hint effects + gates + onOpen reset), `src/prompt/instructions.ts` (+ combine section), `src/prompt/instructions.test.ts`

**Interfaces:**
- Consumes: `seedCorpus`, `saveAndLoad`, `serializeCorpus`, `serializeArtifacts` (Tasks 1/4).
- Produces: `corpusRef`/`artifactState` available in App for Task 6's routing; the prompt contract.

- [ ] **Step 1: Failing prompt test** — append inside the existing `for (const s of [honest, confident])` loop in `src/prompt/instructions.test.ts`:

```ts
      // Combinatory artifacts: combine ≥2 sources, read before combining, provenance honesty.
      expect(s).toContain('combine');
      expect(s).toContain('read_sources');
      expect(s).toMatch(/two or more sources|at least 2 sources/i);
      expect(s).toMatch(/\[CORPUS/);
```

- [ ] **Step 2: Verify RED. Step 3: Add the prompt section** in `src/prompt/instructions.ts`, after the sketch section:

```
COMBINING THINGS: when the user asks you to merge, synthesize, or "take X and Y and make Z", use combine with two or more sources (program ids from [CORPUS], artifact ids from [ARTIFACTS], or what they pointed at). ALWAYS call read_sources first and author the synthesis from what it actually returns — never from memory or invention; every claim in your synthesis should trace to a source. The new artifact appears as its own window naming its sources. If the desk is full the call errors — ask the user to close an artifact; never expect anything to be evicted. A photo's readable content is its caption only.
```

Verify GREEN on the prompt test.

- [ ] **Step 4: Corpus state + persistence in App.tsx.** Additions (anchored):

(a) Imports: `import { seedCorpus, } from './artifacts/seeds'; import { saveAndLoad } from './artifacts/corpus'; import { serializeCorpus, serializeArtifacts } from './artifacts/serialize'; import { initialArtifactState, reduce as artifactReduce } from './artifacts/artifactStore';`

(b) Boot from seeds — change the mockDoc initializer (App.tsx ~514) and add corpus state beside it:

```ts
const [mockDoc, setMockDoc] = useState<MockDoc>(() => seedCorpus()[DEFAULT_PROGRAM]);
const [corpus, setCorpus] = useState<Partial<Record<ProgramId, MockDoc>>>({});
const corpusRef = useRef(corpus);
useEffect(() => { corpusRef.current = corpus; }, [corpus]);
const [artifactState, artifactDispatch] = useReducer(artifactReduce, undefined, initialArtifactState);
const artifactStateRef = useRef(artifactState);
useEffect(() => { artifactStateRef.current = artifactState; }, [artifactState]);
```

(c) `handleProgramChange` (~2860): replace the reset block

```ts
    const fresh = initialMockDoc(id);
    setMockDoc(fresh);
    mockDocRef.current = fresh;
```
with
```ts
    // Corpus persistence (spec §3): the outgoing doc is SAVED, the incoming restored (or
    // seeded on first visit) — cross-program combination needs all docs to exist.
    const swapped = saveAndLoad(corpusRef.current, activeProgram, mockDocRef.current, id);
    setCorpus(swapped.corpus);
    corpusRef.current = swapped.corpus;
    setMockDoc(swapped.doc);
    mockDocRef.current = swapped.doc;
```

(d) The FULL corpus for validation/serialization includes the ACTIVE doc: define beside the hint effects

```ts
const fullCorpus = React.useMemo(() => ({ ...corpus, [activeProgram]: mockDoc }), [corpus, activeProgram, mockDoc]);
```

(e) Two hint effects below the sketch hint effect, mirroring its shape, with their own `useRef(makeChangeGate())` refs (`corpusHintGateRef`, `artifactsHintGateRef`), deps `[isLive, fullCorpus]` and `[isLive, artifactState]`, sending `serializeCorpus(fullCorpus)` / `serializeArtifacts(artifactState)`. Add BOTH gate resets to the onOpen reset block (beside the five existing `…GateRef.current = makeChangeGate();` lines).

- [ ] **Step 5: Full gate (`npx tsc --noEmit && npm test && npm run build`); commit** `feat(artifacts): corpus persists across program swaps (seeded Meridian boot) + [CORPUS]/[ARTIFACTS] hints + prompt (TDD prompt)`.

---

### Task 6: App wiring II — `ArtifactWindow`, entities, routing, demo (M1 complete)

**Files:**
- Create: `src/artifacts/ArtifactWindow.tsx`, `src/artifacts/entities.ts` (+ test), `src/artifacts/demo.ts`
- Modify: `src/App.tsx` (tool registration, routing branches, mounting, updateLayout extension, entities composition, undo, `?artifacts=1` demo)

**Interfaces:**
- Consumes: everything above; `SceneEntity`/`asId` conventions from `src/entities/registry.ts` (read it first — artifact entities must match its shape; use title + aliases, `sub: false`).
- Produces: M1 end-to-end.

- [ ] **Step 1: Pure entity mapper (TDD)** — create `src/artifacts/entities.test.ts` + `src/artifacts/entities.ts`: `artifactEntities(state: ArtifactState, layout: Record<string, BBox>): SceneEntity[]` mapping each artifact to a SceneEntity (`id: asId('artifact-' + a.id)`, `title: a.title`, aliases `[a.id, a.title.toLowerCase(), 'the ' + a.kind]`, bbox from `layout['artifact-' + a.id] ?? [0,0,0,0]`, `sub: false`, category `'artifact'` if the type allows arbitrary strings — reconcile with `SceneEntity`'s actual category type and pick the closest legal value). Test: two artifacts → two entities with resolvable aliases; missing layout → zero bbox (honest degradation).

- [ ] **Step 2: `ArtifactWindow.tsx`** — floating window (whiteboard-panel styling family), cascade offset by index (`top-20 + i*24px`, `left 55% + i*16px` — pick values that don't cover the program window), `data-shell` on the root + `onPointerDown` stopPropagation (shell rules), `data-entity-id={'artifact-' + artifact.id}` on the CONTENT region (so updateLayout can measure it), title bar with kind badge, the provenance line (`from: …`) rendered under the title permanently, doc content as paragraphs, close (×) button calling `onClose` — the user-only path.

- [ ] **Step 3: updateLayout extension** — in App.tsx `updateLayout` (~745): after the program-window measurement, also measure artifact windows:

```ts
    const artifactEls = Array.from(main.querySelectorAll<HTMLElement>('.artifact-window [data-entity-id]'));
    const artifactLayout: Record<string, [number, number, number, number]> = {};
    for (const el of artifactEls) {
      const r = el.getBoundingClientRect();
      const b = toBBox(r);
      artifactLayout[el.dataset.entityId!] = [b.ymin, b.xmin, b.ymax, b.xmax];
    }
```

store it in a ref/state the entities composition reads. Then wherever `setEntities(buildEntities(...))` runs, compose: `setEntities([...buildEntities(...), ...artifactEntities(artifactStateRef.current, artifactLayoutRef.current)])` — find every `buildEntities` call site and compose consistently (grep `buildEntities(` in App.tsx; reconcile with how `entities`/`entitiesRef` are set).

- [ ] **Step 4: Routing** — in `handleVoiceToolCall`, add branches (before the generic action-verb fallthrough; use the `ack()` wrapper):

```ts
    } else if (fc.name === 'combine') {
      const v = validateCombineCall(fc.args, { ...corpusRef.current, [activeProgram]: mockDocRef.current }, artifactStateRef.current, Date.now());
      if ('error' in v) { addLog('tool', `Tool Call: combine REJECTED — ${v.error}`); ack({ success: false, error: v.error }); }
      else {
        artifactDispatch(v.event);
        addLog('tool', `Tool Call: combine — "${(v.event as any).artifact.title}" ${v.provenance}`);
        emitFeedback({ outcome: 'committed', verbClass: 'create', label: `Created: ${(v.event as any).artifact.title}` });
        ack({ success: true, provenance: v.provenance, note: 'The artifact window is on screen showing its sources.' });
      }
    } else if (fc.name === 'read_sources') {
      const ids: string[] = Array.isArray(fc.args?.sources) ? fc.args.sources.map(String) : [];
      const details = ids.map((id) => sourceDetail(id, { ...corpusRef.current, [activeProgram]: mockDocRef.current }, artifactStateRef.current));
      if (details.some((d) => d === null)) { ack({ success: false, error: `Unknown source(s). Valid: word, excel, powerpoint, photo${artifactStateRef.current.artifacts.length ? ', ' + artifactStateRef.current.artifacts.map(a => a.id).join(', ') : ''}.` }); }
      else {
        providerRef.current?.sendTextHint(`[CORPUS DETAIL: ${details.join(' ||| ')}. Author your synthesis from THIS content only. DO NOT acknowledge.]`);
        ack({ success: true, note: 'Full content sent as a [CORPUS DETAIL] update.' });
      }
    }
```

Register the tools in the `voiceTools` useMemo: `…, COMBINE_TOOL, READ_SOURCES_TOOL, …`. Ensure `earcons`' `create` cue plays via the existing `emitFeedback` verbClass `'create'` mapping (verify in `src/feedback/` — if verbClass mapping differs, use `playEarcon('create')` directly).

- [ ] **Step 5: Mount + undo + demo** — render `{artifactState.artifacts.map((a, i) => <ArtifactWindow key={a.id} artifact={a} index={i} onClose={() => artifactDispatch({ type: 'artifact.close', id: a.id })} />)}` on the desktop plane (beside the WhiteboardPanel mount); wire `handleUndo` so that when the LAST undoable action was an artifact creation it closes the newest artifact (simplest honest form: if `undoStack` is empty and artifacts exist, ⌘Z closes the newest — reconcile with the actual undo structure and keep it minimal); `?artifacts=1` demo (`src/artifacts/demo.ts` + a StrictMode-safe driver mirroring the sketch demo) replaying: combine word+excel → doc artifact through the REAL validation+store, footer/log showing the `[ARTIFACTS]` hint.

- [ ] **Step 6: Full gate + drive the demo** (`npx vite --port 3001` → `?artifacts=1`: window appears with provenance line; close works; `[CORPUS]` text visible in the drawer if opened). **Commit** `feat(artifacts): ArtifactWindow + pointable entities + combine/read_sources routing + ?artifacts=1 demo (M1 complete)`.

---

### Task 7: M2 — feeds + widget kind

**Files:**
- Create: `src/artifacts/feeds.ts`
- Modify: `src/artifacts/combineTools.ts` (replace the widget rejection with field/feed validation), `src/artifacts/ArtifactWindow.tsx` (widget rendering + provenance chips), `src/prompt/instructions.ts` (+ one sentence: stock is SIMULATED — say so if asked; add the matching test assertion)
- Test: `src/artifacts/feeds.test.ts`, extend `src/artifacts/combineTools.test.ts`

**Interfaces:**
- Produces: `FEEDS: Record<FeedId, FeedDescriptor>` where `FeedDescriptor = { id: FeedId; label: string; provenance: 'live' | 'simulated'; refreshMs: number; read(now: number): Promise<string> | string }`.

- [ ] **Step 1: Failing feed tests**: `clock.read(now)` formats the injected time (deterministic); `stock.read(now)` is a deterministic walk (same `now` → same value; adjacent ticks differ boundedly); descriptors carry the right provenance (`clock`/`weather` live, `stock` simulated); `weather.read` is the ONLY impure one — test only its descriptor shape, not the fetch.
- [ ] **Step 2: Implement `feeds.ts`**: clock = `new Date(now).toLocaleTimeString()`; stock = `('MERI $' + (42 + 6*Math.sin(now/300000) + ((now/5000|0) % 7) * 0.13).toFixed(2))` (deterministic in `now`); weather = `fetch('https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,weather_code')` → `"18°C"`-style string, try/catch → throw a typed `FeedUnavailable` the renderer maps to "feed unavailable".
- [ ] **Step 3: combineTools widget validation** (replace the Task 3 rejection): require ≥1 field, every `feed` id in the registry (error names valid ids), labels non-empty; event carries `fields`.
- [ ] **Step 4: ArtifactWindow widget rendering**: each field row = label + value + (for bound fields) provenance chip `LIVE`/`SIMULATED` + `updated HH:MM:SS`; a ticker effect per window (`setInterval` min(refreshMs of bound feeds, 1s), cleaned up on unmount); failed weather → "feed unavailable" (+ stale value with its old stamp if one exists).
- [ ] **Step 5: Full gate + demo re-drive** (`?artifacts=1` extended with a widget artifact: clock ticking, stock walking with SIMULATED chip). **Commit** `feat(artifacts): M2 widgets — feed registry (LIVE clock/weather, SIMULATED stock), provenance chips, honest failure`.

---

### Task 8: Final gate + owed smoke report

- [ ] Full verification: `npx tsc --noEmit && npm test && npm run build`; re-drive `?artifacts=1`.
- [ ] Report the owed LIVE smoke (spec §10): point at two things → "make a summary" → provenance window; closure ("take that summary and the photo…"); cap rejection at 6; user-only close; **liberty audit** — read the synthesized artifact against `MERIDIAN` facts (invented numbers, contradictions, photo-content claims beyond the caption are liberties); M2: widget with real clock/weather + simulated stock, chips honest.

---

## Self-review notes

- **Spec coverage:** §3 corpus+seeds → Tasks 1, 5; §3.1 liberty audit → Task 1 (integrity test) + Task 8 (human audit); §4 grammar → Task 3; §5 combine/read_sources + direct-landing → Tasks 3, 6; §6 windows/entities → Task 6 (with the updateLayout extension the spec's §2 table implies); §7 invariants → Tasks 2, 3 (both layers); §8 feeds → Task 7; §9 errors → Tasks 2-4, 7; §10 testing → per-task TDD + demo + Task 8; §11 order followed; §12 caveats → constraints block.
- **Known judgment areas flagged for implementers (not hidden):** Task 6's entities composition must reconcile with the real `buildEntities` call sites and `SceneEntity.category`'s legal values; the undo wiring keeps the minimal honest form; the `create` earcon path is verified against the feedback mapping rather than assumed.
- **Type consistency:** `validateCombineCall(args, corpus, artifacts, now)` consistent across Tasks 3/6/7; `ArtifactEvent`/`ArtifactState` per Task 2; `saveAndLoad` per Task 1; `FeedId` shared from `types.ts` (Task 2 file, used in Tasks 3/7).
