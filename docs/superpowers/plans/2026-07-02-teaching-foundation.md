# Teaching Foundation (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agent-free teaching foundation — a pure guide/teach/fade reducer, on-element overlays (highlight, one-at-a-time numbered steps with subgoal labels, soft-block scrim, relate links), honest tool→event mapping, guidance telemetry, and a `?teach=1` scripted demo over the real scene.

**Architecture:** `src/teaching/` mirrors the ramble-foundation pattern: `types.ts` + pure `teachingStore.ts` reducer + `selectors.ts` (the fading engine), thin overlay components anchored to R2 entity bboxes, `teachTools.ts` mapping tool calls to events via `resolveEchoedTarget` (whole-call honest failure on unresolvable targets), and a `TeachingLayer` mounted inside App's `<main>` behind a `?teach=1` flag with a scripted demo driver. Telemetry gains `guidance` events + a slice. Competence persists to sessionStorage fail-soft.

**Tech Stack:** TypeScript, React 19, vitest; no new dependencies.

## Global Constraints (from spec §2 — evidence-bound)

- Branch `honest-mode`; verify `git branch --show-current` before each commit.
- Emphasis renders ON the element; never a detached callout panel.
- Exactly ONE active step rendered at a time; done steps collapse to ✓ dots; **no progress bar**.
- Steps carry `subgoal` (why) + `instruction` (ONE short sentence).
- Soft-block only at fade 0; scrimmed clicks are inert + informative (name the active subgoal), never punitive; sidebar/map/dismissal never blocked; leaving the path pauses, never fails.
- Fading derived, never stored: `fadeLevel = min(2, competence[taskKey] ?? 0)`; `user.reveal` restores scaffold for ONE step; completion increments competence.
- `teach` posture: only learner action advances (except step 0); `guide`: agent or learner advances.
- Tool mapper: unresolvable target fails the WHOLE call with the target named — never teach at a guessed element.
- Pure modules take injected `now`; reducer never throws (unknown ids no-op); overlays render nothing for zero bboxes.
- Additive: without `?teach` in the URL, zero behavioral change. No telemetry schema breaks (new event type + optional method only). No new dependencies.

---

## File Structure

- Create `src/teaching/types.ts` — spec §3 types verbatim + `TeachingEvent` union.
- Create `src/teaching/teachingStore.ts` + `teachingStore.test.ts` — `reduce`, `initialTeachingState`.
- Create `src/teaching/selectors.ts` + `selectors.test.ts` — `fadeLevel`, `activeStep`, `visibleScaffold`, `blockedEntityIds`.
- Create `src/teaching/teachTools.ts` + `teachTools.test.ts` — `TEACH_TOOLS`, `teachCallToEvent`.
- Create `src/teaching/persistence.ts` + `persistence.test.ts` — competence (de)serialization + storage wrappers.
- Create `src/teaching/TeachingLayer.tsx` (+ internal HighlightRing/StepBadge/SoftBlockScrim/RelateLink render fns) and `src/teaching/demoScript.ts` + `demoScript.test.ts`.
- Modify `src/App.tsx` — mount `<TeachingLayer …/>` inside `<main>` behind the flag (~6 lines).
- Modify `src/telemetry.ts` — `guidance` event + method + metrics slice.

---

### Task 1: Types + reducer + selectors (the fading engine)

**Files:**
- Create: `src/teaching/types.ts`, `src/teaching/teachingStore.ts`, `src/teaching/teachingStore.test.ts`, `src/teaching/selectors.ts`, `src/teaching/selectors.test.ts`

**Interfaces:**
- Consumes: `EntityId` from `../entities/registry` (type-only).
- Produces: everything in `types.ts` below; `initialTeachingState(): TeachingState`; `reduce(state, event, now): TeachingState`; `fadeLevel(state, taskKey): FadeLevel`; `activeStep(state): TeachStep | null`; `visibleScaffold(state): { markers: boolean; labels: boolean; block: boolean; highlightOnly: boolean; promptOnly: boolean }`; `blockedEntityIds(state, allTileIds: EntityId[]): EntityId[]`.

- [ ] **Step 1: Write `types.ts`** (spec §3 verbatim)

```ts
import type { EntityId } from '../entities/registry';

export type TeachPosture = 'guide' | 'teach';
export type FadeLevel = 0 | 1 | 2;
export type StepState = 'pending' | 'active' | 'done' | 'skipped';

export interface TeachStep {
  entityId: EntityId;
  subgoal: string;
  instruction: string;
  state: StepState;
}

export interface TeachSequence {
  title: string;
  taskKey: string;
  posture: TeachPosture;
  steps: TeachStep[];
  activeIndex: number | null;
  softBlock: boolean;
  paused: boolean;
  blockedAttempts: number;
  lastBlocked?: { entityId: EntityId; at: number };
}

export interface TeachHighlight { entityId: EntityId; note?: string; at: number }
export interface TeachRelation { from: EntityId; to: EntityId; label: string }

export interface TeachingState {
  posture: TeachPosture;
  sequence: TeachSequence | null;
  highlights: TeachHighlight[];
  relations: TeachRelation[];
  competence: Record<string, number>;
  revealRequested: boolean;
}

export type TeachingEvent =
  | { type: 'teach.highlight'; entityId: EntityId; note?: string }
  | { type: 'teach.sequence'; title: string; taskKey: string; posture: TeachPosture;
      steps: { entityId: EntityId; subgoal: string; instruction: string }[] }
  | { type: 'teach.stepAdvance' }
  | { type: 'teach.relate'; relations: TeachRelation[] }
  | { type: 'teach.clear' }
  | { type: 'user.stepAction'; entityId: EntityId }
  | { type: 'user.reveal' }
  | { type: 'user.pause' } | { type: 'user.resume' } | { type: 'user.dismiss' };
```

- [ ] **Step 2: Write the failing reducer tests**

Create `src/teaching/teachingStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialTeachingState, reduce } from './teachingStore';
import type { EntityId } from '../entities/registry';
import type { TeachingEvent } from './types';

const id = (s: string) => s as EntityId;
const SEQ: TeachingEvent = {
  type: 'teach.sequence', title: 'Save a file', taskKey: 'word.save', posture: 'guide',
  steps: [
    { entityId: id('word-2'), subgoal: 'Open the save action', instruction: 'Click the Save button.' },
    { entityId: id('word-4'), subgoal: 'Confirm the document', instruction: 'Click the document body.' },
  ],
};
const start = (ev: TeachingEvent = SEQ, st = initialTeachingState()) => reduce(st, ev, 1000);

describe('teach.sequence', () => {
  it('starts at step 0 active with soft-block on at fade 0', () => {
    const st = start();
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.steps[0].state).toBe('active');
    expect(st.sequence!.softBlock).toBe(true);
  });
  it('soft-block is off when competence >= 1 (fade 1)', () => {
    const st0 = { ...initialTeachingState(), competence: { 'word.save': 1 } };
    expect(start(SEQ, st0).sequence!.softBlock).toBe(false);
  });
});

describe('advancement rules', () => {
  it('guide: teach.stepAdvance advances any step', () => {
    let st = start();
    st = reduce(st, { type: 'teach.stepAdvance' }, 1100);
    expect(st.sequence!.activeIndex).toBe(1);
    expect(st.sequence!.steps[0].state).toBe('done');
  });
  it('teach: stepAdvance works ONLY on step 0 (the worked example)', () => {
    let st = start({ ...SEQ, posture: 'teach' });
    st = reduce(st, { type: 'teach.stepAdvance' }, 1100);          // step 0 → ok
    expect(st.sequence!.activeIndex).toBe(1);
    st = reduce(st, { type: 'teach.stepAdvance' }, 1200);          // step 1 → no-op
    expect(st.sequence!.activeIndex).toBe(1);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-4') }, 1300); // learner acts
    expect(st.sequence!.activeIndex).toBeNull();                   // completed
  });
  it('completion increments competence and clears reveal', () => {
    let st = start();
    st = reduce({ ...st, revealRequested: true }, { type: 'user.stepAction', entityId: id('word-2') }, 1100);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-4') }, 1200);
    expect(st.competence['word.save']).toBe(1);
    expect(st.revealRequested).toBe(false);
  });
});

describe('soft-block and path tolerance', () => {
  it('off-target action at fade 0 blocks: counter + lastBlocked, no advance', () => {
    let st = start();
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-3') }, 1100);
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.blockedAttempts).toBe(1);
    expect(st.sequence!.lastBlocked).toEqual({ entityId: 'word-3', at: 1100 });
  });
  it('off-target with softBlock false is ignored (no block, no advance)', () => {
    let st = start(SEQ, { ...initialTeachingState(), competence: { 'word.save': 1 } });
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-3') }, 1100);
    expect(st.sequence!.blockedAttempts).toBe(0);
    expect(st.sequence!.activeIndex).toBe(0);
  });
  it('pause holds the sequence; actions ignored while paused; resume restores', () => {
    let st = start();
    st = reduce(st, { type: 'user.pause' }, 1100);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1200);
    expect(st.sequence!.activeIndex).toBe(0);
    st = reduce(st, { type: 'user.resume' }, 1300);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1400);
    expect(st.sequence!.activeIndex).toBe(1);
  });
  it('dismiss clears the sequence without competence credit', () => {
    let st = start();
    st = reduce(st, { type: 'user.dismiss' }, 1100);
    expect(st.sequence).toBeNull();
    expect(st.competence['word.save']).toBeUndefined();
  });
});

describe('highlights, relations, clear, reveal', () => {
  it('highlight appends with timestamp; clear empties all', () => {
    let st = reduce(initialTeachingState(), { type: 'teach.highlight', entityId: id('word-2'), note: 'save' }, 1000);
    st = reduce(st, { type: 'teach.relate', relations: [{ from: id('word-2'), to: id('word-4'), label: 'writes to' }] }, 1100);
    expect(st.highlights).toHaveLength(1);
    expect(st.relations).toHaveLength(1);
    st = reduce(st, { type: 'teach.clear' }, 1200);
    expect(st.highlights).toHaveLength(0);
    expect(st.relations).toHaveLength(0);
    expect(st.sequence).toBeNull();
  });
  it('user.reveal sets revealRequested; next advance clears it', () => {
    let st = start();
    st = reduce(st, { type: 'user.reveal' }, 1100);
    expect(st.revealRequested).toBe(true);
    st = reduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1200);
    expect(st.revealRequested).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/teaching/teachingStore.test.ts`
Expected: FAIL — `Cannot find module './teachingStore'`.

- [ ] **Step 4: Write the reducer**

Create `src/teaching/teachingStore.ts`:
```ts
import type { TeachingState, TeachingEvent, TeachStep, TeachSequence } from './types';

export function initialTeachingState(): TeachingState {
  return { posture: 'guide', sequence: null, highlights: [], relations: [], competence: {}, revealRequested: false };
}

const MAX_HIGHLIGHTS = 8;
const MAX_RELATIONS = 6;

function fade(state: TeachingState, taskKey: string): number {
  return Math.min(2, state.competence[taskKey] ?? 0);
}

/** Mark the active step done and activate the next; on completion, credit competence. */
function advance(state: TeachingState, seq: TeachSequence): TeachingState {
  if (seq.activeIndex === null) return state;
  const steps = seq.steps.map((s, i): TeachStep =>
    i === seq.activeIndex ? { ...s, state: 'done' }
    : i === seq.activeIndex! + 1 ? { ...s, state: 'active' }
    : s);
  const nextIndex = seq.activeIndex + 1 < seq.steps.length ? seq.activeIndex + 1 : null;
  const completed = nextIndex === null;
  return {
    ...state,
    revealRequested: false,
    sequence: { ...seq, steps, activeIndex: nextIndex },
    competence: completed
      ? { ...state.competence, [seq.taskKey]: (state.competence[seq.taskKey] ?? 0) + 1 }
      : state.competence,
  };
}

export function reduce(state: TeachingState, event: TeachingEvent, now: number): TeachingState {
  switch (event.type) {
    case 'teach.highlight':
      return { ...state, highlights: [...state.highlights, { entityId: event.entityId, note: event.note, at: now }].slice(-MAX_HIGHLIGHTS) };
    case 'teach.sequence': {
      if (!event.steps.length) return state;
      const steps: TeachStep[] = event.steps.map((s, i) => ({ ...s, state: i === 0 ? 'active' : 'pending' }));
      return {
        ...state,
        posture: event.posture,
        revealRequested: false,
        sequence: {
          title: event.title, taskKey: event.taskKey, posture: event.posture, steps,
          activeIndex: 0, softBlock: fade(state, event.taskKey) === 0,
          paused: false, blockedAttempts: 0,
        },
      };
    }
    case 'teach.stepAdvance': {
      const seq = state.sequence;
      if (!seq || seq.paused || seq.activeIndex === null) return state;
      // teach posture: the agent may only advance the worked first step.
      if (seq.posture === 'teach' && seq.activeIndex > 0) return state;
      return advance(state, seq);
    }
    case 'user.stepAction': {
      const seq = state.sequence;
      if (!seq || seq.paused || seq.activeIndex === null) return state;
      const target = seq.steps[seq.activeIndex];
      if (event.entityId === target.entityId) return advance(state, seq);
      if (seq.softBlock) {
        return { ...state, sequence: { ...seq, blockedAttempts: seq.blockedAttempts + 1, lastBlocked: { entityId: event.entityId, at: now } } };
      }
      return state;
    }
    case 'teach.relate':
      return { ...state, relations: event.relations.slice(0, MAX_RELATIONS) };
    case 'teach.clear':
      return { ...state, sequence: null, highlights: [], relations: [], revealRequested: false };
    case 'user.reveal':
      return { ...state, revealRequested: true };
    case 'user.pause':
      return state.sequence ? { ...state, sequence: { ...state.sequence, paused: true } } : state;
    case 'user.resume':
      return state.sequence ? { ...state, sequence: { ...state.sequence, paused: false } } : state;
    case 'user.dismiss':
      return { ...state, sequence: null, revealRequested: false };
    default:
      return state;
  }
}
```

- [ ] **Step 5: Run reducer tests**

Run: `npm test -- src/teaching/teachingStore.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Write the failing selector tests**

Create `src/teaching/selectors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fadeLevel, activeStep, visibleScaffold, blockedEntityIds } from './selectors';
import { initialTeachingState, reduce } from './teachingStore';
import type { EntityId } from '../entities/registry';

const id = (s: string) => s as EntityId;
const seq = (competence: Record<string, number> = {}) =>
  reduce({ ...initialTeachingState(), competence }, {
    type: 'teach.sequence', title: 'T', taskKey: 'k', posture: 'guide',
    steps: [{ entityId: id('a'), subgoal: 'S', instruction: 'I.' }],
  }, 1000);

describe('selectors', () => {
  it('fadeLevel derives from competence, capped at 2', () => {
    expect(fadeLevel(initialTeachingState(), 'k')).toBe(0);
    expect(fadeLevel({ ...initialTeachingState(), competence: { k: 1 } }, 'k')).toBe(1);
    expect(fadeLevel({ ...initialTeachingState(), competence: { k: 7 } }, 'k')).toBe(2);
  });
  it('activeStep returns the active step or null', () => {
    expect(activeStep(initialTeachingState())).toBeNull();
    expect(activeStep(seq())!.subgoal).toBe('S');
  });
  it('visibleScaffold: fade 0 → markers+labels+block; fade 1 → highlightOnly; fade 2 → promptOnly', () => {
    expect(visibleScaffold(seq())).toMatchObject({ markers: true, labels: true, block: true, highlightOnly: false, promptOnly: false });
    expect(visibleScaffold(seq({ k: 1 }))).toMatchObject({ markers: false, block: false, highlightOnly: true });
    expect(visibleScaffold(seq({ k: 2 }))).toMatchObject({ highlightOnly: false, promptOnly: true });
  });
  it('reveal restores full scaffold at any fade', () => {
    const st = { ...seq({ k: 2 }), revealRequested: true };
    expect(visibleScaffold(st)).toMatchObject({ markers: true, labels: true, promptOnly: false });
  });
  it('blockedEntityIds = all tiles except the target when blocking, else empty', () => {
    expect(blockedEntityIds(seq(), [id('a'), id('b'), id('c')])).toEqual(['b', 'c']);
    expect(blockedEntityIds(seq({ k: 1 }), [id('a'), id('b')])).toEqual([]);
    expect(blockedEntityIds(initialTeachingState(), [id('a')])).toEqual([]);
  });
});
```

- [ ] **Step 7: Write the selectors**

Create `src/teaching/selectors.ts`:
```ts
import type { TeachingState, TeachStep, FadeLevel } from './types';
import type { EntityId } from '../entities/registry';

export function fadeLevel(state: TeachingState, taskKey: string): FadeLevel {
  return Math.min(2, state.competence[taskKey] ?? 0) as FadeLevel;
}

export function activeStep(state: TeachingState): TeachStep | null {
  const seq = state.sequence;
  return seq && seq.activeIndex !== null ? seq.steps[seq.activeIndex] : null;
}

/** The single source the overlay renderer reads. Reveal restores full scaffold for the active step. */
export function visibleScaffold(state: TeachingState) {
  const seq = state.sequence;
  const none = { markers: false, labels: false, block: false, highlightOnly: false, promptOnly: false };
  if (!seq || seq.activeIndex === null || seq.paused) return none;
  const level = state.revealRequested ? 0 : fadeLevel(state, seq.taskKey);
  if (level === 0) return { markers: true, labels: true, block: seq.softBlock, highlightOnly: false, promptOnly: false };
  if (level === 1) return { ...none, highlightOnly: true };
  return { ...none, promptOnly: true };
}

export function blockedEntityIds(state: TeachingState, allTileIds: EntityId[]): EntityId[] {
  const seq = state.sequence;
  if (!seq || seq.activeIndex === null || seq.paused || !visibleScaffold(state).block) return [];
  const target = seq.steps[seq.activeIndex].entityId;
  return allTileIds.filter((t) => t !== target);
}
```

- [ ] **Step 8: Run all Task-1 tests + gates**

Run: `npm test -- src/teaching/ && npm run lint`
Expected: 15 tests PASS; tsc clean.

- [ ] **Step 9: Commit**

```bash
git add src/teaching/types.ts src/teaching/teachingStore.ts src/teaching/teachingStore.test.ts src/teaching/selectors.ts src/teaching/selectors.test.ts
git commit -m "feat(teaching): guide/teach/fade reducer + selectors (the fading engine)"
```

---

### Task 2: Overlay components + `?teach=1` demo

**Files:**
- Create: `src/teaching/TeachingLayer.tsx`, `src/teaching/demoScript.ts`, `src/teaching/demoScript.test.ts`
- Modify: `src/App.tsx` (mount only)

**Interfaces:**
- Consumes: Task 1 (`reduce`, `initialTeachingState`, selectors, types); `SceneEntity`, `EntityId`, `displayName` from `../entities/registry`.
- Produces: `<TeachingLayer entities={SceneEntity[]} demo={boolean} onGuidance?={(kind, data) => void} />` — self-contained (owns its own state + dispatch; exposes `dispatchRef` prop `React.MutableRefObject<((e: TeachingEvent) => void) | null>` for Plan 2); `DEMO_SCRIPT: { at: number; event: TeachingEvent }[]` built for a given entity list via `buildDemoScript(entities)`.

- [ ] **Step 1: Write the demo script + its failing test**

Create `src/teaching/demoScript.ts`:
```ts
import type { SceneEntity } from '../entities/registry';
import type { TeachingEvent } from './types';

/**
 * A scripted teaching session over the real scene: highlight → 3-step guide sequence
 * (soft-block on) → relate. Timing offsets in ms; the driver replays completion of the
 * same taskKey to demonstrate fade 1 on the second run. Pure — entities injected.
 */
export function buildDemoScript(entities: SceneEntity[]): { at: number; event: TeachingEvent }[] {
  const tiles = entities.filter((e) => e.category !== 'map');
  if (tiles.length < 3) return [];
  const [a, b, c] = tiles;
  return [
    { at: 800,  event: { type: 'teach.highlight', entityId: a.id, note: 'start here' } },
    { at: 2600, event: { type: 'teach.clear' } },
    { at: 3000, event: { type: 'teach.sequence', title: 'Tour the scene', taskKey: 'demo.tour', posture: 'guide',
      steps: [
        { entityId: a.id, subgoal: 'Find the anchor', instruction: 'Click the first tile.' },
        { entityId: b.id, subgoal: 'Compare the pair', instruction: 'Click the second tile.' },
        { entityId: c.id, subgoal: 'Close the loop', instruction: 'Click the third tile.' },
      ] } },
    { at: 20000, event: { type: 'teach.relate', relations: [{ from: a.id, to: b.id, label: 'compares with' }] } },
  ];
}
```
Create `src/teaching/demoScript.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildDemoScript } from './demoScript';
import { initialTeachingState, reduce } from './teachingStore';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';

const layout = {
  items: getProgram('word').images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
};

describe('demo script', () => {
  const entities = buildEntities(getProgram('word'), {}, layout);
  it('drives the store to an active soft-blocked sequence, then completes via user actions', () => {
    const script = buildDemoScript(entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.softBlock).toBe(true);
    // learner clicks the three targets in order
    for (const step of [...st.sequence!.steps]) st = reduce(st, { type: 'user.stepAction', entityId: step.entityId }, 30000);
    expect(st.sequence!.activeIndex).toBeNull();
    expect(st.competence['demo.tour']).toBe(1);
    expect(st.relations).toHaveLength(1);
  });
  it('returns empty for scenes with <3 tiles (renders nothing, never throws)', () => {
    expect(buildDemoScript([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then pass**

Run: `npm test -- src/teaching/demoScript.test.ts` → FAIL (module missing) → after creating both files: PASS (2 tests).

- [ ] **Step 3: Write the TeachingLayer**

Create `src/teaching/TeachingLayer.tsx`:
```tsx
import React, { useEffect, useRef, useState } from 'react';
import type { SceneEntity, EntityId } from '../entities/registry';
import { displayName } from '../entities/registry';
import type { TeachingEvent, TeachingState } from './types';
import { initialTeachingState, reduce } from './teachingStore';
import { activeStep, visibleScaffold, blockedEntityIds } from './selectors';
import { buildDemoScript } from './demoScript';

const pct = (v: number) => `${v / 10}%`; // 0-1000 space → percentage of the container

type Props = {
  entities: SceneEntity[];
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: TeachingEvent) => void) | null>; // Plan 2 seam
  onGuidance?: (kind: string, data: Record<string, unknown>) => void;        // telemetry seam (Task 4)
};

export function TeachingLayer({ entities, demo = false, dispatchRef, onGuidance }: Props) {
  const [state, setState] = useState<TeachingState>(initialTeachingState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = (e: TeachingEvent) => setState((s) => reduce(s, e, Date.now()));
  useEffect(() => { if (dispatchRef) { dispatchRef.current = dispatch; return () => { dispatchRef.current = null; }; } }, [dispatchRef]);

  // Demo driver: play the script once entities exist.
  const played = useRef(false);
  useEffect(() => {
    if (!demo || played.current || entities.filter(e => e.category !== 'map').length < 3) return;
    played.current = true;
    const timers = buildDemoScript(entities).map(({ at, event }) => setTimeout(() => dispatch(event), at));
    return () => timers.forEach(clearTimeout);
  }, [demo, entities]);

  const byId = (eid: EntityId) => entities.find((e) => e.id === eid);
  const box = (eid: EntityId) => {
    const e = byId(eid);
    if (!e) return null;
    const [ymin, xmin, ymax, xmax] = e.bbox;
    if (ymax - ymin <= 0 || xmax - xmin <= 0) return null; // zero bbox → render nothing
    return { top: pct(ymin), left: pct(xmin), width: pct(xmax - xmin), height: pct(ymax - ymin) };
  };

  const scaffold = visibleScaffold(state);
  const step = activeStep(state);
  const seq = state.sequence;
  const tileIds = entities.filter((e) => e.category !== 'map').map((e) => e.id);
  const blocked = blockedEntityIds(state, tileIds);
  const toastFresh = seq?.lastBlocked && Date.now() - seq.lastBlocked.at < 2500;

  return (
    <div className="absolute inset-0 z-[60] pointer-events-none" data-teaching-layer>
      {/* Ad-hoc highlights: emphasis ON the element (never a detached panel) */}
      {state.highlights.map((h, i) => {
        const b = box(h.entityId);
        return b && (
          <div key={i} className="absolute rounded-xl ring-4 ring-amber-400/80 shadow-[0_0_24px_rgba(251,191,36,0.5)] transition-all" style={b}>
            {h.note && <span className="absolute -top-2 left-2 px-1.5 rounded bg-amber-400 text-[10px] font-bold text-black">{h.note}</span>}
          </div>
        );
      })}

      {/* Relate links: SVG arcs between entity centers, mid-labeled (the EXPERIMENT) */}
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        {state.relations.map((r, i) => {
          const a = byId(r.from), b2 = byId(r.to);
          if (!a || !b2) return null;
          const cx = (e: SceneEntity) => (e.bbox[1] + e.bbox[3]) / 2 / 10;
          const cy = (e: SceneEntity) => (e.bbox[0] + e.bbox[2]) / 2 / 10;
          const mx = (cx(a) + cx(b2)) / 2, my = (cy(a) + cy(b2)) / 2 - 6;
          return (
            <g key={i}>
              <path d={`M ${cx(a)} ${cy(a)} Q ${mx} ${my - 8} ${cx(b2)} ${cy(b2)}`}
                    fill="none" stroke="rgb(99,102,241)" strokeWidth="0.4" strokeDasharray="1.2 0.8"
                    vectorEffect="non-scaling-stroke" transform="scale(1,1)" />
              <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" className="fill-indigo-500 text-[9px] font-mono">{r.label}</text>
            </g>
          );
        })}
      </svg>

      {/* Sequence scaffolding */}
      {seq && step && (
        <>
          {/* soft-block scrim patches over non-target tiles (Carroll: inert + informative) */}
          {scaffold.block && blocked.map((eid) => {
            const b = box(eid);
            return b && (
              <div key={eid} className="absolute rounded-lg bg-slate-900/35 backdrop-saturate-50 pointer-events-auto cursor-not-allowed" style={b}
                   onClick={() => { dispatch({ type: 'user.stepAction', entityId: eid }); onGuidance?.('blocked', { entityId: eid }); }} />
            );
          })}
          {/* active-step catcher + emphasis on the target */}
          {(() => {
            const b = box(step.entityId);
            if (!b) return null;
            const showRing = scaffold.markers || scaffold.highlightOnly;
            return (
              <div className={`absolute rounded-xl pointer-events-auto cursor-pointer ${showRing ? 'ring-4 ring-[var(--accent-color)] shadow-[0_0_28px_rgba(99,102,241,0.45)]' : ''}`}
                   style={b}
                   onClick={() => { dispatch({ type: 'user.stepAction', entityId: step.entityId }); onGuidance?.('step_done', { subgoal: step.subgoal }); }}>
                {scaffold.markers && seq.activeIndex !== null && (
                  <span className="absolute -top-3 -left-3 w-7 h-7 rounded-full bg-[var(--accent-color)] text-white text-sm font-bold flex items-center justify-center shadow">
                    {seq.activeIndex + 1}
                  </span>
                )}
                {scaffold.labels && (
                  <span className="absolute -bottom-7 left-0 px-2 py-0.5 rounded-md bg-[var(--card-bg)] border border-[var(--card-border)] text-[11px] font-mono whitespace-nowrap shadow-sm">
                    {seq.activeIndex !== null ? seq.activeIndex + 1 : ''} · {step.subgoal} — {step.instruction}
                  </span>
                )}
              </div>
            );
          })()}
          {/* done steps collapse to ✓ dots at their entities (glanceable, no progress bar) */}
          {seq.steps.map((s, i) => {
            if (s.state !== 'done') return null;
            const b = box(s.entityId);
            return b && <span key={i} className="absolute w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center" style={{ top: b.top, left: b.left }}>✓</span>;
          })}
          {/* fade-2 prompt (promptOnly): terse, with the always-available reveal */}
          {scaffold.promptOnly && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] shadow">
              <span className="text-[11px] font-mono">{step.subgoal}</span>
              <button className="text-[10px] font-mono text-[var(--accent-color)]"
                      onClick={() => { dispatch({ type: 'user.reveal' }); onGuidance?.('reveal', {}); }}>show me</button>
            </div>
          )}
          {/* disablement toast (transient, names the active subgoal) */}
          {toastFresh && seq.lastBlocked && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-100 border border-amber-300 text-[11px] font-mono text-amber-900 shadow">
              Not yet — {seq.activeIndex !== null ? `${seq.activeIndex + 1} · ${step.subgoal}` : step.subgoal} first
              {(() => { const e = byId(seq.lastBlocked!.entityId); return e ? ` (that was ${displayName(e)})` : ''; })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount in App behind the flag**

In `src/App.tsx`: add imports (after the entities imports):
```tsx
import { TeachingLayer } from './teaching/TeachingLayer';
```
Add near the other feature flags/state (after `perceivedVersion` declaration):
```tsx
  const teachMode = typeof window !== 'undefined' && window.location.search.includes('teach');
```
Inside `<main>` immediately after the `<canvas ref={traceCanvasRef} …/>` element (~L3108), add:
```tsx
          {teachMode && <TeachingLayer entities={entities} demo />}
```

- [ ] **Step 5: Gates + manual check**

Run: `npm run lint && npm run build && npm test` — all green.
Manual: `npm run dev` → `http://localhost:3000/?teach=1` (no key needed): highlight appears ON a tile, then the 3-step tour — numbered badge + subgoal chip on ONE tile at a time, other tiles scrimmed; clicking a scrimmed tile shows the "Not yet — ① …" toast; clicking targets in order completes with ✓ dots. Without `?teach`: pixel-identical app.

- [ ] **Step 6: Commit**

```bash
git add src/teaching/TeachingLayer.tsx src/teaching/demoScript.ts src/teaching/demoScript.test.ts src/App.tsx
git commit -m "feat(teaching): on-element overlays + soft-block + ?teach=1 scripted demo"
```

---

### Task 3: Teach tools + honest mapper

**Files:**
- Create: `src/teaching/teachTools.ts`, `src/teaching/teachTools.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `../voice/types`; `resolveEchoedTarget`, `SceneEntity` from `../entities/registry`; `TeachingEvent`, `TeachPosture` from `./types`.
- Produces: `TEACH_TOOLS: VoiceTool[]` (5 tools); `teachCallToEvent(call: { name: string; args: any }, entities: SceneEntity[]): TeachingEvent | { error: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/teaching/teachTools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TEACH_TOOLS, teachCallToEvent } from './teachTools';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';

const layout = {
  items: getProgram('word').images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
};
const entities = buildEntities(getProgram('word'), {}, layout);

describe('TEACH_TOOLS', () => {
  it('declares the five teaching tools', () => {
    expect(TEACH_TOOLS.map(t => t.name).sort()).toEqual(
      ['teach_clear', 'teach_highlight', 'teach_relate', 'teach_sequence', 'teach_step_done']);
  });
});

describe('teachCallToEvent', () => {
  it('maps teach_highlight with target resolution', () => {
    const ev = teachCallToEvent({ name: 'teach_highlight', args: { target: 'Save button', note: 'here' } }, entities);
    expect(ev).toMatchObject({ type: 'teach.highlight', note: 'here' });
  });
  it('maps teach_sequence resolving every step target', () => {
    const ev = teachCallToEvent({ name: 'teach_sequence', args: {
      title: 'Save', taskKey: 'word.save', posture: 'guide',
      steps: [{ target: 'Save button', subgoal: 'Open save', instruction: 'Click it.' }],
    } }, entities) as any;
    expect(ev.type).toBe('teach.sequence');
    expect(ev.steps[0].subgoal).toBe('Open save');
  });
  it('FAILS THE WHOLE CALL naming an unresolvable step target (honesty over helpfulness)', () => {
    const ev = teachCallToEvent({ name: 'teach_sequence', args: {
      title: 'X', taskKey: 'k', posture: 'guide',
      steps: [
        { target: 'Save button', subgoal: 'A', instruction: 'B.' },
        { target: 'Cell Q99', subgoal: 'C', instruction: 'D.' },
      ],
    } }, entities);
    expect(ev).toEqual({ error: 'Could not resolve target "Cell Q99" to an on-screen element.' });
  });
  it('maps step_done and clear; unknown tool → error', () => {
    expect(teachCallToEvent({ name: 'teach_step_done', args: {} }, entities)).toEqual({ type: 'teach.stepAdvance' });
    expect(teachCallToEvent({ name: 'teach_clear', args: {} }, entities)).toEqual({ type: 'teach.clear' });
    expect(teachCallToEvent({ name: 'nope', args: {} }, entities)).toEqual({ error: 'Unknown teaching tool "nope".' });
  });
  it('maps teach_relate resolving both ends; fails naming the bad end', () => {
    const ok = teachCallToEvent({ name: 'teach_relate', args: { pairs: [{ from: 'Save button', to: 'Document body', label: 'writes to' }] } }, entities) as any;
    expect(ok.type).toBe('teach.relate');
    const bad = teachCallToEvent({ name: 'teach_relate', args: { pairs: [{ from: 'Save button', to: 'Nonsense Widget', label: 'x' }] } }, entities);
    expect(bad).toEqual({ error: 'Could not resolve target "Nonsense Widget" to an on-screen element.' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/teaching/teachTools.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the tools + mapper**

Create `src/teaching/teachTools.ts`:
```ts
import type { VoiceTool } from '../voice/types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { resolveEchoedTarget } from '../entities/registry';
import type { TeachingEvent, TeachPosture, TeachRelation } from './types';

export const TEACH_TOOLS: VoiceTool[] = [
  { name: 'teach_highlight',
    description: 'Visually emphasize ONE on-screen element the user should look at. Use for "where is…" / "show me…" questions. Note is optional and must be ≤3 words.',
    parameters: { type: 'object', properties: {
      target: { type: 'string', description: 'The element to highlight (its visible name).' },
      note: { type: 'string', description: 'Optional ≤3-word label.' } }, required: ['target'] } },
  { name: 'teach_sequence',
    description: 'Start a step-by-step teaching sequence with numbered on-screen markers. posture "guide" = walk the user through it fast; "teach" = you demonstrate step 1, then the USER must perform each step. Keep instructions to ONE short sentence each.',
    parameters: { type: 'object', properties: {
      title: { type: 'string' },
      taskKey: { type: 'string', description: 'Stable key for this task family, e.g. "word.save" — repeats of the same key fade the scaffolding.' },
      posture: { type: 'string', enum: ['guide', 'teach'] },
      steps: { type: 'array', items: { type: 'object', properties: {
        target: { type: 'string' }, subgoal: { type: 'string', description: 'Short WHY label.' },
        instruction: { type: 'string', description: 'ONE short sentence.' } },
        required: ['target', 'subgoal', 'instruction'] } } },
      required: ['title', 'taskKey', 'posture', 'steps'] } },
  { name: 'teach_step_done',
    description: 'Advance the active teaching sequence one step (guide posture, or the demonstrated first step in teach posture).',
    parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'teach_relate',
    description: 'Draw labeled relationship links between on-screen elements to explain how they connect.',
    parameters: { type: 'object', properties: { pairs: { type: 'array', items: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
      required: ['from', 'to', 'label'] } } }, required: ['pairs'] } },
  { name: 'teach_clear',
    description: 'Remove all teaching overlays (highlights, sequence, relationship links).',
    parameters: { type: 'object', properties: {}, required: [] } },
];

const unresolved = (target: string) => ({ error: `Could not resolve target "${target}" to an on-screen element.` });

function resolve(entities: SceneEntity[], target: string): EntityId | null {
  return resolveEchoedTarget(entities, target)?.entity.id ?? null;
}

/** Pure mapping from a teach tool call to a reducer event. Unresolvable targets fail the WHOLE call. */
export function teachCallToEvent(
  call: { name: string; args: any }, entities: SceneEntity[],
): TeachingEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'teach_highlight': {
      const id = resolve(entities, String(a.target ?? ''));
      if (!id) return unresolved(String(a.target ?? ''));
      return { type: 'teach.highlight', entityId: id, note: a.note ? String(a.note) : undefined };
    }
    case 'teach_sequence': {
      const steps: { entityId: EntityId; subgoal: string; instruction: string }[] = [];
      for (const s of a.steps ?? []) {
        const id = resolve(entities, String(s.target ?? ''));
        if (!id) return unresolved(String(s.target ?? ''));
        steps.push({ entityId: id, subgoal: String(s.subgoal ?? ''), instruction: String(s.instruction ?? '') });
      }
      if (!steps.length) return { error: 'teach_sequence requires at least one step.' };
      return { type: 'teach.sequence', title: String(a.title ?? ''), taskKey: String(a.taskKey ?? 'task'),
               posture: (a.posture === 'teach' ? 'teach' : 'guide') as TeachPosture, steps };
    }
    case 'teach_step_done': return { type: 'teach.stepAdvance' };
    case 'teach_relate': {
      const relations: TeachRelation[] = [];
      for (const p of a.pairs ?? []) {
        const from = resolve(entities, String(p.from ?? ''));
        if (!from) return unresolved(String(p.from ?? ''));
        const to = resolve(entities, String(p.to ?? ''));
        if (!to) return unresolved(String(p.to ?? ''));
        relations.push({ from, to, label: String(p.label ?? '') });
      }
      if (!relations.length) return { error: 'teach_relate requires at least one pair.' };
      return { type: 'teach.relate', relations };
    }
    case 'teach_clear': return { type: 'teach.clear' };
    default: return { error: `Unknown teaching tool "${call.name}".` };
  }
}
```

- [ ] **Step 4: Run tests + gates**

Run: `npm test -- src/teaching/ && npm run lint`
Expected: all teaching tests PASS (15 + 2 + 5 = 22); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/teaching/teachTools.ts src/teaching/teachTools.test.ts
git commit -m "feat(teaching): teach tool definitions + honest entity-resolving mapper"
```

---

### Task 4: Guidance telemetry + competence persistence

**Files:**
- Modify: `src/telemetry.ts`
- Create: `src/telemetry.guidance.test.ts`, `src/teaching/persistence.ts`, `src/teaching/persistence.test.ts`
- Modify: `src/teaching/TeachingLayer.tsx` (wire persistence + guidance emission)

**Interfaces:**
- Consumes: the `telemetry` singleton; Task 1-2 types.
- Produces: `type GuidanceKind = 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown'`; `telemetry.guidance(kind: GuidanceKind, detail: { taskKey?: string; posture?: string; fadeLevel?: number })`; `metrics().guidance` slice; `loadCompetence(): Record<string, number>` / `saveCompetence(c): void` (fail-soft).

- [ ] **Step 1: Failing telemetry test**

Create `src/telemetry.guidance.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { telemetry } from './telemetry';

const cfg = {
  backend: 'gemini', autonomy: 'confirm', feedback: 'earcon', program: 'word', honest: true,
  device: { width: 1280, height: 800, touch: false, pointer: 'fine', formFactor: 'desktop' as const, ua: 'test' },
};

describe('guidance telemetry', () => {
  beforeEach(() => telemetry.start(cfg));
  it('counts sequences, completions, unaided (fade-2) completions, blocked, reveals', () => {
    telemetry.guidance('sequence_start', { taskKey: 'k', posture: 'guide', fadeLevel: 0 });
    telemetry.guidance('blocked', { taskKey: 'k' });
    telemetry.guidance('sequence_complete', { taskKey: 'k', fadeLevel: 0 });
    telemetry.guidance('sequence_start', { taskKey: 'k', posture: 'teach', fadeLevel: 2 });
    telemetry.guidance('reveal', { taskKey: 'k' });
    telemetry.guidance('sequence_complete', { taskKey: 'k', fadeLevel: 2 });
    const g = telemetry.metrics().guidance;
    expect(g).toEqual({ sequences: 2, completions: 2, unaidedCompletions: 1, blocked: 1, reveals: 1, abandoned: 0, relatesShown: 0 });
  });
});
```

- [ ] **Step 2: Implement in telemetry.ts**

Add to the `TelemetryEvent` union:
```ts
  | { t: number; type: 'guidance'; kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown'; taskKey?: string; posture?: string; fadeLevel?: number }
```
Add the method after `error(...)`:
```ts
  guidance(kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown', detail: { taskKey?: string; posture?: string; fadeLevel?: number } = {}) {
    this.push({ type: 'guidance', kind, ...detail });
  }
```
In `metrics()`, before the return, add:
```ts
    const guid = this.events.filter(e => e.type === 'guidance') as Extract<TelemetryEvent, { type: 'guidance' }>[];
    const gk = (k: string) => guid.filter(e => e.kind === k).length;
```
And to the returned object:
```ts
      guidance: {
        sequences: gk('sequence_start'),
        completions: gk('sequence_complete'),
        unaidedCompletions: guid.filter(e => e.kind === 'sequence_complete' && e.fadeLevel === 2).length,
        blocked: gk('blocked'), reveals: gk('reveal'), abandoned: gk('sequence_abandoned'), relatesShown: gk('relate_shown'),
      },
```

- [ ] **Step 3: Persistence (pure + storage wrapper) with failing test first**

Create `src/teaching/persistence.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseCompetence, serializeCompetence } from './persistence';

describe('competence persistence', () => {
  it('round-trips a record', () => {
    expect(parseCompetence(serializeCompetence({ 'word.save': 2 }))).toEqual({ 'word.save': 2 });
  });
  it('fail-soft: null, garbage, and wrong shapes → {}', () => {
    expect(parseCompetence(null)).toEqual({});
    expect(parseCompetence('not json')).toEqual({});
    expect(parseCompetence('[1,2]')).toEqual({});
    expect(parseCompetence('{"k":"NaNish"}')).toEqual({});
  });
});
```
Create `src/teaching/persistence.ts`:
```ts
const KEY = 'ff-teach-competence';

export function serializeCompetence(c: Record<string, number>): string {
  return JSON.stringify(c);
}

/** Fail-soft: anything malformed yields an empty record (fresh scaffold, never a crash). */
export function parseCompetence(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch { return {}; }
}

export function loadCompetence(): Record<string, number> {
  try { return parseCompetence(sessionStorage.getItem(KEY)); } catch { return {}; }
}
export function saveCompetence(c: Record<string, number>): void {
  try { sessionStorage.setItem(KEY, serializeCompetence(c)); } catch { /* fail-soft */ }
}
```

- [ ] **Step 4: Wire persistence + guidance into TeachingLayer**

In `src/teaching/TeachingLayer.tsx`:
- Add imports: `import { loadCompetence, saveCompetence } from './persistence';` and `import { telemetry } from '../telemetry';` and `fadeLevel` to the selectors import.
- Initial state seeds competence: change the useState initializer to
  `useState<TeachingState>(() => ({ ...initialTeachingState(), competence: loadCompetence() }))`.
- After each dispatch-driven state change, persist + emit: replace the `dispatch` const with:
```tsx
  const dispatch = (e: TeachingEvent) => setState((s) => {
    const next = reduce(s, e, Date.now());
    if (next.competence !== s.competence) saveCompetence(next.competence);
    if (e.type === 'teach.sequence') telemetry.guidance('sequence_start', { taskKey: e.taskKey, posture: e.posture, fadeLevel: fadeLevel(s, e.taskKey) });
    if (e.type === 'teach.relate') telemetry.guidance('relate_shown', {});
    if (e.type === 'user.dismiss' && s.sequence && s.sequence.activeIndex !== null) telemetry.guidance('sequence_abandoned', { taskKey: s.sequence.taskKey });
    if (s.sequence && next.sequence && next.sequence.activeIndex === null && s.sequence.activeIndex !== null)
      telemetry.guidance('sequence_complete', { taskKey: s.sequence.taskKey, fadeLevel: fadeLevel(s, s.sequence.taskKey) });
    return next;
  });
```
- The existing `onGuidance?.('blocked'|'step_done'|'reveal', …)` calls become `telemetry.guidance('blocked'|'step_done'|'reveal', {})` (drop the `onGuidance` prop entirely — telemetry is the seam).

- [ ] **Step 5: Gates**

Run: `npm run lint && npm run build && npm test`
Expected: all green (teaching 22 + telemetry-guidance 1 + persistence 2 = +25 over the pre-plan 64 ⇒ 89 total). Note: `telemetry.guidance` inside the reducer-wrapping setState runs only on real user/driver events — StrictMode double-invoke of the updater is possible; the updater must stay pure of telemetry if a duplicate is observed in the manual check: in that case move the telemetry emission into `dispatch` BEFORE `setState` using `stateRef.current` for the prior state. The manual check (Step 6) explicitly verifies counts.

- [ ] **Step 6: Manual check (record evidence)**

`?teach=1`: run the demo, complete the tour, export session JSON → `guidance.sequences === 1`, `completions === 1`, `blocked` matches your scrim clicks; reload (same tab/session) and rerun → second run starts at fade 1 (no scrim, highlight only), proving persistence.

- [ ] **Step 7: Commit**

```bash
git add src/telemetry.ts src/telemetry.guidance.test.ts src/teaching/persistence.ts src/teaching/persistence.test.ts src/teaching/TeachingLayer.tsx
git commit -m "feat(teaching): guidance telemetry rubric + fail-soft competence persistence"
```

---

## Self-Review notes

- **Spec coverage:** §3 types (T1 verbatim); §4 reducer/fading incl. posture rules, soft-block, pause/dismiss, reveal (T1); §5 overlays — on-element rings, one-at-a-time StepBadge + subgoal chip, ✓ dots, scrim patches + disablement toast naming the subgoal, RelateLink arcs (T2); §6 tools + honest whole-call failure (T3); §7 guidance telemetry incl. unaided fade-2 completions (T4); §8 `?teach=1` demo over real entities with real click advancement (T2); §9 degradation (zero-bbox render-nothing T2, mapper errors-as-data T3, sessionStorage fail-soft T4); §10 testing (25 new tests + demo assertions); §11 build order = tasks.
- **StrictMode caveat handled explicitly** in T4 Step 5 rather than discovered in review.
- **Spec §2 constraint 8 (intensity ∝ complexity)** is a Plan-2 (prompting) concern — the foundation exposes posture/taskKey; noted here so the final review doesn't count it as a silent gap.
- **Type consistency:** `TeachingEvent`/`TeachingState`/`reduce`/`initialTeachingState`/`fadeLevel`/`activeStep`/`visibleScaffold`/`blockedEntityIds`/`teachCallToEvent`/`TEACH_TOOLS`/`loadCompetence`/`saveCompetence` used identically across tasks; `dispatchRef` is the Plan-2 seam.
```
