# Controller architecture for a point-and-speak command surface

*A design study: how to model command / control / transform / mutate / create, and how to
build a "control dial" so the assistant can confirm by **speech**, by **earcon**, by **visual
only**, or **silently** — instead of always narrating "done."*

---

## 1. The problem with where we are

Today the loop is monolithic:

```
voice+pointing → handleVoiceToolCall → (confirm baked into the prompt) → applyAction → the MODEL SPEAKS "done"
```

Three things are fused that should be separable:

1. **Policy** (how much to confirm / how much autonomy) lives in the system prompt + a per-verb
   `confirm` arg — it can't be tuned at runtime and isn't reusable across verbs.
2. **Feedback** is hard-wired to **one channel: the LLM's voice**. Every confirmation is spoken,
   which is exactly the "too many words for a repetitive task" failure NN/g found, and trains
   *confirmation fatigue* (Google/James Giangola: users "stop reading and automatically click OK").
3. **Execution** (`applyAction`) is already a clean pure reducer — but it's wedged between the
   other two concerns instead of standing alone.

The research below converges on a single fix: **separate the instrument from the effect, make
feedback a routed channel, and put policy on a dial.**

---

## 2. Three load-bearing ideas from the literature

**A. Instrumental Interaction** (Beaudouin-Lafon, CHI 2000) — model the UI as an *instrument*
acting on *domain objects*. Our point-and-speak loop is the instrument; the document is the
object. Keeping them separate lets us tune the controller on his three measures — *indirection*
(anchor feedback at the pointed location), *integration*, *compatibility* (a "make this bold"
produces a visible bold change at the referent) — independently of document logic.

**B. CARE properties** (Coutaz & Nigay) — modalities relate by **C**omplementarity,
**A**ssignment, **R**edundancy, **E**quivalence, *for output as well as input*. This is the
theoretical license for a **feedback dial**: treat *visual highlight / earcon / speech / haptic /
silent* as **Equivalent** output channels and let a runtime router pick the relation per event.

**C. Mechanism/Policy separation + MAPE-K** (Brinch Hansen; IBM autonomic computing) — the part
that *mutates* (mechanism) must not hard-code *whether/when/with-confirmation* (policy). The
control loop is **M**onitor → **A**nalyze → **P**lan → **E**xecute over shared **K**nowledge.

Map MAPE-K onto a five-stage pipeline:

```
 Intent          Monitor   point+speak → {verb, target, args, confidence}   (mutual disambiguation: Oviatt)
   │
 Command         Analyze   → typed, validated Command object (serializable)
   │
 Policy          Plan      → autonomy + confirmation decision  ── DIAL A ──▶ {commit | notify | propose | ask}
   │
 Executor        Execute   pure reducer verb handlers (state, Command) → (state', memento)
   │
 State + Undo     ▲ Knowledge: command/memento history
   │
 Feedback router            choose channels  ────────────── DIAL B ──▶ {speech | earcon | visual | haptic | silent}
```

Your existing pieces already sit on this spine: `handleVoiceToolCall` ≈ Command dispatch,
`applyAction` ≈ Executor, honest-mode confidence/commitment ≈ Policy, `onModelAudio` speech ≈
*today's single, hard-wired* Feedback channel. The work is mostly **extracting feedback into a
router** and **graduating policy onto a dial**.

---

## 3. A principled verb taxonomy (command / control / transform / mutate / create)

Searle's speech acts give the spine: **direction of fit** + **reversibility × cost** set the
*default* policy. (Defaults — the dial shifts them globally.)

| Verb class | Speech act | World change | Default action mode | Default feedback |
|---|---|---|---|---|
| **query / identify** | representative | none | commit immediately | none / earcon (ack) |
| **command / control** (navigate, select, focus) | directive, transient | view only, reversible | optimistic commit | earcon |
| **transform** (format, restyle) | directive | reversible content | optimistic commit + show change | earcon + visual |
| **mutate** (edit value, set field) | directive | durable, reversible | act-then-**notify + Undo** | earcon + visual toast |
| **create** (insert slide, add chart) | declarative | additive, reversible | act-then-**notify + Undo** | "additive" earcon + visual |
| **destroy / overwrite** | declarative | hard-to-reverse, high cost | **confirm-before-commit** (floor) | speech/visual prompt |
| **share / send** (outward) | declarative | irreversible, social cost | **witness-render + confirm** | speech + visual (the card you already have) |

This is the cross-product the VUI and autonomy literature all land on: **Google/Alexa/NN/g** all
say *confirm sparingly, gate explicit confirmation on cost-of-error and irreversibility*; Horvitz
formalizes it as *act only when expected value of acting > not acting*, with a confidence
threshold **p\*** that rises with cost-of-error. The `lookalike` beat you already have is the
**p\* < confidence** case made concrete.

---

## 4. DIAL A — Autonomy / friction ("how much it bugs me")

Graduates today's binary honest-mode toggle into Sheridan/Parasuraman **Levels of Automation**:

| Notch | LoA band | Behavior |
|---|---|---|
| **Manual** | L1–3 | preview every action; nothing commits without an explicit "go" |
| **Confirm** | L4–5 | propose + require approval before *any* state change; queries run free |
| **Auto-safe** *(default)* | L6–7 | silently commit reversible/low-cost verbs; confirm only the *destroy/share* cell |
| **Autonomous** | L8–10 | commit everything; route hard-to-reverse through **act-then-notify + Undo**, not a blocking dialog |

It's **intent-aware**: the same notch treats `transform`/`control` (reversible directives)
liberally and `destroy`/`share` (irreversible declaratives) conservatively. An optional **"Auto"**
meta-setting makes the dial *adaptive* (sliding autonomy) — the system raises/lowers the notch by
live `confidence × cost`, with the user keeping a hard override (Horvitz #6).

**Coupling rule (the safety floor):** even at *Autonomous*, an irreversible action must emit at
least notify+Undo. Reversibility is the master variable (NN/g: "prefer undo over confirmation";
LogRocket reversible-actions matrix). Undo falls out for free from the command/memento history.

---

## 5. DIAL B — Feedback modality ("how it tells me")

CARE-Equivalent channels, selected at runtime. This is the dial you specifically asked for —
speech ↔ earcon ↔ silent:

| Notch | Channels | When |
|---|---|---|
| **Silent** | visual highlight only | demo/recording, expert flow |
| **Earcon** *(recommended default)* | short non-speech cue + visual | normal use — glanceable + a tone, no narration |
| **Ambient+** | earcon + visual + (haptic if present) | noisy/eyes-off; CARE-**Redundancy** for emphasis |
| **Speech** | LLM voice + visual | onboarding, accessibility, hands-and-eyes-busy |

Two hard rules from the research bound every notch:

- **Minimum-feedback floor (Norman's Gulf of Evaluation):** routine success may be silent/earcon,
  but *"did it work?"* must always be answerable — so the **visual** channel is never fully off,
  and an irreversible commit always shows notify+Undo. Norman: "confirm every action, but
  unobtrusively." Calm-tech: "technology can communicate but doesn't need to speak."
- **Never audio-only (WCAG 1.3.3 / 1.2.1):** every audio cue has a redundant visual (and ideally
  haptic) equivalent — which CARE gives you for free, and the Redundant-Signals-Effect says also
  makes confirmation *faster* to perceive.

---

## 6. The key move: take routine confirmation **out of the LLM's mouth**

Right now the model speaks "Here's the London Eye / Done" because the prompt tells it to verbally
confirm *and* it emits audio. The cleanest architectural change is to **reassign channels by who
owns them**:

- **The app (deterministic) owns *action confirmation*** → earcon + visual. Fires within **100 ms**
  (Nielsen's instantaneous threshold; sub-100 ms reads as *you caused it* — Michotte causality).
- **The LLM's voice is reserved for genuine dialogue** → questions, hedges, disambiguation,
  explanations. I.e., it speaks **only when honest-mode would make it ask or hedge** — never to
  rubber-stamp a success.

This is a one-line shift in `buildInstructions` ("perform the tool call; **do not** verbally
confirm successful actions — stay silent on success; speak only to ask, hedge, or report an
error") plus an app-side earcon on `sendToolResponse`. It also *fixes* a current bug-magnet: the
"don't confirm twice" prompt rules become unnecessary because the model no longer confirms at all.
Dial B's *Speech* notch simply re-enables spoken confirmations for users who want them.

---

## 7. The earcon "sonic language"

Design constraints (Brewster's experimentally-derived guidelines + accessibility):

- **Instrument timbres, not sine/square** (simple tones are easily masked); one timbre = the
  controller's "voice" so the set feels like a family.
- **Pitch 150 Hz – 5 kHz**, keep fundamentals **low** (presbycusis hits >2 kHz first; a 520 Hz cue
  woke 92% of HoH sleepers vs 56% at 3.1 kHz). **Consonant = routine, dissonant = reserved for
  error** only. Duration **≤ ~500 ms** (0.5 s/1 s beat 2 s); fire ≤100 ms; keep jitter low.
- **A handful of cues, used consistently** — don't make users learn a dictionary.
- **Prefer meaning-bearing cues over abstract earcons.** Walker et al.: spearcons/speech reach
  100% recognition in ~1.14 training cycles vs ~8.5 for abstract earcons; auditory icons (Gaver)
  are intuitive by analogy. So lean on **auditory-icon metaphor** + optional **spearcon** label,
  using abstract pitch only as a *status modifier*.

Proposed family (status = pitch contour; class = metaphor/rhythm):

| Event | Cue (auditory-icon led) | Contour |
|---|---|---|
| **Listening / attention** | soft breath/“open” tone | neutral, sustained |
| **command/control accepted** | tiny tactile “tick” | flat |
| **transform/mutate committed** | short latch/“click-settle” | **resolve down** (closure) |
| **create** | SonicFinder-style “pour/fill” | **rising** (completion) |
| **needs confirmation (p\*<conf)** | same family, **unresolved** | **rising, suspended** (a question) |
| **rejected / can't-tell** | muted thud | **falling**, slightly dissonant |
| **undo** | the commit cue **reversed** | mirror contour |

Concurrency (rare here): unique timbre per stream + ~300 ms onset stagger if two ever overlap.

**Mapping axes** (Material Design Sound + Apple HIG + Walker polarity work):
- **Valence → pitch contour:** ascending = success / create / open; descending = error / delete /
  close. (The one mapping that *is* near-universal.)
- **Severity → timbre + loudness:** brighter/sharper/louder = higher-priority or *irreversible*;
  softer/rounded/quieter = routine/reversible. Loudness tracks position in the hierarchy; reserve
  the most prominent cue for the irreversible `destroy`/`share` cell. A single distinct **"hero"**
  sound is reserved for top-of-hierarchy moments (first connect), never routine feedback.
- **Apple's three tests** — *Causality* (obvious what triggered it), *Harmony* (feels the way it
  looks/sounds — fire the earcon **at the pointed location's** highlight), *Utility* (carries value,
  not decoration). Heuristic: the motif should be **simple enough to hum** (recall survives noise).
- Counter-intuitively, a *heterogeneous* cue set is **easier to learn** than a homogeneous one
  (the IEC 60601-1-8 lesson) — so make the few cues genuinely distinct, not minor timbre variants.

---

## 8. How it maps onto this codebase

| Layer | Today | Target |
|---|---|---|
| Intent | deixis loop + `computePointingConfidence` | unchanged (already does mutual disambiguation) |
| Command | `handleVoiceToolCall` if/else | a small `Command = {verb, class, target, args, confidence}` + dispatch table |
| Policy | prompt + per-verb `confirm` | `decide(command, dialA) → {commit|notify|propose|ask}` + verb→class map in `scenarios.ts` |
| Executor | `applyAction` (pure ✓) | unchanged; return `{state, memento}` for undo |
| Undo | none | command/memento history stack (cheap) |
| Feedback | `onModelAudio` speech only | **`FeedbackRouter`**: `{ earcon (WebAudio), visual (your witness card/highlight/toast), speech (model audio), haptic (navigator.vibrate) }`, selected by `route(class, dialB, context)` |
| Dials | honest-mode toggle | Autonomy dial + Feedback dial (same pattern as the program dropdown) |

Honest mode is **subsumed**: it becomes the *Confirm/Auto-safe* notch of Dial A, not a separate
toggle.

---

## 9. Recommended first slice (resist over-building)

Ship the seams, not the cathedral. **Skip** full Event Sourcing / CQRS (Fowler: "risky
complexity… most of my encounters were unsuccessful"), a rules engine, and distributed
idempotency. **Build:**

1. **`FeedbackRouter`** with three channels: **earcon** (a tiny WebAudio synth — ~6 cues),
   **visual** (reuse the `pendingAction`/witness card + a lightweight toast + the existing
   highlight), **speech** (passthrough of model audio). One function `route(verbClass, dialB)`.
2. **Feedback dial** (Silent / Earcon / Speech) — a dropdown like the program picker.
3. **Verb→class + default-policy map** in `scenarios.ts` (data, not code) — extends the action
   taxonomy you already built.
4. **Prompt change** (§6): model stops speaking successful confirmations; app earcons them.
5. **Undo stack** from `applyAction` mementos (you already have pure state — capture prev state).

That's roughly honest-mode-toggle-sized, almost entirely additive, and it makes the whole
"command/control/transform/mutate/create" surface tunable along both axes.

Later, if wanted: Autonomy dial as a 4-notch control; adaptive "Auto" mode; haptic channel;
spearcon labels; per-stage (Parasuraman) autonomy.

---

## 10. Open decisions for you

1. **One dial or two?** Verbosity (Dial B) and friction (Dial A) are separable; a single
   "chattiness" knob is simpler but conflates them. Recommend **two**, but ship Dial B first.
2. **Earcons: synth or sampled?** A tiny WebAudio synth (zero assets, tunable) vs. designed
   samples (richer, but assets + licensing). Recommend **synth for v1**.
3. **Does the model ever self-confirm?** Recommend **no** — confirmation becomes app-owned;
   model voice = dialogue only. Reversible at the *Speech* notch.

---

## Sources

Architecture: Command/Memento (GoF — refactoring.guru, gameprogrammingpatterns.com); CQRS/Event
Sourcing (martinfowler.com/bliki/CQRS.html, learn.microsoft.com event-sourcing); Redux reducers
(redux.js.org); function-calling as command interface (martinfowler.com/articles/function-call-LLM.html);
idempotent tools (padiso.co); mechanism/policy separation & MAPE-K (en.wikipedia.org/wiki/Separation_of_mechanism_and_policy,
autonomic computing).
Interaction models: Put-that-there (Bolt 1980); Oviatt multimodal complementarity & mutual
disambiguation (cogsci.msu.edu, charlotte.edu); Instrumental Interaction (lri.fr/~mbl/papers/CHI2000/paper.pdf);
Shneiderman–Maes debate; Horvitz mixed-initiative (erichorvitz.com/mixedinit.htm); CARE properties
(core.ac.uk/outputs/101380016, Nigay & Coutaz).
Autonomy/dial: Sheridan & Verplank 1978; Parasuraman, Sheridan & Wickens 2000; sliding autonomy
(cs.cmu.edu/~mmv/papers/08ias.pdf); Norman gulfs & feedforward (nngroup.com/articles/two-ux-gulfs-evaluation-execution,
Vermeulen CHI 2013); Bellotti "Making Sense of Sensing Systems" 2002; Searle speech acts
(plato.stanford.edu/entries/speech-acts); reversibility (nngroup.com/articles/confirmation-dialog,
blog.logrocket.com ux-reversible-actions-framework).
VUI confirmation: Google Conversation Design confirmations; Pearl *Designing VUI* (O'Reilly);
Alexa design guidelines; NN/g intelligent-assistant usability; Sagawa et al. Interspeech 2004.
Auditory/earcons: Blattner, Sumikawa & Greenberg 1989; Gaver everyday listening & SonicFinder;
Brewster experimentally-derived earcon guidelines (dcs.gla.ac.uk/~stephen/earcon_guidelines.shtml);
McGookin & Brewster concurrent earcons / Sonification Handbook ch.13–14; Walker et al. spearcons
(sonify.psych.gatech.edu); Jeon et al. learnability (music/earcons/spearcons/lyricons).
Ambient/feedback/accessibility: Weiser & Brown calm technology; Case Calm Tech principles;
earPod (dgp.toronto.edu, CHI 2007); Redundant-Signals-Effect (frontiersin.org); Nielsen response-time
limits (0.1/1/10 s); action-sound latency/jitter (Jack et al. 2018); IEC 60601-1-8 alarm
distinctiveness; WCAG 1.3.3 / 1.2.1 / 1.4.2; presbycusis & 520 Hz waking study (Bruck).

*Method note: fetched via search-engine extracts of these canonical URLs (direct page fetch was
egress-blocked this session); exact numeric thresholds worth re-verifying against the primary PDFs
before publication.*
