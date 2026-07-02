# Architecture Review — Toward a Virtual Desktop with an Honest Pointer

*Requested review: how is this built, and what should we optimize/refactor to support the target
scenarios — a virtual desktop you can talk **or type** to, with an honest pointer: ask how to do
things, combine documents, make quick fixes, verify values against a RAG db, point things out on
screen. Grounded in the actual code at `honest-mode` HEAD `637589f`.*

Date: 2026-07-01
Status: Recommendations — each numbered item is a candidate spec/plan cycle.

---

## 1. What the codebase is today (honest inventory)

**Strong, keep:**
- **The interaction grammar** — Intent → Command → Policy (`decideCommit`) → Effect (`applyAction`)
  → Feedback (earcons/visual/TTS, model contractually silent on success). Faithful to the learnings
  doc; validated across three build cycles.
- **Pluggable voice engines** — `VoiceProvider` (Gemini/OpenAI/Azure) is a real, working seam.
- **The ramble-fill store** (`src/ramble/`) — pure event reducer + selectors + thin components +
  reducer-enforced yield. This is the best-architected corner of the repo.
- **Honesty mechanisms** — grounding reconciliation (G5), repair grammar, referents, calibrated
  telemetry, and now real per-tile perception (`src/perception/`).
- **F1 spreadsheet** (`src/widgets/Spreadsheet.tsx` + `dataSnapshot`) — the template for real
  widgets: real DOM, real pixels, real data layer.

**Liabilities:**
- **`src/App.tsx` is ~3,900 lines** and owns everything: session orchestration, deixis timing,
  grounding, vision-frame building, perception cache, markers, OCR, layout measurement, and all
  UI panels. Every feature this review proposes would land in this one file today. It is the
  single biggest tax on velocity and on review quality (all three build cycles needed
  anchor-matching gymnastics here).
- **Two control-loop architectures coexist**: point-and-speak is imperative
  (`handleVoiceToolCall` mutates state directly); ramble-fill is a pure event store. The second is
  strictly better and already proven in-repo.
- **Identity is title-string-keyed** (`hoveredObjectRef`, `matchElement`, `PHOTOS.find(p =>
  p.title === name)`). Perception exposed the cost: labels are now dynamic, and string identity
  broke the G5 telemetry (see follow-ups). Strings are presentation; identity needs stable ids.
- **Content is scenario-config, not widgets.** `scenarios.ts` is a good single source of truth,
  but its `MockDoc` union + `applyAction` switch can't express the target scenarios ("combine
  documents" has no (source, target) command shape; there is no real document DOM except the F1
  spreadsheet).
- **Voice-only input.** There is no typed path; every capability is gated on a realtime audio
  session, which also makes end-to-end testing impossible without a human + key.

## 2. Recommendations (priority order)

### R1 — Typed input parity (cheap, unlocks everything)
Add `sendUserText(text)` to `VoiceProvider` (all three backends support text turns) plus a small
input box. Route typed text through the **same** pipeline as transcripts (`processInputTranscript`
already exists — deixis keywords, repair grammar, number selection all reuse). Payoff beyond the
"talk or type" requirement: **scripted end-to-end tests** of the whole loop with no audio and no
human, which every later item benefits from. Smallest item here; do it first.

### R2 — Stable widget ids + perceived-name-aware G5 (the identity layer)
Give every pointable thing a stable `id`; make `title` and `perceivedLabel` presentation-only.
`matchElement` resolves the model's echoed target against *all known names for an id* (title +
perceived + dataSnapshot terms) and returns the id. This subsumes the committed G5 follow-up
(perceived-name → title mapping) instead of patching it, and is the foundation for
confidence-from-disagreement across structural/visual/semantic channels (F2). Do this **before**
adding more widgets — every new widget multiplies the cost of string identity.

### R3 — Decompose App.tsx onto the store architecture
Extract, in order of value: (a) the grounding/deixis engine (pointer capture, keyword-time binding,
confidence, hints) into pure modules like `coherence.ts`; (b) the vision-frame builder; (c) session
orchestration. Converge point-and-speak onto the ramble-fill pattern — a shared
`(state, event) → state` store with the §4-style event contract, one Policy/Effect/Feedback core,
form factors as thin shells. This *is* the FormFactors thesis in code, and it is the precondition
for a "desktop" (multiple apps/windows) not collapsing under its own weight.

### R4 — Real widgets + cross-widget commands (the "desktop")
Adopt the original widget-registry design: each widget declares `render / hitTest / dataSnapshot /
commandVocab / applyCommand` (F1's Spreadsheet already does most of this). Add a real text-document
widget next. Extend `Command` with cross-widget shape — `{ kind:'combine', source: WidgetId[],
target: WidgetId }`, `{ kind:'fix', target, patch }` — with mementos, so "combine these two
documents" and "quick fixes" are ordinary commands under the existing Policy gates (combine =
create-class; overwrite = gated).

### R5 — RAG-backed verification (the genuinely new capability)
A `verify_value(claim, target)` tool + server-side retrieval (`server.ts` + `better-sqlite3` is
already a dependency; embeddings via the existing Gemini key). Flow: model or user questions a
value → retrieve top-k from the doc store → compare against the widget's `dataSnapshot` → feedback
shows **verified / contradicted / no-source** with the citation one tap deep (same provenance
pattern as ramble-fill's transcript drill-in). Policy hook: unverified high-stakes values witness
rather than commit. This extends the honesty thesis from *perception* ("what am I pointing at") to
*facts* ("is this number right").

### R6 — Guidance mode ("ask how to do things" / "point out things")
A `point_out(targetId, note)` / `guide(steps[])` tool pair that draws on the existing overlay
(markers/highlight infra already exists) instead of mutating. Verb class `query`/`guidance` — never
gated, always reversible, forgiving grounding (region-level is success; a generous highlight still
teaches). Add `interactionMode: 'action' | 'guidance'` to telemetry with the more forgiving rubric
(per the SWIFT_DOCS_TO_VITE note §6) so the durability claim is measured, not asserted.

### R7 — Perf/cost pass (do opportunistically, not first)
- **Batch tile perception**: 4 tiles → one `generateContent` call with 4 images (labels as JSON),
  quarter the calls and latency.
- **Vision frame on change, not interval**: hash the drawn state; skip `sendVideoFrame` when
  unchanged (most frames are identical between actions).
- **Code-split** voice providers + Tesseract behind dynamic import (bundle is 777 kB with a Vite
  warning today).
- The Minors already on the ledger (double `resolveTileName` in the badge, write-only
  `perceivedVersion` comment, `.slice()` in `recentSlots`).

## 3. What NOT to do
- Don't build more content types on string identity (R2 first).
- Don't bolt the desktop onto App.tsx as-is (R3 first).
- Don't add an action executor for real external apps — out of scope per the Cocopilot division of
  labor (principles transfer; OS-control plumbing doesn't).
- Don't re-litigate the glance-monitor rules (no progress bars; editor stays out of the monitor).

## 4. Suggested sequencing

R1 (days) → R2 (small) → R3 (the big one, staged by module) → R4 (per-widget slices) → R5/R6
(independent once R2-R4 exist; R5 needs only R2). R7 rides along wherever files are already open.
Each R gets its own spec → plan → subagent-driven cycle.
