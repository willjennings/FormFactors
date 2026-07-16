# Combinatory Artifacts — Design Spec

*"Take this and that and turn it into something new." Multi-referent synthesis: the user points
at two or more things (the Word report, the Excel numbers, an earlier artifact) and asks for a
new thing — a merged document, or a live widget bound to data feeds. Outputs are pointable, so
combination is closed under composition: what the agent makes, the user can point at and combine
again. Lands on experience-audit gap #6 (combine scenarios inexpressible).*

Date: 2026-07-16
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **Two milestones, one grammar.** M1: multi-source → witnessed-by-provenance synthesis into
a new DOC artifact (proves the combinatory loop end-to-end). M2: the WIDGET artifact kind — fields
bound to data feeds, real where keyless, simulated-and-labeled elsewhere.

---

## 1. Purpose & scope

Every verb in the prototype today acts on ONE referent. Combination is the missing half of the
grammar: synthesis takes N sources and produces a new artifact that did not exist. The honesty
problems are new too: the model must only combine what it can actually read (provenance), the
new thing must say what it was made from, live data must declare what is real, and creation must
never destroy (no eviction, no overwriting user-touched artifacts).

**In scope:** persistent cross-program corpus; source-reference grammar (grounding chips, program
names, artifact ids); the `combine` tool (model-authored synthesis, create-only); `artifactStore`
+ floating `ArtifactWindow`s registered as pointable entities; `[CORPUS]`/`[ARTIFACTS]` hints;
M2 widget kind with a feed registry (real: weather via open-meteo + local clock; simulated:
stock price — all provenance-chipped).

**Out of scope (follow-ons):** editing artifact content in place (an artifact "edit pass");
agent-initiated artifact updates/closure (create-only in this spec — see §7); artifact
persistence across reloads; free-form user-defined feeds; multi-window layout management beyond
simple stacking; exporting artifacts.

## 2. Architecture

New self-contained `src/artifacts/` subsystem beside the others:

| Module | Responsibility |
|---|---|
| `src/artifacts/types.ts` | `Artifact`, `SourceRef`, `FeedBinding`, `ArtifactEvent`, `ArtifactState`. |
| `src/artifacts/artifactStore.ts` | Pure reducer; deterministic ids; `MAX_ARTIFACTS` with **rejection semantics** (the store never evicts — see §7). |
| `src/artifacts/combineTools.ts` | `COMBINE_TOOL` + pure `validateCombineCall(args, corpus, artifacts)` — errors-as-data, capacity by simulation. |
| `src/artifacts/serialize.ts` | `serializeCorpus` (`[CORPUS]` — names + one-line gists, not full dumps) and `serializeArtifacts` (`[ARTIFACTS]` — ids, titles, kinds, provenance). Both deduped via `makeChangeGate`. |
| `src/artifacts/feeds.ts` | M2: the feed registry — pure descriptors + fetch/simulate functions with provenance (`live` \| `simulated`) and graceful failure. |
| `src/artifacts/ArtifactWindow.tsx` | Floating window: title, provenance line ("from: Quarterly report + Q3 numbers"), content (doc text \| widget fields), close button (user-only). |
| `src/App.tsx` | Corpus persistence (§3), tool registration + routing, entity registration for artifact windows, hints, mounting. |

## 3. The corpus — persistent cross-program documents (foundation fix)

Today `handleProgramChange` resets the outgoing program's document; "take the report and the
numbers" is inexpressible because only the active program's doc exists. Fix: a `corpus` map —
`Record<ProgramId, MockDoc>` — that persists each program's document across swaps (the active
program reads/writes its entry; swap no longer re-initializes an entry that exists). The
`[CORPUS]` hint names what is available ("word: 'Quarterly report' (1 paragraph) · excel: Q3
numbers (4×6 grid) · ppt: 1 slide") WITHOUT full content — full text flows to the model only in
the combine flow (§5), keeping the standing token cost flat.

## 4. The source-reference grammar

A source is any of:
- a **program document** by name — `"word"`, `"excel"`, `"ppt"`, `"photo"` (aliases resolved
  the same way entity names are: "the report", "the spreadsheet" → the prompt lists canonical
  ids; the tool takes ids);
- an **artifact id** from `[ARTIFACTS]` — `"a1"`, `"a2"` (closure: outputs are inputs);
- what the user **pointed at**: grounding chips and markers already carry multi-referent
  selection ("this and that") — the existing deixis hints tell the model which entities were
  indicated; the model maps them to source ids.

`combine` requires **≥ 2 sources**. Unknown ids fail the whole call naming the valid ones
(teach/beautify precedent). One source is not a combination — the error says to use the
existing single-target verbs instead.

## 5. The `combine` tool (M1: kind `doc`)

```
combine({ sources: string[], kind: 'doc' | 'widget', title: string,
          content?: string,            // kind 'doc': the model-authored synthesis
          fields?: { label: string, value?: string, feed?: FeedId }[]  // kind 'widget' (M2)
        })
```

Flow: the user asks ("take the report and the numbers, make an executive summary") → the model
may request the full text of named sources via the corpus hint mechanics (the app sends a
one-shot `[CORPUS DETAIL: …]` hint for the named sources when the model calls a lightweight
`read_sources(sources)` tool — this keeps full dumps out of the standing context) → the model
calls `combine` with its authored content → `validateCombineCall` checks: ≥2 sources, all
resolvable, title/content non-empty, **capacity by simulation** (§7) → the artifact is created,
registered as an entity, and announced by the `create` earcon.

**Creation is additive, so it lands directly — no witness card.** The commitment×friction rule:
nothing existing is touched, the window is closable, and the provenance line IS the witness
("from: X + Y" is rendered on the artifact). Undo closes the newest artifact.

## 6. Artifact windows — pointable outputs

Each artifact renders as a floating window on the desktop plane (whiteboard-panel pattern):
title bar, provenance line, content, user-only close (×). Windows stack with a slight cascade
offset; `MAX_ARTIFACTS = 6` keeps the desk sane. Every artifact registers in the entity system
(title + aliases + measured bbox via the `data-entity-id` contract), so the user can point at it,
ask about it, and **use it as a source in the next combination**. The `[ARTIFACTS]` hint keeps
the model's map current (ids, titles, kinds, provenance), deduped, reset-on-reconnect like all
state-hint gates.

## 7. The two probe-lesson invariants (binding)

- **Ownership is structural (the yield lesson, 2026-07-16):** the agent's tool surface is
  CREATE-ONLY. There is no agent path that closes, replaces, or mutates an artifact — closing is
  a user-only button, exactly as sketch strokes are user-only. If a later spec adds agent
  updates (e.g. refreshing a widget's fields), any user-touched artifact (renamed, edited,
  pinned) is user-owned and structurally off-limits — never enforce this by prompt alone.
- **Capacity rejects, never evicts (the beautify lesson, 2026-07-16):** `validateCombineCall`
  simulates the creation through the real reducer; if the store is at `MAX_ARTIFACTS`, the call
  fails with errors-as-data: "the desk already holds 6 artifacts — ask the user to close one
  first." The reducer itself also refuses (returns state unchanged + a `rejectedAtCap` counter
  surfaced in `[ARTIFACTS]`) so no caller can bypass the rule. Silent eviction of something the
  user didn't agree to lose is the exact bug class fixed in `wb_beautify` today.

## 8. Milestone 2 — the widget kind + feed registry

A `widget` artifact renders labeled fields; each field is either static (model-authored value)
or bound to a feed from the fixed registry:

| FeedId | Source | Provenance chip |
|---|---|---|
| `clock` | local time, ticks 1s | `LIVE` |
| `weather` | open-meteo (keyless, CORS-friendly; fixed demo coords), refresh ~10 min | `LIVE` |
| `stock` | deterministic simulated walk, ticks ~5s | `SIMULATED` |

Honesty rules: every bound field renders its provenance chip + last-updated stamp; a failed
fetch shows "feed unavailable" (with the stale value visibly stamped with its OLD timestamp if
one exists) — never a stale value passing as fresh; the `combine` ack and `[ARTIFACTS]` hint
carry the same provenance so the model never claims simulated data is real. The prompt's
combine section states: "the stock feed is SIMULATED — say so if asked." Feed descriptors are
pure and testable; fetching is isolated in one impure function per feed with an injected clock
for tests.

## 9. Error handling & degradation

- Unknown source id → whole call fails naming valid sources (`[CORPUS]` ids + live artifact ids).
- `< 2` sources → error pointing to single-target verbs.
- At capacity → §7 rejection; the model relays honestly ("close an artifact first").
- Unknown `feed` id (M2) → error naming the registry.
- `read_sources` on an unknown source → error; on a photo → its metadata/description line (the
  corpus gist), never a pretend OCR.
- Offline/no session → artifacts render and tick (clock/simulated feeds) fully; weather shows
  "feed unavailable"; nothing about the surface requires a live model.

## 10. Testing

- **Pure (vitest, TDD):** `artifactStore` (create/close/cap-reject/`rejectedAtCap`),
  `validateCombineCall` (source resolution, <2 sources, capacity simulation, field/feed
  validation), `serializeCorpus`/`serializeArtifacts` (gists not dumps, dedup, cap note),
  feed descriptors (simulated walk determinism with injected clock; provenance labels).
- **Scripted demo (`?artifacts=1`, no key):** replays a combine (word+excel → summary doc) and
  an M2 widget with ticking clock + simulated stock through the real store; footer shows the
  exact `[ARTIFACTS]` hint.
- **Live smoke (owed):** point at two things → "make a summary" → window appears with
  provenance; "take that summary and the photo, make a slide-style widget with the weather" →
  closure + feeds; cap rejection at 6; close is user-only.

## 11. Build order (informs the plan)

1. Corpus persistence (`Record<ProgramId, MockDoc>` + `[CORPUS]` gists) — foundation, testable.
2. `types` + `artifactStore` (TDD — cap-reject semantics first).
3. `combineTools` (`COMBINE_TOOL`, `read_sources`, `validateCombineCall`) + `serialize` (TDD).
4. `ArtifactWindow` + entity registration + App wiring + `?artifacts=1` demo (M1 complete).
5. M2: `feeds.ts` registry + widget rendering + provenance chips.
6. Live smoke, reported as owed.

## 12. Caveats (binding)

- **Provenance is the witness.** Every artifact permanently shows what it was made from; the
  model may only combine sources it read this session.
- **Create-only agent.** No agent path closes or mutates an artifact (§7).
- **Reject, never evict** at `MAX_ARTIFACTS` (§7).
- **Feeds declare themselves.** LIVE vs SIMULATED chips + timestamps on every bound field; a
  simulated feed is never described as real, by the UI or the model.
- **Gists in standing context, full text on demand** (`read_sources`) — token discipline is an
  honesty-adjacent budget rule (a hint channel that balloons gets truncated by the provider,
  silently).
