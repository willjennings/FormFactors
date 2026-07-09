# Teaching Perception (C2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent's teaching overlays perceivable to the model — WYSIWYG pixels in the vision frame plus a structured `[TEACHING STATE]` text hint — so it can witness its own scaffolding and track the learner's progress.

**Architecture:** A transparent, plane-spanning `instructionLayerRef` wrapper around `TeachingLayer` becomes a general "instructional overlay layer" seam. The existing vision pipeline snapshots that wrapper (fail-soft, reusing `snapshotNode`, which is already transparent-background) and composites it over the reconstructed scene. A pure `serializeTeachingState` emits a deduped `[TEACHING STATE]` hint via the existing `sendTextHint` channel. Purely additive perception plumbing — no changes to `TeachingLayer`, the reducer, or the selectors.

**Tech Stack:** React 19, TypeScript, Vitest, html-to-image (`toCanvas`), the existing `VoiceProvider.sendVideoFrame`/`sendTextHint` channels.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-teaching-perception-design.md`. Every task's requirements implicitly include it.
- **Honest fail-soft:** a `null` instruction snapshot means the overlay is OMITTED from the frame — never a stale or schematic teaching mark. On any `drawImage`/snapshot failure, degrade to the bare surface.
- **Reuse `snapshotNode` as-is** — no new snapshot function. `toCanvas` (html-to-image 1.11.x) fills a background only when `options.backgroundColor` is set; `snapshotNode` never sets it, so it is already transparent where the node is transparent.
- **Dedupe the text hint:** send `[TEACHING STATE]` once per teaching-state change, never once per frame. Both channels are dormant unless a session is live AND a sequence is active (traffic-meter / idle-watchdog discipline).
- **Names, never ids:** the hint uses `displayName(entity)` (falling back to the raw id string only so a stale id never yields a blank) — the same vocabulary the model already grounds on.
- **Silent context:** the hint ends with `DO NOT acknowledge this message.` (matches every other `[SYSTEM …]` hint).
- No changes to `TeachingLayer`, the teaching reducer (`teachingStore.ts`), or the selectors (`selectors.ts`).

---

### Task 1: Pure teaching-state serializer + change gate

**Files:**
- Create: `src/teaching/teachingState.ts`
- Test: `src/teaching/teachingState.test.ts`

**Interfaces:**
- Consumes: `TeachingState`, `TeachStep` from `./types`; `SceneEntity`, `EntityId`, `entityById`, `displayName` from `../entities/registry`; `activeStep`, `blockedEntityIds`, `fadeLevel` from `./selectors`; `initialTeachingState` from `./teachingStore` (test only).
- Produces:
  - `serializeTeachingState(state: TeachingState, entities: SceneEntity[]): string | null`
  - `makeChangeGate(): (value: string | null) => boolean`

- [ ] **Step 1: Write the failing test**

Create `src/teaching/teachingState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeTeachingState, makeChangeGate } from './teachingState';
import { initialTeachingState } from './teachingStore';
import type { TeachingState, TeachStep } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});

// word-2 is the active target; the other two are what soft-block scrims.
const entities: SceneEntity[] = [
  ent('word-1', 'Title text'),
  ent('word-2', 'Bold button'),
  ent('word-3', 'Save button'),
];

const step = (entityId: string, subgoal: string, instruction: string, state: TeachStep['state']): TeachStep =>
  ({ entityId: entityId as EntityId, subgoal, instruction, state });

const seqState = (over: Partial<NonNullable<TeachingState['sequence']>> = {}): TeachingState => ({
  ...initialTeachingState(),
  sequence: {
    title: 'Make the title bold',
    taskKey: 'bold-title',
    posture: 'guide',
    steps: [
      step('word-1', 'Select the title', 'Drag over the title text.', 'done'),
      step('word-2', 'Click Bold', 'Click Bold to embolden it.', 'active'),
      step('word-3', 'Save', 'Save the document.', 'pending'),
    ],
    activeIndex: 1,
    softBlock: true,
    paused: false,
    blockedAttempts: 0,
    ...over,
  },
});

describe('serializeTeachingState', () => {
  it('returns null when no sequence is active', () => {
    expect(serializeTeachingState(initialTeachingState(), entities)).toBeNull();
  });

  it('returns null when the sequence has no active step', () => {
    expect(serializeTeachingState(seqState({ activeIndex: null }), entities)).toBeNull();
  });

  it('serializes posture, progress, active step, completed, blocked, fade, paused', () => {
    const s = serializeTeachingState(seqState(), entities)!;
    expect(s).toContain('Guiding "Make the title bold"');
    expect(s).toContain('step 2 of 3');
    expect(s).toContain('Click Bold');
    expect(s).toContain('Click Bold to embolden it.');
    expect(s).toContain('target: Bold button');
    expect(s).toContain('Completed: Title text');
    expect(s).toContain('Blocked (soft): Title text, Save button');
    expect(s).toContain('Fade level: 0');
    expect(s).toContain('Paused: no');
    expect(s.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });

  it('uses "Teaching" for the teach posture', () => {
    expect(serializeTeachingState(seqState({ posture: 'teach' }), entities)).toContain('Teaching "Make the title bold"');
  });

  it('reports paused and empties the blocked set when paused', () => {
    const s = serializeTeachingState(seqState({ paused: true }), entities)!;
    expect(s).toContain('Paused: yes');
    expect(s).toContain('Blocked (soft): none');
  });

  it('falls back to the raw id (never blank) when an entity is missing, without throwing', () => {
    const s = serializeTeachingState(seqState(), [])!;
    expect(s).toContain('target: word-2');
    expect(s).not.toContain('target: )'); // guards against a blank name before the closing paren
  });
});

describe('makeChangeGate', () => {
  it('sends once per change, resets on null, never sends null', () => {
    const gate = makeChangeGate();
    expect(gate('A')).toBe(true);   // first non-null → send
    expect(gate('A')).toBe(false);  // unchanged → skip
    expect(gate('B')).toBe(true);   // changed → send
    expect(gate(null)).toBe(false); // null → never sent, resets
    expect(gate('B')).toBe(true);   // re-sends after reset
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/teaching/teachingState.test.ts`
Expected: FAIL — `Failed to resolve import "./teachingState"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/teaching/teachingState.ts`:

```ts
// C2a text channel: a structured [TEACHING STATE] hint that pairs with the WYSIWYG overlay
// pixels (learnings §4: never labels-only). Pure & derived from the same selectors the overlay
// renders from, so text and pixels cannot disagree.

import type { TeachingState } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { entityById, displayName } from '../entities/registry';
import { activeStep, blockedEntityIds, fadeLevel } from './selectors';

/** Name for an entity id; falls back to the raw id so a stale id never yields a blank line. */
function nameOf(entities: SceneEntity[], id: EntityId): string {
  return displayName(entityById(entities, id)) || String(id);
}

/**
 * Serialize the active teaching sequence for the model. Returns null when no sequence is active
 * (nothing to say → nothing sent). Names come from displayName — the vocabulary the model grounds
 * on — never entity ids.
 */
export function serializeTeachingState(state: TeachingState, entities: SceneEntity[]): string | null {
  const seq = state.sequence;
  const step = activeStep(state);
  if (!seq || seq.activeIndex === null || !step) return null;

  const verb = seq.posture === 'guide' ? 'Guiding' : 'Teaching';
  const completed = seq.steps.filter((s) => s.state === 'done').map((s) => nameOf(entities, s.entityId));
  const blocked = blockedEntityIds(state, entities.map((e) => e.id)).map((id) => nameOf(entities, id));
  const fade = fadeLevel(state, seq.taskKey);

  return `[TEACHING STATE: ${verb} "${seq.title}" — step ${seq.activeIndex + 1} of ${seq.steps.length}.`
    + ` Active step: ${step.subgoal} — "${step.instruction}" (target: ${nameOf(entities, step.entityId)}).`
    + ` Completed: ${completed.length ? completed.join(', ') : 'none'}.`
    + ` Blocked (soft): ${blocked.length ? blocked.join(', ') : 'none'}.`
    + ` Fade level: ${fade} (0 full / 1 partial / 2 faint). Paused: ${seq.paused ? 'yes' : 'no'}.`
    + ` DO NOT acknowledge this message.]`;
}

/**
 * Send-once-per-change gate (mirrors makeThrottle's closure pattern). Returns true only when
 * `value` is non-null AND differs from the last value it returned true for. A null value resets
 * the gate (so the next active sequence re-sends) and is itself never sent.
 */
export function makeChangeGate(): (value: string | null) => boolean {
  let lastSent: string | null = null;
  return (value) => {
    if (value === null) { lastSent = null; return false; }
    if (value === lastSent) return false;
    lastSent = value;
    return true;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/teaching/teachingState.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/teaching/teachingState.ts src/teaching/teachingState.test.ts
git commit -m "feat(teaching): serializeTeachingState + makeChangeGate — the C2a text channel (TDD)"
```

---

### Task 2: Visual channel — instructional-overlay seam, snapshot, composite

**Files:**
- Modify: `src/App.tsx` (refs near `surfaceRef` ~line 560; wrapper around `TeachingLayer` ~line 2478; refresh effect near the surface-snapshot effect ~line 2346; composite in the vision loop after the markers `forEach`, before the `DOCUMENT STRIP` block ~line 2303)

**Interfaces:**
- Consumes: `snapshotNode`, `makeThrottle` (already imported from `./vision/snapshotNode`); `TeachingLayer` (already imported).
- Produces: `instructionLayerRef` (a `React.RefObject<HTMLDivElement>`) and `instructionSnapshotRef` (a `React.MutableRefObject<HTMLCanvasElement | null>`) consumed by Task 3's neighbour only structurally — Task 3 does not read these.

**Context:** `TeachingLayer`'s own root is `absolute inset-0 z-[60] pointer-events-none`. Wrapping it in a `z-auto` (`absolute inset-0`, no `z-index`) div preserves its geometry (both span the `relative` plane `mainContainerRef`) and its stacking (a `z-auto` positioned element establishes no stacking context, so the child's `z-[60]` resolves globally, exactly as today). The wrapper becomes the general instructional-overlay layer the C2a-illustrate renderer will later join.

This task is integration wiring around already-tested pure functions; its gate is tsc + the full suite staying green + a clean build (there is no jsdom seam for `html-to-image` or canvas compositing — the same boundary as the existing surface-snapshot effect, whose only unit test is `makeThrottle`).

- [ ] **Step 1: Add the refs**

In `src/App.tsx`, immediately after `const surfaceRef = useRef<HTMLDivElement>(null);` (~line 560), add:

```ts
  // C2a: the instructional-overlay layer (teaching marks today, annotations later) + its
  // WYSIWYG snapshot for the vision frame. The wrapper is the general seam; anything rendered
  // inside it is perceived for free.
  const instructionLayerRef = useRef<HTMLDivElement>(null);
  const instructionSnapshotRef = useRef<HTMLCanvasElement | null>(null);
```

- [ ] **Step 2: Wrap `TeachingLayer` in the seam**

In `src/App.tsx` (~line 2478), replace:

```tsx
          <TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
```

with:

```tsx
          {/* C2a: the instructional-overlay seam. z-auto wrapper preserves TeachingLayer's own
              z-[60] stacking and plane geometry; it exists so the vision frame can snapshot the
              teaching marks (and, later, the annotation renderer) as one node. */}
          <div ref={instructionLayerRef} className="absolute inset-0 pointer-events-none" data-instruction-layer>
            <TeachingLayer entities={entities} program={program} demo={teachMode} dispatchRef={teachingDispatchRef} onStateChange={setTeachingSnapshot} />
          </div>
```

- [ ] **Step 3: Add the throttled refresh effect**

In `src/App.tsx`, immediately after the surface-snapshot refresh effect (the one ending `}, [isLive, activeProgram]);` right below the `// Refresh the real-pixel surface snapshot` comment, ~line 2363), add:

```ts
  // C2a: refresh the instructional-overlay snapshot (teaching marks) — throttled, fail-soft.
  // Reuses snapshotNode: the layer is transparent except where marks are drawn, and snapshotNode
  // omits backgroundColor, so only the marks composite (surface shows through). null (snapshot
  // failed or window closed) → the overlay is omitted from the frame, never faked.
  useEffect(() => {
    instructionSnapshotRef.current = null; // clear on program swap so marks never carry over
    if (!isLive) return;
    let cancelled = false;
    const gate = makeThrottle(500);
    const tick = async () => {
      if (cancelled || !gate(Date.now())) return;
      const node = instructionLayerRef.current;
      if (!node) { instructionSnapshotRef.current = null; return; }
      const canvas = await snapshotNode(node);
      if (!cancelled) instructionSnapshotRef.current = canvas; // canvas on success, null on failure
    };
    const interval = setInterval(tick, 250);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isLive, activeProgram]);
```

- [ ] **Step 4: Composite the overlay in the vision loop**

In `src/App.tsx`, find the end of the markers `forEach` in the vision-pipeline `setInterval` — the block that draws `M${i+1}` labels, immediately before the `// DOCUMENT STRIP (G2)` comment (~line 2302). Insert between them:

```ts
      // C2a: composite the WYSIWYG teaching/annotation overlay over the plane region. Transparent
      // except where marks are drawn; drawn at full frame extent because the layer spans the same
      // 0-1000 plane the window is reconstructed in. null → omitted (honest), never a fake mark.
      const iCanvas = instructionSnapshotRef.current;
      if (iCanvas) {
        try { ctx.drawImage(iCanvas, 0, 0, VISION_SIZE, VISION_SIZE); } catch { /* keep the frame clean */ }
      }

```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all existing tests plus Task 1's 7 tests green.

- [ ] **Step 7: Verify the build**

Run: `npx vite build`
Expected: build succeeds (no type or bundling error).

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(vision): instructional-overlay seam — teaching marks composite into the vision frame (WYSIWYG, fail-soft)"
```

---

### Task 3: Text channel — deduped `[TEACHING STATE]` hint wiring

**Files:**
- Modify: `src/App.tsx` (import ~line 64; gate ref near the other C2a refs ~line 562; send effect near the spreadsheet-hint effect ~line 2365)

**Interfaces:**
- Consumes: `serializeTeachingState`, `makeChangeGate` from `./teaching/teachingState` (Task 1); `teachingSnapshot` state and `entities` state (already in `App`); `providerRef.current.sendTextHint` (existing channel).
- Produces: nothing consumed by later tasks (final task).

**Context:** `teachingSnapshot` (`TeachingState | null`) is already maintained via `TeachingLayer`'s `onStateChange={setTeachingSnapshot}`. This task only reads it. Same integration-wiring gate as Task 2 (tsc + suite + build); the pure logic it wires was fully tested in Task 1.

- [ ] **Step 1: Import the serializer + gate**

In `src/App.tsx`, near the other teaching imports (the `import { blockedElementNumbers } from './teaching/selectors';` line ~45, or the teaching-types import ~line 64), add:

```ts
import { serializeTeachingState, makeChangeGate } from './teaching/teachingState';
```

- [ ] **Step 2: Add the gate ref**

In `src/App.tsx`, immediately after the `instructionSnapshotRef` declaration from Task 2 (~line 562), add:

```ts
  // C2a: one change-gate for the component's lifetime, so the [TEACHING STATE] hint fires once per
  // teaching-state change, not once per frame (honors the R2 re-send-every-frame follow-up).
  const teachingHintGateRef = useRef(makeChangeGate());
```

- [ ] **Step 3: Add the deduped send effect**

In `src/App.tsx`, immediately after the spreadsheet-hint effect (the one ending `}, [isLive, activeProgram, mockDoc]);` below `// Send the live structured spreadsheet data`, ~line 2369), add:

```ts
  // C2a: send the structured [TEACHING STATE] hint alongside the overlay pixels (learnings §4:
  // never labels-only). Deduped via the change-gate; null (no active sequence) resets it so the
  // next sequence re-sends. Silent context — the hint tells the model not to acknowledge.
  useEffect(() => {
    if (!isLive) return;
    const hint = teachingSnapshot ? serializeTeachingState(teachingSnapshot, entities) : null;
    if (teachingHintGateRef.current(hint) && hint) {
      providerRef.current?.sendTextHint(hint);
    }
  }, [isLive, teachingSnapshot, entities]);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 6: Verify the build**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(vision): deduped [TEACHING STATE] hint — the model reads its teaching state, not OCRs it"
```

---

## Human smoke (owed — needs an API key; not a task)

Run `?teach=1` alongside a live session and confirm:
1. The numbered step rings / relate arc appear in the model's vision frame (inspect a sent frame, or ask the model to describe what it sees on the surface).
2. A `[TEACHING STATE]` hint arrives naming the active step and blocked set.
3. Advancing a step changes the hint **once**, not every frame.
4. Forcing an `html-to-image` failure degrades the frame to the bare surface with no phantom marks.

This is the honest test boundary — pixel compositing + live send are live-only, consistent with prior sub-projects' owed smokes.
