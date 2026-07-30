# Evaluation logging — knowing what this system is good at, and what it isn't

## Context

FormFactors is already heavily instrumented. `src/telemetry.ts` carries 22 event types: actions with
their commit/witness/rejected decision, deixis **graded against ground truth** with an honest
`correct: boolean | null`, corrections flagged `overAgent`, missions with start/complete/**abandoned**,
asks kept deliberately separate from errors, and register/shell switches on a named `Arm`.

None of that answers the question in the title. Three specific gaps:

1. **No outcome unit.** There are events but no record of *the user wanted X; did they get it?*
   Missions have that shape, but only for four scripted arcs. An unscripted "sum this column" leaves
   a trail of actions with no verdict attached.
2. **The hypotheses are already written down and never evaluated.** Every register carries a
   pre-registered `probe` with an explicit win condition — Terminal's is *"Is zero-scaffold fastest
   for experts? Wins: lowest mission time WITHOUT correction/error spikes."* Every shell skin carries
   one too. These are good experimental design sitting inert as prose. Nothing computes them.
3. **The "not good at" half is generated honestly and then thrown away.** The missing-information
   gate emits `{error}` when the *model* is at fault and `{needsContent}` when it needs the *user* —
   both are truthful statements about a limit. They are counted as rates. Nothing collects them into
   a map of *what this system cannot do*.

There is also a fourth, softer gap: human sitting results live in markdown, disconnected from the
telemetry corpus, so a finding a person made in the room can't be cross-referenced against the
session that produced it.

**The principle this spec exists to serve.** This project's thesis is that the system must never
present something false. An evaluation log is where a system is most tempted to flatter itself, so
§5 is not decoration — it is the load-bearing section, and every rule in it comes from a mistake this
codebase has already made.

**Rulings taken during design (2026-07-29):**

1. **Evaluations are *derived* from the journal, never accumulated ad hoc.** A pure reducer over the
   event log produces attempt records. This makes them replayable, testable in the `node` environment,
   and — crucially — **re-gradeable**: when the derivation improves, old sessions are recomputed rather
   than lost.
2. **Outcomes are observed, never asserted.** The mission subsystem already establishes this
   ("deterministic committed-state observation, run-baselined"); the same rule binds here.
3. **`ungradeable` is a first-class outcome and `underpowered` is a first-class verdict.** Neither may
   be silently rendered as a success or as "no effect".

---

## §1 The attempt — the unit of evaluation

An **attempt** is one user intent and what became of it.

```ts
// src/eval/types.ts
export type AttemptOutcome =
  | 'completed'          // the asked-for change is in the committed state
  | 'corrected'          // completed, but the user had to fix it first
  | 'wrong'              // completed, then undone by the user — retroactively a failure
  | 'refused-honestly'   // the system said it couldn't, and that was true
  | 'asked-and-answered' // the gate asked, the user answered, it landed
  | 'asked-and-dropped'  // the gate asked and the user never answered
  | 'abandoned'          // the intent was never satisfied and the session moved on
  | 'ungradeable';       // we genuinely cannot tell — never a synonym for success

export interface Attempt {
  id: string;
  askedAt: number;
  request: string;          // the user's words, verbatim
  program: ProgramId;
  verb: string | null;      // null when no tool call resulted
  outcome: AttemptOutcome;
  turns: number;            // exchanges from request to outcome
  corrections: number;      // user corrections during the attempt
  undos: number;
  witnessed: boolean;       // did a witness card gate it
  durationMs: number | null;
  arm: Arm;                 // register + shell + backend + dials, as already defined
}
```

`request` is stored verbatim because the most useful evaluation artefact is a list of the exact
phrasings that did and did not work. Aggregate rates tell you *how often*; the verbatim tells you
*what about*.

## §2 Deriving the outcome

`src/eval/deriveAttempts.ts` — `deriveAttempts(events: TelemetryEvent[], journal: JournalEntry[]): Attempt[]`,
pure. Rules, in priority order:

- An `action` whose commit is followed by a `correction` with `overAgent` inside the attempt window →
  **`wrong`**. An action the user reverses is not a success that happened to be edited; it is a
  failure that was caught. This is the single most important rule in the file.
- Commit + a preceding correction, not reversed → **`corrected`**.
- Commit, no correction, and the document state actually changed in the asked-for direction →
  **`completed`**. The state check is required: this codebase has already shipped a path where an
  action was announced as committed while the reducer returned the document unchanged.
- `{error}` refusal with no successful retry → **`refused-honestly`**. **This is not a failure of the
  system.** It is the gate working.
- `unspecified_ask` → `answered: true` and a later commit → **`asked-and-answered`**; no answer →
  **`asked-and-dropped`**.
- No terminal event before the session ends or the program changes → **`abandoned`**.
- Anything the rules cannot place → **`ungradeable`**, with the reason recorded.

**Attempt boundaries** are the hard part and must be stated rather than inferred: an attempt opens on
a user utterance or typed submit, and closes on a commit, a refusal, a dropped ask, a program change,
or session end. Nested tool calls belong to the open attempt. Where the boundary is ambiguous, mark
`ungradeable` rather than guessing — a wrong boundary silently mis-grades everything inside it.

## §3 The capability ledger — the "not good at" half

`src/eval/capabilityLedger.ts` — aggregates, across sessions, every honest statement of a limit:

| source | already emitted today | what the ledger adds |
|---|---|---|
| gate `{error}` | `error` event with a message | grouped by (verb, program, reason), with verbatim requests |
| gate `{needsContent}` | `unspecified_ask` with field | which fields get asked about most, and how often the answer sticks |
| declared `cannot` | the program platform spec's `tier` + `cannot` sentence | which declared limits users actually hit |
| `deixis.correct === false` | graded already | which referent phrasings resolve wrongly |
| `grounding.agree === false` | graded already | where the app and the model disagree about the referent |

The output is a ranked list of *things this system cannot do, in the words people used to ask for
them*. That artefact does not exist today and is the direct answer to "what is it not good at".

Note the ledger is built from signals the system **already generates truthfully**. No new honesty
machinery is required — only collection.

## §4 Probe evaluation — checking the hypotheses we already wrote

`RegisterDef.probe` and `ShellSkin.probe` are pre-registered hypotheses with stated win conditions.
Each gains a machine-checkable companion:

```ts
// alongside the existing `probe: string`
winsWhen?: (a: ArmAggregate, control: ArmAggregate) => ProbeVerdict;
export type ProbeVerdict = { verdict: 'met' | 'not-met' | 'underpowered'; because: string };
```

`ArmAggregate` is the per-arm roll-up of §1 attempts: completion rate, correction rate, median turns
to completion, refusal rate, ask rate, median attempt duration, and **n**. Guided remains the control
arm, as the register registry already states.

**`underpowered` is returned whenever n is too small for the comparison** — and it is returned *by
name*, never as `not-met`. Reporting "no effect" from four sessions is the most likely way this
apparatus would mislead its own author.

Keeping `probe` (the prose) beside `winsWhen` (the predicate) is deliberate: the prose is what a human
pre-registered, the predicate is what the machine checks, and a divergence between them is itself a
finding.

## §5 Anti-flattery rules — every one of these is a mistake already made here

1. **A refusal is never a failure.** The codebase already separates asks from errors precisely so
   "an arm that asks more does not look like an arm that errors more". Extend that: `refused-honestly`
   and `asked-and-answered` are **correct outcomes** and must never be summed into a failure rate.
2. **An undone action is retroactively wrong.** Counting the commit and ignoring the undo is how a
   system reports success at the moment it did damage.
3. **Never derive an outcome from model self-report.** No `Attempt` field may come from what the model
   said it did. This project has a live example of the cost: an action was acked `success: true` while
   the document was byte-identical.
4. **Derived metrics can invert silently — pin them.** `correctionRate` was once inverted by widening
   its denominator, so an arm that provoked *more* refusals scored as needing *less* correction. Every
   derived rate in this subsystem gets a test asserting its direction, not just its value.
5. **Watch the double-counted commit.** A witnessed-then-confirmed action currently emits both
   `witness` and `commit`. The aggregate must decide once, explicitly, whether that is one attempt or
   two — and say which in a comment.
6. **Abandonment is data, not absence.** The most dangerous record is the attempt that quietly went
   nowhere, because it looks like nothing happened. It must appear in the ledger.
7. **Ungradeable is not a rounding error.** If the ungradeable share of a session exceeds a stated
   threshold, the session's aggregates are reported as unreliable rather than averaged into the corpus.
8. **Sample size travels with every number.** No rate is ever reported without its n.

## §6 Where it lives

| File | Responsibility |
|---|---|
| `src/eval/types.ts` | **new** — `Attempt`, `AttemptOutcome`, `ArmAggregate`, `ProbeVerdict` |
| `src/eval/deriveAttempts.ts` | **new** — pure derivation from events + journal |
| `src/eval/capabilityLedger.ts` | **new** — the "cannot do" roll-up |
| `src/eval/armAggregate.ts` | **new** — per-arm roll-up + `underpowered` thresholds |
| `src/register/registry.ts` | `winsWhen` beside each `probe` |
| `src/shell/skins/registry.ts` | `winsWhen` beside each `probe` |
| `src/telemetry.ts` | export attempts + ledger + probe verdicts in `snapshot()` |
| `src/shell/DebugDrawer.tsx` | an evaluation panel: outcomes, top refusals, probe verdict for the current arm |

Everything except the drawer panel is pure and testable in the existing `node` environment.

## §7 Human sittings join the same corpus

Smoke rows in `docs/superpowers/smokes/` gain a small machine-readable header — session id, arm,
date, and a verdict per row — so a finding made by a person in the room can be joined to the session
export that produced it. The prose stays; a human's judgement about *why* something failed is the most
valuable field in the whole corpus and must not be flattened into an enum.

## §8 Verification

- **Pure TDD** for `deriveAttempts`: each outcome from a hand-built event sequence; the undo-makes-it-
  `wrong` rule; the boundary cases marked `ungradeable` rather than guessed.
- **The keystone: re-deriving from a replayed journal produces byte-identical attempts.** This mirrors
  the existing replay-equals-live invariant, and it is what makes evaluations re-gradeable.
- **Direction tests** on every derived rate (§5.4): construct a session where the rate must go *up*,
  assert it does.
- **An `underpowered` test**: an arm with n below threshold returns `underpowered`, never `not-met`.
- **A flattery test**: a session consisting entirely of honest refusals scores **0% failure**, not
  100% — the doctrine in one assertion.

## §9 Out of scope

- Any server, database or cross-machine aggregation. Sessions export as files; joining them is a
  local script, not infrastructure.
- Statistical inference — no p-values, no confidence intervals. `underpowered` is a threshold on n,
  deliberately crude, because a crude honest signal beats a sophisticated one nobody can audit.
- Automatic arm assignment or randomisation. Which arm a sitting runs is a human decision.
- Grading the *quality* of prose the agent wrote. This subsystem grades whether the system did what
  was asked, not whether what it produced was good.

## After approval

Write to `docs/superpowers/specs/`, commit, ask for spec review, then `superpowers:writing-plans`.
Sequencing note: this pairs naturally with the next human sitting — the sitting produces the first
real corpus, and the sitting is currently the highest-value unbuilt thing on the roadmap.
