# Ramble-Fill Foundation (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agent-free foundation of the ramble-fill mode — the state model, the pure event-reducer (with yield enforcement), the derived selectors, the scribe tool→event mapper, and the glanceable monitor — proven end-to-end with scripted events (no live agent).

**Architecture:** A pure `(state, event, now) → state` reducer owns `SessionState`; derived selectors compute the active slot, recency, and stall; React components render state as the glanceable monitor. A scripted-events demo plays a recorded event sequence through the reducer so the glance test is provable before the scribe exists. This is steps 1–4 of the spec's §10 build order; the scribe wiring (steps 5–7) is Plan 2.

**Tech Stack:** TypeScript, React 19, Vite, Tailwind v4, vitest (already configured from the F1 work).

## Global Constraints

- Branch: work on `honest-mode`. Verify `git branch --show-current` before each commit.
- Pure modules (`types.ts`, `rfiSchema.ts`, `sessionStore.ts`, `selectors.ts`, `scribeTools.ts`) must NOT call `Date.now()` — callers inject `now: number` / `today: string` (matches the existing `src/coherence.ts` convention).
- Reducer never throws: an event referencing an unknown `slotId` returns state unchanged.
- Yield is reducer-enforced: once a slot's `owner==='user'`, the reducer drops `slot.fillingStart` / `slot.valueUpdate` / `slot.draft` for it.
- Exactly one slot may be `filling` at a time (the `activeSlotId` anchor).
- Confidence overlay threshold `CONF_THRESHOLD = 0.6`; stall threshold `STALL_MS = 10_000`.
- Reuse the existing `VoiceTool` type from `src/voice/types.ts` for the scribe tool definitions. No new dependencies.
- This foundation mounts via a `?ramble=1` URL flag in `src/main.tsx` — it must NOT alter the existing point-and-speak App for the normal (no-flag) path.

---

## File Structure

- Create `src/ramble/types.ts` — `FormSchema`, `Slot`, `SlotFill`, `SessionState`, `RambleEvent` union, and the string-literal unions.
- Create `src/ramble/rfiSchema.ts` — the fixed `RFI_SCHEMA` + `initialSessionState`.
- Create `src/ramble/sessionStore.ts` — the pure `reduce(state, event, now)`.
- Create `src/ramble/selectors.ts` — `activeSlot`, `recentSlots`, `isStalled`, `STALL_MS`.
- Create `src/ramble/scribeTools.ts` — `SCRIBE_TOOLS` (data) + pure `toolCallToEvent`.
- Create `src/ramble/Monitor.tsx`, `src/ramble/SlotRow.tsx`, `src/ramble/LivenessIndicator.tsx` — the glanceable screen.
- Create `src/ramble/RambleDemo.tsx` — a scripted-event player driving the Monitor.
- Create `src/ramble/scriptedDemo.ts` — the recorded event sequence (shared by the demo and the test).
- Create test files alongside: `sessionStore.test.ts`, `selectors.test.ts`, `scribeTools.test.ts`, `rfiSchema.test.ts`, `scriptedDemo.test.ts`.
- Modify `src/main.tsx` — mount `<RambleDemo/>` when `location.search` contains `ramble`.

---

### Task 1: Types + RFI schema + initial state

**Files:**
- Create: `src/ramble/types.ts`, `src/ramble/rfiSchema.ts`, `src/ramble/rfiSchema.test.ts`

**Interfaces:**
- Produces: all the ramble types (below); `RFI_SCHEMA: FormSchema`; `initialSessionState(schema: FormSchema, today: string, now: number): SessionState`.

- [ ] **Step 1: Write the types**

Create `src/ramble/types.ts`:
```ts
export type SlotType = 'text' | 'shortText' | 'date' | 'number' | 'enum' | 'reference';

export interface Slot {
  id: string;
  label: string;
  type: SlotType;
  required: boolean;
  constraint?: string;
  order: number;
}

export interface FormSchema {
  formId: string;
  title: string;
  slots: Slot[];
  capturedAt: number;
}

export type SlotStatus = 'empty' | 'filling' | 'draft' | 'confirmed' | 'needsInput';
export type SlotSource = 'heard' | 'inferred' | 'asked' | 'userEdited';
export type SlotOwner = 'agent' | 'user';

export interface SlotFill {
  slotId: string;
  value: string | null;
  status: SlotStatus;
  confidence: number;            // 0..1
  source: SlotSource;
  owner: SlotOwner;              // once 'user', the agent never overwrites
  provenanceUtteranceIds?: string[];
  updatedAt: number;
  pendingQuestion?: string | null;  // set while status==='needsInput'
  prior?: SlotFill | null;          // snapshot taken on user.editStart, for cancel-revert
}

export type Phase = 'capturing' | 'conversing' | 'recapping' | 'awaitingConsent' | 'submitting' | 'done';
export type Activity = 'listening' | 'thinking' | 'filling' | 'asking' | 'readingBack' | 'idle' | 'stalled';

export interface SessionState {
  phase: Phase;
  activity: Activity;
  activeSlotId: string | null;
  lastUpdateAt: number;
  fills: SlotFill[];
}

export type RambleEvent =
  | { type: 'slot.fillingStart'; slotId: string }
  | { type: 'slot.valueUpdate'; slotId: string; partialValue: string }
  | { type: 'slot.draft'; slotId: string; value: string; confidence: number; source: SlotSource }
  | { type: 'slot.needsInput'; slotId: string; question: string }
  | { type: 'slot.confirmed'; slotId: string }
  | { type: 'activity.change'; activity: Activity }
  | { type: 'session.phaseChange'; phase: Phase }
  | { type: 'heartbeat' }
  | { type: 'user.editStart'; slotId: string }
  | { type: 'user.editCommit'; slotId: string; value: string }
  | { type: 'user.editCancel'; slotId: string }
  | { type: 'user.openFullEditor' };
```

- [ ] **Step 2: Write the failing test**

Create `src/ramble/rfiSchema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

describe('RFI_SCHEMA', () => {
  it('has 6 slots in order with the required ones marked', () => {
    expect(RFI_SCHEMA.slots.map(s => s.id)).toEqual([
      'question', 'location', 'drawingRef', 'neededBy', 'discipline', 'dateSubmitted',
    ]);
    expect(RFI_SCHEMA.slots.find(s => s.id === 'discipline')!.required).toBe(false);
    expect(RFI_SCHEMA.slots.find(s => s.id === 'question')!.required).toBe(true);
  });
});

describe('initialSessionState', () => {
  it('seeds every slot empty except dateSubmitted (inferred=today, draft)', () => {
    const st = initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);
    expect(st.phase).toBe('conversing');
    expect(st.activity).toBe('listening');
    expect(st.activeSlotId).toBeNull();
    const date = st.fills.find(f => f.slotId === 'dateSubmitted')!;
    expect(date).toMatchObject({ value: '6/29/2026', status: 'draft', source: 'inferred', confidence: 1, owner: 'agent' });
    const q = st.fills.find(f => f.slotId === 'question')!;
    expect(q).toMatchObject({ value: null, status: 'empty', source: 'heard', owner: 'agent' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/ramble/rfiSchema.test.ts`
Expected: FAIL — `Cannot find module './rfiSchema'`.

- [ ] **Step 4: Write the schema + initial state**

Create `src/ramble/rfiSchema.ts`:
```ts
import type { FormSchema, SessionState, SlotFill } from './types';

export const RFI_SCHEMA: FormSchema = {
  formId: 'rfi',
  title: 'RFI',
  capturedAt: 0,
  slots: [
    { id: 'question', label: 'Question', type: 'text', required: true, order: 0 },
    { id: 'location', label: 'Location / gridline', type: 'shortText', required: true, order: 1 },
    { id: 'drawingRef', label: 'Drawing ref', type: 'reference', required: true, order: 2 },
    { id: 'neededBy', label: 'Needed by', type: 'date', required: true, order: 3 },
    { id: 'discipline', label: 'Discipline', type: 'enum', required: false, constraint: 'Architectural|Structural|Mechanical|Electrical', order: 4 },
    { id: 'dateSubmitted', label: 'Date', type: 'date', required: true, order: 5 },
  ],
};

/** Build the starting session. `today` and `now` are injected (pure). */
export function initialSessionState(schema: FormSchema, today: string, now: number): SessionState {
  const fills: SlotFill[] = schema.slots.map((s) =>
    s.id === 'dateSubmitted'
      ? { slotId: s.id, value: today, status: 'draft', confidence: 1, source: 'inferred', owner: 'agent', updatedAt: now }
      : { slotId: s.id, value: null, status: 'empty', confidence: 0, source: 'heard', owner: 'agent', updatedAt: now },
  );
  return { phase: 'conversing', activity: 'listening', activeSlotId: null, lastUpdateAt: now, fills };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/ramble/rfiSchema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ramble/types.ts src/ramble/rfiSchema.ts src/ramble/rfiSchema.test.ts
git commit -m "feat(ramble): types + fixed RFI schema + initial session state"
```

---

### Task 2: Reducer — agent→UI transitions

**Files:**
- Create: `src/ramble/sessionStore.ts`, `src/ramble/sessionStore.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `RambleEvent`, `SlotFill` from `./types`; `RFI_SCHEMA`, `initialSessionState` from `./rfiSchema`.
- Produces: `reduce(state: SessionState, event: RambleEvent, now: number): SessionState`.

- [ ] **Step 1: Write the failing test**

Create `src/ramble/sessionStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

const start = () => initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);
const slot = (st: any, id: string) => st.fills.find((f: any) => f.slotId === id);

describe('reduce — agent→UI transitions', () => {
  it('fillingStart sets the single active anchor', () => {
    const st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    expect(st.activeSlotId).toBe('question');
    expect(slot(st, 'question').status).toBe('filling');
    expect(st.activity).toBe('filling');
    expect(st.lastUpdateAt).toBe(2000);
  });

  it('valueUpdate streams text into the slot', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    st = reduce(st, { type: 'slot.valueUpdate', slotId: 'question', partialValue: 'S-301 beam' }, 2100);
    expect(slot(st, 'question').value).toBe('S-301 beam');
    expect(st.lastUpdateAt).toBe(2100);
  });

  it('draft releases the anchor and records confidence + source', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2200);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: 'draft', confidence: 0.9, source: 'heard' });
    expect(st.activeSlotId).toBeNull();
  });

  it('needsInput stashes the question and sets asking', () => {
    const st = reduce(start(), { type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' }, 3000);
    expect(slot(st, 'neededBy')).toMatchObject({ status: 'needsInput', pendingQuestion: 'by when?' });
    expect(st.activity).toBe('asking');
  });

  it('confirmed settles a slot', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2200);
    st = reduce(st, { type: 'slot.confirmed', slotId: 'location' }, 2300);
    expect(slot(st, 'location').status).toBe('confirmed');
  });

  it('phaseChange and heartbeat behave', () => {
    let st = reduce(start(), { type: 'session.phaseChange', phase: 'recapping' }, 4000);
    expect(st.phase).toBe('recapping');
    st = reduce(st, { type: 'heartbeat' }, 4500);
    expect(st.lastUpdateAt).toBe(4500);
  });

  it('ignores events for an unknown slot (no throw)', () => {
    const before = start();
    const after = reduce(before, { type: 'slot.draft', slotId: 'nope', value: 'x', confidence: 1, source: 'heard' }, 2000);
    expect(after.fills).toEqual(before.fills);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ramble/sessionStore.test.ts`
Expected: FAIL — `Cannot find module './sessionStore'`.

- [ ] **Step 3: Write the reducer (transitions only; yield/edit added in Task 3)**

Create `src/ramble/sessionStore.ts`:
```ts
import type { SessionState, SlotFill, RambleEvent } from './types';

function hasSlot(state: SessionState, slotId: string): boolean {
  return state.fills.some((f) => f.slotId === slotId);
}

function ownerOf(state: SessionState, slotId: string): SlotFill['owner'] | undefined {
  return state.fills.find((f) => f.slotId === slotId)?.owner;
}

function patchSlot(state: SessionState, slotId: string, patch: Partial<SlotFill>, now: number): SessionState {
  return {
    ...state,
    fills: state.fills.map((f) => (f.slotId === slotId ? { ...f, ...patch, updatedAt: now } : f)),
  };
}

export function reduce(state: SessionState, event: RambleEvent, now: number): SessionState {
  switch (event.type) {
    case 'slot.fillingStart': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      const s = patchSlot(state, event.slotId, { status: 'filling' }, now);
      return { ...s, activeSlotId: event.slotId, activity: 'filling', lastUpdateAt: now };
    }
    case 'slot.valueUpdate': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { value: event.partialValue }, now), lastUpdateAt: now };
    }
    case 'slot.draft': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      const s = patchSlot(state, event.slotId, { value: event.value, status: 'draft', confidence: event.confidence, source: event.source }, now);
      const activeSlotId = state.activeSlotId === event.slotId ? null : state.activeSlotId;
      return { ...s, activeSlotId, activity: 'thinking', lastUpdateAt: now };
    }
    case 'slot.needsInput': {
      if (!hasSlot(state, event.slotId)) return state;
      return { ...patchSlot(state, event.slotId, { status: 'needsInput', pendingQuestion: event.question }, now), activity: 'asking', lastUpdateAt: now };
    }
    case 'slot.confirmed': {
      if (!hasSlot(state, event.slotId)) return state;
      return { ...patchSlot(state, event.slotId, { status: 'confirmed' }, now), lastUpdateAt: now };
    }
    case 'activity.change':
      return { ...state, activity: event.activity, lastUpdateAt: now };
    case 'session.phaseChange':
      return { ...state, phase: event.phase };
    case 'heartbeat':
      return { ...state, lastUpdateAt: now };
    default:
      return state; // user.* handled in Task 3; unknown events are no-ops
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ramble/sessionStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ramble/sessionStore.ts src/ramble/sessionStore.test.ts
git commit -m "feat(ramble): pure reducer — agent→UI transitions"
```

---

### Task 3: Reducer — yield enforcement, edit commit/cancel

**Files:**
- Modify: `src/ramble/sessionStore.ts`
- Modify: `src/ramble/sessionStore.test.ts`

**Interfaces:**
- Consumes/Produces: extends `reduce` to handle `user.editStart` / `user.editCommit` / `user.editCancel` / `user.openFullEditor`, and proves the yield rule.

- [ ] **Step 1: Add the failing tests**

Append to `src/ramble/sessionStore.test.ts`:
```ts
describe('reduce — yield + edits', () => {
  it('editStart takes ownership and clears the anchor if it was filling', () => {
    let st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'question' }, 2100);
    expect(slot(st, 'question').owner).toBe('user');
    expect(st.activeSlotId).toBeNull();
  });

  it('agent CANNOT overwrite a user-owned slot (yield)', () => {
    let st = reduce(start(), { type: 'user.editStart', slotId: 'location' }, 2000);
    const before = slot(st, 'location');
    st = reduce(st, { type: 'slot.draft', slotId: 'location', value: 'WRONG', confidence: 1, source: 'heard' }, 2100);
    st = reduce(st, { type: 'slot.fillingStart', slotId: 'location' }, 2150);
    st = reduce(st, { type: 'slot.valueUpdate', slotId: 'location', partialValue: 'WRONG2' }, 2200);
    expect(slot(st, 'location')).toEqual(before); // unchanged
  });

  it('editCommit sets userEdited + confirmed + user-owned', () => {
    let st = reduce(start(), { type: 'user.editStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'user.editCommit', slotId: 'location', value: 'C-3' }, 2100);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: 'confirmed', source: 'userEdited', owner: 'user' });
  });

  it('editCancel reverts to the pre-edit snapshot and returns ownership to the agent', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 1500);
    const draft = slot(st, 'location');
    st = reduce(st, { type: 'user.editStart', slotId: 'location' }, 2000);
    st = reduce(st, { type: 'user.editCancel', slotId: 'location' }, 2100);
    expect(slot(st, 'location')).toMatchObject({ value: 'C-3', status: draft.status, source: 'heard', owner: 'agent' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ramble/sessionStore.test.ts`
Expected: FAIL — yield/edit cases fail (the `default` branch no-ops `user.*`).

- [ ] **Step 3: Replace the `default` branch with the edit handlers**

In `src/ramble/sessionStore.ts`, replace the single `default:` case with:
```ts
    case 'user.editStart': {
      const cur = state.fills.find((f) => f.slotId === event.slotId);
      if (!cur) return state;
      const s = patchSlot(state, event.slotId, { owner: 'user', prior: { ...cur } }, now);
      const activeSlotId = state.activeSlotId === event.slotId ? null : state.activeSlotId;
      return { ...s, activeSlotId };
    }
    case 'user.editCommit':
      if (!hasSlot(state, event.slotId)) return state;
      return patchSlot(state, event.slotId, { value: event.value, status: 'confirmed', source: 'userEdited', owner: 'user', prior: null }, now);
    case 'user.editCancel': {
      const cur = state.fills.find((f) => f.slotId === event.slotId);
      if (!cur || !cur.prior) return state;
      const prior = cur.prior;
      return { ...state, fills: state.fills.map((f) => (f.slotId === event.slotId ? { ...prior, owner: 'agent', prior: null } : f)) };
    }
    case 'user.openFullEditor':
      return state; // navigation handled by the app shell
    default:
      return state;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ramble/sessionStore.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ramble/sessionStore.ts src/ramble/sessionStore.test.ts
git commit -m "feat(ramble): reducer-enforced yield + edit commit/cancel"
```

---

### Task 4: Derived selectors

**Files:**
- Create: `src/ramble/selectors.ts`, `src/ramble/selectors.test.ts`

**Interfaces:**
- Consumes: `SessionState`, `SlotFill`.
- Produces: `STALL_MS: number`; `activeSlot(state): SlotFill | null`; `recentSlots(state, n?): SlotFill[]`; `isStalled(state, now): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/ramble/selectors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { activeSlot, recentSlots, isStalled, STALL_MS } from './selectors';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';

const start = () => initialSessionState(RFI_SCHEMA, '6/29/2026', 1000);

describe('selectors', () => {
  it('activeSlot returns the filling slot or null', () => {
    expect(activeSlot(start())).toBeNull();
    const st = reduce(start(), { type: 'slot.fillingStart', slotId: 'question' }, 2000);
    expect(activeSlot(st)!.slotId).toBe('question');
  });

  it('recentSlots returns the last n updated non-empty slots, excluding the active one', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 1, source: 'heard' }, 2000);
    st = reduce(st, { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 1, source: 'heard' }, 2100);
    st = reduce(st, { type: 'slot.fillingStart', slotId: 'question' }, 2200);
    const recent = recentSlots(st, 2).map(s => s.slotId);
    expect(recent).toEqual(['drawingRef', 'location']); // newest first, active 'question' excluded
  });

  it('isStalled only when conversing and past the threshold', () => {
    const st = start(); // lastUpdateAt = 1000, phase conversing
    expect(isStalled(st, 1000 + STALL_MS)).toBe(false);     // exactly at threshold, not past
    expect(isStalled(st, 1000 + STALL_MS + 1)).toBe(true);  // past
    const done = reduce(st, { type: 'session.phaseChange', phase: 'done' }, 1000);
    expect(isStalled(done, 1000 + STALL_MS + 5000)).toBe(false); // not conversing → never stalled
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ramble/selectors.test.ts`
Expected: FAIL — `Cannot find module './selectors'`.

- [ ] **Step 3: Write the selectors**

Create `src/ramble/selectors.ts`:
```ts
import type { SessionState, SlotFill } from './types';

export const STALL_MS = 10_000;

export function activeSlot(state: SessionState): SlotFill | null {
  return state.fills.find((f) => f.slotId === state.activeSlotId) ?? null;
}

export function recentSlots(state: SessionState, n = 2): SlotFill[] {
  return state.fills
    .filter((f) => f.slotId !== state.activeSlotId && f.status !== 'empty')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, n);
}

export function isStalled(state: SessionState, now: number): boolean {
  return state.phase === 'conversing' && now - state.lastUpdateAt > STALL_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ramble/selectors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ramble/selectors.ts src/ramble/selectors.test.ts
git commit -m "feat(ramble): derived selectors (active/recent/stall)"
```

---

### Task 5: Scribe tools + tool→event mapper

**Files:**
- Create: `src/ramble/scribeTools.ts`, `src/ramble/scribeTools.test.ts`

**Interfaces:**
- Consumes: `VoiceTool` from `../voice/types`; `RambleEvent`, `SlotSource` from `./types`.
- Produces: `SCRIBE_TOOLS: VoiceTool[]`; `toolCallToEvent(call: { name: string; args: any }): RambleEvent | null`.

- [ ] **Step 1: Write the failing test**

Create `src/ramble/scribeTools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SCRIBE_TOOLS, toolCallToEvent } from './scribeTools';

describe('SCRIBE_TOOLS', () => {
  it('declares the five scribe tools', () => {
    expect(SCRIBE_TOOLS.map(t => t.name).sort()).toEqual(
      ['ask_gap', 'confirm_slot', 'fill_slot', 'recap', 'submit'],
    );
  });
});

describe('toolCallToEvent', () => {
  it('maps fill_slot → slot.draft with coerced fields', () => {
    const ev = toolCallToEvent({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' } });
    expect(ev).toEqual({ type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' });
  });

  it('maps ask_gap → slot.needsInput', () => {
    expect(toolCallToEvent({ name: 'ask_gap', args: { slotId: 'neededBy', question: 'by when?' } }))
      .toEqual({ type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' });
  });

  it('maps confirm_slot, recap, submit', () => {
    expect(toolCallToEvent({ name: 'confirm_slot', args: { slotId: 'location' } }))
      .toEqual({ type: 'slot.confirmed', slotId: 'location' });
    expect(toolCallToEvent({ name: 'recap', args: {} })).toEqual({ type: 'session.phaseChange', phase: 'recapping' });
    expect(toolCallToEvent({ name: 'submit', args: {} })).toEqual({ type: 'session.phaseChange', phase: 'awaitingConsent' });
  });

  it('returns null for an unknown tool', () => {
    expect(toolCallToEvent({ name: 'nope', args: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ramble/scribeTools.test.ts`
Expected: FAIL — `Cannot find module './scribeTools'`.

- [ ] **Step 3: Write the tools + mapper**

Create `src/ramble/scribeTools.ts`:
```ts
import type { VoiceTool } from '../voice/types';
import type { RambleEvent, SlotSource } from './types';

export const SCRIBE_TOOLS: VoiceTool[] = [
  {
    name: 'fill_slot',
    description: 'Provisionally fill one form field from what the user said. Use only for genuine content, not asides. Provide your confidence (0..1) and the source.',
    parameters: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'The field id, e.g. "question", "location", "drawingRef", "neededBy", "discipline".' },
        value: { type: 'string', description: 'The value to fill.' },
        confidence: { type: 'number', description: '0..1 — how sure you are this is right.' },
        source: { type: 'string', enum: ['heard', 'inferred', 'asked'], description: 'heard=said directly; inferred=you derived it; asked=answer to a gap question.' },
      },
      required: ['slotId', 'value', 'confidence', 'source'],
    },
  },
  {
    name: 'ask_gap',
    description: 'Ask the user ONE conversational question to fill a missing required field. Ask only when genuinely ambiguous or empty.',
    parameters: {
      type: 'object',
      properties: {
        slotId: { type: 'string', description: 'The field the question is about.' },
        question: { type: 'string', description: 'The short spoken question.' },
      },
      required: ['slotId', 'question'],
    },
  },
  {
    name: 'confirm_slot',
    description: 'Mark a field confirmed after you read it back and the user accepted it.',
    parameters: { type: 'object', properties: { slotId: { type: 'string' } }, required: ['slotId'] },
  },
  {
    name: 'recap',
    description: 'Begin the full recap: voice the whole form and explicitly flag every inferred field before submitting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'submit',
    description: 'Request submission of the completed form. This is a high-consequence action and will require explicit user consent.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

/** Pure 1:1 mapping from a scribe tool call to a reducer event. Returns null for unknown tools. */
export function toolCallToEvent(call: { name: string; args: any }): RambleEvent | null {
  const a = call.args ?? {};
  switch (call.name) {
    case 'fill_slot':
      return { type: 'slot.draft', slotId: String(a.slotId), value: String(a.value ?? ''), confidence: Number(a.confidence ?? 0.5), source: (a.source ?? 'heard') as SlotSource };
    case 'ask_gap':
      return { type: 'slot.needsInput', slotId: String(a.slotId), question: String(a.question ?? '') };
    case 'confirm_slot':
      return { type: 'slot.confirmed', slotId: String(a.slotId) };
    case 'recap':
      return { type: 'session.phaseChange', phase: 'recapping' };
    case 'submit':
      return { type: 'session.phaseChange', phase: 'awaitingConsent' };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ramble/scribeTools.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ramble/scribeTools.ts src/ramble/scribeTools.test.ts
git commit -m "feat(ramble): scribe tool definitions + pure tool→event mapper"
```

---

### Task 6: The glanceable monitor + scripted-events demo

**Files:**
- Create: `src/ramble/LivenessIndicator.tsx`, `src/ramble/SlotRow.tsx`, `src/ramble/Monitor.tsx`, `src/ramble/scriptedDemo.ts`, `src/ramble/RambleDemo.tsx`, `src/ramble/scriptedDemo.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `<Monitor schema, state, now, onEditStart, onEditCommit, onEditCancel>`; `SCRIPTED_DEMO: RambleEvent[]`; `<RambleDemo/>`.

- [ ] **Step 1: Write the LivenessIndicator**

Create `src/ramble/LivenessIndicator.tsx`:
```tsx
import type { SessionState } from './types';
import { isStalled } from './selectors';

const DOT: Record<string, string> = {
  listening: 'bg-emerald-500', filling: 'bg-blue-500', asking: 'bg-amber-400',
  thinking: 'bg-blue-400', readingBack: 'bg-violet-500', idle: 'bg-slate-400', stalled: 'bg-red-500',
};

export function LivenessIndicator({ state, now }: { state: SessionState; now: number }) {
  const stalled = isStalled(state, now);
  const activity = stalled ? 'stalled' : state.activity;
  const secs = Math.round((now - state.lastUpdateAt) / 1000);
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[activity] ?? 'bg-slate-400'} ${activity === 'filling' || activity === 'asking' ? 'animate-pulse' : ''}`} />
      <span className={stalled ? 'text-red-600 font-semibold' : 'text-slate-500'}>
        {stalled ? `no update ${secs}s` : activity}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Write the SlotRow**

Create `src/ramble/SlotRow.tsx`:
```tsx
import { useState } from 'react';
import type { Slot, SlotFill } from './types';

const CONF_THRESHOLD = 0.6;

const BASE: Record<string, string> = {
  empty: 'opacity-40',
  filling: 'bg-blue-50 ring-1 ring-blue-300',
  draft: 'bg-amber-50/40',
  confirmed: '',
  needsInput: 'bg-amber-50/60',
};

export function SlotRow({
  slot, fill, isActive, onEditStart, onEditCommit, onEditCancel,
}: {
  slot: Slot; fill: SlotFill; isActive: boolean;
  onEditStart: (id: string) => void;
  onEditCommit: (id: string, value: string) => void;
  onEditCancel: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const uncertain = fill.source === 'inferred' || (fill.value != null && fill.confidence < CONF_THRESHOLD);
  const owned = fill.owner === 'user';

  const begin = () => { setDraft(fill.value ?? ''); setEditing(true); onEditStart(slot.id); };
  const commit = () => { setEditing(false); onEditCommit(slot.id, draft); };
  const cancel = () => { setEditing(false); onEditCancel(slot.id); };

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-md ${BASE[fill.status] ?? ''} ${isActive ? 'animate-pulse' : ''}`}>
      <div className="w-32 shrink-0 text-xs text-slate-500">{slot.label}</div>
      <div className="flex-1 font-mono text-sm">
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
            onBlur={commit}
            className="w-full border border-blue-400 rounded px-1 py-0.5"
          />
        ) : (
          <button className="text-left w-full" onClick={begin}>
            {fill.status === 'needsInput'
              ? <span className="text-amber-600">asking… “{fill.pendingQuestion}”</span>
              : (fill.value ?? <span className="text-slate-300">·</span>)}
          </button>
        )}
      </div>
      {uncertain && <span title="inferred / low confidence" className="text-amber-500 text-xs">✓?</span>}
      {owned && <span title="yours — agent won’t overwrite" className="text-blue-600 text-[10px] font-semibold">yours</span>}
    </div>
  );
}
```

- [ ] **Step 3: Write the Monitor**

Create `src/ramble/Monitor.tsx`:
```tsx
import type { FormSchema, SessionState } from './types';
import { LivenessIndicator } from './LivenessIndicator';
import { SlotRow } from './SlotRow';

export function Monitor({
  schema, state, now, onEditStart, onEditCommit, onEditCancel, onOpenFullEditor,
}: {
  schema: FormSchema; state: SessionState; now: number;
  onEditStart: (id: string) => void;
  onEditCommit: (id: string, value: string) => void;
  onEditCancel: (id: string) => void;
  onOpenFullEditor: () => void;
}) {
  const slots = [...schema.slots].sort((a, b) => a.order - b.order);
  return (
    <div className="max-w-md mx-auto mt-10 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold">{schema.title}</h2>
        <LivenessIndicator state={state} now={now} />
      </div>
      <div className="py-2">
        {slots.map((slot) => {
          const fill = state.fills.find((f) => f.slotId === slot.id)!;
          return (
            <SlotRow
              key={slot.id} slot={slot} fill={fill}
              isActive={state.activeSlotId === slot.id}
              onEditStart={onEditStart} onEditCommit={onEditCommit} onEditCancel={onEditCancel}
            />
          );
        })}
      </div>
      <div className="px-4 py-2 border-t border-slate-100 text-right">
        <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={onOpenFullEditor}>open full editor</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the scripted demo sequence**

Create `src/ramble/scriptedDemo.ts`:
```ts
import type { RambleEvent } from './types';

/** A recorded ramble: fills three slots, asks a gap, then recaps. Drives the demo and the test. */
export const SCRIPTED_DEMO: RambleEvent[] = [
  { type: 'slot.fillingStart', slotId: 'question' },
  { type: 'slot.valueUpdate', slotId: 'question', partialValue: 'S-301 beam conflicts with A-502' },
  { type: 'slot.draft', slotId: 'question', value: 'S-301 beam conflicts with A-502 ceiling height', confidence: 0.9, source: 'heard' },
  { type: 'slot.fillingStart', slotId: 'location' },
  { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.95, source: 'heard' },
  { type: 'slot.fillingStart', slotId: 'drawingRef' },
  { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 0.5, source: 'inferred' },
  { type: 'slot.needsInput', slotId: 'neededBy', question: 'by when do you need an answer?' },
  { type: 'activity.change', activity: 'readingBack' },
  { type: 'session.phaseChange', phase: 'recapping' },
];
```

- [ ] **Step 5: Write the scripted-events test (proves state→view-model)**

Create `src/ramble/scriptedDemo.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SCRIPTED_DEMO } from './scriptedDemo';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { recentSlots } from './selectors';

describe('scripted demo', () => {
  it('drives the store to the expected recap state', () => {
    let st = initialSessionState(RFI_SCHEMA, '6/29/2026', 0);
    let now = 0;
    for (const ev of SCRIPTED_DEMO) { now += 100; st = reduce(st, ev, now); }

    expect(st.phase).toBe('recapping');
    const byId = (id: string) => st.fills.find(f => f.slotId === id)!;
    expect(byId('question').status).toBe('draft');
    expect(byId('location').value).toBe('C-3');
    expect(byId('drawingRef').source).toBe('inferred');      // will show a ✓? marker
    expect(byId('neededBy').status).toBe('needsInput');
    expect(byId('dateSubmitted').source).toBe('inferred');   // seeded inferred
    // recency excludes empty slots and is newest-first
    expect(recentSlots(st, 2).every(s => s.status !== 'empty')).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/ramble/scriptedDemo.test.ts`
Expected: PASS (1 test). (Implementation already exists from Tasks 1–4; this verifies the recorded sequence.)

- [ ] **Step 7: Write the RambleDemo player**

Create `src/ramble/RambleDemo.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { reduce } from './sessionStore';
import { SCRIPTED_DEMO } from './scriptedDemo';
import type { SessionState } from './types';
import { Monitor } from './Monitor';

export function RambleDemo() {
  const [state, setState] = useState<SessionState>(() => initialSessionState(RFI_SCHEMA, '6/29/2026', Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const step = useRef(0);

  // Tick "now" so the liveness/stall readout is live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Play the scripted sequence, one event every 1.2s.
  useEffect(() => {
    const t = setInterval(() => {
      if (step.current >= SCRIPTED_DEMO.length) { clearInterval(t); return; }
      const ev = SCRIPTED_DEMO[step.current++];
      setState((s) => reduce(s, ev, Date.now()));
    }, 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <Monitor
      schema={RFI_SCHEMA} state={state} now={now}
      onEditStart={(id) => setState((s) => reduce(s, { type: 'user.editStart', slotId: id }, Date.now()))}
      onEditCommit={(id, value) => setState((s) => reduce(s, { type: 'user.editCommit', slotId: id, value }, Date.now()))}
      onEditCancel={(id) => setState((s) => reduce(s, { type: 'user.editCancel', slotId: id }, Date.now()))}
      onOpenFullEditor={() => { /* Plan 2: navigate to the edit pass */ }}
    />
  );
}
```

- [ ] **Step 8: Mount it behind the `?ramble=1` flag**

In `src/main.tsx`, find where `<App />` is rendered (e.g. `root.render(<App />)` or a `createRoot(...).render(...)`). Gate it:
```tsx
import { RambleDemo } from './ramble/RambleDemo';
// ...
const useRamble = typeof window !== 'undefined' && window.location.search.includes('ramble');
root.render(useRamble ? <RambleDemo /> : <App />);
```
(Match the existing render call's surrounding `StrictMode`/providers — only swap the rendered element, do not change the existing App path for the no-flag case.)

- [ ] **Step 9: Typecheck, build, run the full suite**

Run: `npm run lint && npm run build && npm test`
Expected: all pass; the test suite includes the new ramble tests plus the pre-existing F1 tests.

- [ ] **Step 10: Manual glance check (record evidence)**

Run `npm run dev`, open the app with `?ramble=1` in the URL. Confirm the **glance test**: within a second and without reading, you can tell it's alive (liveness dot + activity), where it is (the pulsing active slot), roughly how far (calm-vs-faint rows), and which to worry about (the `✓?` markers on `drawingRef` + `Date`). Tap a field → it becomes editable, shows "yours", and the demo can no longer overwrite it. Let the demo idle past 10s → liveness flips to a distinct "no update Ns" stalled state.

- [ ] **Step 11: Commit**

```bash
git add src/ramble/LivenessIndicator.tsx src/ramble/SlotRow.tsx src/ramble/Monitor.tsx src/ramble/scriptedDemo.ts src/ramble/RambleDemo.tsx src/ramble/scriptedDemo.test.ts src/main.tsx
git commit -m "feat(ramble): glanceable monitor + scripted-events demo (?ramble=1)"
```

---

## Self-Review notes

- **Spec coverage (foundation = spec §10 steps 1–4):** state model (Task 1), reducer + yield (Tasks 2–3), selectors incl. stall (Task 4), tool→event mapper (Task 5), monitor with per-field states/overlays + liveness + recency + yield UI + scripted demo (Task 6). Deferred to **Plan 2**: wiring the scribe onto `VoiceProvider`, recap voicing, the `witness_render` consent gate, telemetry extension, and the real edit pass — all explicitly out of this plan.
- **Glance test:** Task 6 Step 10 is the spec's acceptance test, run manually (the per-field view-model is unit-asserted in Step 5).
- **Yield (the #1 trust rule):** enforced in the pure reducer (Task 3) and proven by the "agent CANNOT overwrite a user-owned slot" test.
- **No `Date.now()` in pure modules:** all pure modules take injected `now`/`today`; only `RambleDemo.tsx` (a component) reads the clock.
- **Type consistency:** `RambleEvent`, `SlotFill`, `SessionState`, `reduce`, `activeSlot`/`recentSlots`/`isStalled`, `toolCallToEvent`, `SCRIBE_TOOLS`, `Monitor` props are used identically across tasks.
```
