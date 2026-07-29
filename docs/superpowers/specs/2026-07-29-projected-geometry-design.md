# Projected geometry — a skin renders the desk, it never owns it

## Context

The shell branch (`docs/superpowers/specs/2026-07-28-desktop-metaphor-shell-design.md`) shipped four
switchable skins over one window inventory. Two of them do not achieve their own stated probes, and
both the user and the browser drive reached that conclusion independently:

- **Material** claims *"what you have made is the desk; programs are sources you draw from"* — but the
  Word window is still the largest object on screen and artifacts sit tucked behind it. The drive's
  verdict: it "does not yet read as what you made is the desk."
- **Conversation** claims windows orbit a central column. The drive: they "don't orbit anything."

Both for the same reason: **a skin may not move geometry.** `deskReduce`'s `desk.skin` case passes
the `windows` array through by identity, pinned with `toBe`, so switching shells cannot touch a rect.

The whole-branch review ruled the branch shippable on the grounds that the measurement is *narrowed,
not invalidated* — four distinct shells with `shell` on the arm still deliver an instrument — but
attached a condition: **B and D results must not be read as evidence about the spatial hypotheses.**
This phase is what lifts that condition.

**The diagnosis, and it is not the reducer.** One `rect` per window is doing two jobs at once: *where
the user put it* and *where it draws*. The invariant worth protecting is "a skin switch must not
destroy geometry the user authored" (research §5 — stable positions are what let people build
cognitive maps). "A skin must not influence geometry at all" was an implementation accident that came
along with it. Separate the two jobs and skins get spatial expression with nobody losing a window.

**Rulings taken during design (2026-07-29):**

1. **Projection layer, chosen by the user** over three alternatives (an explicit "Arrange for this
   shell" button reusing the boot-fit mechanism; per-skin stored layouts; and expressing Material
   through substance rather than geometry). Rejected options are recorded in §10 — the substance one
   may still belong here alongside projection.
2. **Do not go *around* the reducer — go *above* it.** Mutating rects outside the journal would break
   replay-equals-live, break undo, and silently move things the user placed.
3. **Drag resolves by "touch promotes"** (§3) rather than by inverting the projection.

---

## §1 Authored vs projected

`DeskWindow.rect` remains the **authored** rect: the single source of truth, the only thing journaled,
the thing `fitWindows` clamps at boot. Nothing about the store's contract changes.

A new pure module computes what is drawn:

```ts
// src/shell/skins/projectDesk.ts
export interface ProjectedRect { id: string; rect: WindowRect }
export function projectDesk(skin: ShellSkin, desk: DeskState, plane: Size): ProjectedRect[]
```

Components render from the projection; the store never sees it. `Familiar` and `Provenance` project
identity. `Material` scales artifact windows up and docks program windows toward the source rail.
`Conversation` pushes windows outward from the centre column and shrinks them.

**Projection is a pure function of (skin, desk, plane).** No time, no randomness, no DOM reads — so it
is fully testable in the `node` environment this repo runs, which matters because there is still no
App-level harness.

## §2 The `placed` flag, and the version bump it forces

A projected window that the user drags must stop being projected, or the next projection would move it
again from its new authored value and it would walk across the screen.

`DeskWindow` therefore gains `placed: boolean` — false when the desk positioned the window, true once
the user has moved it themselves. `projectDesk` skips any window with `placed: true`: **anything you
placed is drawn exactly where you put it, in every skin.**

`DeskWindow` is a persisted shape, so **`JOURNAL_VERSION` goes 2 → 3.** This is the phase's only bump.
That also resolves the migration question cleanly: a v2 journal is rejected by the existing version
gate rather than half-restored, so no restored desk arrives with an ambiguous `placed` state. The
in-app "Previous desk could not be restored" path already exists and is the honest surface for it.

## §3 Touch promotes

When the user drags a window that is currently projected:

1. The drag operates in **projected space** — the window moves under the cursor, as it appears.
2. On settle, the **projected rect is written as the new authored rect** via the existing journaled
   `window.move`, and `placed` becomes true.
3. That window is never projected again.

This avoids requiring projections to be invertible. A scale-and-translate is; "dock to the rail" is
not. It also degrades to exactly today's behaviour for anything the user has touched, and it is
explainable in one sentence — which matters for a research instrument.

The existing drag path already distinguishes intermediate frames (unjournaled `deskDispatchLive`) from
the settled rect (journaled `window.move`); `placed` is set on the settled dispatch only.

## §4 Clamping — the risk that must be specced, not discovered

`fitWindows` clamps **authored** rects against the plane at boot. A projection can push a window
off-plane in **projected** space while its authored rect is perfectly legal. That is the same class as
the shell branch's I2 — fixed-pixel geometry meeting a variable plane — reappearing one layer up.

**`projectDesk` must clamp its own output.** Every returned rect is `clampWindow`ed against the plane
before it leaves the function, and a test asserts that property over generated inputs rather than a
handful of examples. A window that a projection cannot fit legibly must be projected to identity
rather than to something off-screen.

## §5 What does not change

- `deskReduce`'s `desk.skin` case still passes `windows` through by identity — the `toBe` test stands
  as written. Skins still cannot touch the store.
- Only authored rects are journaled; replay-equals-live is untouched, and the keystone desk case still
  covers it.
- `barItems` still orders by `openedAt`; the store still never owns content; every skin still declares
  `restoreVia`.
- **Re-measurement is already handled.** The layout effect carries `desk.skin` and a window-geometry
  signature in its dependencies, so a projection change re-measures the scene for free. The shell
  branch built that for a different reason; it pays off here. The signature must additionally cover
  the *projected* rects, since two different skins can project the same authored rect differently.
- Pointing needs no change: entities are measured from the DOM, so projected positions are what gets
  measured and what `resolveAt` resolves against.

## §6 The second lever: default rects

The browser drive added an option the original discussion did not have. Material may not read as
intended even with projection, because the **default** rects put a 680-wide program window at `x: 48`
and artifacts at `x: 560` — the program window is simply bigger to begin with.

So this phase may also change `initialDeskState`'s and `ARTIFACT_BASE_RECT`'s defaults. That is a
change at desk level, not render level, and it is legitimate: defaults are what the desk chooses when
the user has not, which is exactly what `placed: false` now means.

**This is also where the shell branch's C1 came from** — `ARTIFACT_BASE_RECT`'s fixed `x: 560` is what
put artifact windows on top of program entities and turned a harmless deferred ruling into a Critical.
Revisiting the defaults is overdue on its own merits.

## §7 Known interaction to handle

A live-feed artifact's fields change height with no re-measure trigger (`ResizeObserver` watches only
the main container and the program window, never an artifact window; nothing bumps `artifact.rev`).
That bug is already logged and is currently the dominant source of wrong referents. **Projection makes
it worse** — if Material scales artifacts, a content-height change is amplified by the scale factor.
Fix the re-measure trigger in this phase or immediately before it; do not ship projection on top of it.

Related: if a projection ever scales via CSS `transform`, the mirror-div technique that measures
individual **words** in the Word document needs re-checking. `getBoundingClientRect` accounts for
transforms; that text-measurement trick may not. Prefer projecting width/height over transforms.

## §8 Files

| File | Change |
| --- | --- |
| `src/shell/skins/projectDesk.ts` | **new** — `projectDesk`, per-skin projections, output clamping |
| `src/shell/skins/projectDesk.test.ts` | **new** — identity skins, Material/Conversation shapes, the clamp property, `placed` skipping |
| `src/shell/desk/types.ts` | `placed: boolean` on `DeskWindow` |
| `src/shell/desk/deskStore.ts` | set `placed` on a settled user move; default false on open |
| `src/shell/desk/selectors.ts` | `fitWindows` unchanged in contract; revisit `ARTIFACT_BASE_RECT` (§6) |
| `src/journal/persistence.ts` | `JOURNAL_VERSION` → 3 |
| `src/shell/ProgramWindow.tsx`, `src/artifacts/ArtifactWindow.tsx` | render from the projection; drag in projected space |
| `src/App.tsx` | thread the projection to the windows; extend the layout signature with projected rects |

## §9 Verification

- **Pure TDD** for `projectDesk`: identity skins return input rects unchanged; `placed: true` windows
  are never projected; every output rect lies inside the plane (property-style, not three examples);
  projection is stable under repetition.
- **Full suite each task** — `npx vitest run`, never scoped to a subdirectory. Floor is whatever the
  branch base carries.
- `npx tsc --noEmit` clean and `npx vite build` — and note these now mean more than they did: with
  `@types/react` installed, JSX props and hook values are genuinely checked.
- **Keyless browser drive**, the only real check on the wiring: Material actually foregrounds
  artifacts; drag a projected window and confirm it stays where you put it across every skin
  afterwards; confirm a projected window is still pointable and `resolveAt` returns it; confirm the
  journal restores `placed` correctly and that a v2 journal is refused rather than half-restored.
- **Live smoke:** the condition this phase exists to lift — B and D results becoming admissible as
  evidence about the spatial hypotheses.

## §10 Out of scope, and the options not taken

- **Per-skin stored layouts** (each skin remembers its own arrangement, like virtual desktops).
  Rejected: state ×4, a bigger journal, and "where is my window" gets harder to answer.
- **An explicit "Arrange for this shell" button.** Rejected as the primary mechanism because it is
  opt-in and most sessions would never see Material's real layout — but it is cheap (it reuses the
  boot-fit batch) and could still be added later as a manual override.
- **Expressing Material through substance rather than geometry** — programs collapsing to source
  chips, artifacts rendering provenance and revision history inline, the combine tray always present.
  **Not rejected; deferred.** It tests Material's probe more directly than size does and may belong
  alongside projection rather than instead of it. Revisit once projection is real and Material can be
  judged on its own terms.
- Multiple concurrent program windows. Still out of scope, still the most conspicuous absence.

## After approval

Write to `docs/superpowers/specs/`, commit, ask for spec review, then `superpowers:writing-plans`.
