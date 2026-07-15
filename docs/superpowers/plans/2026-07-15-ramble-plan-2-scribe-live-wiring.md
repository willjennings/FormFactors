# Ramble Plan 2 (Scribe Live Wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the ramble-fill scribe onto the live `VoiceProvider` — spec §10 steps 5–7 of `docs/superpowers/specs/2026-06-29-ramble-fill-monitor-design.md` — plus close the two debts logged against Plan 1 (the yield-guard asymmetry and the component-level yield test).

**Architecture:** Plan 1 landed the pure foundation (types, `rfiSchema`, `sessionStore` reducer, selectors, `Monitor`/`SlotRow`/`LivenessIndicator`, `SCRIBE_TOOLS`, scripted demo at `?ramble=1`). Plan 2 adds: (1) the two missing `owner==='user'` reducer guards; (2) a schema-aware `scribeCallToEvents` mapper (honest errors-as-data, `fillingStart→draft` pairing); (3) the scribe system prompt; (4) ramble telemetry events; (5) a new `RambleLive.tsx` container owning its own provider session + consent card + telemetry/earcon wiring; (6) routing (`?ramble=live`) and a MenuBar mode-switch button. The mode switch is a **navigation boundary**, not in-place App state: App and RambleLive never share a live session, so App.tsx needs no ramble gates — this honors spec §2.4 ("mode switch… points the VoiceProvider at the scribe prompt + tools") with the reconnect the spec implies, while reusing (per §2.2) the same `VoiceProvider` factories, earcons, telemetry, and the witnessed-consent pattern.

**Tech Stack:** React 19 + TypeScript, vitest (node env — no DOM/component tests in this repo), the existing `src/voice/*` provider factories, `src/feedback/earcons`, `src/telemetry.ts`, `src/coherence.ts` (G9 `CallDeduper`).

## Global Constraints

- **No progress bar/counter on the monitor** (spec §5.5 / memory rule): the recede-to-faint ratio IS the "how far" signal. Do not add one anywhere, including the prompt ("do not narrate progress").
- **Yield is reducer-enforced AND hinted** (spec §4.3 + §6.2 defense in depth): `owner==='user'` is sticky; the hint is advisory only.
- **Submit is unconditionally witnessed** (spec §6.3): no autonomy level auto-commits it; `decideCommit` is NOT consulted (bypassed, not extended).
- **Consent declined → stays `awaitingConsent`, nothing submitted** (spec §8).
- **Errors are data** (house rule, teach precedent): a bad scribe call returns `{ success:false, error }` naming what's valid; never pretend a fill happened.
- **The model's voice is reserved for**: gap questions, incremental read-back, and the recap (spec §6.1). Recap-before-submit is mandatory and flags every `inferred` field.
- Tests: `npx vitest run <file>`; full gate: `npx tsc --noEmit && npm test`. TDD every pure change; App/JSX wiring is verified by tsc + full suite + build (repo convention — no DOM harness).
- Commit style: `feat(ramble): …` / `fix(ramble): …` + the repo's Co-Authored-By/Claude-Session trailers.

---

### Task 1: Yield guards — `slot.needsInput` / `slot.confirmed` respect user ownership (+ the scripted yield harness)

Plan 1's reducer guards `fillingStart`/`valueUpdate`/`draft` but NOT `needsInput`/`confirmed` — the agent can still flip a user-owned slot's status (logged asymmetry). Close it, then prove the whole yield contract with a scripted end-to-end harness (the "component-level yield test, no @testing-library": the state entry a `SlotRow` renders IS its props, so asserting the fill after a scripted barrage is asserting the screen).

**Files:**
- Modify: `src/ramble/sessionStore.ts:35-42`
- Test: `src/ramble/sessionStore.test.ts` (append), Create: `src/ramble/yieldHarness.test.ts`

**Interfaces:**
- Consumes: `reduce(state, event, now)` from `./sessionStore`, `RFI_SCHEMA`/`initialSessionState` from `./rfiSchema`.
- Produces: no new API — stricter reducer semantics later tasks rely on (RambleLive dispatches agent events blindly; the reducer is the yield authority).

- [ ] **Step 1: Write the failing tests** — append to `src/ramble/sessionStore.test.ts` (it already defines `start()` and `slot()` helpers at the top):

```ts
describe('yield guards — agent events cannot touch a user-owned slot (Plan 2)', () => {
  const userOwned = () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.9, source: 'heard' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'location' }, 2100);
    return reduce(st, { type: 'user.editCommit', slotId: 'location', value: 'C-9' }, 2200);
  };
  it('drops slot.needsInput on a user-owned slot (no status flip, no asking activity)', () => {
    const after = reduce(userOwned(), { type: 'slot.needsInput', slotId: 'location', question: 'where exactly?' }, 2300);
    expect(slot(after, 'location')).toMatchObject({ value: 'C-9', status: 'confirmed', owner: 'user' });
    expect(after.activity).not.toBe('asking');
  });
  it('drops slot.confirmed on a user-owned slot mid-edit (status stays the pre-edit snapshot)', () => {
    let st = reduce(start(), { type: 'slot.draft', slotId: 'drawingRef', value: 'S-301', confidence: 0.4, source: 'heard' }, 2000);
    st = reduce(st, { type: 'user.editStart', slotId: 'drawingRef' }, 2100); // owner=user, still 'draft'
    const after = reduce(st, { type: 'slot.confirmed', slotId: 'drawingRef' }, 2200);
    expect(slot(after, 'drawingRef')).toMatchObject({ status: 'draft', owner: 'user' });
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run src/ramble/sessionStore.test.ts`
Expected: 2 FAIL — `needsInput` flips status to `'needsInput'`/activity `'asking'`; `confirmed` flips status to `'confirmed'`.

- [ ] **Step 3: Minimal implementation** — in `src/ramble/sessionStore.ts`, add the owner guard to both cases (mirroring the guard already on `slot.draft`):

```ts
    case 'slot.needsInput': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { status: 'needsInput', pendingQuestion: event.question }, now), activity: 'asking', lastUpdateAt: now };
    }
    case 'slot.confirmed': {
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
      return { ...patchSlot(state, event.slotId, { status: 'confirmed' }, now), lastUpdateAt: now };
    }
```

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/ramble/sessionStore.test.ts` → all pass.

- [ ] **Step 5: Write the failing yield-harness test** — create `src/ramble/yieldHarness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduce } from './sessionStore';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import type { RambleEvent, SessionState } from './types';

// Component-level yield proof, scripted (spec §9: "prove the glance with mocked events").
// The fill entry in SessionState IS the SlotRow's props — asserting it asserts the screen.
const play = (events: RambleEvent[], from?: SessionState) =>
  events.reduce((st, ev, i) => reduce(st, ev, 1000 + i * 100), from ?? initialSessionState(RFI_SCHEMA, '7/15/2026', 1000));

describe('yield harness — user edit mid-ramble survives an agent barrage', () => {
  it('after the user takes location, every later agent event on it is a no-op on screen', () => {
    const st = play([
      { type: 'slot.fillingStart', slotId: 'question' },
      { type: 'slot.draft', slotId: 'question', value: 'Beam conflicts with duct', confidence: 0.8, source: 'heard' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.7, source: 'heard' },
      { type: 'user.editStart', slotId: 'location' },
      { type: 'user.editCommit', slotId: 'location', value: 'C-9 (north wall)' },
      // the barrage — every agent event type that targets a slot:
      { type: 'slot.fillingStart', slotId: 'location' },
      { type: 'slot.valueUpdate', slotId: 'location', partialValue: 'C-3' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.99, source: 'heard' },
      { type: 'slot.needsInput', slotId: 'location', question: 'which gridline?' },
      { type: 'slot.confirmed', slotId: 'location' },
    ]);
    const loc = st.fills.find((f) => f.slotId === 'location')!;
    expect(loc).toMatchObject({ value: 'C-9 (north wall)', status: 'confirmed', owner: 'user', source: 'userEdited' });
    expect(st.activeSlotId).not.toBe('location'); // never became the anchor again
  });
});
```

- [ ] **Step 6: Run to verify it PASSES** (guards from Step 3 make it green — this test is the regression lock, run it before committing to be sure): `npx vitest run src/ramble/yieldHarness.test.ts`. If any assertion fails, the guard from Step 3 is incomplete — fix the reducer, not the test.

- [ ] **Step 7: Full gate + commit**

```bash
npx tsc --noEmit && npm test
git add src/ramble/sessionStore.ts src/ramble/sessionStore.test.ts src/ramble/yieldHarness.test.ts
git commit -m "fix(ramble): yield guards on slot.needsInput/slot.confirmed + scripted yield harness (TDD)"
```

---

### Task 2: `scribeCallToEvents` — schema-aware mapper with honest errors and `fillingStart→draft` pairing

Spec §6: `fill_slot` maps to `slot.draft` *"preceded by `slot.fillingStart`"* — the current single-event `toolCallToEvent` skips the filling anchor, so the monitor never shows the live "filling" state. Also, an unknown `slotId` currently becomes an event the reducer silently drops — the model is never told (violates errors-are-data). Replace `toolCallToEvent` with `scribeCallToEvents(call, schema)` returning `RambleEvent[] | { error }`. (`toolCallToEvent` has no callers outside its own test — safe to replace.)

**Files:**
- Modify: `src/ramble/scribeTools.ts:48-65` (replace the mapper; tool defs unchanged)
- Test: `src/ramble/scribeTools.test.ts` (rewrite the mapper describe-block)

**Interfaces:**
- Consumes: `FormSchema` from `./types`.
- Produces: `scribeCallToEvents(call: { name: string; args: any }, schema: FormSchema): RambleEvent[] | { error: string }` — Task 5's RambleLive routes every tool call through this.

- [ ] **Step 1: Write the failing tests** — in `src/ramble/scribeTools.test.ts`, replace the `describe('toolCallToEvent', …)` block (and its import) with:

```ts
import { SCRIBE_TOOLS, scribeCallToEvents } from './scribeTools';
import { RFI_SCHEMA } from './rfiSchema';

describe('scribeCallToEvents', () => {
  it('fill_slot → fillingStart THEN draft (the monitor needs the live anchor)', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' } }, RFI_SCHEMA);
    expect(evs).toEqual([
      { type: 'slot.fillingStart', slotId: 'location' },
      { type: 'slot.draft', slotId: 'location', value: 'C-3', confidence: 0.8, source: 'heard' },
    ]);
  });
  it('clamps confidence to 0..1 and coerces an invalid source to heard', () => {
    const evs = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'location', value: 'C-3', confidence: 7, source: 'guessed' } }, RFI_SCHEMA) as any[];
    expect(evs[1]).toMatchObject({ confidence: 1, source: 'heard' });
  });
  it('FAILS THE CALL on an unknown slotId, naming the valid ids (errors are data)', () => {
    const bad = scribeCallToEvents({ name: 'fill_slot', args: { slotId: 'siteContact', value: 'x', confidence: 0.9, source: 'heard' } }, RFI_SCHEMA) as { error: string };
    expect(bad.error).toMatch(/^Unknown slotId "siteContact"\./);
    expect(bad.error).toContain('question, location, drawingRef, neededBy, discipline, dateSubmitted');
  });
  it('ask_gap and confirm_slot validate slotId too', () => {
    expect(scribeCallToEvents({ name: 'ask_gap', args: { slotId: 'neededBy', question: 'by when?' } }, RFI_SCHEMA))
      .toEqual([{ type: 'slot.needsInput', slotId: 'neededBy', question: 'by when?' }]);
    expect(scribeCallToEvents({ name: 'confirm_slot', args: { slotId: 'nope' } }, RFI_SCHEMA)).toHaveProperty('error');
  });
  it('recap and submit map to phase changes; unknown tool → error', () => {
    expect(scribeCallToEvents({ name: 'recap', args: {} }, RFI_SCHEMA)).toEqual([{ type: 'session.phaseChange', phase: 'recapping' }]);
    expect(scribeCallToEvents({ name: 'submit', args: {} }, RFI_SCHEMA)).toEqual([{ type: 'session.phaseChange', phase: 'awaitingConsent' }]);
    expect(scribeCallToEvents({ name: 'nope', args: {} }, RFI_SCHEMA)).toEqual({ error: 'Unknown scribe tool "nope".' });
  });
});
```

- [ ] **Step 2: Run to verify fail**: `npx vitest run src/ramble/scribeTools.test.ts` → FAIL (`scribeCallToEvents` not exported).

- [ ] **Step 3: Implement** — in `src/ramble/scribeTools.ts`, replace `toolCallToEvent` (lines 48–65) with:

```ts
import type { RambleEvent, SlotSource, FormSchema } from './types';   // ← replace the existing type-import line

const AGENT_SOURCES: SlotSource[] = ['heard', 'inferred', 'asked'];

/** Errors are data: name the valid ids so the scribe's retry can succeed. */
function badSlot(slotId: string, schema: FormSchema) {
  return { error: `Unknown slotId "${slotId}". Valid slot ids: ${schema.slots.map((s) => s.id).join(', ')}.` };
}

/** Pure mapping from a scribe tool call to reducer events. Unknown tool/slot fails the WHOLE call. */
export function scribeCallToEvents(
  call: { name: string; args: any }, schema: FormSchema,
): RambleEvent[] | { error: string } {
  const a = call.args ?? {};
  const slotId = String(a.slotId ?? '');
  const known = (id: string) => schema.slots.some((s) => s.id === id);
  switch (call.name) {
    case 'fill_slot': {
      if (!known(slotId)) return badSlot(slotId, schema);
      const confidence = Math.min(1, Math.max(0, Number(a.confidence ?? 0.5)));
      const source = (AGENT_SOURCES.includes(a.source) ? a.source : 'heard') as SlotSource;
      return [
        { type: 'slot.fillingStart', slotId },
        { type: 'slot.draft', slotId, value: String(a.value ?? ''), confidence, source },
      ];
    }
    case 'ask_gap':
      if (!known(slotId)) return badSlot(slotId, schema);
      return [{ type: 'slot.needsInput', slotId, question: String(a.question ?? '') }];
    case 'confirm_slot':
      if (!known(slotId)) return badSlot(slotId, schema);
      return [{ type: 'slot.confirmed', slotId }];
    case 'recap':
      return [{ type: 'session.phaseChange', phase: 'recapping' }];
    case 'submit':
      return [{ type: 'session.phaseChange', phase: 'awaitingConsent' }];
    default:
      return { error: `Unknown scribe tool "${call.name}".` };
  }
}
```

Note: `FormSchema` is already exported from `./types`; extend the existing type-only import at the top of the file rather than adding a second import line.

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/ramble/scribeTools.test.ts` → all pass.
- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npm test
git add src/ramble/scribeTools.ts src/ramble/scribeTools.test.ts
git commit -m "feat(ramble): scribeCallToEvents — schema-aware mapper, fillingStart→draft pair, honest slot errors (TDD)"
```

---

### Task 3: The scribe system prompt (`scribePrompt.ts`)

Spec §6.1 verbatim, plus the global constraints (no progress narration, yield note, voice roles). Pure function of the schema + injected `today` so it's testable and never reads the clock.

**Files:**
- Create: `src/ramble/scribePrompt.ts`
- Test: `src/ramble/scribePrompt.test.ts`

**Interfaces:**
- Produces: `buildScribeInstructions(schema: FormSchema, today: string): string` — Task 5 passes it to `provider.connect`.

- [ ] **Step 1: Write the failing test** — create `src/ramble/scribePrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScribeInstructions } from './scribePrompt';
import { RFI_SCHEMA } from './rfiSchema';

describe('buildScribeInstructions', () => {
  const s = buildScribeInstructions(RFI_SCHEMA, '7/15/2026');
  it('names every slot id and marks the required ones', () => {
    for (const slot of RFI_SCHEMA.slots) expect(s).toContain(slot.id);
    expect(s).toMatch(/REQUIRED/);
    expect(s).toContain('Architectural|Structural|Mechanical|Electrical');
  });
  it('carries the §6.1 prompt discipline', () => {
    expect(s).toMatch(/asides|thinking.?aloud/i);          // content-vs-chatter
    expect(s).toMatch(/ONE gap question at a time/i);      // gap-driven, singly
    expect(s).toMatch(/read.?back/i);                      // read-back is dialogue
    expect(s).toMatch(/recap.*before.*submit/is);          // mandatory recap
    expect(s).toMatch(/inferred/);                         // flags inferred at recap
    expect(s).toContain('7/15/2026');                      // seeded dateSubmitted context
  });
  it('carries the yield rule and the no-progress-narration rule', () => {
    expect(s).toMatch(/user (has )?edited.*never (change|fill|overwrite)/is);
    expect(s).toMatch(/do not narrate progress|no progress/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**: `npx vitest run src/ramble/scribePrompt.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — create `src/ramble/scribePrompt.ts`:

```ts
import type { FormSchema } from './types';

/** The scribe's system prompt (spec §6.1). Pure: schema + today injected. */
export function buildScribeInstructions(schema: FormSchema, today: string): string {
  const slotLines = schema.slots
    .map((s) => `- ${s.id} — "${s.label}" (${s.type}${s.required ? ', REQUIRED' : ''}${s.constraint ? `, one of: ${s.constraint}` : ''})`)
    .join('\n');
  return `You are a SCRIBE. The user is handsfree and rambling about one ${schema.title} form; your only job is to fill it accurately in the background. Today is ${today}; dateSubmitted is already seeded to today as an INFERRED value.

THE FORM (use these exact slot ids in every tool call):
${slotLines}

CONTENT vs CHATTER: fill_slot only on genuine content. Discard asides, self-corrections mid-thought, and thinking-aloud. When unsure whether something is content, hold it at LOW confidence and read it back — never silently file it, never invent.

GAPS: track which REQUIRED slots are still empty. Ask ONE gap question at a time with ask_gap — only for a real gap or genuine ambiguity, never from mere unease. Wait for the answer before asking another.

READ-BACK IS DIALOGUE: periodically voice a short read-back of what you filled ("got it as: at C-3, S-301 conflicts — right?"). Read-back is a question — this and gap questions and the recap are the ONLY times you speak. On acceptance call confirm_slot; on a correction, fill_slot the fix and re-confirm.

YIELD: if the system tells you the user is editing or has edited a field themselves, that field is THEIRS — never fill, ask about, or overwrite it again.

RECAP BEFORE SUBMIT — MANDATORY: when the form is complete, call recap() and voice the WHOLE form, explicitly flagging every inferred value ("date submitted I inferred as ${today}"). Only after the recap call submit(); submission always requires the user's explicit consent on screen.

Do not narrate progress or count fields aloud. Keep every utterance to one short sentence.`;
}
```

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/ramble/scribePrompt.test.ts` → all pass.
- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npm test
git add src/ramble/scribePrompt.ts src/ramble/scribePrompt.test.ts
git commit -m "feat(ramble): scribe system prompt — content-vs-chatter, one gap, read-back, mandatory recap (TDD)"
```

---

### Task 4: Telemetry — the six ramble events (spec §7)

Extend the `TelemetryEvent` union + `Telemetry` methods. `correction` already exists as a bare undo marker — extend it with optional fields (backward compatible; existing `telemetry.correction()` callers unchanged).

**Files:**
- Modify: `src/telemetry.ts:35-43` (union), `:84-95` (methods)
- Test: `src/telemetry.test.ts` (append)

**Interfaces:**
- Produces (Task 5 calls these): `telemetry.fill(slotId, source, confidence)` · `telemetry.gapQuestion(slotId)` · `telemetry.readback(accepted: boolean)` · `telemetry.stall()` · `telemetry.sessionComplete(timeToCompleteMs, slotsFilled, inferredCount)` · `telemetry.correction(slotId?, overAgent?)`.

- [ ] **Step 1: Write the failing test** — append to `src/telemetry.test.ts` (reuse the existing `cfg` const):

```ts
describe('ramble telemetry (spec §7)', () => {
  beforeEach(() => telemetry.start(cfg));
  it('records fill / gap_question / readback / stall / session_complete and an attributed correction', () => {
    telemetry.fill('location', 'heard', 0.8);
    telemetry.gapQuestion('neededBy');
    telemetry.readback(true);
    telemetry.readback(false);
    telemetry.stall();
    telemetry.correction('location', true);
    telemetry.sessionComplete(42_000, 6, 1);
    const events = JSON.parse(telemetry.exportJSON()).events as any[];
    expect(events.find(e => e.type === 'fill')).toMatchObject({ slotId: 'location', source: 'heard', confidence: 0.8 });
    expect(events.find(e => e.type === 'gap_question')).toMatchObject({ slotId: 'neededBy' });
    expect(events.filter(e => e.type === 'readback').map(e => e.accepted)).toEqual([true, false]);
    expect(events.some(e => e.type === 'stall')).toBe(true);
    expect(events.find(e => e.type === 'correction')).toMatchObject({ slotId: 'location', overAgent: true });
    expect(events.find(e => e.type === 'session_complete')).toMatchObject({ timeToCompleteMs: 42_000, slotsFilled: 6, inferredCount: 1 });
  });
});
```

(If `exportJSON()`'s payload key differs from `events`, read `src/telemetry.ts:172` and match its actual shape — assert against what `exportJSON` really returns, adjusting only the parse line, not the semantics.)

- [ ] **Step 2: Run to verify fail**: `npx vitest run src/telemetry.test.ts` → FAIL (`fill` is not a function).

- [ ] **Step 3: Implement** — in `src/telemetry.ts`:

Replace the `correction` union member (line 41) and add the five new members after it:

```ts
  | { t: number; type: 'correction'; slotId?: string; overAgent?: boolean } // undo, or a ramble user-edit (overAgent = the key trust signal)
  | { t: number; type: 'fill'; slotId: string; source: string; confidence: number }
  | { t: number; type: 'gap_question'; slotId: string }
  | { t: number; type: 'readback'; accepted: boolean }
  | { t: number; type: 'stall' }
  | { t: number; type: 'session_complete'; timeToCompleteMs: number; slotsFilled: number; inferredCount: number }
```

Replace the `correction()` method (line 91) and add the new methods beside it:

```ts
  correction(slotId?: string, overAgent?: boolean) { this.push({ type: 'correction', slotId, overAgent }); }
  fill(slotId: string, source: string, confidence: number) { this.push({ type: 'fill', slotId, source, confidence }); }
  gapQuestion(slotId: string) { this.push({ type: 'gap_question', slotId }); }
  readback(accepted: boolean) { this.push({ type: 'readback', accepted }); }
  stall() { this.push({ type: 'stall' }); }
  sessionComplete(timeToCompleteMs: number, slotsFilled: number, inferredCount: number) {
    this.push({ type: 'session_complete', timeToCompleteMs, slotsFilled, inferredCount });
  }
```

- [ ] **Step 4: Run to verify pass**: `npx vitest run src/telemetry.test.ts` → all pass.
- [ ] **Step 5: Full gate + commit**

```bash
npx tsc --noEmit && npm test
git add src/telemetry.ts src/telemetry.test.ts
git commit -m "feat(ramble): telemetry — fill/gap_question/readback/stall/session_complete + attributed correction (TDD)"
```

---

### Task 5: `RambleLive.tsx` — the live scribe container

The integration piece: owns one provider session (all three backends), routes tool calls `scribeCallToEvents → reduce`, sends yield hints, renders `Monitor` + the witnessed consent card, wires earcons + telemetry. No unit harness for JSX in this repo → verify with tsc + full suite + build; the live smoke is a reported human step (Task 6).

**Files:**
- Create: `src/ramble/RambleLive.tsx`

**Interfaces:**
- Consumes: `reduce`, `RFI_SCHEMA`/`initialSessionState`, `isStalled`, `Monitor`, `SCRIBE_TOOLS`/`scribeCallToEvents` (Task 2), `buildScribeInstructions` (Task 3), `telemetry.*` (Task 4), `CallDeduper`/`argsKey` from `../coherence`, `playEarcon`/`primeEarcons`, the three `create*Provider` factories.
- Produces: `export function RambleLive(): JSX.Element` — Task 6 mounts it at `?ramble=live`.

- [ ] **Step 1: Create `src/ramble/RambleLive.tsx`** (complete file):

```tsx
import { useEffect, useRef, useState } from 'react';
import { RFI_SCHEMA, initialSessionState } from './rfiSchema';
import { reduce } from './sessionStore';
import { isStalled } from './selectors';
import type { RambleEvent, SessionState } from './types';
import { Monitor } from './Monitor';
import { SCRIBE_TOOLS, scribeCallToEvents } from './scribeTools';
import { buildScribeInstructions } from './scribePrompt';
import type { VoiceProvider, ProviderKind } from '../voice/types';
import { createGeminiProvider } from '../voice/gemini';
import { createOpenAIRealtimeProvider } from '../voice/openai';
import { createAzureRealtimeProvider } from '../voice/azure';
import { CallDeduper, argsKey } from '../coherence';
import { playEarcon, primeEarcons } from '../feedback/earcons';
import { telemetry, detectDevice } from '../telemetry';
import { Button } from '../ui/Button';

const label = (id: string) => RFI_SCHEMA.slots.find((s) => s.id === id)?.label ?? id;

/** Live ramble-fill: the scribe on a real VoiceProvider driving the glanceable Monitor. */
export function RambleLive() {
  const [state, setState] = useState<SessionState>(() => initialSessionState(RFI_SCHEMA, new Date().toLocaleDateString(), Date.now()));
  const stateRef = useRef(state);
  const [now, setNow] = useState(() => Date.now());
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [backend, setBackend] = useState<ProviderKind>('gemini');
  const providerRef = useRef<VoiceProvider | null>(null);
  const deduperRef = useRef(new CallDeduper());
  const startedAtRef = useRef(0);
  const typedRef = useRef<HTMLInputElement | null>(null);

  const apply = (ev: RambleEvent) => {
    setState((prev) => {
      const next = reduce(prev, ev, Date.now());
      stateRef.current = next;
      return next;
    });
  };

  // Liveness tick + stall edge (telemetry + earcon on the flip, spec §5.4/§7).
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const stalled = isStalled(state, now);
  const prevStalledRef = useRef(false);
  useEffect(() => {
    if (stalled && !prevStalledRef.current) { telemetry.stall(); playEarcon('error'); }
    prevStalledRef.current = stalled;
  }, [stalled]);

  useEffect(() => () => providerRef.current?.close(), []); // teardown on unmount

  const handleToolCall = (call: { id: string; name: string; args: any }) => {
    // G9 idempotency (all scribe tools carry args; recap/submit repeats are idempotent phase changes).
    if (deduperRef.current.seen(call.name, argsKey(call.args), Date.now())) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: true, deduped: true });
      return;
    }
    const mapped = scribeCallToEvents(call, RFI_SCHEMA);
    if ('error' in mapped) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: false, error: mapped.error });
      return;
    }
    const prev = stateRef.current;
    if (call.name === 'fill_slot') {
      // A re-fill over an existing draft = a patched read-back (spec §7 readback accepted-vs-patched).
      if (prev.fills.find((f) => f.slotId === call.args?.slotId)?.status === 'draft') telemetry.readback(false);
      telemetry.fill(String(call.args?.slotId), String(call.args?.source ?? 'heard'), Number(call.args?.confidence ?? 0.5));
    }
    if (call.name === 'ask_gap') { telemetry.gapQuestion(String(call.args?.slotId)); playEarcon('confirm-needed'); }
    if (call.name === 'confirm_slot') { telemetry.readback(true); playEarcon('commit-mutate'); }
    if (call.name === 'submit') playEarcon('confirm-needed');
    for (const ev of mapped) apply(ev);
    providerRef.current?.sendToolResponse(call.id, call.name, { success: true });
  };

  const start = async () => {
    if (isLive || isConnecting) return;
    setIsConnecting(true); setLastError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (backend === 'gemini' && !apiKey) throw new Error('Missing GEMINI_API_KEY — set it in .env and restart the dev server.');
      const provider =
        backend === 'azure'
          ? createAzureRealtimeProvider(process.env.AZURE_OPENAI_ENDPOINT || '', process.env.AZURE_REALTIME_DEPLOYMENT || 'gpt-realtime-2', process.env.AZURE_OPENAI_API_KEY || '', process.env.AZURE_TRANSCRIBE_DEPLOYMENT || undefined)
          : backend === 'openai' ? createOpenAIRealtimeProvider()
          : createGeminiProvider(apiKey!);
      providerRef.current = provider;
      primeEarcons();
      await provider.connect(
        {
          instructions: buildScribeInstructions(RFI_SCHEMA, new Date().toLocaleDateString()),
          tools: SCRIBE_TOOLS,
          voice: backend === 'gemini' ? 'Zephyr' : backend === 'azure' ? 'alloy' : 'marin',
        },
        {
          onOpen: () => {
            setIsLive(true); setIsConnecting(false);
            startedAtRef.current = Date.now();
            telemetry.start({ backend, autonomy: 'witnessed', feedback: 'earcon', program: 'rfi-ramble', honest: true, device: detectDevice() });
            playEarcon('listening');
            apply({ type: 'heartbeat' });
          },
          onClose: () => { setIsLive(false); setIsConnecting(false); providerRef.current = null; },
          onError: (m) => { setIsConnecting(false); setLastError(m); telemetry.error(m); },
          onInputTranscript: () => apply({ type: 'heartbeat' }),
          onToolCall: handleToolCall,
        },
      );
    } catch (e: any) {
      setIsConnecting(false); setLastError(e?.message ?? String(e)); providerRef.current = null;
    }
  };

  const stop = () => providerRef.current?.close();

  // UI→Agent edits: reducer enforces yield; the hint is defense-in-depth (spec §6.2).
  const onEditStart = (id: string) => {
    apply({ type: 'user.editStart', slotId: id });
    providerRef.current?.sendTextHint(`[SYSTEM: the user is editing "${label(id)}" themselves — do NOT fill, ask about, or mention it. Stay silent.]`);
  };
  const onEditCommit = (id: string, value: string) => {
    const prior = stateRef.current.fills.find((f) => f.slotId === id)?.prior;
    const overAgent = prior != null && prior.value != null && prior.owner === 'agent';
    apply({ type: 'user.editCommit', slotId: id, value });
    telemetry.correction(id, overAgent);
    providerRef.current?.sendTextHint(`[SYSTEM: the user set "${label(id)}" to "${value}" themselves. That field is theirs now — never change it. Do not respond.]`);
  };
  const onEditCancel = (id: string) => apply({ type: 'user.editCancel', slotId: id });

  // Submit consent — unconditionally witnessed (spec §6.3); declined → stays awaitingConsent (§8).
  const confirmSubmit = () => {
    apply({ type: 'session.phaseChange', phase: 'submitting' });
    playEarcon('commit-mutate');
    setTimeout(() => {
      apply({ type: 'session.phaseChange', phase: 'done' });
      const st = stateRef.current;
      telemetry.sessionComplete(
        Date.now() - startedAtRef.current,
        st.fills.filter((f) => f.value != null).length,
        st.fills.filter((f) => f.source === 'inferred').length,
      );
      providerRef.current?.sendTextHint('[SYSTEM: the form was submitted with the user\'s consent. The session is done — thank them briefly.]');
    }, 700);
  };
  const declineSubmit = () => {
    providerRef.current?.sendTextHint('[SYSTEM: the user DECLINED the submission — nothing was sent. They may edit fields or tell you what to change; recap again before any new submit.]');
  };

  const sendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const v = typedRef.current?.value.trim();
    if (v && providerRef.current) { providerRef.current.sendUserText(v); apply({ type: 'heartbeat' }); }
    if (typedRef.current) typedRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-md mx-auto pt-6 px-4 flex items-center justify-between">
        <a href="/" className="text-xs text-slate-500 hover:text-slate-800">← point-and-speak</a>
        <div className="flex items-center gap-2">
          <select
            aria-label="Voice backend" value={backend} disabled={isLive || isConnecting}
            onChange={(e) => setBackend(e.target.value as ProviderKind)}
            className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white"
          >
            <option value="gemini">Gemini</option><option value="openai">OpenAI</option><option value="azure">Azure</option>
          </select>
          <Button size="sm" onClick={isLive ? stop : start} disabled={isConnecting}>
            {isLive ? 'Stop' : isConnecting ? 'Connecting…' : 'Start ramble'}
          </Button>
        </div>
      </div>
      {lastError && <div className="max-w-md mx-auto mt-2 px-4 text-xs text-red-600">{lastError}</div>}

      <Monitor
        schema={RFI_SCHEMA} state={state} now={now}
        onEditStart={onEditStart} onEditCommit={onEditCommit} onEditCancel={onEditCancel}
        onOpenFullEditor={() => { /* the edit pass is a follow-on spec */ }}
      />

      {isLive && (
        <form onSubmit={sendTyped} className="max-w-md mx-auto mt-3 px-4">
          <input
            ref={typedRef} placeholder="Type instead of speaking (dev)"
            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
          />
        </form>
      )}

      {state.phase === 'awaitingConsent' && (
        <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center" role="dialog" aria-label="Submit consent">
          <div className="bg-white rounded-xl shadow-lg p-5 w-80">
            <h3 className="text-sm font-semibold">Submit this {RFI_SCHEMA.title}?</h3>
            <p className="text-xs text-slate-500 mt-1.5">You just heard the recap. Nothing is sent without your OK.</p>
            <div className="flex gap-2 mt-4 justify-end">
              <Button size="sm" variant="outline" onClick={declineSubmit}>Not yet</Button>
              <Button size="sm" onClick={confirmSubmit}>Submit</Button>
            </div>
          </div>
        </div>
      )}
      {state.phase === 'done' && (
        <div className="max-w-md mx-auto mt-4 px-4 text-center text-sm text-green-700">
          Submitted ✓ — <a className="underline" href="?ramble=live">start another</a>
        </div>
      )}
    </div>
  );
}
```

If `Button` has no `variant="outline"` or `size="sm"` props, read `src/ui/Button.tsx` and use its actual API (fall back to `className` styling) — do not add new variants to the shared primitive for this.

- [ ] **Step 2: Verify — typecheck + full suite + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: clean; no test count change (JSX container, no unit harness by repo convention).

- [ ] **Step 3: Commit**

```bash
git add src/ramble/RambleLive.tsx
git commit -m "feat(ramble): RambleLive — scribe on the live VoiceProvider, yield hints, witnessed submit consent, earcons+telemetry"
```

---

### Task 6: Routing + MenuBar entry, then the final gate

`?ramble=live` mounts `RambleLive`; any other `?ramble` value keeps the scripted demo (back-compat with `?ramble=1`). A MenuBar button in the main app navigates into ramble mode (the spec-§2.4 mode switch as a navigation boundary).

**Files:**
- Modify: `src/main.tsx`, `src/shell/MenuBar.tsx:7-21`, `src/App.tsx:2796`

**Interfaces:**
- Consumes: `RambleLive` (Task 5).
- Produces: user-reachable mode switch; nothing downstream.

- [ ] **Step 1: Update `src/main.tsx`** (complete file):

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { RambleDemo } from './ramble/RambleDemo';
import { RambleLive } from './ramble/RambleLive';
import './index.css';

const rambleParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ramble') : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {rambleParam === 'live' ? <RambleLive /> : rambleParam ? <RambleDemo /> : <App />}
  </StrictMode>,
);
```

- [ ] **Step 2: Add the mode-switch button to `src/shell/MenuBar.tsx`** — add `AudioLines` to the lucide import, an `onRambleMode: () => void` prop, and the button before the theme toggle:

```tsx
import { Sun, Moon, Settings2, AudioLines } from 'lucide-react';
// props: { …existing…; onRambleMode: () => void }
<Tip label="Ramble mode (scribe)"><Button size="icon44" aria-label="Ramble mode" onClick={onRambleMode}><AudioLines size={16} /></Button></Tip>
```

- [ ] **Step 3: Pass the prop in `src/App.tsx:2796`** — extend the existing `<MenuBar …/>` line with:

```tsx
onRambleMode={() => { window.location.search = 'ramble=live'; }}
```

- [ ] **Step 4: Final gate — typecheck + full suite + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit, then report the owed live smoke**

```bash
git add src/main.tsx src/shell/MenuBar.tsx src/App.tsx
git commit -m "feat(ramble): mode switch — ?ramble=live mounts RambleLive; MenuBar entry (demo stays at ?ramble=1)"
```

Report to the user that the LIVE smoke from spec §9 is owed (needs an API key + mic or the typed dev input): ramble a scenario → fills appear with the filling→draft anchor → a gap question on a missing required slot → read-back → tap-edit a slot mid-ramble and confirm the agent yields (reducer + hint) → recap flags the inferred date → submit hits the consent card → decline keeps it unsent → confirm completes → `session_complete` in the exported telemetry JSON. Also note the glance test (spec §5.1) is the acceptance bar during that smoke.

---

## Self-review notes

- **Spec coverage:** §10 step 5 (scribe wiring + mode switch) → Tasks 2, 3, 5, 6; step 6 (recap + consent + inferred flagging) → Task 3 (prompt) + Task 5 (consent card; flagging is voiced per §6.1); step 7 (telemetry) → Tasks 4–5. §4.3/§6.2 yield → Tasks 1 and 5. §8 error rows → Task 2 (unknown slot → honest error, stronger than silent no-op) + §8 consent-declined in Task 5. Deliberately NOT built (out of scope per §1): photo→schema capture, full edit pass (`onOpenFullEditor` stays a stub), transcript drill-in, multi-form.
- **Deviation from spec, on purpose:** §2.4 reads "a mode switch in App"; this plan makes the switch a navigation boundary (`?ramble=live` + MenuBar button) rather than in-place App state, because the two modes share no scene and the provider must reconnect with different prompt+tools either way — this avoids gating ~12 deixis subsystems (perception frames, layout hints, omnibox grammar) inside App.tsx. The §2.2 reuse map is honored by direct import instead. Flag this to the user at plan review.
- **Consent reuse nuance (§6.3):** the spec names `setPendingAction`; that state lives inside App's component scope and carries deixis-specific fields (charStart/newText). RambleLive reuses the witness→commit *pattern* (blocking card, explicit confirm, Esc-equivalent decline) with the same `ui/Button` primitives, and honors "unconditionally witnessed" by never consulting `decideCommit`.
- **Type consistency check:** `scribeCallToEvents(call, RFI_SCHEMA)` (Tasks 2→5) ✓; `buildScribeInstructions(schema, today)` (3→5) ✓; telemetry method names (4→5: `fill`, `gapQuestion`, `readback`, `stall`, `sessionComplete`, `correction(slotId, overAgent)`) ✓; `initialSessionState(schema, today, now)` matches `rfiSchema.ts` ✓; `VoiceCallbacks.onInputTranscript(text, isFinal)` — RambleLive ignores the args (heartbeat only) ✓.
