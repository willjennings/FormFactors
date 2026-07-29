# Desktop Metaphor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One window inventory (the desk store) and four switchable shell skins over it — Familiar, Material, Provenance, Conversation — so the desktop metaphor becomes a measured variable.

**Architecture:** A pure `deskStore` reducer owns every window (program + artifacts): rect, z-order, minimize, focus, origin, openedAt. Selectors hold every rendering decision; skins are declarative slot compositions rendered by one `ShellFrame`. The desk joins the journal (`JOURNAL_VERSION` 1→2), `shell` joins the telemetry Arm, and the switch rides the existing register band.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, vitest (pure functions only — no jsdom), existing journal/telemetry/register subsystems.

## Global Constraints

- **Full suite every task**: `npx vitest run` (baseline **864 tests / 100 files** — that is the floor), `npx tsc --noEmit` clean, `npx vite build` succeeds. Never scope a gate to a subdirectory.
- **No new dependencies.** No jsdom, no @types/react (that install is a separate user decision).
- **tsc does not check React hook values in this repo** (no @types/react, no `strict`). Every decision must live in a pure module-level function with tests; JSX stays a thin map over tested output. An annotation on a ref is documentation, not verification.
- **The desk store never copies content**: windows carry `refId`; titles resolve at selector time.
- **`barItems` is ordered by `openedAt`, never by z or focus** (spec §1 / research §5).
- **A skin switch never moves a window the user placed** and must trigger scene re-measurement in the same commit that introduces the switch (spec §7).
- **`JOURNAL_VERSION` goes 1→2 exactly once**, in Task 4 (spec §6). No other task touches it.
- Spec invariants (§5) hold in all skins: pointing, deixis, entity measurement, the gate + ask surface, witness cards, undo, omnibox.
- Comment accuracy is part of every deliverable — verify every factual sentence and line reference you write.
- Fix verification standard: behavioural revert (undo the behaviour, keep signatures), never compile-shape.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/shell/desk/types.ts` | 1 | `DeskWindow`, `DeskState`, `DeskEvent`, `WindowOrigin` |
| `src/shell/desk/deskStore.ts` | 1 | pure reducer |
| `src/shell/desk/deskStore.test.ts` | 1 | reducer semantics |
| `src/shell/desk/selectors.ts` | 2 | `barItems`, `visibleWindows`, `deskSummary`, `reconcileArtifacts` |
| `src/shell/desk/selectors.test.ts` | 2 | selector decisions |
| `src/shell/skins/types.ts` | 3 | `SkinKey`, `ShellSkin`, slot unions |
| `src/shell/skins/registry.ts` | 3 | `SHELL_SKINS`, `resolveSkin`, `SKIN_KEYS` |
| `src/shell/skins/registry.test.ts` | 3 | registry invariants (incl. `restoreVia`) |
| `src/journal/registry.ts` | 4 | `desk` store; version bump lives in persistence.ts |
| `src/journal/persistence.ts` | 4 | `JOURNAL_VERSION = 2` |
| `src/telemetry.ts` | 5 | `shell_switch` event, `shell` on `Arm`, `shellSwitch()` |
| `src/shell/skins/parts/*.tsx` | 6–7 | Wallpaper, TopBars, Taskbar, Shelf, Timeline, SourceRail, DeskIcons |
| `src/shell/skins/ShellFrame.tsx` | 6–7 | slot composition |
| `src/shell/ProgramWindow.tsx` | 6 | minimize control + chrome variants |
| `src/artifacts/ArtifactWindow.tsx` | 6 | rect/z/minimize from desk store; chrome variant |
| `src/App.tsx` | 6–8 | desk wiring, `?shell=`, layout deps, band second row |
| `src/shell/RegisterBand.tsx` | 8 | shell row |
| `src/shell/MenuBar.tsx` | 8 | pill shows skin beside register |
| `src/shell/Dock.tsx` | 7 | retired (launcher role moves into taskbar/source-rail parts) |
| `src/shell/windowState.ts` | 6 | keep `clampWindow`/`MIN_W`/`MIN_H`; retire load/save |

Baseline commit note: record `git rev-parse HEAD` before Task 1.

---

### Task 1: Desk store — types + reducer

**Files:**
- Create: `src/shell/desk/types.ts`, `src/shell/desk/deskStore.ts`
- Test: `src/shell/desk/deskStore.test.ts`

**Interfaces:**
- Consumes: `WindowRect` from `src/shell/windowState.ts`; `SkinKey` from `src/shell/skins/types.ts` — **Task 3 creates that file; to keep Task 1 self-contained, create `src/shell/skins/types.ts` in THIS task containing only** `export type SkinKey = 'familiar' | 'material' | 'provenance' | 'conversation';` (Task 3 extends the same file).
- Produces: `deskReduce(s: DeskState, e: DeskEvent): DeskState`, `initialDeskState(activeProgram: string, rect: WindowRect): DeskState`, `programWindowId(programId: string): string`, `artifactWindowId(artifactId: string): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shell/desk/deskStore.test.ts
import { describe, expect, it } from 'vitest';
import { deskReduce, initialDeskState, programWindowId, artifactWindowId } from './deskStore';
import type { DeskState } from './types';

const R = { x: 48, y: 48, w: 680, h: 620 };
const open = (s: DeskState, id: string, kind: 'program' | 'artifact', origin: 'you' | 'agent', at: number): DeskState =>
  deskReduce(s, { type: 'window.open', id, kind, refId: id.split(':')[1], rect: R, origin, at });

describe('deskStore', () => {
  it('sparse start: exactly one window — the active program, origin you, focused', () => {
    const s = initialDeskState('word', R);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0]).toMatchObject({ id: programWindowId('word'), kind: 'program', refId: 'word', origin: 'you', minimized: false });
    expect(s.focusedId).toBe(programWindowId('word'));
    expect(s.skin).toBe('familiar');
  });

  it('open with a NEW id appends on top and focuses', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    expect(s.windows).toHaveLength(2);
    expect(s.focusedId).toBe('artifact:a1');
    const [prog, art] = s.windows;
    expect(art.z).toBeGreaterThan(prog.z);
    expect(art.origin).toBe('agent');
  });

  it('open with a KNOWN id is focus+restore, never a duplicate', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });
    const zBefore = s.windows.find(w => w.id === 'artifact:a1')!.z;
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 99);
    expect(s.windows).toHaveLength(2);                                   // no duplicate
    const a1 = s.windows.find(w => w.id === 'artifact:a1')!;
    expect(a1.minimized).toBe(false);                                    // restored
    expect(a1.z).toBeGreaterThan(zBefore);                               // raised
    expect(a1.openedAt).toBe(10);                                        // openedAt NEVER rewritten (bar order stability)
    expect(s.focusedId).toBe('artifact:a1');
  });

  it('focus raises, un-minimizes, and sets focusedId in one event', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });
    s = deskReduce(s, { type: 'window.focus', id: 'artifact:a1' });
    const a1 = s.windows.find(w => w.id === 'artifact:a1')!;
    expect(a1.minimized).toBe(false);
    expect(s.focusedId).toBe('artifact:a1');
    expect(a1.z).toBe(Math.max(...s.windows.map(w => w.z)));
  });

  it('minimize hands focus to the highest-z non-minimized window, else null', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });     // focused one goes away
    expect(s.focusedId).toBe(programWindowId('word'));
    s = deskReduce(s, { type: 'window.minimize', id: programWindowId('word') });
    expect(s.focusedId).toBe(null);
  });

  it('close removes and hands focus the same way', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.close', id: 'artifact:a1' });
    expect(s.windows.map(w => w.id)).toEqual([programWindowId('word')]);
    expect(s.focusedId).toBe(programWindowId('word'));
  });

  it('move replaces rect only; skin switch changes NOTHING but skin', () => {
    let s = initialDeskState('word', R);
    const moved = { x: 100, y: 100, w: 700, h: 500 };
    s = deskReduce(s, { type: 'window.move', id: programWindowId('word'), rect: moved });
    expect(s.windows[0].rect).toEqual(moved);
    const before = s.windows;
    s = deskReduce(s, { type: 'desk.skin', skin: 'material' });
    expect(s.skin).toBe('material');
    expect(s.windows).toBe(before);                                       // identity: no window touched
  });

  it('unknown ids are no-ops (identity), matching artifactStore discipline', () => {
    const s = initialDeskState('word', R);
    for (const e of [
      { type: 'window.close', id: 'artifact:ghost' } as const,
      { type: 'window.focus', id: 'artifact:ghost' } as const,
      { type: 'window.minimize', id: 'artifact:ghost' } as const,
      { type: 'window.move', id: 'artifact:ghost', rect: R } as const,
    ]) expect(deskReduce(s, e)).toBe(s);
  });

  it('desk.restore replaces state wholesale (journal compaction path)', () => {
    const s = initialDeskState('word', R);
    const other = initialDeskState('excel', R);
    expect(deskReduce(s, { type: 'desk.restore', state: other })).toBe(other);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shell/desk/` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/shell/desk/types.ts
// The window inventory (spec §1). The store OWNS geometry/order/visibility and NEVER content:
// a window carries refId, titles resolve at selector time from the owning store, so a retitled
// artifact can never keep a stale window label.
import type { WindowRect } from '../windowState';
import type { SkinKey } from '../skins/types';

export type WindowKind = 'program' | 'artifact';
export type WindowOrigin = 'you' | 'agent';

export interface DeskWindow {
  id: string;            // programWindowId(...) | artifactWindowId(...)
  kind: WindowKind;
  refId: string;
  rect: WindowRect;
  z: number;
  minimized: boolean;
  origin: WindowOrigin;  // stamped at open, never changes (skin C's title tag)
  openedAt: number;      // stable bar-order key — never rewritten, even by reopen
}

export interface DeskState {
  windows: DeskWindow[];
  focusedId: string | null;
  nextZ: number;
  skin: SkinKey;
}

export type DeskEvent =
  | { type: 'window.open'; id: string; kind: WindowKind; refId: string; rect: WindowRect; origin: WindowOrigin; at: number }
  | { type: 'window.close'; id: string }
  | { type: 'window.focus'; id: string }
  | { type: 'window.minimize'; id: string }
  | { type: 'window.move'; id: string; rect: WindowRect }
  | { type: 'desk.skin'; skin: SkinKey }
  | { type: 'desk.restore'; state: DeskState };
```

```ts
// src/shell/desk/deskStore.ts
import type { DeskEvent, DeskState, DeskWindow } from './types';
import type { WindowRect } from '../windowState';

export const programWindowId = (programId: string) => `program:${programId}`;
export const artifactWindowId = (artifactId: string) => `artifact:${artifactId}`;

export function initialDeskState(activeProgram: string, rect: WindowRect): DeskState {
  // Sparse start (spec §0b): first contact opens ONE window — the active program. Density is
  // earned; a returning desk restores whatever the journal says was open.
  const w: DeskWindow = {
    id: programWindowId(activeProgram), kind: 'program', refId: activeProgram,
    rect, z: 1, minimized: false, origin: 'you', openedAt: 0,
  };
  return { windows: [w], focusedId: w.id, nextZ: 2, skin: 'familiar' };
}

const fallbackFocus = (windows: DeskWindow[]): string | null => {
  const visible = windows.filter(w => !w.minimized);
  if (!visible.length) return null;
  return visible.reduce((a, b) => (b.z > a.z ? b : a)).id;
};

export function deskReduce(s: DeskState, e: DeskEvent): DeskState {
  switch (e.type) {
    case 'window.open': {
      const existing = s.windows.find(w => w.id === e.id);
      if (existing) {
        // Reopen = focus + restore. openedAt is NOT rewritten: bar order must stay stable
        // under the user's hand (research §5).
        const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: false, z: s.nextZ } : w);
        return { ...s, windows, focusedId: e.id, nextZ: s.nextZ + 1 };
      }
      const w: DeskWindow = { id: e.id, kind: e.kind, refId: e.refId, rect: e.rect, z: s.nextZ, minimized: false, origin: e.origin, openedAt: e.at };
      return { ...s, windows: [...s.windows, w], focusedId: e.id, nextZ: s.nextZ + 1 };
    }
    case 'window.close': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.filter(w => w.id !== e.id);
      return { ...s, windows, focusedId: s.focusedId === e.id ? fallbackFocus(windows) : s.focusedId };
    }
    case 'window.focus': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: false, z: s.nextZ } : w);
      return { ...s, windows, focusedId: e.id, nextZ: s.nextZ + 1 };
    }
    case 'window.minimize': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      const windows = s.windows.map(w => w.id === e.id ? { ...w, minimized: true } : w);
      return { ...s, windows, focusedId: s.focusedId === e.id ? fallbackFocus(windows) : s.focusedId };
    }
    case 'window.move': {
      if (!s.windows.some(w => w.id === e.id)) return s;
      return { ...s, windows: s.windows.map(w => w.id === e.id ? { ...w, rect: e.rect as WindowRect } : w) };
    }
    case 'desk.skin':
      // Skins change furniture, never geometry: windows array is passed through by IDENTITY —
      // the reducer cannot move a window the user placed (spec §1, tested).
      return { ...s, skin: e.skin };
    case 'desk.restore':
      return e.state;
    default:
      return s;
  }
}
```

Create `src/shell/skins/types.ts` with only the `SkinKey` line (see Interfaces).

- [ ] **Step 4: Run tests** — `npx vitest run` → all pass (≥864 + new). `npx tsc --noEmit`. `npx vite build`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(desk): window inventory — pure desk store (open/close/focus/minimize/move, sparse start)"`

---

### Task 2: Desk selectors

**Files:**
- Create: `src/shell/desk/selectors.ts`
- Test: `src/shell/desk/selectors.test.ts`

**Interfaces:**
- Consumes: Task 1 types + `deskReduce`/`initialDeskState`/ids.
- Produces:
  - `interface BarItem { id: string; title: string; kind: WindowKind; origin: WindowOrigin; minimized: boolean; focused: boolean }`
  - `barItems(desk: DeskState, resolveTitle: (w: DeskWindow) => string): BarItem[]`
  - `visibleWindows(desk: DeskState): DeskWindow[]` (non-minimized, ascending z)
  - `deskSummary(desk: DeskState): { pieces: number; sources: number }` (pieces = artifact windows, sources = program windows)
  - `reconcileArtifacts(desk: DeskState, liveArtifactIds: string[], now: number): DeskState` — pure; cascades new rects `{ x: 0.55*plane arrival handled by caller — use fixed base { x: 560, y: 80 } + 24/16 per index }`; removes windows whose artifact is gone; returns `desk` by identity when nothing changes (the S4 prune lesson: derived lists reconcile against live truth, and effects keyed on identity must not loop).

- [ ] **Step 1: Failing tests** — cover: `barItems` ordered by `openedAt` and **stable when focus changes** (open a1 then a2, focus a1, assert order unchanged); titles come from `resolveTitle` (pass `w => w.refId.toUpperCase()`, assert `'A1'`); `visibleWindows` excludes minimized and sorts ascending z; `deskSummary` counts; `reconcileArtifacts` adds a window for a live artifact with none (origin `'agent'`, id `artifactWindowId(id)`), removes a window whose artifact is gone, returns identity when in sync, and cascades two new artifacts to distinct rects.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (straightforward; `reconcileArtifacts` composes `deskReduce` calls internally so semantics stay in one place).
- [ ] **Step 4: Full suite + tsc + build.**
- [ ] **Step 5: Commit** — `feat(desk): selectors — barItems (openedAt-stable), visibleWindows, deskSummary, reconcileArtifacts`

---

### Task 3: Skin registry

**Files:**
- Modify: `src/shell/skins/types.ts` (extend)
- Create: `src/shell/skins/registry.ts`
- Test: `src/shell/skins/registry.test.ts`

**Interfaces — produce exactly (spec §2, §0b):**

```ts
// types.ts (full)
export type SkinKey = 'familiar' | 'material' | 'provenance' | 'conversation';
export interface ShellSkin {
  key: SkinKey; label: string; glyph: string;
  ethos: string; probe: string;
  assumesRung: 'none' | 'R2' | 'R4';
  slots: {
    background: 'wallpaper' | 'paper' | 'dark' | 'flat';
    topBar: 'menu' | 'desk' | 'session' | 'minimal';
    bottomBar: 'taskbar' | 'shelf' | 'timeline' | 'none';
    sideRail: 'icons' | 'sources' | 'none';
    windowChrome: 'full' | 'minimal' | 'provenance';
    surfaces: 'float' | 'material' | 'column';
    restoreVia: 'bottomBar' | 'column';
  };
}
```

```ts
// registry.ts — the four skins, verbatim slot table from spec §3
export const SHELL_SKINS: ShellSkin[] = [
  { key: 'familiar', label: 'Familiar', glyph: '⊞', assumesRung: 'none',
    ethos: 'A computer you already know — the agent is the only new thing in the room.',
    probe: 'Does a conventional desktop make the agent\'s reach legible fastest?',
    slots: { background: 'wallpaper', topBar: 'menu', bottomBar: 'taskbar', sideRail: 'icons', windowChrome: 'full', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'material', label: 'Material', glyph: '◈', assumesRung: 'R4',
    ethos: 'What you have made is the desk; programs are sources you draw from.',
    probe: 'Does foregrounding made material change what people make?',
    slots: { background: 'paper', topBar: 'desk', bottomBar: 'shelf', sideRail: 'sources', windowChrome: 'minimal', surfaces: 'material', restoreVia: 'bottomBar' } },
  { key: 'provenance', label: 'Provenance', glyph: '◷', assumesRung: 'R2',
    ethos: 'The desk is a visible record — who did what, witnessed or not.',
    probe: 'Does visible provenance change trust and correction rate?',
    slots: { background: 'dark', topBar: 'session', bottomBar: 'timeline', sideRail: 'none', windowChrome: 'provenance', surfaces: 'float', restoreVia: 'bottomBar' } },
  { key: 'conversation', label: 'Conversation', glyph: '◍', assumesRung: 'none',
    ethos: 'The agent holds the centre; windows orbit the talk.',
    probe: 'Does centring conversation reduce pointing?',
    slots: { background: 'flat', topBar: 'minimal', bottomBar: 'none', sideRail: 'none', windowChrome: 'minimal', surfaces: 'column', restoreVia: 'column' } },
];
export const SKIN_KEYS = SHELL_SKINS.map(s => s.key);
export function resolveSkin(key: string): ShellSkin { /* find ?? SHELL_SKINS[0] is FORBIDDEN — return familiar ONLY for the literal 'familiar'; unknown key returns the DEFAULT with a console.warn is also forbidden. Return type ShellSkin | null; callers handle null honestly. */ }
```

`resolveSkin(key: string): ShellSkin | null` — null for unknown keys. The `?shell=` param handler treats null as "ignore, use current" (mirrors how bad URL params are handled elsewhere; no silent Word-style fallback).

- [ ] **Step 1: Failing tests** — every skin with `bottomBar: 'none'` has `restoreVia: 'column'` (the minimize-into-nowhere guard, iterated over the registry so a fifth skin is covered on arrival); all four keys unique; `resolveSkin('familiar')` returns the def, `resolveSkin('windows95')` returns null; every skin declares `assumesRung`.
- [ ] **Step 2–4: red → implement → full suite + tsc + build.**
- [ ] **Step 5: Commit** — `feat(skins): shell skin registry — four skins, restoreVia invariant, assumesRung`

---

### Task 4: Journal integration

**Files:**
- Modify: `src/journal/registry.ts`, `src/journal/persistence.ts:9`
- Test: extend `src/journal/registry.test.ts`

**Interfaces:**
- Consumes: `deskReduce`, `initialDeskState`, `DeskState`/`DeskEvent` from Task 1.
- Produces: `JOURNAL_REGISTRY.desk` following the exact `StoreSpec` pattern of `dials` (registry.ts:45-70): `initial: () => initialDeskState(DEFAULT_PROGRAM, DEFAULT_RECT)` where `DEFAULT_RECT = { x: 48, y: 48, w: 680, h: 620 }` (the current boot rect from App.tsx:948), `reduce: deskReduce`, `snapshotEvent: (s: DeskState) => ({ type: 'desk.restore', state: s })`.

- [ ] **Step 1: Failing tests** — the "registers exactly the four persisted stores" test at `src/journal/registry.test.ts:51` becomes **five** and will fail first (update it); add: desk events replay (open→minimize→skin survives a replay round-trip through the real journal `replay`); compaction snapshot restores the full desk (windows + skin together — the unified-store rationale, spec §6).
- [ ] **Step 2: Red.**
- [ ] **Step 3: Implement** — add the store; set `JOURNAL_VERSION = 2` in persistence.ts with a comment naming why (`desk store added — v1 journals have no desk and must quarantine, not half-restore`).
- [ ] **Step 4: Full suite + tsc + build.** Verify by hand-running the persistence test file that a v1 payload is rejected as `unsupported version 1` (the existing version-gate test should already cover the mechanism; extend it to assert v1-specifically if it doesn't).
- [ ] **Step 5: Commit** — `feat(journal): desk store persists — JOURNAL_VERSION 2`

---

### Task 5: Telemetry

**Files:**
- Modify: `src/telemetry.ts`
- Test: extend `src/telemetry.test.ts`

**Interfaces:**
- Produces: event `{ t, type: 'shell_switch', from: SkinKey, to: SkinKey, midSession: boolean }` in the event union (beside `register_switch`, telemetry.ts:66); method `shellSwitch(from, to, midSession)` (beside `registerSwitch`, :133); `Arm` (:32) gains `shell?: SkinKey`; the export filename/config string at :252-253 appends the shell the way it appends register.

- [ ] **Step 1: Failing tests** — `shellSwitch` pushes the event with the right shape; `snapshot()` carries it; the Arm round-trips `shell`; **`metrics()` is unchanged by shell events** (assert `errors`, `actions.total`, and `asks` counts are identical before/after a `shellSwitch` — the register-arm error-rate doctrine applied to the new axis).
- [ ] **Step 2–4: red → implement → full suite + tsc + build.**
- [ ] **Step 5: Commit** — `feat(telemetry): shell_switch + shell on the session arm`

---

### Task 6: App wiring — the desk replaces ad-hoc window state

The big integration task. Standard model, full care: this file's failure modes are stale refs and effects that loop.

**Files:**
- Modify: `src/App.tsx`, `src/shell/ProgramWindow.tsx`, `src/artifacts/ArtifactWindow.tsx`, `src/shell/windowState.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces (for Task 7): `desk: DeskState` app state + `deskDispatchJ` (journaled dispatch, following the exact pattern of `artifactDispatchJ`); `deskRef` mirror (synchronous write on dispatch — this file's signature failure is clearing state but not the ref); `ShellFrame` mount point receiving `{ skin, desk, barItems, onBarClick, onSkinSelect }`.

Steps (each with its own verification):

- [ ] **Step 1**: Desk state + journaled dispatch. Boot from `bootStates?.desk ?? initialDeskState(activeProgram, clamped loadWindowRect fallback)`. Delete `windowRect`/`windowOpen` `useState` (App.tsx:948-955) and the `saveWindowRect` effect; keep `clampWindow` for drag. `deskRef.current` written synchronously in the dispatch wrapper.
- [ ] **Step 2**: `ProgramWindow` reads rect from the desk (`desk.windows` find by `programWindowId(activeProgram)`), `onRectChange` dispatches `window.move`, close button dispatches `window.minimize` (**not close** — spec §1: the program window minimizes; the dock-reopen path becomes `window.open` which is focus+restore). Add a minimize button beside close (both `hit-24`, aria-labelled). Chrome variant prop `chrome: 'full' | 'minimal' | 'provenance'` + `origin` for the provenance tag (render `yours`/`agent` chip when `chrome === 'provenance'`).
- [ ] **Step 3**: `ArtifactWindow` drops its index-cascade `style` (ArtifactWindow.tsx:150) for a rect from the desk; add the same chrome variants; z from the desk; clicking anywhere in a window dispatches `window.focus` (guard: only when not already focused, to avoid dispatch storms on every click).
- [ ] **Step 4**: Reconcile effect — `useEffect` on `[artifactState.artifacts]` dispatching nothing when `reconcileArtifacts` returns identity (that identity contract is what prevents the loop). Program-change effect opens/focuses `programWindowId(next)` and minimizes the previous program window.
- [ ] **Step 5**: `?shell=` boot param via `resolveSkin` (null → ignore); skin switch handler dispatches `desk.skin` + `telemetry.shellSwitch(prev, next, isLive)`.
- [ ] **Step 6**: **Re-measurement**: add `desk.skin` and the desk windows signature (`desk.windows.map(w => `${w.id}:${w.rect.x},${w.rect.y},${w.rect.w},${w.rect.h},${w.minimized}`).join('|')`) to the layout-scan effect deps (App.tsx:1260 `updateLayout` effect — it currently keys on `windowRect, windowOpen, mockDoc`; replace those two dead keys with the desk signature).
- [ ] **Step 7**: Verification — no App test harness exists: state exactly what was verified by reading (every `setDesk` site writes the ref; the reconcile effect's identity guard; the layout deps). Full suite + tsc + build must stay green; run the app once via `npx vite` and confirm boot, drag, minimize/restore, artifact windows appear (report what you saw).
- [ ] **Step 8: Commit** — `feat(desk): App runs on the window inventory — minimize/restore, reconcile, ?shell=, re-measure on skin`

**Carry-in from the gate phase (do not regress):** `pendingActionRef`/`askRef`/`lastAnswerRef` discipline is untouched; nothing in this task may reorder the gate/dedupe/ask block at App.tsx:1740-1900.

---

### Task 7: ShellFrame + the four skins' parts

**Files:**
- Create: `src/shell/skins/ShellFrame.tsx`, `src/shell/skins/parts/Background.tsx`, `parts/TopBar.tsx`, `parts/Taskbar.tsx`, `parts/Shelf.tsx`, `parts/Timeline.tsx`, `parts/SourceRail.tsx`, `parts/DeskIcons.tsx`
- Create: `src/shell/skins/parts/timelineItems.ts` + `timelineItems.test.ts` (pure)
- Modify: `src/App.tsx` (mount ShellFrame; retire `<Dock>`), delete `src/shell/Dock.tsx`
- Test: `src/shell/skins/parts/timelineItems.test.ts`

Slot → part mapping is mechanical; the decisions live in already-tested selectors (`barItems`, `visibleWindows`, `deskSummary`) plus ONE new pure function:

- `timelineItems(activity: ActivityEntry[], limit: number): TimelineItem[]` — maps the existing `activityStore` entries (`src/shell/activityStore.ts` — kinds incl. `'ask'`) to the four-lane timeline rows (`{ actor: 'you' | 'agent' | 'witnessed' | 'waiting', text, at }`), most recent last, `waiting` appended when the newest entry is an open ask. TDD it: an `'ask'` entry yields `agent` + a trailing `waiting` lane; a commit yields `witnessed`; capped at `limit`.

Rendering rules (all skins):
- Taskbar/Shelf render `barItems` in order; click = `window.open` dispatch (focus+restore semantics from Task 1); active item = `focused`, minimized items dimmed. Program launchers for non-open programs render from `PROGRAMS` after the bar items (Familiar) / in the SourceRail (Material).
- All parts are `data-shell` + `onPointerDown` stopPropagation, matching MenuBar/Dock convention (they must not become deixis targets).
- Wallpaper/paper/dark/flat are CSS backgrounds on the plane — behind `z-10` windows, never intercepting pointer events (`pointer-events-none`).
- Conversation skin: `surfaces: 'column'` renders the existing omnibox/rail column centred with windows at reduced opacity — it repositions existing components, it does NOT fork them.
- Every interactive element ≥ the `hit-24` standard; keyboard reachable.

- [ ] Steps: TDD `timelineItems` first (red → green), then parts, then ShellFrame composition, then mount + delete Dock (its reopen behaviour now lives on taskbar/shelf/source-rail clicks). Full suite + tsc + build. `npx vite` visual check of all four skins via `?shell=` (report what you saw per skin, including that the ask card and chips render in each).
- [ ] **Commit** — `feat(skins): ShellFrame + Familiar/Material/Provenance/Conversation parts; Dock retired`

---

### Task 8: The switch — band second row + pill

**Files:**
- Modify: `src/shell/RegisterBand.tsx`, `src/shell/MenuBar.tsx`, `src/App.tsx`, `src/register/bandKeys.ts` (+ its test)

**Interfaces:**
- Consumes: `SHELL_SKINS`, `resolveSkin`, the Task 6 skin-switch handler.
- Produces: band renders a second row of 4 skin notches under the register row; **digits 1-5 keep selecting registers; skin notches are click/arrow-key only in this phase** (avoids re-opening the swallowed-digit contract in `bandKeys.ts` — extending digit chords to 10 targets is its own decision, deferred and noted in the band caption). Hover caption shows skin `ethos — probe` + `assumes R…` via the same caption mechanism as registers. Pill (MenuBar.tsx:16-18) shows `glyph label · skinGlyph skinLabel`.

- [ ] Steps: extend `RegisterBand` props with `{ skin: SkinKey, onSelectSkin }`; render the row; update the pill; wire in App. If `bandKeys.ts` needs any change, TDD it; otherwise assert by test that digits still resolve registers only. Full suite + tsc + build.
- [ ] **Commit** — `feat(shell): skin row on the register band + pill shows the current shell`

---

### Task 9: Keyless browser drive

**Files:**
- Create: `docs/superpowers/smokes/2026-07-28-shell-browser-drive.md` (results)
- Reuse: the Task-6 harness pattern from `.superpowers/sdd/2026-07-28-missing-information-gate/task-6-harness/` (chrome-headless-shell screenshots; `[data-shell] input` omnibox selector; stub key — never touch `.env`).

Checklist (each row PASS/FAIL with screenshot evidence — look at the screenshots, a blank frame is a failed launch):

- [ ] SH-1 boot on `?shell=familiar`: wallpaper + taskbar + one window (sparse start), clock ticking
- [ ] SH-2 minimize the program window from its control → taskbar item dims → click it → restores at the SAME rect
- [ ] SH-3 `?artifacts=1` demo: artifact windows appear in the bar as they're created; close one → bar item leaves
- [ ] SH-4 drag a window, switch skin via band, switch back → rect preserved byte-identical
- [ ] SH-5 after a skin switch, hover an entity → deixis pill names it (re-measurement proof)
- [ ] SH-6 all four skins: the ask card, candidate chips, and quick-fire digits work (drive the gate demo path); ordinary chips intact under a bare ask
- [ ] SH-7 conversation skin: minimized window restores from the column list (restoreVia proof)
- [ ] SH-8 provenance skin: agent-made artifact window shows `agent` tag; program window shows `yours`; timeline shows the ask as `agent` lane + `waiting`
- [ ] SH-9 band: skin hover captions show ethos/probe/assumesRung; digits still select registers only
- [ ] SH-10 journal: switch skin + move a window, reload → desk restores (skin + rects + minimized set); `New desk` → sparse start returns
- [ ] SH-11 export: session file carries `shell` on the arm and a `shell_switch` event
- [ ] Owed live-smoke rows appended to the standing sitting doc (mid-session skin switch with a live model; reconnect caveat noted — the known reconnect defect gates register/backend switches until fixed)
- [ ] **Commit** — `test(shell): keyless browser drive — inventory, skins, restore, re-measure`

---

## Self-review (done while writing)

- Spec coverage: §1 store → T1/T2; §2 framework+restoreVia → T3/T7; §0b ladder (assumesRung, sparse start) → T3/T1; §3 four skins → T3/T7; §4 switch → T8 (+`?shell=` in T6); §5 invariants → T6 carry-in + SH-6; §6 journal/version → T4; §7 re-measure → T6 step 6 + SH-5; §8 file map → header table; §9 verification → T9; §10 exclusions honoured (no multi-program windows: the desk holds ONE program window, others minimize on program change).
- Type consistency: `DeskState.skin: SkinKey` defined in T1 via the T1-created `skins/types.ts`; T3 extends the same file — no circular import (desk → skins/types only; skins/registry → nothing from desk; ShellFrame → both).
- No placeholders: every test named concretely; `resolveSkin` deliberately `| null` with the fallback ban stated inline.
