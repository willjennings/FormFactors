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

## §5 Open questions (asked, not assumed)

1. Battery size and spend — how many cells and repeats, on whose token budget.
2. Verbatim `request` storage in exports — privacy stance for non-author participants.
3. Participant sourcing — who, how formal, moderated or not.
4. Sequencing against SH2 / PR-PS — what this program displaces.

## §6 Verification

- `turn` derivation and the no-attempt-turn rule: pure TDD alongside `deriveAttempts`.
- The battery script dry-runs against the stub socket (zero spend) asserting it produces a gradeable
  export end-to-end before any live run.
- A direction test: a session with two `speech_only` turns must *lower* completion rate versus the
  same session without them — the denominator fix, pinned.
- First live battery run is itself the acceptance test of §2; its summary doc is the deliverable.

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
