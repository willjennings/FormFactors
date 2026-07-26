# Artifact Revise Core — Design Spec

*"That second paragraph — tighten it." Artifacts stop being finished objects and become material:
versioned, addressable part by part, and changeable in place by the agent (proposed, dial-gated) and
by the user (directly). Closes the loop the combinatory spec deliberately left open — draft →
inspect → point → refine → repeat — and lands on five-blindspots B1 (output terminal, no refine
loop) and B2 (opaque artifacts, no sub-entities).*

Date: 2026-07-26
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **S1+S2+S3 of the five-blindspots roadmap, merged into one cycle.** S1 revise core (pure
store), S2 artifact sub-entities, S3 the `refine_artifact` tool + direct user editing + revert.

---

## 1. Purpose & scope

The combinatory-artifacts spec (2026-07-16) declared artifacts **create-only** and listed "editing
artifact content in place (an artifact 'edit pass')" as an explicit out-of-scope follow-on. This
spec is that follow-on.

Today `src/artifacts/types.ts` defines exactly two events — `artifact.create | artifact.close` — and
`artifactStore.ts` is 23 lines with no update path. The consequences:

- **The cowork loop terminates at creation.** The only in-place refinement primitive in the system is
  `revise_text`, which works on the Word mockDoc alone (`App.tsx:1493-1521`). To improve an artifact
  the model must create a sibling, burning the `MAX_ARTIFACTS = 6` cap under reject-never-evict
  semantics.
- **Artifacts are opaque.** `artifactEntities` registers one entity per artifact
  (`src/artifacts/entities.ts`) with `sub: false`. The user can point at `a1` but not at *the second
  paragraph of* `a1` — even though Excel cells and PowerPoint slides have had sub-entity pointing
  since C1.

**In scope:** artifact revisions with history and provenance; part identity (paragraphs, widget
fields) as the single shared notion across reducer/deriver/renderer; artifact sub-entities via the
existing C1 `SubEntitySpec` contract; the `refine_artifact` tool with errors-as-data validation;
dial-gated commit-vs-witness with a double staleness guard; direct user editing of artifact text;
per-artifact revert plus tagged ⌘Z; a scripted keyless demo.

**Out of scope (deliberate):** rail-card ids and pin-to-artifact (roadmap S4 — the other half of
II.2 plus II.3); the session journal (S5-S6); paired comparison (R2); artifact persistence across
reloads; changing `revise_text`'s hardcoded always-witness behaviour; structural reordering of parts
(move/swap); rich text.

## 2. Architecture

| Module | Responsibility |
|---|---|
| `src/artifacts/types.ts` | Extend `Artifact` with `rev` + `history`; add `RevisionMeta`, `ArtifactVersion`, `ArtifactPatch`, two events. |
| `src/artifacts/parts.ts` | **New, pure.** `splitParagraphs`, `artifactParts`, `applyPatch`. The single source of part identity. |
| `src/artifacts/artifactStore.ts` | `artifact.revise` + `artifact.revertTo` reducer cases; `rejectedStale` counter. |
| `src/artifacts/serialize.ts` | `[ARTIFACTS]` gains `rev N` and the stale note. |
| `src/artifacts/entities.ts` | Part sub-entities folded into the existing `artifactEntities(state, layout)` call. |
| `src/artifacts/refineTools.ts` | **New.** `REFINE_TOOL` + pure `validateRefineCall(args, state)` — errors-as-data, remedies derived from live state. |
| `src/artifacts/ArtifactWindow.tsx` | Per-part `data-entity-id` stamping; inline editing; `rev` chip + history disclosure with revert; feed-ticker re-key. |
| `src/artifacts/demo.ts` | `?artifacts=1` gains a scripted revise sequence. |
| `src/scenarios.ts` | `VERB_CLASS.refine_artifact = 'mutate'`. |
| `src/App.tsx` | Tool registration + routing branch; `pendingAction` artifact variant; double staleness guard in `confirmPendingAction`; tagged `undoStack`. |

The subsystem stays self-contained: everything except the last two rows lives under
`src/artifacts/`, and the pure modules are testable without a DOM.

## 3. Data model

```ts
interface RevisionMeta { rev: number; at: number; owner: 'agent' | 'user'; note?: string }

interface ArtifactVersion {
  rev: number; title: string; content?: string; fields?: WidgetField[]; meta: RevisionMeta;
}

interface Artifact {
  // …existing: id, kind, title, sources, content?, fields?, createdAt
  rev: number;                 // creation = 1
  history: ArtifactVersion[];  // PRIOR versions only, append-only, oldest first
}
```

**History holds full snapshots, not diffs.** Artifacts are small (a few paragraphs or fields) and
capped at six. Snapshots make revert a pure lookup, make the S5 journal's replay trivial, and remove
a whole class of patch-composition bugs. History is unbounded within a session: a cap that silently
dropped old revisions would be exactly the dishonesty the reject-never-evict rule exists to prevent.
Sessions are short and artifacts are small, so unbounded is affordable — this is a stated decision,
not an oversight.

### 3.1 Patch vocabulary

```ts
type ArtifactPatch =
  | { op: 'replace-part'; index: number; text?: string; label?: string }
  | { op: 'add-part'; index?: number; text: string; label?: string }  // append when index omitted
  | { op: 'remove-part'; index: number }
  | { op: 'retitle'; title: string };
```

One vocabulary shared by the reducer, the tool validator, and the witness renderer. `label` applies
to widget fields only; `text` is a doc paragraph's prose or a widget field's value. A `replace-part`
may carry both (rename a field and set its value in one revision) but must carry at least one.

`add-part`'s `index` is the **1-based position the new part will occupy**, shifting later parts down;
omitting it appends. `index = parts.length + 1` and omission are therefore the same operation.

**Retitle re-keys pointing.** The artifact's title is one of its aliases in `artifactEntities`, and
the deriver recomputes aliases on every build, so a retitle updates the pointable name for free.

### 3.2 Events

```ts
| { type: 'artifact.revise'; id: string; baseRev: number; patch: ArtifactPatch;
    owner: 'agent' | 'user'; note?: string }
| { type: 'artifact.revertTo'; id: string; toRev: number }   // USER-ONLY
```

`artifact.revertTo` follows the `artifact.close` discipline: **no tool maps to it.** Undoing is the
user's prerogative; the agent can only propose forward.

## 4. Part identity

`src/artifacts/parts.ts` is the **single source of part identity**. Today `ArtifactWindow.tsx:89`
splits paragraphs inline with `.split(/\n+/).filter(Boolean)`. If the deriver reimplemented that
split, ids could drift from pixels — the user would point at what the screen calls paragraph 2 and
the model would receive paragraph 3. Extracting it makes drift structurally impossible.

```ts
interface Part { index: number; id: string; label?: string; text: string }

splitParagraphs(content: string | undefined): string[]
artifactParts(a: Artifact): Part[]        // doc → paragraphs, widget → fields
applyPatch(a: Artifact, p: ArtifactPatch): Artifact | null
```

`artifactParts` yields `para-1…para-N` for docs and `field-1…field-N` for widgets — **1-based**,
matching the user-facing language ("the second paragraph") and the existing slide/cell convention.

`applyPatch` returns `null` — meaning "no legal result" — when:
- the index is out of range for the current parts (for `add-part`, `parts.length + 1` is in range)
- the result would be empty (removing the last paragraph of a doc; an empty replacement text)
- a `replace-part` carries neither `text` nor `label`
- the patch writes a **value** to a feed-bound widget field (see §7.3)
- a retitle is empty or unchanged

Positional ids are honest **only relative to a revision**. That is precisely why the tool handshake
carries `baseRev` alongside the index (§7).

## 5. Reducer semantics

`artifact.revise`:
1. Unknown `id` → state unchanged (no counter; the validator makes this unreachable from the tool
   path, and replay must be a deterministic no-op).
2. `event.baseRev !== artifact.rev` → **`rejectedStale + 1`**, state otherwise unchanged. Mirrors the
   existing `rejectedAtCap` pattern, and surfaces in `[ARTIFACTS]`.
3. `applyPatch` returns `null` → state unchanged.
4. Otherwise: push the current version onto `history`, apply the patch, `rev + 1`, record
   `RevisionMeta` with `owner` and `note`.

**Revisions never run the capacity simulation.** A revise creates nothing, so the `MAX_ARTIFACTS`
check must not run — an explicit test revises successfully while the desk is at six.

`artifact.revertTo`: if `toRev` is not in `history`, no-op. Otherwise the revert is **itself a new
revision** (`rev + 1`) carrying the historical content, with `note: 'reverted to rev N'` and
`owner: 'user'`. The timeline stays append-only and every branch point remains inspectable — the same
discipline S5's journal will need.

`initialArtifactState()` gains `rejectedStale: 0`. Creation sets `rev: 1, history: []`.

## 6. Sub-entities (S2)

`artifactEntities(state, layout)` gains part entities alongside the existing whole-artifact ones:

| Kind | Entity id | Title | Aliases |
|---|---|---|---|
| doc | `artifact-a1-para-2` | `Paragraph 2 — "Trip brief"` | `paragraph 2`, `second paragraph`, `normText` of the first few words |
| widget | `artifact-a1-field-2` | `Departure — "Trip widget"` | `normText` of the field label |

All part entities carry `sub: true`. That is the C1 discriminator, and it also keeps them out of
`blockedElementNumbers` — the exact Critical the C1 final review caught when slide ordinals leaked
into the soft-block set.

The first-words alias is what makes "the part about the budget" resolve. `resolveEchoedTarget`'s
≥2-token overlap floor (R2) already prevents a one-word coincidence from grounding.

**Zero App changes are required for measurement.** `App.tsx:911` already scans
`.artifact-window [data-entity-id]` and writes `artifactLayoutRef` — verified against current code.
`ArtifactWindow` stamping each paragraph and field with `data-entity-id` is sufficient; parts become
pointable with real bboxes automatically. A part with no layout entry degrades to a zero bbox, the
existing honest fallback.

## 7. The refine tool (S3)

```
refine_artifact { artifactId, baseRev, op, index?, text?, label?, title?, note? }
```

Flat arguments, matching `REVISE_TOOL`'s shape. (Nested object-array parameters were the subject of
the `d24abef` Gemini schema bug; flat args stay clear of that surface entirely.)

The description must teach the handshake: read `rev N` from `[ARTIFACTS]`, pass it as `baseRev`,
address parts by the index the `[ARTIFACTS]`/`[CONTEXT]` view shows, and re-read after any rejection.

### 7.1 Validation — `validateRefineCall(args, state)`

Pure, returning `{ event } | { error }`, errors-as-data naming a real remedy every time:

| Failure | Message |
|---|---|
| unknown `artifactId` | names the live ids |
| stale `baseRev` | *"a1 is at rev 3, you addressed rev 2 — re-read `[ARTIFACTS]` and re-issue."* |
| index out of range | names the valid part ids for the current rev |
| value write to a feed-bound field | *"field 2 'Time' is bound to the clock feed — its value is live. You can rename it, but not set it."* |
| no-op | *"a1 paragraph 2 already reads exactly that."* |
| empty result | *"that would leave a1 with no content."* |

`validPartIds` is **derived once from the same `artifactParts` call the resolver uses**, and shared
with the rejection text. This is the combine C1 discipline verbatim: never assert validity from a
hardcoded list, always derive it — the app must never name an id that would itself fail.

### 7.2 Commit vs witness

`VERB_CLASS.refine_artifact = 'mutate'`, routed through the existing
`decideCommit(verbClass, autonomy, confirmed)` (`scenarios.ts:548`).

**Stated consequence:** `decideCommit` gates only `destroy` and `share` under `auto-safe`, so under
**Guided — today's default control arm — a refine auto-commits with no witness card.** The witnessed
before→after diff appears under `manual` and `confirm`. This is a deliberate departure from the
"witnessed like `revise_text`" line in the roadmap: refine is the *repeated* verb in a flow loop, so
its friction is exactly what the register arms exist to measure, and flattening it across arms would
waste the experiment.

What keeps auto-commit honest is that **every revision is reversible**: tagged ⌘Z and the
per-artifact revert control (§9) are load-bearing parts of this decision, not conveniences. The
activity ticker also shows every dispatch, so an auto-committed refine is never invisible.

### 7.3 Feed-bound fields

A widget field bound to a live feed shows a value the app fetches, not one the model authored.
Letting a refine write that value would let the model launder authored data as LIVE — the exact
honesty seam the feed provenance chips exist to protect. `applyPatch` refuses it and the validator
explains the rename alternative.

### 7.4 The double staleness guard

When a refine is witnessed, `confirmPendingAction` (`App.tsx:1695`) must verify **both** before
applying:

1. the artifact's `rev` still equals the witnessed `baseRev`, and
2. the witnessed `oldText` still matches the part's current text.

Either failure drops the card honestly, logs it, and sends the model a recompute instruction naming
the current state. This mirrors the revise stale-span guard at `App.tsx:1703-1710` — the fix that came
out of the 2026-07-16 human smoke where repeated voice revises spliced garbage (`".ary.ary.y."`)
because a confirm applied offsets computed against an older document.

Note that `confirmPendingAction` currently assumes a doc-shaped action: it calls `applyAction` on
`mockDoc` unconditionally at line 1711. The artifact branch must return before reaching it.

Rejections call `deduper.forget()` so a corrected retry is never swallowed as a duplicate — the G9
ack-wrapper discipline from `9739da3`.

## 8. Direct user editing

Clicking a paragraph or a field value opens an inline editor; Enter/blur commits, Esc cancels. A
commit dispatches `artifact.revise` with `owner: 'user'` and the current `rev` as `baseRev`. **No
witness** — the gate exists for interpretation error on the agent's side, and the user editing their
own material is not interpretation.

**Keyboard capture is already solved.** `isEditableTarget` (`src/shell/quickFire.ts:25`) covers
`INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` and guards both the backtick register chord
(`App.tsx:2099`) and quick-fire digits (`App.tsx:2109`); `App.tsx:2379` guards the ⌘Z path. An inline
editor using any of those element types inherits the protection.

**The mid-edit conflict needs no new machinery.** If the user edits a paragraph while a refine
targeting it sits witnessed, the revision counter advances and the part text changes — so the double
staleness guard fires on both conditions and the refine drops honestly. The user's edit wins, which
matches the ramble tap-edit ownership precedent ("yours", and the agent yields).

Parts keep their `data-entity-id` while editable, so an edited paragraph stays pointable.

## 9. Revert and undo

**Tagged undo stack.** `undoStack` (`App.tsx:634`) becomes:

```ts
{ kind: 'doc'; doc: MockDoc; label: string } | { kind: 'artifact'; id: string; toRev: number; label: string }
```

⌘Z pops whichever is newest; the artifact variant dispatches `artifact.revertTo`. The existing
newest-artifact-close fallback for an empty stack (`App.tsx:3357-3368`) stays.

**Per-artifact revert.** The window's title bar carries a `rev N` chip; clicking it discloses the
revision list — rev number, owner (agent/you), note, and a hit-24 revert control per row. This exists
because the stack alone is ambiguous: refine `a1`, then edit the Word doc, and ⌘Z reaches the doc,
not the artifact the user is looking at.

Reverting through either path produces a new revision (§5), so revert is itself undoable.

## 10. Model-facing surfaces

`[ARTIFACTS]` items gain the revision: `a1 "Trip brief" (doc, rev 3, from: word + excel)`. The model
echoes that number back as `baseRev` — the handshake that makes positional part ids safe.

A `rejectedStale` note appears the way the cap note does: *"2 revisions were rejected as stale — read
the current rev before revising."*

`read_sources` / `sourceDetail` doubles as the history reader: an artifact's detail gains its revision
list with notes and owners. **No new tool** — the model already knows to call `read_sources` before
acting on content.

The hint re-serializes through the existing `makeChangeGate`, so a revision produces exactly one
update.

## 11. Required fix: the feed ticker

`ArtifactWindow`'s per-window feed ticker keys its effect on `[artifact.kind, artifact.id]`
(line 65) and its comment (lines 30-33) explicitly justifies that: *"Fields are create-only (the
agent never mutates an artifact after creation — spec §7), so the bound-feed set is stable for the
window's lifetime."*

This spec kills that assumption. The effect must re-key on `artifact.rev` so that adding or removing
a feed-bound field re-establishes the ticker, and the stale comment must be corrected.

## 12. Telemetry

Refine rides the existing idiom: `telemetry.action('refine_artifact', 'mutate', decision, modality)`
at the dispatch site, exactly as the action-verb branch does at `App.tsx:1465`. This gives the R1
arms a comparable refine-friction measure for free — witness:commit ratio per register — with no new
event type.

## 13. Testing

Pure-function TDD per repo convention, plus build verification for component paths.

**Unit (red first):**
- reducer: stale `baseRev` increments `rejectedStale` and changes nothing else; a revise **succeeds
  while at the six-artifact cap**; `revertTo` mints a new revision rather than truncating; history is
  append-only and holds prior versions only; unknown id is a clean no-op.
- `parts`: paragraph split matches the renderer's output for multi-blank-line and trailing-newline
  content; 1-based ids; `applyPatch` returns null for out-of-range, empty result, feed-bound value
  write, and no-op retitle.
- `entities`: part ids and aliases; `sub: true`; ordinal and first-words aliases; a missing layout
  entry degrades to a zero bbox.
- `validateRefineCall`: every error path names remedies **derived from live state** — a test asserts
  the ids named in a rejection are exactly the ids that would succeed.
- `serialize`: `rev N` in items; the stale note appears and clears.

**Gates:** `npx vitest run` — the **full suite on every task**, not the touched directory. This is the
explicit PLAN LESSON from the ramble phase machine, where four probes pinning old behaviour broke
silently across three tasks because gates were scoped to `src/ramble/`. Plus `npx tsc --noEmit` and
`npx vite build`.

**Keyless browser drive** via `?artifacts=1`: scripted revise → the `rev` chip increments, history
lists the prior version, revert restores it as a *new* revision, paragraphs measure as pointable
entities, inline edit commits.

**Live smoke** (folds into the standing sitting):
- a refine witnessed under `manual`/`confirm`, and the same refine auto-committing under Guided —
  the arm difference made visible
- a deliberately stale `baseRev` dropped with an honest recompute message the model acts on
- point at "the second paragraph" by voice and refine it
- direct-edit a paragraph while a refine targeting it is witnessed → honest drop, user's edit stands
- revert from the history disclosure, then ⌘Z

## 14. Risks

| Risk | Mitigation |
|---|---|
| Positional part ids are honest only per-revision | The `(baseRev, index)` handshake; stale rejections name the current rev |
| Auto-commit under the default register surprises the user | Every revision reversible via two paths; activity ticker shows each dispatch; §7.2 states it explicitly |
| Part id drift between renderer and deriver | `parts.ts` is the single source, consumed by both |
| Model laundering authored values as LIVE feed data | `applyPatch` refuses value writes to feed-bound fields |
| Confirm applying against changed text | Double staleness guard (rev + oldText), mirroring the proven revise guard |
| Unbounded history growth | Small artifacts, cap of six, short sessions — stated decision in §3 |
