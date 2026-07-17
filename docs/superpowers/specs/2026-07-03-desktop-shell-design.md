# Desktop Shell — Design Spec (project A)

*Replace the tourism-demo scaffolding (two-box photos+map layout, tour-guide prompt, prototype
sidebar) with a true desktop experience: a draggable program window on a desktop plane, a
floating response rail rendering the card grammar, a talk-or-type omnibox, and the lab equipment
shelved in a debug drawer. This prototype is about the front-end experience that drives real
learning and real help when you need it; the shell is where that experience finally has a stage.*

Date: 2026-07-03
Branch: `honest-mode`
Status: Approved design — ready for implementation planning (two plan slices, §9).
Companion contract: `docs/superpowers/specs/2026-07-03-response-grammar-design.md` (project B —
defines WHAT the rail renders; this spec defines WHERE it lives and what surrounds it).
Audit basis: the 2026-07-03 eleven-gap audit (session record; gaps 1, 2, 7, 8-partial, 11, 12
addressed here; gaps 3-6, 9-10 and multi-window are later projects).
Decision record: window model = **(b) one draggable/resizable program window + dock** (multi-
window deferred); tasks = **(i) omnibox suggestion chips** (goal-model redesign deferred).

---

## 1. Layout

```
┌────────────────────────────────────────────────────────────┐
│ ☰ FormFactors            (menu bar)         ● live  ⚙ drawer│
│   ┌─ Microsoft Word ─────────────── ✕ ┐   ┌─ rail ──────┐ │
│   │ Home | Save  Save As              │   │ ✓ done stub │ │
│   │ ┌──────────────────────────────┐  │   │ ┌─────────┐ │ │
│   │ │  document body               │  │   │ │ DO card │ │ │
│   │ │  (draggable, resizable)      │  │   │ │ active  │ │ │
│   │ └──────────────────────────────┘  │   │ └─────────┘ │ │
│   └───────────────────────────────────┘   │  dimmed…    │ │
│                                            └─────────────┘ │
│        [Try: total this column] [What does Save As do?]    │
│      ┌──────────────────────────────────────────┐          │
│      │ 🎤  Ask or tell me anything…         ↵   │ (omnibox)│
│      └──────────────────────────────────────────┘          │
│ [W] [X] [P] [🖼]  (dock)                                   │
└────────────────────────────────────────────────────────────┘
```

## 2. The desktop plane

- A full-viewport desktop replaces the two-box `<main>` (photos-box + map-box). Subtle wallpaper
  in the existing light/dark theme system.
- **Nothing about deixis changes:** the 0-1000 coordinate space stays anchored to the plane;
  pointer painting, markers, teaching overlays, and `updateLayout` measurement all continue to
  operate over it. Overlays anchor to measured entity bboxes, so they track whatever moves.
- A minimal **menu bar**: app name, live-session status dot, drawer toggle (⚙). No other chrome.

## 3. The program window

- ONE window, containing the existing `ProgramSurface` with exactly one change: its internal
  `TitleBar` retires, because the window's title bar now carries the program label + saved-status
  badge (window chrome honestly provides what the "Camera roll" box faked). Elements, models, and
  click wiring are untouched. Drag by title bar;
  resize from a corner handle; sensible min/max bounds; position/size persist per program
  (sessionStorage, fail-soft like competence persistence).
- **Movement is cheap by construction:** `updateLayout`'s ResizeObserver + the generic
  `[data-element-id]` query re-measure on drag/resize; entities follow; teaching overlays and the
  vision frame follow the entities. The measurement contract is untouched.
- The **dock** (bottom-left, one icon per program) replaces the program dropdown. Same swap
  semantics as today, including the hard session reconnect — fixing reconnect context loss is
  gap 5, explicitly out of scope here.
- ✕ on the window closes to an empty desktop (dock re-opens); no minimize/maximize in this
  iteration (YAGNI).

## 4. The response rail (placement + behavior; content per the grammar spec)

- A floating panel, **right side by default, draggable, collapsible to a pill**. It renders the
  response grammar exactly per the companion spec: cards, done-stubs, dimmed futures,
  band-inherited pointers, the guideLine as its interstitial text line.
- Teaching sequences render IN the rail (unified-rail decision); their on-element overlays keep
  drawing on the plane. **Caption mode** = the rail collapsed to a one-card projection during
  cursor-led guidance (fade-2 rendering).
- 3±1 cards visible (grammar spec §5); the rail scrolls done-stubs, never the active card out of
  view.
- **Implementation is part of project A but slices as its own plan** (§9): shell first (with the
  rail's dock/collapse shell rendering a placeholder for teaching sequences only), rail store +
  `respondCallToRail` mapper + `respond` tool wiring second. Each lands independently testable.

## 5. The omnibox — talk or type

- Docked bottom-center: text field + mic button + status glyph. THE entry point for both
  modalities.
  - **Typed:** submits through the existing `sendUserText` pipeline (deixis keywords, repair
    grammar, number selection all reuse). The current sidebar text box is retired.
  - **Voice:** the mic button toggles the live session (replacing sidebar session controls). The
    status glyph shows connecting / listening / off; errors (no key, no mic, insecure context)
    render as an honest inline message at the omnibox, not a log line.
- **Suggestion chips** above the omnibox surface `tasksForProgram(activeProgram)` content as
  one-tap prompts ("Try: total this column"). Tap prefills the omnibox (user still submits —
  suggestions never auto-execute). Keyboard-focusable. The action-category chip color survives as
  the chip accent. This RELOCATES the task library; the goal-driven redesign of its content is
  gap 7, deferred.
- The welcome modal shrinks to a one-line first-run hint above the omnibox ("Point at things and
  ask — or type."); the onboarding coach-mark sequence and confetti die.

## 6. De-tourism demolition (folded into this project)

**Deleted outright:**
- The map box and all its state: `.map-box` JSX, `mapUrl`/`mapType`/`mapQuery`/`directions`,
  the pending-map committer, the iframe.
- `update_map`, `show_directions`, `synthesize` tools, handlers, hardcoded London landmark lists,
  and the itinerary sidebar card.
- `MAP_ENTITY_ID` and every special-casing site; **`buildEntities` loses the mandatory map
  entity** (layout param drops `map`; the registry builds `[...elements]` only).
- The vision compositor's "GOOGLE MAPS" box; the map mention in layout hints.
- `INITIAL_IMAGE` (London stock photo), `persistentCanvasRef`, `captureImageArea` circle-crop,
  and the entire `executeImageEdit` image-generation subsystem (orphaned photos-era code).
- The trip-pattern "London trip" offer payload and `identifiedLandmarksRef` naming; the
  tour-guide welcome copy and AI-Pointer graphic.

**Kept and generalized:**
- `explain` — the identify verb; once the rail lands its answers render as ANSWER cards.
- `share` — the outward-commitment witness beat; "Lia"/itinerary flavor neutralized to a generic
  recipient + current-document payload.
- The pattern-offer *mechanism* (notice → hypothesize → ask, never act) — retained as a seam,
  re-aimed at program behavior in a later project; the tourism payload text is deleted with the
  rest.
- The task library's program-native content (identify, look-alike, save, format, insert, photo
  actions) — relocated to suggestion chips (§5).

**Rewritten:**
- `buildInstructions` becomes an honest desktop-assistant prompt: same grounding grammar
  (confidence tiers, witness-render, commitment × confidence scaling, grounding-mismatch
  protocol), zero London, zero map, describing exactly the world that renders (one program
  window, its named elements, the rail, the omnibox). Capability list = program actions +
  explain + share. Examples drawn from the four programs. (Card-contract prompt language arrives
  with the rail slice.)

## 7. The debug drawer

- A slide-over drawer (⚙ in the menu bar) receives everything currently on the right sidebar:
  autonomy dial, feedback dial, backend picker, honest-mode toggle, debug-markings toggle, event
  log, world-state line, undo history count, telemetry export. Nothing is deleted — it's lab
  equipment, correctly shelved.
- **Undo stays first-class** (minimum-feedback floor): ⌘Z keybinding + a small transient undo
  affordance on the action toast. The drawer holds the history view, not the only entry point.
- The witness/confirm card gains **buttons** (Confirm / Cancel), keyboard-focusable — voice
  confirmation remains, but is no longer the only path (first payment on gap 9). It renders as a
  CAUTION-register card anchored near the rail once the rail lands; as a floating card above the
  omnibox in the shell slice.

## 8. Mechanics, error handling, degradation

- **Vision compositor** simplifies: desktop background + window snapshot at its measured bbox +
  cursor crosshair + markers + doc strip. The labeled-box fallback keeps meaning "snapshot not
  ready", never stale pixels.
- **Layout measurement**: `updateLayout` queries the window element (`.program-window`) instead
  of `.photos-box`/`.map-box`; `layoutBounds` shape becomes `{ window, surface, photoItems }`.
  Zero-bbox degradation rules unchanged.
- **No-key / typed-only**: the shell renders fully; direct manipulation, teaching demo, drawer,
  omnibox all work; mic button surfaces the missing-key state honestly at the omnibox. (Full
  typed-without-session assistance remains gated by gap 8's session dependency — out of scope.)
- Window drag during an active teach sequence: overlays re-anchor on the next measurement pass
  (existing behavior); no special handling.
- Narrow viewports keep the existing rotate/desktop-only overlay for now (mobile shell is a
  later concern; the grammar's S-size cards are specced but not built here).

## 9. Build slices (two plans from this spec)

1. **A1 — the shell:** desktop plane, program window (drag/resize/persist), dock, omnibox +
   suggestion chips, debug drawer, witness buttons, de-tourism demolition + prompt rewrite,
   vision/measurement updates. Ends with: the full experience of today's capabilities, on the new
   stage, with the map and tourism vocabulary gone. Rail placeholder hosts teaching sequences.
2. **A2 — the rail:** rail store + renderer per the grammar spec, `respondCallToRail` mapper,
   `respond` VoiceTool wired with the strict-contract prompt section, teaching-sequence
   unification (TeachSequence renders as rail cards), ANSWER-card routing for `explain`.

## 10. Out of scope

Multi-window/z-order/focus manager; goal model + reconnect-preserving sessions (gap 5); task
library content redesign (gap 7); DOM-derived entity granularity + live perception incl.
overlays-in-frame (project C, gaps 3-4); richer documents (gap 6); full keyboard/aria pass
(gap 9 beyond witness buttons + ⌘Z); multi-step feedback model (gap 10); mobile shell.

## 11. Testing

- **Pure (vitest):** `buildEntities` without the map (layout param change); window
  position/size persistence (fail-soft load/save, pattern: `persistence.test.ts`); suggestion
  derivation from `tasksForProgram`; prompt builder — assert the rewritten `buildInstructions`
  contains program capabilities and does NOT contain map/London/tour vocabulary (a de-tourism
  regression test).
- **Existing suites must stay green** — teaching, demo scripts, scenarios, registry (minus map
  expectations, updated deliberately).
- **Manual:** drag/resize window → overlays and `?teach=1` still anchor; dock swap; omnibox
  typed + voice paths; chips prefill; drawer holds all dials; witness confirm via button and
  keyboard; no-key experience shows honest omnibox state.
