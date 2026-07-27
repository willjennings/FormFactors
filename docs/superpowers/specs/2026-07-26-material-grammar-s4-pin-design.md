# Material Grammar — Rail Card Ids, Pin, and the Combine Tray (S4 + pin)

*A response stops being something you read and becomes something you keep. Rail cards get
identities, so you can point at "the caution card". Pinning one mints a real artifact. And a
deterministic tray lets you pick exactly which material combines, instead of leaving the model to
guess what "this and that" meant. Closes five-blindspots B3 (responses aren't material) and the
rail half of B2 (cards have no sub-entity granularity).*

Date: 2026-07-26
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **S4 of the five-blindspots roadmap, absorbing spec A.** Three parts, one grammar: rail card
ids (II.2 rail half), pin-to-artifact (II.3), and the combine tray (`2026-07-21-combinatory-chip-design.md`,
which the roadmap ruled never ships standalone).

---

## 1. Purpose & scope

The artifact revise core (2026-07-26, `ac0e92b..2d369db`) made artifacts material — versioned,
addressable, refinable. But the *rail*, where every model response actually lands, was untouched by
it. Today:

- **A rail card has no identity.** `RailCard` (`src/rail/types.ts:4-19`) carries an `entityId` for
  what the card *points at*, but nothing identifying the card itself. `artifactEntities` has a
  sibling for artifacts; the rail has none. You cannot point at "the second card".
- **A response cannot become material.** A card is prose in a floating panel. To keep it you would
  ask the agent to make an artifact and hope it reproduces the content. There is no promotion path.
- **`combine`'s sources are guessed.** Its `sources` are source-ids (`word`, `excel`, `a1`…,
  `combineTools.ts:39-43`) while the UI only ever points at scene-entities and passes their *names*
  in hints. That mapping gap is exactly why the model must guess which on-screen things "this and
  that" mean. The grounding buffer is capped at 2 and carries names, not ids.

**The unifying claim:** a card becomes material, and material is combinable. Pin is the bridge —
which is why these three ship together rather than as three features.

**In scope:** `railEntities` deriving pointable card entities; `data-entity-id` stamping on card
content with the shell carve-out; a user-only pin affordance minting a doc artifact through the real
create path; `entityToSourceId` as the single combinability resolver; an ordered deduped combine
tray; shift-click multi-select; a fenced `[COMBINE REQUEST]` handoff; telemetry for both new paths.

**Out of scope:** teacher-style annotation of artifact text (highlighted lines, circled words,
insert carets in hand-drawn ink) — **this is the next phase**, deferred deliberately: it needs
word/line geometry *inside* artifact windows, which does not exist (`measureWords` covers only the
Word textarea). Also out: combining program docs other than the active one (only the mounted program
window is pointable); voice-path changes (saying "combine this and that" still routes through the
model's deixis mapping, unchanged); widget-field authoring UI; an agent-facing pin tool; the session
journal (S5-S6).

## 2. Architecture

| Module | Responsibility |
|---|---|
| `src/rail/railEntities.ts` | **New, pure.** `railEntities(rail, layout)` → `SceneEntity[]` for visible cards. |
| `src/rail/cardContent.ts` | **New, pure.** `cardTitle(card)`, `cardParagraphs(card)` — the single definition of a card's text, shared by the entity deriver and the pin builder. |
| `src/rail/CardView.tsx` | Stamp `data-entity-id`; add the pin control. |
| `src/rail/RailPanel.tsx` | Shell carve-out so card content reaches the plane's hit-test. |
| `src/artifacts/pin.ts` | **New, pure.** `pinEventFor(card, seq, now)` → an `artifact.create` event or a refusal reason. |
| `src/artifacts/entities.ts` | Add `entityToSourceId(entity)` — the single combinability resolver. |
| `src/artifacts/combineTray.ts` | **New, pure.** Ordered, deduped tray; `toggle`/`remove`/`clear`/`canFire`. |
| `src/artifacts/combineRequest.ts` | **New, pure.** Tray → the user-turn text and the fenced `[COMBINE REQUEST]` hint. |
| `src/shell/Omnibox.tsx` | Render the tray row (distinct from grounding chips). |
| `src/App.tsx` | Shift-click branch in `handlePointerDown`; tray state; pin dispatch; fire path; entity recompose on `rail.set`. |
| `src/entities/registry.ts` | Document the three-prefix namespace. |

## 3. Part 1 — Rail card ids

`railEntities(rail, layout)` mirrors `artifactEntities`. One entity per **visible** card
(`visibleCards` already computes which those are, `railStore.ts`), keyed `rail-<seq-slug>-cN`,
**1-based**, `sub: true`.

**`N` is the card's index in `rail.cards`, not its position in the visible list.** Cards change
mode as the rail advances — a completed card becomes a stub, a pending one activates — so numbering
by visible position would silently renumber every card each time one completes, and "card 2" would
mean a different card minute to minute. Indexing the underlying array keeps a card's id stable for
the life of its rail. Stub and dimmed cards are pointable too; they are on screen.

`sub: true` is load-bearing for the same reason it was in S2: it is this codebase's sub-element
discriminator *and* it keeps these entities out of the soft-block set — the C1 final review caught
slide ordinals leaking there for exactly this reason.

**Aliases** — the ways a person names a card:
- `card 2` and the ordinal form (`second card`)
- the kicker (`the caution card`, `the answer card`) — from the existing `KICKER` map
- first-words of the card's text, **subject to the ≥2-token floor added in S2**. A one-word card
  must mint no first-words alias: `resolveEchoedTarget`'s exact-match branch scores 1000 regardless
  of overlap, so a bare common word would ground falsely.

**Card identity is not `card.entityId`.** The existing field is *what the card points at*; this is
the card's own identity. The spec says so explicitly because conflating them is the obvious future
bug.

**Honesty: ids are rail-relative.** Cards are replaced wholesale on `rail.set`, so `rail-<seq>-c2`
means something different after a new rail arrives — the same rev-relative situation artifact parts
have. No handshake is needed because there is **no card-mutating tool**: nothing writes through a
card id, so there is no stale-write to guard. What *is* required:

> **The entity recompose must fire on `rail.set` and `rail.dismiss`.** Otherwise the registry keeps
> describing cards that no longer exist. This is precisely the defect the S1-S3 final review caught
> for artifacts (a revision never re-measured the scene), and it is written here so it is designed
> in rather than found later.

## 4. Part 2 — Pin

**A `hit-24` pin control on every rendered card**, always visible — the repo's standard for a
durable control (the artifact `×` is the precedent). It renders in every register: pin is material,
not scaffolding, so no `chipDensity` gate applies.

`pinEventFor(card, seq, now)` is pure and returns either an `artifact.create` event or a refusal
reason:

- **Kind is always `doc`.** A card is prose; a doc is the prose artifact kind. Widgets stay
  agent-authored through `combine`, where the model chooses feed bindings.
- **Content** comes from `cardParagraphs(card)` — the single definition shared with the entity
  deriver, so the pinned text can never disagree with what the card displayed:
  - `answer`/`orient`/`caution`/`check` → the card's `text`
  - `concept` → front, back, and analogy as separate paragraphs
  - `recap` → **one paragraph per line.** This preserves the structure the model authored, makes
    each line individually pointable and refinable by S1-S3, and is the substrate the deferred
    annotation phase needs (line-level marks require line-level parts).
  - `do`/`try` → the action or prompt text, plus `result`/`notice` if present
- **Title** from `cardTitle(card)` — the card's first line, truncated to **60 characters** on a word
  boundary with an ellipsis (the `BUDGETS` family in `rail/types.ts` already works at this scale).
- **Provenance:** `sources: ['<KICKER> card (<seq>)']`, rendering as `from: ANSWER card (explain-save)`
  on the artifact window's permanent provenance line. Note this is a *provenance record*, not a live
  reference — it is deliberately not a valid `combine` source-id, and a model that tries
  `read_sources` on it gets the existing honest rejection naming the ids that would work.
  (There is no `turnId` in this codebase yet; that arrives with the journal in S5-S6. Citing one
  here would be inventing a value that does not exist.)
- **Empty card** (no text at all) → refusal reason, no event.

**Pin is user-only**, like `artifact.close` and `artifact.revertTo`. No agent tool mints a pin: the
user decides what becomes durable.

**At the cap, pin is refused, never evicted.** It routes through the real reducer, so
`MAX_ARTIFACTS = 6` applies and `rejectedAtCap` increments and surfaces in `[ARTIFACTS]`. The UI
must surface the refusal honestly (an error-outcome toast naming the cap) rather than appearing to
do nothing.

Everything downstream is free by construction: a pinned card is combinable (`validSourceIds`
includes artifact ids), pointable (`artifactEntities`), paragraph-addressable and refinable
(S1-S3), and it survives `rail.set` replacement — which is the whole point.

## 5. Part 3 — The combine tray

### 5.1 What is combinable

`entityToSourceId(entity): string | null` in `src/artifacts/entities.ts` — the single source of
truth, TDD'd:
- an artifact window entity → strip the prefix (`artifact-a1` → `a1`)
- the program window entity → the active program's id
- **everything else → null**, including rail cards. A card is not a source until it is pinned.
  That is the grammar: pin makes material, the tray combines material.

### 5.2 The tray

`src/artifacts/combineTray.ts`, pure:

```ts
interface TrayMember { entityId: string; sourceId: string; title: string; color: string }
type CombineTray = TrayMember[];             // ordered, deduped by sourceId

toggle(tray, member): CombineTray;           // add if absent, remove if present
remove(tray, sourceId): CombineTray;
clear(): CombineTray;
canFire(tray): boolean;                      // >= 2
```

Capped at `MAX_ARTIFACTS`. Semantically distinct from the grounding buffer: grounding means "my next
utterance is about these"; the tray means "make a new artifact from these". Cleared on program swap
and after a successful fire.

### 5.3 Interaction — and two corrections to spec A

Spec A placed the shift-click branch in `handleSurfaceElementClick` reading `e.shiftKey`. **Both
halves are wrong against current code**, and the corrections are part of this design:

1. **`handleSurfaceElementClick` takes a bare `elementId: number`** (`App.tsx:1721`) — no event, so
   no `shiftKey` — and artifact windows never route through it. The correct seam is
   **`handlePointerDown` on `<main>`** (`App.tsx:2843`), which already bbox-hit-tests against *all*
   entities in `entitiesRef.current` and receives the full pointer event. The shift branch belongs
   there, before the touch-deixis registration, and returns without painting or grounding when it
   consumes the click.
2. **`RailPanel` calls `stopPropagation()` on its root** (`RailPanel.tsx:41`), so card content never
   reaches that hit-test. Card content needs the `data-shell` + `data-entity-id` carve-out
   `ArtifactWindow` already uses (`App.tsx:2851` implements the carve-out: shell chrome is skipped
   *unless* the target is inside a `data-entity-id`). Without this, Part 1 mints entities that can be
   named but never pointed at.

A non-combinable shift-click is a no-op for the tray and falls through to normal behaviour.

**Tray UI:** a distinct row in the omnibox above the grounding chips, each member a removable chip
(`hit-24` ×). Rendered in every register — like pin, the tray is material, not scaffolding.

**Fire:** with ≥2 members, a chip appears — `combine these → doc` / `→ widget`. Quick-fire-able by
digit, consistent with the existing slippy pattern.

### 5.4 Firing — a fenced handoff, not a bypass

Firing does **not** author content. `combine` is model-authored by design; a UI that fabricated the
synthesis would be faking authorship. Firing sends, in one turn:

1. a natural user turn via `sendUserText`, built from member titles and the chosen kind; and
2. a **fenced** hint carrying the exact ids:
   `[COMBINE REQUEST: sources=["a1","word"], kind="doc" — call combine with exactly these source ids; read them first.]`

The fence is what makes this unforgeable — it rides `sendTextHint`, which spec C's per-session token
already protects, so typed user text cannot impersonate a combine request.

The model reads the named sources, authors the synthesis, and calls `combine` with precisely the ids
the UI chose. `validateCombineCall`, `artifactStore`, and `ArtifactWindow` are reused untouched: the
≥2 rule, dedupe gate, capacity-by-simulation, and provenance guarantees all still apply. The tray
clears on a successful fire.

## 6. Honesty rules this design must hold

1. **Never mint material the user did not ask for.** Pin is explicit and user-only; shift-clicking a
   card does not implicitly pin it. A stray gesture must never consume the 6-artifact cap.
2. **Never evict.** Pin at cap refuses and says so.
3. **Derive, never assert.** Any message naming valid sources computes them from `validSourceIds` /
   `entityToSourceId`, never a hardcoded list.
4. **Stale entities are a lie.** The recompose fires on every rail change (§3).
5. **Authorship stays with whoever did the authoring.** The tray chooses sources; the model writes
   the content; the provenance line says where a pin came from.

## 7. Telemetry

Both new paths emit through the existing idiom, so the slippy flow is measurable against the
voice-driven one (the thesis: form factors compared on the same scenarios with the same telemetry):
- `pin` — card type, resulting artifact id, or the refusal reason.
- `combine_tray` — member count, chosen kind, and whether the resulting `combine` call succeeded.

Both carry the session `Arm` already on `SessionConfig` from R1, so tray-vs-voice combine is
comparable across registers.

## 8. Testing

Pure-function TDD per repo convention; component paths build-verified plus a keyless browser drive.

- `railEntities`: ids and 1-based numbering, `sub: true`, kicker/ordinal/first-words aliases, the
  ≥2-token floor dropping a one-word card's alias, unmeasured card → zero bbox.
- `cardContent`: every `CardType` maps to title and paragraphs; recap yields one paragraph per line;
  an empty card yields nothing.
- `pin`: event shape and provenance string per card type; empty card refused; **at-cap behaviour
  asserted through the real reducer**, not asserted in isolation.
- `entityToSourceId`: artifact and program entities map; rail cards, buttons, cells and words return
  null.
- `combineTray`: toggle add/remove, dedupe by sourceId, order preserved, cap, `canFire` at 2.
- `combineRequest`: names exactly the selected ids and kind; user turn reads naturally from titles.

**Gates:** `npx vitest run` — the **full suite on every task**, never a directory subset. This lesson
has now cost this project twice. Plus `npx tsc --noEmit` and `npx vite build`.

**Keyless browser drive:** point at a card and confirm the status names it; pin it and watch the
artifact window appear with its provenance line; shift-click the artifact and the program window and
watch the tray fill; fire and confirm the fenced request is what goes out; pin at the cap and see an
honest refusal.

**Live smoke (owed, needs a key):** fire the tray and confirm the model combines *exactly* the
selected ids rather than re-guessing; point at "the caution card" by voice; pin a card and then
refine the resulting artifact by voice, closing the full loop — ask → answer → pin → combine →
point → refine.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Card ids are honest only per-rail | No card-mutating tool exists, so there is no stale-write path; recompose on `rail.set` keeps the registry truthful |
| Shift-click swallowing normal clicks | The branch consumes the event only when `entityToSourceId` resolves; everything else falls through |
| Rail chrome blocking the hit-test | Explicit `data-shell` + `data-entity-id` carve-out, mirroring `ArtifactWindow` |
| Pin filling the desk | Explicit user action, hard cap, honest refusal, reject-never-evict |
| The model ignoring the fenced ids | `validateCombineCall` still rejects unknown ids honestly; the request is an instruction, not a guarantee — worth watching in the live smoke |
