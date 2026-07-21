# Combinatory Chip — Design (A)

**Date:** 2026-07-21
**Status:** Approved in brainstorm (deterministic source-selection + model-authored synthesis / shift-click multi-select / fenced [COMBINE REQUEST] handoff). Spec awaiting user review.
**Builds on:** Combinatory Artifacts (`src/artifacts/`, landed 2026-07-16), quick-fire chips + grounding buffer (`src/shell/`), and session-fenced context (C, `2026-07-21-session-fenced-context-design.md`) for the unforgeable handoff hint.

## 1. Problem / opportunity

`combine` already turns ≥2 sources into a new artifact, but its `sources` are **source-ids**
(`word`/`excel`/`powerpoint`/`photo` + artifact ids `a1`, `a2`…, per `combineTools.ts:39-43`),
while the UI only ever points at **scene-entities** (`artifact-a1`, the program window) and passes
their *names* in hints — never their source-ids. That mapping gap is exactly why the model has to
*guess* which on-screen things "this and that" mean when combining. There is no multi-referent
hold: the grounding buffer is hard-capped at 2 (`App.tsx:1617`) and carries names, not ids.

The user's direction: a slippy mouse+keyboard flow to "take this, that → turn it into a
doc/widget" — a deterministic multi-referent entry into the combine grammar.

## 2. Honest division of labor (core stance)

`combine` is **model-authored**: the tool's `content` (doc) / `fields` (widget) are synthesized
by the model after it reads the sources. A fully deterministic UI-only combine would have to fake
that authorship — dishonest for real content. So:

- **The UI does deterministic source-selection + kind.** This removes the deixis→source-id
  guessing — the whole value of the feature.
- **The model does the synthesis.** It reads exactly the selected sources and calls `combine`
  with precisely the ids the UI chose.

No canned content, no faked authorship, no deixis ambiguity.

## 3. What is combinable

Only entities that resolve to a **valid combine source-id** can be added:

- an **artifact window** → strip the `artifact-` prefix (`artifact-a1` → `a1`);
- the **program window** → the active program's id (`word`/`excel`/`powerpoint`/`photo`).

A hovered button, cell, or word simply cannot be added — it is not a combinable source. On screen
at any moment the combinable set is therefore `{ active program window } ∪ { open artifact windows }`
(only one program window is ever mounted). This is sufficient for a first version: combine the
current doc with artifacts, or two artifacts.

Pure resolver `entityToSourceId(entity): SourceId | null` in `src/artifacts/entities.ts` (or a
sibling), TDD'd, single source of truth for combinability.

## 4. Combine tray (`src/artifacts/combineTray.ts`, pure, TDD)

An ordered, deduped selection buffer, semantically distinct from the grounding buffer (grounding =
"my next utterance is about these"; tray = "make a new artifact from these"):

```ts
interface TrayMember { entityId: EntityId; sourceId: string; title: string; color: string; }
type CombineTray = TrayMember[];               // ordered, deduped by sourceId

toggle(tray, member): CombineTray;             // add if absent, remove if present
remove(tray, sourceId): CombineTray;
clear(): CombineTray;
// cap = MAX_ARTIFACTS (6); needs >= 2 to fire.
```

App holds tray state; `toggle` is called only with members whose `entityToSourceId` resolved
(non-combinable shift-clicks are a no-op). Cleared on program swap and after a fire.

## 5. Interaction — shift-click multi-select (ruled in brainstorm)

- **Shift-click** a combinable window toggles its membership in the tray. This branches off
  **before** the normal grounding path inside `handleSurfaceElementClick` (`App.tsx:1608`): if
  `e.shiftKey` and the clicked entity resolves to a source-id, `toggle` the tray and
  `preventDefault`/return (do not also fill grounding). Non-combinable shift-clicks fall through
  to normal behavior.
- **Tray UI:** reuse the grounding-chip rendering in the omnibox (`Omnibox.tsx:104-131`) as a
  distinct tray row — each member a removable chip (× → `remove`). A subtle hover affordance on
  combinable windows ("⇧-click to combine") aids discoverability.
- **Fire:** when the tray holds ≥2, a combinatory chip appears — `⚡ combine these → doc` and
  `→ widget` (two chips, or one chip + a doc/widget toggle). Firing is also quick-fire-able (a
  digit), consistent with the existing keyboard-slippy pattern.

## 6. Firing → fenced handoff to the model

Firing does **not** bypass the model (authorship must stay honest). It sends, in one turn:

1. a natural user turn via `sendUserText`, e.g. *"Combine the doc and the spreadsheet into a
   summary doc."* (built from member titles + chosen kind); and
2. a **fenced** hint (unforgeable thanks to C) carrying the exact ids:
   `[COMBINE REQUEST: sources=["a1","word"], kind="doc" — call combine with exactly these source
   ids; read them first.]`

The model reads the named sources, authors the synthesis, and calls `combine({sources, kind, …})`
with precisely the ids the UI selected. `validateCombineCall` / `artifactStore` / `ArtifactWindow`
are reused untouched (the existing ≥2, dedupe, capacity-by-simulation, and provenance guarantees
all apply). The tray clears on a successful fire.

Note: the `?artifacts=1` demo already proves a UI→`validateCombineCall`→`artifactDispatch`
deterministic path (`App.tsx:3129-3167`); we reuse that plumbing's shape for validation but keep
the *content* model-authored rather than canned.

## 7. Telemetry

Emit a `combine_tray` experiment-arm event on fire: member count, kinds chosen, whether the
resulting `combine` call succeeded — so the slippy path is measurable against voice-driven combine
(form-factor comparison, per the thesis).

## 8. Testing

- `combineTray.test.ts`: `toggle` add/remove/dedupe by sourceId, order preserved, cap at 6,
  ≥2-to-fire predicate, clear.
- `entities.test.ts` (extend): `entityToSourceId` maps artifact/program entities → ids, returns
  null for buttons/cells/words.
- Handoff builder test: tray → `[COMBINE REQUEST: …]` names the exact ids + kind; user-turn text
  reads naturally from titles.
- Component paths (shift-click branch, tray chips, fire) are build-verified + human smoke
  (node/jsdom limits, per repo convention).

## 9. Out of scope

Combining program docs that are not the active one (only the mounted program window is pointable —
a future "corpus picker" could lift this); voice-path changes (saying "combine this and that"
still routes through the model's deixis mapping — unchanged); widget-field authoring UI (the model
authors fields as today).

## 10. Dependencies / ordering

Depends on **C** (session-fenced context) for the unforgeable `[COMBINE REQUEST]` fence — A should
land after C. Independent of B.
