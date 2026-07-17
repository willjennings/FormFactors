# Response Grammar — Design Spec (the card contract)

*The model has no response surface today: its output is a voice stream, a toast, and a witness
card. This spec defines the missing grammar — a small set of typed cards the model must pour
itself into, with budgets enforced at render. The paragraphs aren't a prompting problem; prose is
the model's native shape, so the fix is a schema, not a style plea. This prototype is about the
front-end experience that drives real learning and real help when you need it — the card is the
unit of both.*

Date: 2026-07-03
Branch: `honest-mode`
Status: Approved design — contract spec; the floating response window/shell is project A
(separate spec), foundations (entity granularity, perception) are project C.
Decision record: **strict contract** (all instructional/informational content arrives as cards;
voice carries one guideLine sentence + genuine dialogue only). **Unified rail** (the teaching
sequence IS a rail of cards; no second grammar).

---

## 1. Positioning — the three-channel split

Model output divides contractually:

| Channel | Carries | Where it lands |
|---|---|---|
| **Cards** (`respond` tool call) | ALL instruction and information | The rail (rendered, durable, glanceable) |
| **guideLine** (one sentence per response) | Persona, warmth, connective tissue ("Two more and the hard part's done.") | Spoken aloud in voice mode; small interstitial text in typed mode |
| **Voice dialogue** | Questions, hedges, errors — per `AGENTUILEARNINGS.md` §1 | Audio |

Cards are neutral, scannable, persona-free. Warmth rides the interstitial; instruction rides the
card. This is the Duolingo/WalkMe distinction: separate the mascot from the exercise, and you get
glanceable AND warm; stuff tone into the tooltip and you get neither.

**Why strict:** a soft contract ("cards for sequences, voice for quick answers") reopens the door
to prose — the model will classify everything as quick. Strict is the only version where
verbosity physically has nowhere to go except the collapsed WHY slot. The realtime-voice
mechanics fit exactly: tool calls are already the structured side-channel; audio literally
becomes the interstitial channel.

## 2. Card taxonomy — eight types, two workhorses

Budgets are character limits enforced at the mapper/renderer (§6), not suggestions.

| Type | Role | Budget | Notes |
|---|---|---|---|
| **DO** | The 80% card. ONE action, verb-first, from the actuation verb set; target bolded; entity-bound. | action ≤90, result ≤60 | Result line doubles as feedforward — the user knows what success looks like before acting (quietly halves the CHECK cards needed). Schema enforces a single verb. |
| **ANSWER** | The query workhorse (explain/identify — "what is this?"). | ≤80 | The type the source taxonomy lacked; ORIENT is sequence-start, CONCEPT is a flashcard — queries need their own tightest-budget card. |
| **ORIENT** | One line of "here's where we are" at a sequence start. | ≤90 | |
| **CHECK** | "You should now see…" with the honest split rendered. | ≤80 | `verify: 'auto'` → solid ✓ "I confirmed it" (predicate against the reducer, §7); `verify: 'user'` → "confirm for me". |
| **CAUTION** | Before anything destructive, in the receipt register. | ≤90 | Rides with the Policy witness: a witnessed high-commitment action renders its CAUTION card in the rail rather than a detached sidebar box. |
| **CONCEPT** | The true flashcard: front = question/term; back = ≤2 sentences + an analogy slot; flippable. | front ≤60, back ≤160, analogy ≤80 | Flashcard is a *property*, not a format — see §5 participation renderings. |
| **TRY** | A prompt to do something WITHOUT instructions + what to notice. The exercise unit (teach posture: the learner generates). | prompt ≤90, notice ≤60 | |
| **RECAP** | End of sequence. Three lines max. Feeds the ledger. | 3 × ≤60 | |

**The verb set is ours.** DO verbs are the existing actuation vocabulary — click, press, type,
drag, open — the same language as `ACTION_VERBS`/teach steps, so the language of instruction and
the language of actuation are one language. A DO card's action, executed, dispatches through the
same `applyAction` reducer that direct clicks and voice use.

## 3. Anatomy of one card

```
┌──────────────────────────────────────┐
│ DO                          (kicker) │  mono, tiny, type label
│ Press **⌘B**            (action line)│  the big text; bold the THING, not the verb —
│ → The clip splits.      (result line)│    the eye is hunting for the thing
│ why?  ·  show me       (affordances) │  quiet, right-aligned
└──────────────────────────────────────┘
```

- **why?** — where the paragraphs go to live. Progressive disclosure, not deletion: the model may
  still write its three sentences of rationale, collapsed behind one tap, never blocking the
  glance. **The paragraph tax:** anything over budget is automatically demoted to the WHY slot by
  the mapper — verbosity costs the model placement, not the user attention.
- **show me** — morphs the card into guidance: taps into the on-element teaching overlay
  (HighlightRing/StepBadge) for the card's bound entity. Card → overlay is a projection, not a
  hand-off (§5: same object).

**Micro-rules:** one clause per line; no subordinate clauses in DO cards. Numbers only when order
carries information. Result lines in the verified-teal treatment.

## 4. Band inheritance — the honesty floor, rendered inside the instruction

Every entity-bound card (`DO`, `CHECK`, `CAUTION`, `TRY` with a target; ANSWER when it names an
element) carries its resolution outcome from `resolveEchoedTarget`:

- **Resolved** → solid pointer affordance; *show me* enabled.
- **Below the resolution threshold** → the pointer renders **hollow** and the card rewrites
  itself into the refusal grammar: *"Find the transition handle (I can't point at it — you look,
  you press)."* The refusal arrives inside the instruction, not as an interruption.
- **Future card whose target doesn't exist yet** (e.g. a dialog that opens at step 3) → dimmed
  title with a hollow pointer, expected; not an error.

This is the Cell-A3 honesty floor (`registry.ts` `resolveEchoedTarget`, ≥2-token overlap, unit-
tested) promoted from an error path to a rendering rule. **Deliberate divergence from
`teachCallToEvent`:** teaching fails the whole call on an unresolvable target (the agent must
never *teach at* a guessed element); the response grammar instead renders the refusal inside the
card, because a card can honestly instruct without pointing. Do not "unify" these — the
difference is the design. Whole-call semantics match
`teachCallToEvent`: a structurally invalid `respond` payload fails the WHOLE call with an error
naming the violation, returned to the model as data — never thrown, never partially rendered.
(Over-budget text is NOT a structural violation — it demotes to WHY, §3.)

## 5. The rail — and its unification with teaching

**One rail object:** ordered cards + `activeIndex` + a sequence identity (`taskKey`). The card
rail and the teaching rail are the same object:

- **Past** cards compress to single-line done-stubs with ✓ (the teaching layer's ✓-dots,
  generalized). **Active** card is full-size. **Future** cards are dimmed titles (hollow pointer
  if the target doesn't exist yet).
- `teach_sequence` becomes a rail of entity-bound DO cards whose subgoals are kickers; ORIENT
  opens it, RECAP closes it. `TeachStep` ⊂ DO card. One store; `TeachingLayer`'s overlays render
  from the same objects the rail renders.
- **Guide / teach / fade are rendering policy, not separate systems:**
  - fade 0 (full scaffold): full cards, solid pointers, soft-block active, agent/learner advances
    per posture.
  - fade 1: rail collapses toward stubs; highlights only; no block.
  - fade 2: **caption mode** — a one-card-at-a-time projection of the same rail (also the
    rendering used during cursor-led guidance). "Show me" restores one card's full scaffold
    (reveal semantics already in the teaching store).
  - Teach posture renders TRY cards where guide posture would render DO cards; CONCEPT's back
    hides until an attempt in quiz/participation mode. **One content object serves teach, test,
    and review** — the flashcard property (§2): author front+back once; the participation dial
    decides the rendering; spaced resurfacing re-deals old CONCEPT cards front-only using the
    competence ledger's decay clock.
- **Visibility:** 3±1 cards visible; sequences past ~5 chunk into legs with a breath (a guideLine
  moment) between. Mobile is the same card at S size. One grammar, four surfaces (rail, caption,
  overlay, mobile).

## 6. Transport, schema, enforcement

A single `respond` VoiceTool. Example payload:

```json
{ "seq": "word.save",
  "cards": [
    { "t": "orient", "text": "Your report is open; nothing saved yet." },
    { "t": "do", "verb": "click", "target": "Save button",
      "result": "The title bar reads Saved.",
      "why": "…the prose lives here, collapsed…" },
    { "t": "check", "verify": "auto",
      "expect": { "path": "saved", "equals": true },
      "text": "The document shows Saved." } ],
  "guideLine": "One click and your work is safe." }
```

- **Pure mapper** `respondCallToRail(call, entities, doc) → RailEvent | { error: string }` — the
  honest-mapper pattern (`teachCallToEvent`'s sibling): every `target` resolves via
  `resolveEchoedTarget`; budgets applied (overflow → WHY demotion; single-verb rule, unknown card
  type, missing required slots → whole-call error as data). Fully unit-testable.
- **Renderer validates at render too** (defense in depth): a card that arrives over budget after
  demotion renders truncated with the overflow in WHY — the renderer physically cannot show a
  paragraph. The budget is the design.
- **Quality-floor note:** constrained generation into typed slots is dramatically easier for
  small models than free prose that happens to be well-structured — the grammar is also a quality
  floor for cheaper/local backends.
- The system prompt's response contract section is written against this schema (prompt wording is
  out of scope here; the schema is the contract it must express).

## 7. Verification — ✓ never lies

- `verify: 'auto'` CHECK cards carry a typed predicate evaluated against the reducer state
  (`MockDoc`): `{ path: <MockDoc field>, equals: <value> }` (dot-paths for nested fields, e.g.
  `cells.A4`). Ground truth is the same pure state `serializeMockDoc` reads — the solid ✓ means
  the app confirmed it, not that the model asserted it.
- A predicate that references an unknown path is a whole-call error (honesty over helpfulness).
- `verify: 'user'` renders "confirm for me" with a tap affordance; the tap is a telemetry event
  and advances the rail.
- An auto-CHECK that evaluates FALSE renders honestly as ✗ "not yet — {text}" and does not
  advance; it never silently passes.

## 8. Telemetry

Card events extend the guidance rubric (`interactionMode: 'guidance'`): `card_dealt` (type,
band), `card_flipped`, `why_opened`, `show_me`, `check_auto` (pass/fail), `check_user_confirmed`,
`rail_complete`/`rail_abandoned`, `resurface_dealt`/`resurface_recalled`. Spaced resurfacing of
CONCEPT cards is an **instrumented experiment** (same discipline as `relate()` — no verified
evidence yet; measure recall via `resurface_recalled`, don't assume). Hard anchors: rail
completion and unaided repetition (fade-2 completion of the same `taskKey`) keep the rubric
falsifiable.

## 9. Error handling & degradation

- Invalid `respond` payloads → error object to the model; nothing renders (never a broken card).
- Unresolvable targets → hollow-pointer refusal rendering (§4), not an error, when the card is
  otherwise valid; a *step whose advancement depends on* an unresolvable target keeps the rail
  honest by rendering but never auto-advancing.
- No voice session (typed mode / no key): the rail renders identically; guideLine renders as
  text. The grammar has zero audio dependency.
- Zero entities measured (surfaces not mounted): entity-bound affordances render hollow; text
  renders. Never throws.

## 10. Out of scope (project boundaries)

- The **floating response window / desktop shell** (project A) — where the rail lives on screen,
  the talk-or-type omnibox, sidebar demotion. This spec defines what it renders.
- Prompt-template wording; migration mechanics from the current `TeachingState` shape; the
  spaced-resurfacing scheduling algorithm (experiment-gated); DOM-derived entity granularity
  (project C — band inheritance consumes whatever resolution exists).

## 11. Testing

- **Pure (vitest):** `respondCallToRail` — budgets (demotion vs whole-call error), single-verb
  enforcement, target resolution + band assignment, CHECK predicate evaluation against MockDoc
  fixtures (including unknown-path error and false-→-✗), guideLine extraction.
- **Rail store:** advance/stub/dim transitions, fade-level renderings (`visibleScaffold`
  generalized), teach-posture TRY substitution, leg chunking at >5.
- **Scripted demo assertion:** a canned `respond` sequence drives the rail to the expected end
  state (pattern: `scriptedDemo.test.ts`).

## References

- John Carroll, *The Nurnberg Funnel* — minimalism: action-first, minimal reading, error info at
  the point of need. The DO card is minimalism as a schema.
- Recipe-step structure (steps-with-affordances) — the pattern these cards generalize, with a
  flip (CONCEPT) and a band (§4).
- `docs/AGENTUILEARNINGS.md` §1 (model voice reserved for dialogue; app owns confirmation),
  §4 (grounding, disagreement-derived confidence).
- `docs/superpowers/research/2026-07-02-learning-teaching-deep-dive.md` — terse-voice constraint
  (d=0.89 verbiage cost), subgoal labels, generation effect (TRY), fading.
- `docs/superpowers/specs/2026-07-02-teaching-foundation-design.md` — the store/overlay/mapper
  substrate the rail unifies with.
