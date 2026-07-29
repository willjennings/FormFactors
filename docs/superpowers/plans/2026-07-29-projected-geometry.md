# Projected Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each shell skin *render* the desk differently without ever *owning* its geometry, so Material and Conversation can achieve the spatial probes they currently claim but don't deliver.

**Architecture:** `DeskWindow.rect` stays the authored rect — the only thing journaled. A new pure `projectDesk(skin, desk, plane)` computes what is drawn; components render from it. A dragged window "touch promotes": its projected rect becomes authored, `placed` goes true, and it is never projected again.

**Tech Stack:** React 19 + TypeScript + Tailwind v4, vitest (`environment: 'node'`, no jsdom), existing desk store / skin registry / journal.

## Global Constraints

- **Full suite every task**: `npx vitest run` — baseline **936 tests / 106 files** is the floor. Never scope a gate to a subdirectory.
- `npx tsc --noEmit` clean and `npx vite build` succeeds. **These now mean more than they used to**: `@types/react` is installed, so JSX props and hook values are genuinely checked.
- **No new dependencies.**
- **`JOURNAL_VERSION` goes 2 → 3 exactly once**, in Task 1. No other task touches it.
- Do not alter the gate/dedupe/ask block in `App.tsx` (search `ACTION_VERB_NAMES.includes(fc.name)`, `shouldDedupeConfirm`).
- **The five desk invariants hold unchanged**: `desk.skin` passes `windows` by identity (its `toBe` test stands as written); `barItems` orders by `openedAt`; every skin declares `restoreVia`; only authored rects are journaled; the desk store never owns content.
- `projectDesk` is **pure**: no time, no randomness, no DOM reads. It is the one place a skin's geometry decision may live.
- **Every projected rect is clamped to the plane before it leaves `projectDesk`.** A projection that cannot fit a window legibly returns identity for that window rather than something off-screen.
- **Never modify `.env`** — it holds a real API key.
- Comment accuracy is part of every deliverable: verify every factual sentence and re-resolve cited line numbers after your own edits. This project has shipped a false comment *while fixing others* three times.
- Verification standard: **behavioural revert** (undo the behaviour, keep signatures, confirm the covering test fails, restore, confirm the tree is clean) — never compile-shape.
- There is **no App-level test harness**. Anything left in a component is verified by reading plus a browser drive. Put decisions in the pure layer.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/shell/desk/types.ts` | 1 | `placed: boolean` on `DeskWindow` |
| `src/shell/desk/deskStore.ts` | 1 | default `placed: false` on open; set true on a user move |
| `src/shell/desk/deskStore.test.ts` | 1 | `placed` semantics |
| `src/journal/persistence.ts` | 1 | `JOURNAL_VERSION` → 3 |
| `src/shell/skins/projectDesk.ts` | 2 | **new** — `projectDesk`, per-skin projections, output clamping |
| `src/shell/skins/projectDesk.test.ts` | 2 | identity, Material/Conversation shapes, clamp property, `placed` skipping |
| `src/shell/ProgramWindow.tsx` | 3 | drag in projected space; settled dispatch promotes |
| `src/artifacts/ArtifactWindow.tsx` | 4 | render from the projection |
| `src/App.tsx` | 3,4,5 | thread the projection; extend the layout signature with projected rects |
| `src/shell/desk/selectors.ts` | 5 | revisit `ARTIFACT_BASE_RECT` |
| `docs/superpowers/smokes/2026-07-30-projected-geometry-drive.md` | 6 | drive results |

Record BASE (`git rev-parse HEAD`) before Task 1.

---

### Task 1: `placed` on the window, and the version bump

**Files:**
- Modify: `src/shell/desk/types.ts`, `src/shell/desk/deskStore.ts`, `src/journal/persistence.ts`
- Test: `src/shell/desk/deskStore.test.ts`

**Interfaces:**
- Consumes: existing `DeskWindow`, `DeskEvent`, `deskReduce`.
- Produces: `DeskWindow.placed: boolean`; `window.move` gains an optional `byUser?: boolean` discriminator so the reducer can tell a user drag from a boot-fit.

**Why `placed` must exist:** a projected window that the user drags has to stop being projected, or the next projection moves it again *from its new authored value* and it walks across the screen.

**Why the version bumps:** `DeskWindow` is a persisted shape. A v2 journal has no `placed`, and guessing it either way is wrong — defaulting true freezes every restored desk out of projection, defaulting false lets a skin move something the user placed. The existing version gate refusing v2 outright is the honest outcome, and the in-app "Previous desk could not be restored" path already exists to surface it.

- [ ] **Step 1: Write the failing tests**

```ts
// added to src/shell/desk/deskStore.test.ts
it('a newly opened window is not placed — the desk positioned it', () => {
  const s = initialDeskState('word', R);
  expect(s.windows[0].placed).toBe(false);
});

it('a USER move marks the window placed; a boot-fit move does not', () => {
  let s = initialDeskState('word', R);
  const id = programWindowId('word');
  const moved = { x: 100, y: 100, w: 700, h: 500 };
  s = deskReduce(s, { type: 'window.move', id, rect: moved });            // boot-fit: no byUser
  expect(s.windows[0].placed).toBe(false);
  expect(s.windows[0].rect).toEqual(moved);
  s = deskReduce(s, { type: 'window.move', id, rect: moved, byUser: true });
  expect(s.windows[0].placed).toBe(true);
});

it('placed is sticky — a later boot-fit cannot un-place a user-placed window', () => {
  let s = initialDeskState('word', R);
  const id = programWindowId('word');
  s = deskReduce(s, { type: 'window.move', id, rect: R, byUser: true });
  s = deskReduce(s, { type: 'window.move', id, rect: { x: 0, y: 0, w: 400, h: 300 } });
  expect(s.windows[0].placed).toBe(true);
});

it('JOURNAL_VERSION is 3 — placed changed a persisted shape', () => {
  expect(JOURNAL_VERSION).toBe(3);
});

it('a v2 payload is REJECTED, not half-restored', () => {
  const r = loadJournal(stubStorageWith({ v: 2, entries: [] }));
  expect('failed' in r && r.failed).toBe('unsupported version 2');
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run` → FAIL (`placed` undefined; version is 2).
- [ ] **Step 3: Implement.** `placed: false` in `initialDeskState` and in `window.open`'s new-window branch. In `window.move`, `placed: e.byUser === true ? true : w.placed` — **sticky, never cleared**. Add the v2-rejection test beside the existing v99 one (do not weaken or replace it).
- [ ] **Step 4: Full suite + tsc + build.**
- [ ] **Step 5: Behavioural revert** — make `placed` non-sticky (`placed: e.byUser === true`), confirm the stickiness test fails, restore, confirm the tree is clean.
- [ ] **Step 6: Commit** — `feat(desk): placed — the desk positioned it, or you did; JOURNAL_VERSION 3`

---

### Task 2: `projectDesk` — the pure projection

**Files:**
- Create: `src/shell/skins/projectDesk.ts`, `src/shell/skins/projectDesk.test.ts`

**Interfaces:**
- Consumes: `ShellSkin` / `SkinKey` from `src/shell/skins/`; `DeskState`, `DeskWindow` from `src/shell/desk/types`; `clampWindow`, `WindowRect`, `MIN_W`, `MIN_H` from `src/shell/windowState`.
- Produces:
  ```ts
  export interface ProjectedRect { id: string; rect: WindowRect }
  export function projectDesk(skin: ShellSkin, desk: DeskState, plane: { width: number; height: number }): ProjectedRect[]
  ```
  Returns one entry per window in `desk.windows`, same order. **Nothing under `src/shell/skins/` may import from `src/shell/desk/` except types** — keep the dependency one-way, as `skins/types.ts` already documents.

**The projections:**
- `familiar`, `provenance` → identity for every window.
- `material` → artifact windows scale up toward the plane centre; program windows shrink and dock toward the left source rail. Artifacts end up the largest objects on screen — that is the point of the skin.
- `conversation` → windows translate outward from the centre column and shrink; the column's width is a shared constant with `ShellFrame`, imported, not re-typed.

**Three properties, all tested:**
1. A window with `placed: true` projects to **its authored rect, unchanged, in every skin**.
2. Every returned rect satisfies `clampWindow(rect, plane) === rect`-equivalent — inside the plane, at least `MIN_W`×`MIN_H`.
3. Projection is **stable**: `projectDesk(skin, deskWhoseRectsAreTheProjection, plane)` returns those same rects. (Needed because a promoted window's authored rect *is* a former projection.)

- [ ] **Step 1: Write the failing tests**

```ts
// src/shell/skins/projectDesk.test.ts
import { describe, expect, it } from 'vitest';
import { projectDesk } from './projectDesk';
import { resolveSkin } from './registry';
import { deskReduce, initialDeskState, artifactWindowId, programWindowId } from '../desk/deskStore';

const PLANE = { width: 1600, height: 1000 };
const skin = (k: string) => resolveSkin(k)!;
const withArtifact = () => deskReduce(initialDeskState('word', { x: 48, y: 48, w: 680, h: 620 }), {
  type: 'window.open', id: artifactWindowId('a1'), kind: 'artifact', refId: 'a1',
  rect: { x: 560, y: 80, w: 380, h: 300 }, origin: 'agent', at: 10,
});

describe('projectDesk', () => {
  it('familiar and provenance project identity', () => {
    const d = withArtifact();
    for (const k of ['familiar', 'provenance']) {
      for (const p of projectDesk(skin(k), d, PLANE)) {
        expect(p.rect).toEqual(d.windows.find(w => w.id === p.id)!.rect);
      }
    }
  });

  it('material makes the artifact larger than the program window', () => {
    const d = withArtifact();
    const p = projectDesk(skin('material'), d, PLANE);
    const area = (id: string) => { const r = p.find(x => x.id === id)!.rect; return r.w * r.h; };
    expect(area(artifactWindowId('a1'))).toBeGreaterThan(area(programWindowId('word')));
  });

  it('a PLACED window is never projected — identity in every skin', () => {
    let d = withArtifact();
    const id = artifactWindowId('a1');
    const mine = { x: 120, y: 400, w: 300, h: 200 };
    d = deskReduce(d, { type: 'window.move', id, rect: mine, byUser: true });
    for (const k of ['familiar', 'material', 'provenance', 'conversation']) {
      expect(projectDesk(skin(k), d, PLANE).find(p => p.id === id)!.rect).toEqual(mine);
    }
  });

  it('every projected rect stays inside the plane, on every skin, on a cramped plane', () => {
    const d = withArtifact();
    const tight = { width: 1024, height: 620 };
    for (const k of ['familiar', 'material', 'provenance', 'conversation']) {
      for (const p of projectDesk(skin(k), d, tight)) {
        expect(p.rect.x).toBeGreaterThanOrEqual(0);
        expect(p.rect.y).toBeGreaterThanOrEqual(0);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(tight.width);
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(tight.height);
      }
    }
  });

  it('projection is stable — projecting a projection changes nothing', () => {
    const d = withArtifact();
    for (const k of ['material', 'conversation']) {
      const once = projectDesk(skin(k), d, PLANE);
      const asDesk = { ...d, windows: d.windows.map(w => ({ ...w, rect: once.find(p => p.id === w.id)!.rect })) };
      expect(projectDesk(skin(k), asDesk, PLANE)).toEqual(once);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — module not found.
- [ ] **Step 3: Implement.** Clamp every output through `clampWindow` as the last step, unconditionally. Where a projection would violate the minimum size on a cramped plane, return that window's authored rect instead — and say so in a comment.
- [ ] **Step 4: Full suite + tsc + build.**
- [ ] **Step 5: Behavioural revert** — remove the final clamp, confirm the cramped-plane test fails; then make `placed` windows projectable, confirm that test fails. Restore both; confirm the tree is clean.
- [ ] **Step 6: Commit** — `feat(skins): projectDesk — skins render geometry, they never own it`

---

### Task 3: Touch promotes

**Files:**
- Modify: `src/shell/ProgramWindow.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `projectDesk` (Task 2), `placed` + `byUser` (Task 1).
- Produces: the drag path operates on the **projected** rect and, on settle, dispatches `{ type: 'window.move', rect, byUser: true }`.

Today's drag already separates intermediate frames (unjournaled `deskDispatchLive`) from the settled rect (journaled `window.move`). The change is that the drag's starting rect is the projected one, and only the settled dispatch carries `byUser: true`.

**Consequence to get right:** the boot-fit effect must keep dispatching **without** `byUser`, or a first boot would mark every window placed and projection would never apply. Verify that by reading the boot-fit call site.

- [ ] **Step 1** — thread the projected rect into `ProgramWindow`'s drag start.
- [ ] **Step 2** — settled dispatch carries `byUser: true`; intermediates unchanged.
- [ ] **Step 3** — confirm by reading that the boot-fit and the artifact reconcile paths dispatch without `byUser`.
- [ ] **Step 4: Full suite + tsc + build**, then **drive it**: in Material, drag a projected program window and confirm (a) it follows the cursor from where it *appeared*, not from its authored position, and (b) after switching skins twice it is exactly where you left it. Report what you saw.
- [ ] **Step 5: Commit** — `feat(desk): touch promotes — drag a projected window and it becomes yours`

---

### Task 4: Render from the projection

**Files:**
- Modify: `src/App.tsx`, `src/artifacts/ArtifactWindow.tsx`

**Interfaces:**
- Consumes: `projectDesk`.
- Produces: a memoized `projected` map consumed by both window components; the layout-scan signature extended with projected rects.

**The re-measure requirement (spec §5).** The layout effect already carries `desk.skin` and a window-geometry signature, so a projection change re-measures. But **two skins can project the same authored rect differently**, so the signature must be built from the **projected** rects, not the authored ones. Get this wrong and the scene is measured against geometry it no longer has — the exact class that has bitten this project twice.

- [ ] **Step 1** — memoize `projectDesk(skin, desk, planeSize)`; keep the memo's deps honest (skin, desk.windows, plane).
- [ ] **Step 2** — `ProgramWindow` and `ArtifactWindow` take their rect from the projection.
- [ ] **Step 3** — replace the authored-rect terms in the layout signature with projected ones.
- [ ] **Step 4: Full suite + tsc + build**, then **drive**: switch to Material and confirm hovering an artifact resolves it (`resolveAt` against freshly measured geometry), and that the pointing pill names the artifact rather than a program element beneath it. Report the observed pill text per skin.
- [ ] **Step 5: Commit** — `feat(skins): windows render from the projection; measure what is drawn`

---

### Task 5: Revisit the default rects

**Files:**
- Modify: `src/shell/desk/selectors.ts` (`ARTIFACT_BASE_RECT`), `src/journal/registry.ts` (`DEFAULT_DESK_RECT`) as needed
- Test: `src/shell/desk/selectors.test.ts`

**Why (spec §6).** Even with projection, Material starts from defaults that put a 680-wide program window at `x: 48` and artifacts at `x: 560`. Defaults are what the desk chooses when the user has not — which is now exactly what `placed: false` means, so changing them is in-scope rather than a liberty.

**And there is a debt to pay here.** `ARTIFACT_BASE_RECT`'s fixed `x: 560` is what put artifact windows on top of program entities and turned a previously-harmless deferred ruling into a Critical (the click-vs-hover referent split). Choose defaults that do not overlap the program window at the narrowest plane the device gate admits (`innerWidth >= 1024`), and pin that with a test.

- [ ] **Step 1: Write the failing test** — at a 1024-wide plane, the default artifact rect and the default program rect do not overlap.
- [ ] **Step 2–4:** red → adjust defaults → full suite + tsc + build.
- [ ] **Step 5: Commit** — `fix(desk): default rects that do not stack artifacts on program entities`

---

### Task 6: Keyless browser drive

**Files:**
- Create: `docs/superpowers/smokes/2026-07-30-projected-geometry-drive.md`

Drive with a dependency-free CDP script against `chrome-headless-shell` on **your own** server with inline stub env — do not reuse a server started from the real `.env`. Every row PASS/FAIL with observed evidence; look at what you capture.

- [ ] PG-1 Material genuinely foregrounds artifacts — the largest object on screen is an artifact, not the Word window
- [ ] PG-2 Conversation's windows sit outward from the column and are smaller than in Familiar
- [ ] PG-3 drag a projected window, cycle all four skins, return — rect byte-identical, and it is *not* re-projected
- [ ] PG-4 an unplaced window IS re-projected on skin switch, and its authored rect in the journal never changed
- [ ] PG-5 pointing resolves a projected artifact correctly in every skin (pill text recorded per skin)
- [ ] PG-6 minimize/restore still works in all four, including Conversation's column list
- [ ] PG-7 the ask card and candidate chips render in all four
- [ ] PG-8 reload restores `placed` and skin; a **v2** journal is refused with the honest in-app message rather than half-restored
- [ ] PG-9 no projected window is ever off-plane at 1024×620 (the narrowest the device gate admits) or in testbed mode below it
- [ ] PG-10 `updateLayout` invocation count at rest is unchanged from before this branch — projection must not add scan pressure
- [ ] Owed live-smoke rows appended to the standing sitting doc, marked `pending`, **with the note that B/D spatial results are now admissible** — the condition this phase existed to lift
- [ ] **Commit** — `test(skins): projected-geometry browser drive`

---

## Self-review

- **Spec coverage:** §1 → T2; §2 `placed`+version → T1; §3 touch promotes → T3; §4 clamping → T2 (constraint + test + revert); §5 invariants → global constraints + T4's signature step; §6 default rects → T5; §7 interactions → the content-height fix landed before this plan (`db68ad2`), and the transform caveat is a constraint on T2's implementation; §9 verification → T6.
- **Type consistency:** `ProjectedRect`, `projectDesk`, `placed`, `byUser` used identically throughout; `projectDesk` imports desk *types* only, preserving the one-way dependency.
- **No placeholders:** every test named concretely; the three projection properties each have a test and a revert.
