# FormFactors / AIPointerRemix — Gap Analysis vs the Learnings Doc

*Grounded in the actual `honest-mode` code (not assumptions), as the learnings doc §6 demands:
"a written gap analysis grounded in the actual code surfaces the foundational problems before you
build on top of them." Rubric = `docs/AGENTUILEARNINGS.md`.*

Date: 2026-06-27
Branch under review: `honest-mode` (HEAD `0675d5d`)
Verdict: **The interaction grammar is strong and largely matches the doc. The foundational gap is
perception — for maps and documents the model sees app-computed labels, not real pixels or real
structured data. Fix that before building more content types.**

---

## Scorecard (learnings doc area → actual code state)

| # | Learnings area | State | Evidence |
|---|---|---|---|
| 1 | Feedback & confirmation design | **Strong** | `feedback/index.ts`, `feedback/earcons.ts` |
| 2 | Autonomy / "how much it bugs me" | **Strong** (minus adaptive notch) | `scenarios.ts:495-520` decideCommit; feedback mode |
| 3 | Agent / command architecture | **Strong** | `handleVoiceToolCall` App.tsx:1478; `applyAction`; `coherence.ts` |
| 4 | Grounding the model in reality | **Partial — the gap** | frame builder App.tsx:2664-2806; `computePointingConfidence` L116-171 |
| 5 | Engine / model selection | **Strong on voice, partial on perception stack** | `src/voice/{gemini,openai,azure}.ts`; `ocr.ts` |
| 6 | Engineering & process | **Strong design, weak test harness** | taint-safety L2699; `telemetry.ts`; no test runner |

---

## What is already done well (do not rebuild)

- **Layer separation (doc §3).** `Intent` (tool calls) → `Command` → `Policy` (`decideCommit`,
  `scenarios.ts:507`, kept *out* of the effect) → `Effect` (`applyAction`) → `Feedback`
  (`emitFeedback`). Clean MAPE-K shape.
- **Undo via memento (doc §3).** `undoStack: {doc, label}[]` (App.tsx:1620); `handleUndo` (L2885).
  (Memento is a full prior-doc snapshot rather than an inverse op — heavier but correct.)
- **Idempotency + repair (doc §3).** `CallDeduper` (1500 ms window) and `parseRepair`
  (`undo`/`cancel`/`other`) in `coherence.ts`, with "no, the other one" swapping candidates.
- **Deterministic, app-owned feedback (doc §1).** Earcons synthesized per outcome; ascending =
  success/create, descending = close/error; <450 ms; instrument timbres; always a visual twin;
  the model is contractually silent on success (`buildInstructions`, App.tsx:1410-1412). This is a
  faithful implementation of the doc's earcon grammar and minimum-feedback floor.
- **Two separable dials (doc §2).** Friction = 4-level autonomy (`manual→confirm→auto-safe→
  autonomous`); verbosity = feedback mode (`silent→earcon→speech`). Orthogonal, as the doc wants.
- **Action→result loop (doc §4).** The 88 px DOCUMENT-STATE strip re-renders the mock doc into the
  model's next frame (App.tsx:2769-2794) so multi-step edits are visible to the model.
- **Referents/anaphora (doc §4).** `referents.ts` ring buffer (60 s), `promptContext()` feeds
  "recently referenced …" so "make that bold" / "the chart I just made" resolve across turns.
- **Pluggable voice engines (doc §5).** `VoiceProvider` interface with Gemini / OpenAI Realtime /
  Azure RTV2 — the "swappable form factor" already exists.
- **Taint-safety (doc §6).** Only CORS-clean cached images are drawn; `drawImage` in try/catch;
  failures fall back to a labeled placeholder so encoding never throws (App.tsx:2698-2710).
- **Telemetry (doc §6).** `telemetry.ts` logs deixis accuracy + calibration (high/low buckets),
  commit/witness counts, correction rate, grounding agreement, device/form-factor, exportable JSON.

---

## Foundational gaps (surface these before building — doc §6)

### F1 — Perception is partly schematic (THE BIG ONE, doc §4)

The model never sees the real app. `App.tsx:2664-2806` builds a synthetic 400×400 canvas:
- **Photos:** real pixels when CORS-clean ✓ (the one genuinely-perceived surface).
- **Map:** a gray rectangle labeled `"GOOGLE MAPS"` (L2716-2722) — the model cannot read the map.
- **Document/spreadsheet/slides:** a serialized **text strip** (`serializeMockDoc`, L2780) — e.g.
  `Excel — A1=100 B1=$50 chart:yes`. This is a *label the app already computed*, the exact
  "you believe it's seeing but it isn't" trap the doc names.

**Why it matters for the stated goal.** The vision is "all of the above — photos, maps,
spreadsheets, etc." A real map or spreadsheet has rich pixels *and* a rich data layer; the current
pipeline throws both away and substitutes a hand-authored summary. The model can only ever act on
what was pre-registered into the schematic — it can't handle a cell, a street, or a chart series it
wasn't told about.

**The DOM point (your correction).** Being in the DOM is supposed to make the **data layer**
readable. Today that data layer is flattened into ~6 lines of canvas text. The fix has two honest
channels, sent together (never labels-only):
1. **Real pixels** — rasterize the *actual* rendered widget region (the real map/sheet/doc node),
   not a redrawn box.
2. **Real structured data** — send the widget's true `dataSnapshot()` (cell grid, map
   markers/center/zoom, doc runs) as structured text, from the live DOM, not a curated string.

### F2 — Confidence's headline signal is a seeded table (doc §4)

`computePointingConfidence` (App.tsx:116-171) returns low confidence primarily from a **seeded
`confusablePairs` table** (Save ↔ Save As). The code comment admits it is "NOT a
perception-confidence model." The doc is explicit: *derive confidence from disagreement, not a
seeded table.*

The good news: the **honest mechanism already exists** — `appReferent` (hit-test) vs `modelTarget`
(model's read) disagreement forces a witness (App.tsx:1597-1614) and is logged via
`telemetry.grounding`. The fix is to **promote disagreement to the primary confidence signal** (the
model states what it sees from real pixels; reconcile against the hit-test) and **retire the seeded
confusable table**. The confusable cases then fall out naturally, because a real read of two
look-alike buttons genuinely disagrees with the hit-test.

### F3 — No automated test harness (doc §6)

`package.json` scripts are `dev / build / start / clean / lint(tsc --noEmit)` — no test runner.
The pure logic (`coherence.ts`, `referents.ts`, `scenarios.ts` matchers, `feedback`) is eminently
unit-testable, but the only checks are **commented-out self-checks** in `coherence.ts` (L181-209),
never executed. The doc requires "typecheck + build + a headless smoke … pure-function tests for
logic." Add vitest (port the commented assertions) + one Playwright mount smoke before extending.

---

## Secondary gaps (worth noting, not blocking)

- **Adaptive autonomy notch (doc §2).** Autonomy is a fixed user-set level; the doc's "Auto notch
  slides by live confidence × cost" is absent. Grounding mismatch overrides to witness, which is a
  partial version of this.
- **CARE routing fidelity (doc §1).** Feedback routes by a single mode (silent/earcon/speech)
  rather than a full `route(goal, context) → {relation, channels[]}`. Adequate; not a true CARE
  router.
- **Perception stack breadth (doc §5).** OCR (Tesseract) is present; **CLIP-style open-vocab
  embeddings are not** (no match/confidence for "the blue one"); no fast **local ASR / EOU** model
  (relies on cloud realtime, which is the doc's deixis-timing risk).
- **Deixis timing (doc §4).** Pointer-at-keyword binding exists via `[USER JUST SAID "THIS" WHILE
  POINTING AT: …]` hints, but late cloud finals remain a risk; no local EOU model.

---

## Recommended sequencing

The doc says fix foundations before building on them. Proposed order:

1. **F3 first (cheap, enabling):** add vitest + a Playwright smoke; port `coherence.ts` self-checks.
   Makes every subsequent change verifiable. ~small.
2. **F1 (the big one):** introduce a real perception channel for one non-photo widget — make the
   model see the **real rendered pixels + real `dataSnapshot()`** of (recommended) the spreadsheet,
   replacing its text-strip label. Proves the data-layer thesis end-to-end on the hardest case.
3. **F2:** promote disagreement-derived confidence to primary and retire the seeded confusable
   table, now that the model has a real read to disagree with.

Everything else (adaptive autonomy, CARE router, CLIP, local EOU) is additive afterward.
