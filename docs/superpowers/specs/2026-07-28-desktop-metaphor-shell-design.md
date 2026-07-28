# Desktop metaphor shell — a window inventory and four skins over it

## Context

The README calls FormFactors "an honest virtual desktop". The pixels do not say that. A screenshot
of the shipped app shows one program window in the top-left corner, a four-icon dock floating in
the bottom-left, an omnibox, and roughly 65% of the plane as flat near-white with a faint dot grid.
It reads as a design-tool canvas with a panel on it, not as a computer.

That is not only a presentation problem. `src/shell/` has one `ProgramWindow` — closeable, with
nowhere to go and no minimize — and `ArtifactWindow` renders up to `MAX_ARTIFACTS = 6` floating
windows cascaded by CSS `calc()` off their array index, with no registry, no z-order, and no
inventory. **Nothing on screen answers "what exists right now."** That is precisely the defect the
Windows 95 taskbar was invented to fix (research note §1).

This phase gives the desk a window inventory and renders it four different ways, so the desktop
metaphor becomes a **measured variable** rather than an assumption.

Research basis: `docs/superpowers/research/2026-07-28-desktop-metaphor-research.md`.

**Rulings taken during design (2026-07-28):**

1. **Four shells, switchable** — one familiar, three agent-native. The user asked to feel the
   difference rather than reason about it.
2. **Shell is an independent axis from register.** Both are recorded on the session arm. Holding
   the register fixed and flipping only the shell is the only way to isolate what the metaphor
   itself contributes.
3. **Generic-credible, not a clone.** No Windows or macOS imitation — cloning imports the
   irrelevant constraints Gentner & Nielsen warn about and invites "why doesn't this work like
   Windows?" on every missing affordance (research §4, §6).
4. **Skins compose slots; they are not forks.** One slot system filled four ways, mirroring how
   registers became dials-plus-gates rather than four apps (research §2).
5. **The shell is a rung on a learning ladder, not just a look** (ruling 2026-07-28, from the
   step-by-step-learning conversation). Learning this system means coming to believe six things in
   order, and each skin assumes a different amount of that prior learning — see §2b.

---

## §0b The learning ladder

Trusting this system is six beliefs, acquired in order:

| rung | belief | earned by |
|---|---|---|
| R0 | "This is a computer I recognise" | the shell itself |
| R1 | "It sees what I point at" | the honest pointer, deixis |
| R2 | "It acts visibly, and I can undo" | witness cards, tagged ⌘Z |
| R3 | "It asks instead of guessing" | the missing-information gate + ask surface |
| R4 | "What it makes is material I keep" | artifacts, pin, combine, revisions |
| R5 | "I can change how it behaves" | registers, dials — and these shells |

Two design consequences land in this phase:

**Each skin declares `assumesRung`** (a `ShellSkin` field, rendered in the band beside ethos and
probe): A assumes nothing — forty years of convention do the work; D assumes nothing for anyone
chat-literate; **C is meaningless before R2** — provenance tags answer a question ("who did this?")
that a user who hasn't seen the agent act has not yet asked; **B assumes R4** — until "what it makes
is material" is believed, a desk organised around material reads as "where did my spreadsheet go?".
This makes skin orderings testable: does Familiar-then-Material teach faster than Material-first?

**Sparse start.** The first-run desk opens ONE window, not a furnished stage; density is earned as
things are actually made and opened. Same instinct as the teaching system's fade-on-repeat: scaffold
proportional to need. Concretely: `initialDeskState()` opens only the active program's window;
artifacts and further windows appear when the session creates them. A returning desk restores
whatever the journal says was open — sparseness is a first-contact property, not a cap.

---

## §1 The desk store — the inventory (pure, TDD)

**`src/shell/desk/types.ts`**

```ts
import type { WindowRect } from '../windowState';
import type { SkinKey } from '../skins/types';   // one-way import: desk knows the skin key, skins never import desk

export type WindowKind = 'program' | 'artifact';
export type WindowOrigin = 'you' | 'agent';

export interface DeskWindow {
  id: string;            // `program:${ProgramId}` | `artifact:${artifactId}`
  kind: WindowKind;
  refId: string;         // ProgramId or artifact id — the CONTENT lives in its own store
  rect: WindowRect;
  z: number;             // higher is nearer the front
  minimized: boolean;
  origin: WindowOrigin;  // who caused it to exist
  openedAt: number;      // stable ordering key for the bar (research §5)
}

export interface DeskState {
  windows: DeskWindow[];
  focusedId: string | null;
  nextZ: number;
  skin: SkinKey;         // §2 — the desk's shape travels with its contents
}
```

`origin` is stamped at open time and never changes: `'you'` for the program window and for a
user-pinned artifact, `'agent'` for an artifact the model created (combine, synthesize). It is the
value skin C's title-bar tag renders, so it must be recorded when the window is opened rather than
inferred later.

**The store never owns content.** A window carries `refId`, never a title or a body. Titles are
resolved at selector time from `artifactStore` / `PROGRAMS`. Storing a copy would let a retitled
artifact keep a stale window label — the same duplicated-truth defect the S1–S3 review caught when
a witness card rendered a widget rename against the wrong side of the pair.

**Events**

```ts
export type DeskEvent =
  | { type: 'window.open'; id: string; kind: WindowKind; refId: string; rect: WindowRect; origin: WindowOrigin; at: number }
  | { type: 'window.close'; id: string }
  | { type: 'window.focus'; id: string }
  | { type: 'window.minimize'; id: string }
  | { type: 'window.move'; id: string; rect: WindowRect }
  | { type: 'desk.skin'; skin: SkinKey }
  | { type: 'desk.restore'; state: DeskState };   // journal-only (compaction), matching workspace.restore
```

**Reducer semantics** (`src/shell/desk/deskStore.ts`)

- `window.open` with a **known** id is not a duplicate — it focuses and un-minimizes. This is the
  taskbar-click path and the dock-reopen path; they must converge.
- `window.open` with a new id appends with `z = nextZ++`, `focusedId = id`.
- `window.focus` raises to `nextZ++`, sets `focusedId`, **and clears `minimized`** — one event for
  "bring this to me", so no caller can raise a window that stays invisible.
- `window.minimize` sets the flag; if it was focused, focus falls to the highest-`z` non-minimized
  window, else `null`.
- `window.close` removes it; focus falls the same way.
- `window.move` replaces `rect` (callers pass a `clampWindow`ed value — the existing pure helper).
- Any event naming an **unknown id is a no-op**, matching `artifactStore`'s discipline.
- `desk.skin` sets the skin and touches nothing else. **A skin switch never moves a window the user
  placed** (research §5).

**Selectors** (`src/shell/desk/selectors.ts`) — these hold the decisions, so they are where the
tests live and the JSX stays a thin map:

- `barItems(desk, resolveTitle: (w: DeskWindow) => string): BarItem[]` where
  `BarItem = { id, title, kind, origin, minimized, focused }` — **ordered by `openedAt`, never by
  `z` or focus.**
  Reshuffling under the user's hand destroys the recognition benefit that makes a bar worth having.
- `visibleWindows(desk): DeskWindow[]` — non-minimized, sorted ascending by `z` for render order.
- `deskSummary(desk): { pieces: number; sources: number }` — feeds skin B's top bar.
- `reconcileArtifacts(desk, liveArtifactIds, now): DeskState` — opens a window for each artifact
  with none, removes windows whose artifact is gone, cascades new rects. Pure; called from an
  effect. This is the S4 tray-prune lesson: the derived list must be reconciled against live truth,
  never assumed to agree.

**Subsumed by this store:** `windowRect` / `windowOpen` component state and the per-program
`sessionStorage` in `windowState.ts`. `clampWindow`, `MIN_W`, `MIN_H` stay and are reused.

---

## §2 The skin framework

**`src/shell/skins/types.ts`**

```ts
export type SkinKey = 'familiar' | 'material' | 'provenance' | 'conversation';

export interface ShellSkin {
  key: SkinKey; label: string; glyph: string;
  ethos: string;   // one sentence: what this shell believes
  probe: string;   // the pre-registered hypothesis, rendered in the band
  assumesRung: 'none' | 'R2' | 'R4';   // §0b — the prior learning this skin presumes, shown in the band
  slots: {
    background:   'wallpaper' | 'paper' | 'dark' | 'flat';
    topBar:       'menu' | 'desk' | 'session' | 'minimal';
    bottomBar:    'taskbar' | 'shelf' | 'timeline' | 'none';
    sideRail:     'icons' | 'sources' | 'none';
    windowChrome: 'full' | 'minimal' | 'provenance';
    surfaces:     'float' | 'material' | 'column';
    restoreVia:   'bottomBar' | 'column';   // see the invariant below
  };
}
```

**Invariant — every skin must name a restore surface.** A minimized window has to be recoverable in
every skin. `restoreVia` makes that structural instead of remembered: skins with
`bottomBar: 'none'` must set `restoreVia: 'column'` and render the list there. A skin that could
minimize a window into nowhere is a trap, and this is the field that forbids it.

`ShellFrame.tsx` composes the slots; each slot value maps to one small component in
`src/shell/skins/parts/`. Adding a fifth skin is then a registry entry plus whichever parts are
genuinely new.

**Ethos and probe** carry the same honest-experiment framing the registers already use — the band
shows what each shell *claims*, so a sitting is a test rather than a preference poll.

---

## §3 The four skins

| slot | A Familiar | B Material | C Provenance | D Conversation |
|---|---|---|---|---|
| background | wallpaper | paper | dark | flat |
| topBar | menu + clock | desk summary | session + counts | minimal |
| bottomBar | taskbar | shelf | timeline | none |
| sideRail | icons | sources | none | none |
| windowChrome | full | minimal | provenance | minimal |
| surfaces | float | material | float | column |
| restoreVia | bottomBar | bottomBar | bottomBar | column |

**A · Familiar.** Gradient wallpaper, top menu bar with a clock, full-width taskbar. The bar lists
the four programs as launchers plus **every open artifact as a peer** — "Q3 brief" sits next to
Excel, so nothing the agent makes can hide behind a window. Three window controls. Desktop icons
render pinned artifacts. *Probe: does a conventional desktop make the agent's reach legible fastest?*

**B · Material.** Paper ground. Artifacts and pinned cards are the desktop's largest objects, each
carrying its own provenance line ("combined from Excel + Word"); the four programs collapse into a
narrow **source rail** you draw from. The only skin where the agent's output outweighs the apps.
*Probe: does foregrounding made material change what people make?* Known risk, accepted: "where did
my spreadsheet go?" is a real first reaction.

**C · Provenance.** Dark, session-oriented. Every window title bar carries a `yours` / `agent` tag;
an agent-written cell shows who wrote it and offers undo; the bottom is a four-lane timeline whose
final lane is the honest present tense — *"waiting — nothing written until you answer."* Moves the
honesty work out of the debug drawer and into the furniture. *Probe: does visible provenance change
trust and correction rate?* Known risk: may make participants behave like testers.

**D · Conversation.** Fixed centre column holds answers, done cards and the ask with its numbered
candidate chips; programs sit dimmed at the edges. The chat-native layout, included because it is
the one this project's thesis disputes and the comparison is worth having. *Probe: does centring
conversation reduce pointing?* Its window list lives at the top of the column (`restoreVia: 'column'`).

---

## §4 The switch

- **Register band gains a second row.** The backtick chord, band and digit-swallowing already
  exist (R1); the shell row reuses them. Digits select a shell while the band is open.
- **`?shell=<key>` URL param** for demos and the keyless drive, matching `?artifacts=1` and friends.
- **Telemetry:** a `shell_switch` event mirroring `register_switch`, and `shell` added to the
  session `Arm` so every exported session says which desk it ran on.
- The pill in the top bar shows the current shell beside the register.

---

## §5 Invariants — what must not change

These hold identically in all four skins. A skin that breaks one is a defect, not a variation:

- pointing, deixis, and `data-entity-id` measurement
- the missing-information gate and the ask surface, including candidate chips and quick-fire digits
- witness cards, confirm/decline, undo
- the journal, telemetry, and the register system
- the omnibox exists in every skin (its position changes; its behaviour does not)

---

## §6 Persistence

The desk joins the journal as one store, `desk`, holding `{ windows, focusedId, nextZ, skin }` —
the shape of the desk and what is on it. Unified for the same reason `workspace` unified corpus and
active program: a skin restoring without its windows, or windows without their skin, is a
disagreement with no upside.

**This changes a persisted shape, so `JOURNAL_VERSION` goes 1 → 2.** That is the standing release
obligation: restore events replay old shapes verbatim and crash at render with no in-app New-desk
escape if the version is not bumped.

---

## §7 Re-measurement

A skin switch changes every bounding box on the plane. `skin` therefore goes into the layout
effect's dependencies **in the same commit that introduces the switch**, not as a follow-up. The
S1–S3 final review caught exactly this class — a revision that never re-measured the scene — and it
was invisible to every per-task review because no single task owned both halves.

---

## §8 Files

| File | Change |
| --- | --- |
| `src/shell/desk/types.ts` | **new** — `DeskWindow`, `DeskState`, `DeskEvent` |
| `src/shell/desk/deskStore.ts` | **new** — reducer |
| `src/shell/desk/selectors.ts` | **new** — `barItems`, `visibleWindows`, `deskSummary`, `reconcileArtifacts` |
| `src/shell/skins/types.ts` | **new** — `ShellSkin`, `SkinKey` |
| `src/shell/skins/registry.ts` | **new** — the four skins + `resolveSkin` |
| `src/shell/skins/ShellFrame.tsx` | **new** — slot composition |
| `src/shell/skins/parts/*.tsx` | **new** — wallpaper, taskbar, shelf, timeline, source rail, desktop icons, top bars |
| `src/shell/ProgramWindow.tsx` | chrome variants, minimize control |
| `src/shell/windowState.ts` | keep `clampWindow`; retire per-program `sessionStorage` |
| `src/artifacts/ArtifactWindow.tsx` | rect from the desk store instead of index cascade; chrome variant |
| `src/shell/RegisterBand.tsx` | second row |
| `src/shell/Dock.tsx` | retired — its launcher role moves into the taskbar and source-rail parts |
| `src/journal/registry.ts` | `desk` store; `JOURNAL_VERSION` → 2 |
| `src/telemetry.ts` | `shell_switch`; `shell` on `Arm` |
| `src/App.tsx` | desk store wiring, skin state, `?shell=`, layout deps |

---

## §9 Verification

- **Pure TDD** for the store and every selector: focus raises and un-minimizes, minimize hands
  focus to the next non-minimized window, close on the focused window, unknown ids no-op,
  `barItems` order is stable under focus changes, `reconcileArtifacts` both adds and removes.
- **Full suite each task** — `npx vitest run`, not the touched directory. Standing lesson from the
  B phase and re-confirmed on the gate: per-task gates scoped to a subdirectory hid four broken
  probes across three tasks.
- `npx tsc --noEmit` + `npx vite build`. Note the known limit: tsc does **not** type-check React
  hook values in this repo, so any state carried in a ref is unverified by that gate.
- **Keyless browser drive** across `?shell=` × all four skins: open two artifacts, minimize each
  window and restore it from the bar, switch skins and confirm windows keep their positions,
  confirm pointing still resolves an entity after a skin switch, confirm the ask card renders in
  every skin.
- **Live smoke** (fold into the standing sitting): switch shells mid-session and confirm the
  session survives; confirm an agent-written cell reads as `agent` in C; confirm the arm export
  carries both `register` and `shell`.

---

## §10 Out of scope, named

- **Multiple concurrent program windows.** The mockups showed Excel and Word open together; the app
  cannot currently do that. `activeProgram` is single, and entity measurement scans the mounted
  surface, so two program surfaces would collide on element ids. The metaphor will make this
  absence conspicuous — it is the most likely next phase, and it is deliberately not this one.
- Real files, folders, or a filesystem; desktop right-click context menus; window snapping or
  tiling; user-chosen wallpaper.
- Any change to what the agent can do. This phase changes the furniture and the inventory, not the
  grammar.
- **The diverse program set** (Notes, Files, Calendar, Mail, Settings, Code, Video) and the
  `ProgramDef` registry that makes adding them safe. That is its own phase — see
  `2026-07-28-program-platform-design.md`. The shell lands first because the inventory is what
  makes a taskbar meaningful before there are nine programs to list.

## After approval

Write this to `docs/superpowers/specs/`, commit, ask for spec review, then invoke
`superpowers:writing-plans` for the SDD implementation plan.
