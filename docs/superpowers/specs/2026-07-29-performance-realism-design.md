# Performance realism — measuring the joint system, not the plumbing

## Context

Companion to `2026-07-29-evaluation-logging-design.md`. That spec defines *how attempts are graded*;
this one defines *how a realistic corpus of attempts gets produced* — because today there is none.

**The audit that motivates this** (2026-07-29, five blind spots):

1. **Every recorded PASS was scripted by us.** All browser drives — including the ones that validated
   the missing-information gate and the ask surface — ran against a stubbed socket whose tool calls
   the test authored. The 936 tests measure the referee, not the game. Whether real Gemini ever calls
   `ask_content`, retries after a refusal, or emits `"Heading here"` instead of `"Heading"` has zero
   measurements. The system's performance is dominated by the one component with no data.
2. **The denominator is missing.** Attempts derive from telemetry events, but a request the model
   answers with speech only — or ignores, or that is mis-transcribed — produces no tool call and no
   event. It vanishes. Completion rates would be computed over the subset of requests that became tool
   calls: survivorship bias in the schema. Relatedly, `deixis.correct` is graded only where a scenario
   supplies ground truth, i.e. mostly scripted demos — pointing accuracy is measured on the easy subset.
3. **Latency and cost appear in zero events.** No time-to-response, no snapshot cost (the font embed
   alone is ~1.24MB at up to 4/s), no tokens per session. Terminal's probe ("lowest mission time")
   would be confounded by model/network variance that dwarfs any UI effect, and nobody can see whether
   Cockpit costs 3× Ambient's tokens for the same outcome.
4. **The Meridian world is small enough that success saturates.** Four programs, ~4 elements each,
   3 numeric cells, one window. Deixis among four targets is 25% by chance. Near-perfect rates here
   predict nothing about the ten-program world PS is about to build — a ceiling effect baked into
   every published number.
5. **One human has ever driven it: the author.** Every sitting is a self-sitting by the person who
   wrote the placeholder list and knows the magic phrasings. R0–R3 of the learning ladder are
   unobservable on the author; the capability ledger would fill with one person's vocabulary.

A sixth, corrected on review against Phase 0: the *forgery* direction of the hint channel is already
fenced (session token, landed 2026-07-23 — a typed `[SYSTEM:]` is treated as user speech). What
remains open is **content-borne** injection: document text, artifact content and feed values are
echoed into hints unfenced. That is a probe candidate here, not a solved problem.

**Rulings taken during design (2026-07-29):**
1. Realism per unit effort ordering: **turn event → live-model battery → outside participant.**
   Everything else refines the picture these three create.
2. The battery replays **fixed utterance sets against the live model** and grades with
   `deriveAttempts`. Deterministic scoring over stochastic runs — never the reverse.
3. No statistical machinery beyond the eval spec's `underpowered` threshold. Crude and auditable
   beats sophisticated and trusted.

---

## §1 The `turn` event — making the denominator real

Every user utterance or typed submit opens a turn; the model's response (tool call, speech, or
silence) closes it.

```ts
| { t: number; type: 'turn'; id: string; modality: InputModality;
    request: string;                       // verbatim — see the open question on storage
    outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost';
    firstResponseMs: number | null;        // time to first model output of any kind
    settledMs: number | null;              // time to commit/refusal/ask, when one occurred
  }
```

- `speech_only` and `no_response` are the rows that do not exist today — the worst failures, currently
  invisible. `deriveAttempts` gains the rule: a `turn` with no attempt is itself an **attempt** with
  outcome `abandoned` (or `ungradeable` when the turn was `transcription_lost`).
- `firstResponseMs`/`settledMs` are measured at the provider seam (`onResponseStart` and the ack path
  already exist); no new clock machinery.
- **Cold first turns are joint-system numbers, and the battery produces one per session.** A turn opens
  when the user submits, which for a typed command with no session yet is *before* the socket exists —
  so that turn's `firstResponseMs` contains the mic pre-flight, the connect and the queued-text flush
  (measured 2085ms cold against 397ms warm on an identical stubbed reply). Since the battery drives
  typed input, **row 1 of every session is such a turn**. The summariser must therefore exclude the
  first turn of each session from the arm's latency aggregate and report it separately as a cold-start
  figure — never average the two, and never silently drop it (the connect cost is real, it is just not
  a model latency).
- Token/frame counts: the traffic meter already counts frames and hints in the header UI; fold its
  totals into `session_complete` (`framesSent`, `hintsSent`, `audioSecondsIn/Out` where the provider
  exposes them) so cost lives in the export, not the pixels.

## §2 The battery — live-model, fixed utterances, graded by the eval spec

`scripts/battery/` (node, not vitest — it spends real tokens and must never run in CI by accident):

- **The utterance set**: ~30 fixed requests, versioned in-repo, drawn from real phrasings — the two
  origin bugs verbatim ("add a heading here", "sum this column"), refine/combine/pin flows, deixis
  with and without pointing, two known-refusal rows (aggregate on a deck), two ambiguity rows that
  should trigger the ask, and two content-borne-injection probes (a cell value containing an
  instruction; an artifact paragraph containing one).
- **A run** = one live session driving the set through the real provider (typed input path; voice is
  the sitting's job), exporting the standard session file.
- **A cell** = arm × backend. Repeats per cell and which cells to run are open questions (§5).
- **Grading**: `deriveAttempts` over each export; per-cell `ArmAggregate`; probe `winsWhen` verdicts;
  the capability ledger unioned across runs. A summary table is written to
  `docs/superpowers/evals/<date>-battery.md` — rates always with n, `underpowered` named, never
  silently "no effect".
- The battery reuses the CDP driving pattern established by the keyless drives; the only difference
  is a real key and a real socket. `.env` is read by the server as today — the battery script itself
  never touches it.

## §3 The corpus variant — removing the ceiling

One **generated** Meridian variant behind `?corpus=wide`: same schema, ~5× entities (30+ spreadsheet
rows with plausible near-collision labels, 8-10 artifacts pre-seeded, longer documents), deterministic
from a fixed seed so runs are comparable. The battery runs each cell on both corpora; a rate that
holds on `wide` is real, one that only holds on the default corpus was the ceiling.

This deliberately does *not* wait for PS: the point is to measure saturation before building the
ten-program world, not after.

## §4 The outside participant

One person who is not the author, per sitting, driving the standard sitting checklist plus five
battery utterances *in their own words* (recorded verbatim into the ledger). Their session exports
join the same corpus via the eval spec's §7 smoke-header. This is the only source of R0–R3 data the
project can ever have — the author is permanently at R5.

## §4b The eval deck — evaluation must be stupid simple (user ruling, 2026-07-29)

Running an evaluation cannot require reading this spec. The whole flow is: **open the app → open the
Eval deck → follow the cards → read the scorecard.** No terminal, no scripts, no knowledge of arms.

**The deck.** A MenuBar entry (beside Missions) opens an ordered deck of trial cards. Each card is
one thing to try, in imperative plain language, with a badge naming the dimension it exercises:

> **Card 4 of 12 · POINTING**
> Point at any cell in the spreadsheet and say *"what's this?"*
> — or click it and type the question.

> **Card 7 of 12 · HONESTY**
> Ask it to total the column in the *slide deck*. (It should refuse and say why —
> a refusal here is the system working.)

> **Card 9 of 12 · ROBUSTNESS**
> Ask for the same edit you did on card 3, but phrase it your own way.

- Cards auto-complete by **observing committed state and telemetry**, the mission subsystem's
  established discipline (run-baselined predicates, never model self-report). A card that can't
  observe its outcome says so and offers a two-tap self-grade (worked / didn't) — recorded as
  human-graded, never silently merged with observed grades.
- Every card is drawn from the battery's utterance set, so a human deck run and an automated battery
  run are the **same trials** and land in the same corpus, comparable by construction.
- A skip is a recorded outcome, not an absence.
- The deck is also the participant script: §4's outside participant just follows the cards, which is
  what makes an informal 45-minute sitting produce structured data with zero moderation overhead.

**The scorecard.** Completing (or abandoning) the deck renders one card-grammar summary — the human
face of `ArmAggregate`, computed by the same derivation, no parallel math:

> **This session — Guided register, Familiar shell, Gemini · 12 trials**
> **Good at:** pointing (5/5 correct) · honest refusals (2/2, said why both times)
> **Shaky:** rephrased asks (1 of 2 needed a correction)
> **Latency:** first response median 1.4s · slowest 4.9s (the column total)
> **Cost:** 63 frames, 19 hints sent
> **Watch:** "make it pop" produced no action and no refusal — it just talked. *(→ capability ledger)*

Rules carried over from the eval spec, restated because a summary card is where flattery creeps in:
every number carries its n; refusals render under **Good at**, never as failures; `speech_only`
no-ops render under **Watch**, never dropped; below the `underpowered` threshold the card says
*"not enough trials to compare arms"* in those words.

The scorecard is exportable with the session file, and the drawer's eval panel (eval-logging spec §6)
becomes a live miniature of it rather than a separate design.

## §5 Open questions — RESOLVED (user rulings, 2026-07-29)

1. **Battery size: pilot of 12 sessions.** 3 repeats × 4 registers, Gemini only; the wide corpus runs
   on Guided only. Validates the harness before larger spend; the full 40-cell grid waits for the
   pilot to earn it.
2. **Verbatim storage: yes, local-only.** Exports carry full phrasings and never leave the author's
   machines; participant sittings note verbal consent in the smoke header. The ledger keeps its
   vocabulary; the trade is stated rather than hidden.
3. **Participant: one colleague/friend, informal.** Never seen the app, author moderates, ~45 minutes,
   notes into the smoke doc. n=1 is fine because today n=0.
4. **Sequencing: eval + battery before SH2.** Turn event + deriveAttempts + battery next, pilot run,
   THEN SH2/PR-PS — so every later phase gets a before/after against a real baseline. SH2's plan is
   written and waits.

## §6 Verification

- `turn` derivation and the no-attempt-turn rule: pure TDD alongside `deriveAttempts`.
- The battery script dry-runs against the stub socket (zero spend) asserting it produces a gradeable
  export end-to-end before any live run.
- A direction test: a session with two `speech_only` turns must *lower* completion rate versus the
  same session without them — the denominator fix, pinned.
- First live battery run is itself the acceptance test of §2; its summary doc is the deliverable.
- Deck cards' completion predicates: pure TDD, mission-style (observed state, run-baselined); a
  self-graded card is stored distinguishably from an observed one, pinned by test.
- The scorecard renderer is a pure function of `ArmAggregate` + ledger rows with its own tests — the
  flattery test applies verbatim: an all-refusals session renders those under Good at.

## §7 Out of scope

- Voice-path automation (real mic in the battery) — sittings own voice.
- Model fine-tuning, prompt optimisation loops, or auto-retry policies — this measures, it does not
  yet steer.
- Cross-machine aggregation infrastructure — exports are files; joining is a local script.
- Closing the content-borne injection surface — this spec only *probes* it; the fence extension is
  its own phase if the probes land.

## After approval

Spec review → `superpowers:writing-plans`. Natural build order: §1 with the eval spec's plan (they
share `deriveAttempts`), then §2-§3 as one cycle, §4 as process rather than code.
