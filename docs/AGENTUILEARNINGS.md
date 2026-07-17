# Transferable learnings — multimodal / voice-agent UI & agent architecture

*Soft guidance distilled from building a point-and-speak (vision + deixis → action) voice
agent. Advisory, not prescriptive — adapt to your project. Phrased as "prefer / consider /
watch for" on purpose.*

---

## 1. Feedback & confirmation design

- **Don't make the model narrate success.** Reserve the LLM's voice for *dialogue* (questions,
  hedges, errors). Let the **app** own action confirmation via a deterministic channel (earcon /
  visual toast / haptic), fired within ~100 ms. This kills "confirmation fatigue" and removes a
  whole class of "don't confirm twice" prompt hacks.
- **Treat output modalities as a routed, runtime-selectable channel** (CARE properties:
  Complementarity / Assignment / Redundancy / Equivalence). A "feedback dial" (silent → earcon →
  speech) is just `route(goal, context) → {relation, channels[]}`. Keep a **minimum-feedback
  floor**: routine success may be silent/earcon, but "did it work?" must always be answerable
  (a visual always-on), and irreversible actions always emit notify+undo.
- **Confirm sparingly, gated on cost × reversibility, not on confidence alone.** Prefer
  **undo over confirmation** for reversible actions (act-then-notify + Undo). Reserve blocking
  confirms for the irreversible-AND-high-cost cell. (NN/g, Google/Alexa VUI guidelines, Horvitz
  expected-value rule.)
- **Earcon design** (if you use non-speech audio): instrument timbres (not raw sine/square);
  pitch ~150 Hz–5 kHz with low fundamentals (accessibility); ≤ ~500 ms; **valence = pitch
  contour** (ascending = create/success, descending = error/close); **severity = timbre/loudness**;
  consonant for routine, dissonance only for error; a *small, heterogeneous* set learns better than
  many near-identical cues; **never audio-only** (always a visual/haptic twin — WCAG). Prefer
  auditory-icon metaphors / spearcons over abstract earcons (they learn ~1.1 vs ~8.5 cycles).

## 2. Autonomy / "how much it bugs me"

- Model autonomy as a **graded dial** (Levels of Automation: Manual → Confirm → Auto-safe →
  Autonomous), not a binary. Make it **intent-aware**: reversible directives (navigate, format)
  run liberally; world-changing declaratives (delete, send, overwrite) gate. An "Auto" notch can
  slide adaptively by live `confidence × cost`, with a hard user override.
- Verbosity (what it tells you) and friction (whether it asks first) are **separable** — two dials
  beat one "chattiness" knob.

## 3. Agent / command architecture

- **Separate the layers:** `Intent → Command → Policy → Effect → Feedback` (a MAPE-K control loop;
  mechanism/policy separation). Keep **policy** (confirm-vs-act) out of the **effect** (mutation).
- **Make effects pure reducers** `(state, command) → (state', memento)`. Undo falls out for free
  from a command+memento history. Don't reach for Event Sourcing / CQRS unless you truly need it.
- **One source of truth for content/config** (a single data module the UI derives from) beats
  literals scattered across files. Adding a new "thing" should be a local, additive edit.
- **Idempotency + repair:** dedup tool calls by (name, args) within a short window (a real agent
  failure mode). Add a tiny **repair grammar** — "undo that", "cancel", "no, the other one" → swap
  to the alternative candidate — beyond a global undo.

## 4. Grounding the model in reality (the big one)

- **Make perception real, not a schematic.** It is dangerously easy to feed a model *labels you
  already computed* (boxes + names) and believe it's "seeing." Send **real pixels**; if a label is
  the only input, the model isn't perceiving and can't handle anything you didn't pre-register.
- **Close the action→result loop.** After the agent acts, it must *perceive the consequence*
  (re-render the new state into its input, and/or feed a structured "world state" text). Without
  this, multi-step work and verify-after-act are impossible.
- **Derive confidence from disagreement, not a seeded table.** Have the model state what it thinks
  it's acting on; reconcile against an independent signal (your hit-test, or a second model).
  **Disagreement = genuine low confidence** (mutual disambiguation, Oviatt) — far more honest than
  a hardcoded "confusable pairs" list.
- **Referents & anaphora:** keep a small registry of recently pointed-at / created entities and
  feed "recently referenced: …" to the model so "make *that* bold" / "the chart I just made"
  resolve across turns. Guard pronoun resolution against questions ("what time is *it*").
- **Timing is a first-class problem.** For deixis ("this/here"), the keyword must bind to the
  pointer *at utterance time*. Cloud transcripts that arrive end-of-turn break this; pre-send the
  current target proactively, and consider a fast local ASR + a learned end-of-utterance model
  rather than silence timeouts.

## 5. Engine / model selection (as of early 2026)

- **Realtime voice (browser-reachable):** Gemini Live, OpenAI Realtime (`gpt-realtime`), Azure
  RTV2 are the performance frontier; they differ mostly in *what you feed them* (continuous video +
  streaming partials vs sparse snapshots + late transcripts).
- **Perception stack is complementary, not redundant:** **OCR** (read text + per-word boxes →
  Tesseract.js in-browser, or native VNRecognizeTextRequest) + **CLIP-style embeddings** (match /
  open-vocab confidence → MobileCLIP on-device) + **Accessibility tree** (semantic UI structure on
  native platforms). OCR reads, CLIP matches, AX gives structure.
- **Input side:** fast local ASR (e.g. SenseVoice) for low-latency keyword/deixis timing; a learned
  **turn/EOU** model (Smart Turn as a separate component, or Parakeet-EOU fused into ASR) beats
  silence-timeout heuristics. Native Apple **Vision Framework** is powerful but native-only (forces
  a platform decision vs staying web).

## 6. Engineering & process

- **Graceful degradation by construction.** New capability (OCR model download, cross-origin
  images, a backend) should *fail soft* — if it can't load, the app behaves as before. Gate heavy/
  optional features behind a toggle, default off.
- **Canvas taint-safety:** drawing a cross-origin image taints a canvas and breaks `toBlob`. Only
  draw images that loaded *clean* (`crossOrigin="anonymous"` + CORS); fall back to a placeholder
  for the rest, so encoding never fails.
- **Instrument before you optimize.** A small telemetry layer (per-attempt accuracy vs a known
  ground truth, calibration, correction rate, latency, device/form-factor) turns subjective
  "feels better" into A/B evidence — and is the right way to decide platform/form-factor.
- **Verify every increment:** typecheck + build + a headless smoke (pure-function tests for logic;
  a browser mount for "no runtime errors"). Land features in small, independently-verified slices.
- **When parallelizing with subagents:** have them author *isolated* modules (no shared-file
  conflicts) and integrate sequentially yourself. **Watch agent-authored files for encoding
  issues** (we hit NUL bytes that compiled but flagged as binary — `tr -cd '\000' | wc -c` to
  check). Re-verify their output; don't trust the "PASS" blindly.
- **Plan before big builds:** a written gap analysis grounded in the actual code (not assumptions)
  surfaces the *foundational* problems (e.g. "the vision is fake") before you build on top of them.

## Key sources (worth reading)

Instrumental Interaction (Beaudouin-Lafon, CHI 2000); CARE properties (Coutaz & Nigay);
Mixed-initiative (Horvitz, CHI 1999); Levels of Automation (Sheridan/Verplank; Parasuraman et al.
2000); Norman gulfs + feedforward (Vermeulen, CHI 2013); Put-that-there (Bolt 1980) & Oviatt
mutual disambiguation; earcons (Blattner 1989; Brewster guidelines; Walker spearcons); Calm
Technology (Weiser & Brown; Case); VUI confirmation (Pearl; Google/Alexa/NN-g).
