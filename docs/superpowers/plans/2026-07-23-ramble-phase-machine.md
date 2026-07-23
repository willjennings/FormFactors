# Ramble Phase Machine Constraints (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain the ramble session machine with a legal-transition table, a phase seal on agent fills, an honest stall scope (conversing+recapping), and decline-returns-to-conversing.

**Architecture:** Three pure guards added to existing modules — `legalTransition` + `fillsAllowedIn` in `sessionStore.ts` (reducer defense-in-depth), `STALL_PHASES` in `selectors.ts`, and a pure `phaseGuard` in `scribeTools.ts` that `RambleLive.handleToolCall` uses for model-facing honest rejections (mirroring the existing user-owned-slot guard). Decline dispatches the now-legal `awaitingConsent → conversing` edge.

**Tech Stack:** TypeScript, vitest. All logic is pure-function TDD; the RambleLive wiring is 6 lines.

**Spec:** `docs/superpowers/specs/2026-07-21-ramble-phase-machine-design.md`

## Global Constraints

- Legal edges, exactly: `conversing→recapping`, `recapping→conversing`, `recapping→awaitingConsent`, `awaitingConsent→submitting`, `awaitingConsent→conversing`, `submitting→done`, plus any self-transition (idempotent no-op). Everything else illegal.
- Illegal `session.phaseChange` → reducer returns state UNCHANGED (silent; model-facing honesty is the HOST's job).
- Fills (agent `slot.*` events) allowed ONLY in `conversing` and `recapping`. `user.edit*` events are NOT sealed — tap-edit mid-consent is live-smoke-verified behavior that must keep working.
- `isStalled` true only in `conversing` and `recapping`. `awaitingConsent` is a human-wait — NEVER stalled. `submitting`/`done` never stalled.
- Host rejections (sealed fill, premature submit, wrong-phase recap) are NEVER recorded in the deduper (existing convention, RambleLive.tsx:67-90).
- Existing yield guards (user-owned slots) compose with — are not replaced by — the phase gate.
- Run tests with `npx vitest run src/ramble/`; `npx tsc --noEmit` stays clean.

---

### Task 1: Legal-transition table (reducer)

**Files:**
- Modify: `src/ramble/sessionStore.ts:45-46`
- Test: `src/ramble/sessionStore.test.ts` (extend)

**Interfaces:**
- Produces: `legalTransition(from: Phase, to: Phase): boolean` exported from `sessionStore.ts` — Task 4's host guard consumes the same edge semantics via `phaseGuard`; import `Phase` from `./types`.

- [ ] **Step 1: Write the failing tests**

Read `src/ramble/sessionStore.test.ts` first and reuse its existing state-construction helpers/fixtures (it builds states via `initialSessionState` or literal objects — match its idiom). Append:

```ts
import { legalTransition } from './sessionStore';
import type { Phase } from './types';

describe('phase transition table', () => {
  const LEGAL: [Phase, Phase][] = [
    ['conversing', 'recapping'],
    ['recapping', 'conversing'],
    ['recapping', 'awaitingConsent'],
    ['awaitingConsent', 'submitting'],
    ['awaitingConsent', 'conversing'],
    ['submitting', 'done'],
  ];
  const ALL: Phase[] = ['capturing', 'conversing', 'recapping', 'awaitingConsent', 'submitting', 'done'];

  it('allows exactly the spec edges plus self-transitions', () => {
    for (const from of ALL) for (const to of ALL) {
      const expected = from === to || LEGAL.some(([f, t]) => f === from && t === to);
      expect(legalTransition(from, to), `${from} -> ${to}`).toBe(expected);
    }
  });

  it('reducer ignores an illegal jump conversing -> done', () => {
    const s = { ...base, phase: 'conversing' as Phase };
    const out = reduce(s, { type: 'session.phaseChange', phase: 'done' }, 1000);
    expect(out.phase).toBe('conversing');
    expect(out).toBe(s); // unchanged reference — a true no-op
  });

  it('reducer ignores conversing -> awaitingConsent (recap cannot be skipped)', () => {
    const s = { ...base, phase: 'conversing' as Phase };
    expect(reduce(s, { type: 'session.phaseChange', phase: 'awaitingConsent' }, 1000).phase).toBe('conversing');
  });

  it('reducer ignores any transition out of done', () => {
    const s = { ...base, phase: 'done' as Phase };
    expect(reduce(s, { type: 'session.phaseChange', phase: 'conversing' }, 1000).phase).toBe('done');
  });

  it('reducer applies a legal edge and a self-transition no-ops cleanly', () => {
    const s = { ...base, phase: 'recapping' as Phase };
    expect(reduce(s, { type: 'session.phaseChange', phase: 'awaitingConsent' }, 1000).phase).toBe('awaitingConsent');
    const same = reduce(s, { type: 'session.phaseChange', phase: 'recapping' }, 1000);
    expect(same.phase).toBe('recapping');
  });
});
```

(`base` = a valid `SessionState` built the same way the file's existing tests build one — reuse their fixture, do not invent a new one.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ramble/sessionStore.test.ts`
Expected: FAIL — `legalTransition` not exported.

- [ ] **Step 3: Implement**

In `src/ramble/sessionStore.ts`, add above `reduce` (import `Phase` type from `./types`):

```ts
/** Spec 2026-07-21-ramble-phase-machine: the machine's only legal edges. Self-transitions
 *  are idempotent no-ops (recap while recapping, etc.). Everything else is ignored here
 *  (defense in depth) — model-facing honesty for illegal calls lives in the HOST guard. */
const LEGAL_EDGES: ReadonlyArray<readonly [Phase, Phase]> = [
  ['conversing', 'recapping'],
  ['recapping', 'conversing'],
  ['recapping', 'awaitingConsent'],
  ['awaitingConsent', 'submitting'],
  ['awaitingConsent', 'conversing'],   // decline returns to conversing
  ['submitting', 'done'],
];

export function legalTransition(from: Phase, to: Phase): boolean {
  return from === to || LEGAL_EDGES.some(([f, t]) => f === from && t === to);
}
```

Replace the `session.phaseChange` case:

```ts
    case 'session.phaseChange':
      if (!legalTransition(state.phase, event.phase)) return state;
      return { ...state, phase: event.phase };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ramble/ && npx tsc --noEmit`
Expected: ALL PASS (every existing ramble test must still pass — the demo/live producers only emit legal edges), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ramble/sessionStore.ts src/ramble/sessionStore.test.ts
git commit -m "feat(ramble): legal-transition table — illegal phase jumps no-op"
```

---

### Task 2: Phase seal on agent fills

**Files:**
- Modify: `src/ramble/sessionStore.ts:20-42` (the five agent `slot.*` cases)
- Test: `src/ramble/sessionStore.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `fillsAllowedIn(phase: Phase): boolean` exported from `sessionStore.ts` — Task 4's `phaseGuard` reuses it.

- [ ] **Step 1: Write the failing tests**

Append to `src/ramble/sessionStore.test.ts` (again reusing the file's state fixture; pick a real `slotId` present in the fixture's `fills`):

```ts
import { fillsAllowedIn } from './sessionStore';

describe('phase seal on fills', () => {
  it('fillsAllowedIn: open in conversing+recapping, sealed elsewhere', () => {
    expect(fillsAllowedIn('conversing')).toBe(true);
    expect(fillsAllowedIn('recapping')).toBe(true);
    expect(fillsAllowedIn('awaitingConsent')).toBe(false);
    expect(fillsAllowedIn('submitting')).toBe(false);
    expect(fillsAllowedIn('done')).toBe(false);
  });

  it('a late slot.draft after done leaves state untouched', () => {
    const s = { ...base, phase: 'done' as Phase };
    const out = reduce(s, { type: 'slot.draft', slotId: SLOT, value: 'late', confidence: 0.9, source: 'heard' }, 1000);
    expect(out).toBe(s);
  });

  it('slot.needsInput and slot.confirmed sealed in awaitingConsent', () => {
    const s = { ...base, phase: 'awaitingConsent' as Phase };
    expect(reduce(s, { type: 'slot.needsInput', slotId: SLOT, question: 'q?' }, 1000)).toBe(s);
    expect(reduce(s, { type: 'slot.confirmed', slotId: SLOT }, 1000)).toBe(s);
  });

  it('re-fills still apply during recapping (readback patches stay open)', () => {
    const s = { ...base, phase: 'recapping' as Phase };
    const out = reduce(s, { type: 'slot.draft', slotId: SLOT, value: 'patched', confidence: 0.8, source: 'heard' }, 1000);
    expect(out.fills.find(f => f.slotId === SLOT)?.value).toBe('patched');
  });

  it('user edits are NOT sealed — tap-edit mid-consent must keep working', () => {
    const s = { ...base, phase: 'awaitingConsent' as Phase };
    const started = reduce(s, { type: 'user.editStart', slotId: SLOT }, 1000);
    const out = reduce(started, { type: 'user.editCommit', slotId: SLOT, value: 'mine' }, 1001);
    const f = out.fills.find(x => x.slotId === SLOT);
    expect(f?.value).toBe('mine');
    expect(f?.owner).toBe('user');
  });
});
```

(`SLOT` = a slotId that exists in the fixture's fills — read the fixture and use a real one.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ramble/sessionStore.test.ts`
Expected: FAIL — `fillsAllowedIn` not exported; sealed-phase drafts currently mutate state.

- [ ] **Step 3: Implement**

In `src/ramble/sessionStore.ts`:

```ts
/** Agent fills are only meaningful while the session is open for input. recapping stays
 *  open (readback→patch re-fills land there); awaitingConsent/submitting/done are sealed.
 *  USER edit events are exempt — the consent card is non-blocking by design. */
export function fillsAllowedIn(phase: Phase): boolean {
  return phase === 'conversing' || phase === 'recapping';
}
```

Add the gate as the FIRST condition of each of the five agent cases (`slot.fillingStart`, `slot.valueUpdate`, `slot.draft`, `slot.needsInput`, `slot.confirmed`), e.g.:

```ts
    case 'slot.fillingStart': {
      if (!fillsAllowedIn(state.phase)) return state;
      if (!hasSlot(state, event.slotId) || ownerOf(state, event.slotId) === 'user') return state;
```

(Same one-line insertion in the other four cases. `user.edit*`, `activity.change`, `heartbeat` untouched.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ramble/ && npx tsc --noEmit`
Expected: ALL PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ramble/sessionStore.ts src/ramble/sessionStore.test.ts
git commit -m "feat(ramble): phase seal — agent fills no-op outside conversing/recapping"
```

---

### Task 3: Honest stall scope

**Files:**
- Modify: `src/ramble/selectors.ts:17-19`
- Test: `src/ramble/selectors.test.ts` (extend)

**Interfaces:**
- Produces: `isStalled` unchanged signature; new exported `STALL_PHASES: ReadonlySet<Phase>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ramble/selectors.test.ts` (reuse its state fixture; `STALL_MS` is already exported):

```ts
describe('stall scope', () => {
  const late = (phase: Phase) => ({ ...base, phase, lastUpdateAt: 0 });
  it('stalls in conversing AND recapping past STALL_MS', () => {
    expect(isStalled(late('conversing'), STALL_MS + 1)).toBe(true);
    expect(isStalled(late('recapping'), STALL_MS + 1)).toBe(true);
  });
  it('awaitingConsent is a human-wait — NEVER stalled, regardless of elapsed', () => {
    expect(isStalled(late('awaitingConsent'), STALL_MS * 100)).toBe(false);
  });
  it('submitting and done never stall', () => {
    expect(isStalled(late('submitting'), STALL_MS * 100)).toBe(false);
    expect(isStalled(late('done'), STALL_MS * 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ramble/selectors.test.ts`
Expected: FAIL — recapping currently returns false.

- [ ] **Step 3: Implement**

Replace `isStalled` in `src/ramble/selectors.ts` (import `Phase` from `./types`):

```ts
/** Phases where the SYSTEM/MODEL owes progress. awaitingConsent is deliberately absent:
 *  it waits on the user's Submit/Not-yet — flagging a human-wait "stalled" would be
 *  dishonest (spec 2026-07-21-ramble-phase-machine §4). */
export const STALL_PHASES: ReadonlySet<Phase> = new Set(['conversing', 'recapping']);

export function isStalled(state: SessionState, now: number): boolean {
  return STALL_PHASES.has(state.phase) && now - state.lastUpdateAt > STALL_MS;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ramble/ && npx tsc --noEmit`
Expected: ALL PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ramble/selectors.ts src/ramble/selectors.test.ts
git commit -m "feat(ramble): stall monitoring covers recapping; consent is a human-wait"
```

---

### Task 4: Host honesty guard + decline returns to conversing

**Files:**
- Modify: `src/ramble/scribeTools.ts` (add pure `phaseGuard`)
- Modify: `src/ramble/RambleLive.tsx:66-111` (handleToolCall) and `:229-231` (declineSubmit)
- Test: `src/ramble/scribeTools.test.ts` (extend)

**Interfaces:**
- Consumes: `fillsAllowedIn` from Task 2 (`./sessionStore`), `Phase` from `./types`.
- Produces: `phaseGuard(name: string, phase: Phase): string | null` exported from `scribeTools.ts` — returns the model-facing error for a wrong-phase call, or `null` when the call is phase-legal.

- [ ] **Step 1: Write the failing tests**

Append to `src/ramble/scribeTools.test.ts`:

```ts
import { phaseGuard } from './scribeTools';

describe('phaseGuard', () => {
  it('fills are legal in conversing/recapping, rejected in sealed phases with the honest reason', () => {
    for (const name of ['fill_slot', 'ask_gap', 'confirm_slot']) {
      expect(phaseGuard(name, 'conversing')).toBeNull();
      expect(phaseGuard(name, 'recapping')).toBeNull();
      expect(phaseGuard(name, 'awaitingConsent')).toMatch(/awaiting the user's consent/);
      expect(phaseGuard(name, 'submitting')).toMatch(/being submitted/);
      expect(phaseGuard(name, 'done')).toMatch(/already submitted/);
    }
  });
  it('submit requires a recap first', () => {
    expect(phaseGuard('submit', 'conversing')).toMatch(/recap the collected slots before submitting/);
    expect(phaseGuard('submit', 'recapping')).toBeNull();
    expect(phaseGuard('submit', 'awaitingConsent')).toBeNull(); // idempotent repeat
    expect(phaseGuard('submit', 'done')).toMatch(/already submitted/);
  });
  it('recap is legal from conversing/recapping only', () => {
    expect(phaseGuard('recap', 'conversing')).toBeNull();
    expect(phaseGuard('recap', 'recapping')).toBeNull();
    expect(phaseGuard('recap', 'done')).toMatch(/already submitted/);
    expect(phaseGuard('recap', 'awaitingConsent')).toMatch(/awaiting the user's consent/);
  });
  it('unknown names pass through (validation owns them)', () => {
    expect(phaseGuard('not_a_tool', 'done')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ramble/scribeTools.test.ts`
Expected: FAIL — `phaseGuard` not exported.

- [ ] **Step 3: Implement the pure guard**

In `src/ramble/scribeTools.ts` (import `fillsAllowedIn` from `./sessionStore`, `Phase` from `./types`):

```ts
/** Model-facing phase honesty (spec 2026-07-21-ramble-phase-machine §2-3): returns the
 *  error message for a wrong-phase call, or null when phase-legal. The reducer would
 *  no-op these anyway (defense in depth); this guard exists so the model is TOLD the
 *  truth instead of getting a success ack for a mutation that never happened. */
export function phaseGuard(name: string, phase: Phase): string | null {
  const sealedReason =
    phase === 'awaitingConsent' ? "the form is awaiting the user's consent — do not modify it; wait for their decision."
    : phase === 'submitting' ? 'the form is being submitted — do not modify it.'
    : phase === 'done' ? 'the form was already submitted — the session is done; nothing can be changed.'
    : null;
  if (name === 'fill_slot' || name === 'ask_gap' || name === 'confirm_slot') {
    return fillsAllowedIn(phase) ? null : sealedReason;
  }
  if (name === 'recap') {
    return phase === 'conversing' || phase === 'recapping' ? null : sealedReason;
  }
  if (name === 'submit') {
    if (phase === 'recapping' || phase === 'awaitingConsent') return null;
    if (phase === 'conversing') return 'recap the collected slots before submitting — the user must hear the readback first.';
    return sealedReason;
  }
  return null;
}
```

- [ ] **Step 4: Wire the host + decline**

In `src/ramble/RambleLive.tsx` `handleToolCall`, insert AFTER the validation block (`if ('error' in mapped) …`, line ~74) and BEFORE the yield guard — same never-enters-the-deduper reasoning as the guards around it:

```ts
    // Phase honesty (spec §2-3): a call the sealed reducer would silently drop must be
    // rejected with the truth — and, like all rejections, never recorded in the deduper.
    const phaseErr = phaseGuard(call.name, stateRef.current.phase);
    if (phaseErr) {
      providerRef.current?.sendToolResponse(call.id, call.name, { success: false, error: phaseErr });
      return;
    }
```

(Import `phaseGuard` from `./scribeTools`.)

Replace `declineSubmit` (line ~229):

```ts
  const declineSubmit = () => {
    // Decline returns to conversing (spec §5): the consent card dismisses, fill
    // monitoring resumes, the user keeps rambling. The model may recap again when ready.
    apply({ type: 'session.phaseChange', phase: 'conversing' });
    providerRef.current?.sendTextHint('[SYSTEM: the user DECLINED the submission — nothing was sent. They may edit fields or tell you what to change; recap again before any new submit.]');
  };
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/ramble/ src/__probes__/probe-ramble-voice.test.ts && npx tsc --noEmit`
Expected: ALL PASS, tsc clean. If any probe test pinned the OLD unconstrained behavior (fills-after-done or free phase jumps as documented findings), update that probe's assertions to pin the NEW guarded behavior — the probes were regression-documenting a known gap this feature closes; note any such change in your report.

- [ ] **Step 6: Commit**

```bash
git add src/ramble/scribeTools.ts src/ramble/scribeTools.test.ts src/ramble/RambleLive.tsx
git commit -m "feat(ramble): phase-honest tool rejections + decline returns to conversing"
```

---

## Verification (after all tasks)

1. `npx vitest run` — full suite green. `npx tsc --noEmit` — clean.
2. Keyless smoke: `npx vite --port 3001` → `?ramble=1` scripted demo unaffected (no phase jumps in the script).
3. **Human smoke (fold into the owed sitting):** live ramble → recap goes silent >10s → stall indicator + earcon now fire during recap; decline consent → card dismisses and filling resumes; after Submit → a late model fill gets the honest "already submitted" error in the op-stream.
