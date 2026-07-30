/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The scorecard (design spec §4b): the human face of `ArmAggregate` — a deck run, or any session,
// ends in ONE card: Good at / Shaky / Latency / Cost / Watch, computed by the SAME derivation
// everything else in `src/eval/` uses. No parallel math: every number below is read off `agg`
// (armAggregate.ts's roll-up), `ledger` (capabilityLedger.ts's not-good-at rows), `deck`
// (deck.ts's `CardResult`s) or `opts.events` (the raw stream those three were themselves derived
// from) — nothing here re-grades an attempt or re-derives an outcome.
//
// ANTI-FLATTERY, restated because a summary card is exactly where flattery creeps back in (spec
// §4b, verbatim): every number carries its n; refusals render under GOOD AT, never as failures;
// `speech_only`/no-response no-ops (capabilityLedger's `no-op-turn` rows) render under WATCH and
// are never dropped, at any count; below `UNDERPOWERED_N` the comparison line says "not enough
// trials to compare arms" and nothing else.
//
// TWO CARRY-IN OBLIGATIONS from this cycle's reviews that shaped fields NOT in the task-8 brief's
// illustrative `ScorecardModel` sketch (documented, not silently added):
//   1. `ProbeVerdict` has no 'untestable' state — Material's and Conversation's `winsWhen` (shell
//      skins registry) can never return 'met' because their probe's outcome variable isn't
//      instrumented. A UI that read `.verdict` alone would render them as a permanently-refuted
//      red X. `comparison` below therefore ALWAYS carries the verdict's own `because` text
//      alongside the verdict word — never the bare enum.
//   2. Cold first turns (performance-realism spec §1) are joint-system numbers (mic pre-flight +
//      connect + queued-text flush), not model latency, and must be excluded from the latency
//      median and reported separately, never averaged in and never silently dropped. `latency`
//      therefore carries a `coldStartMs` field beyond the brief's two-field sketch.
// A third field not in the sketch, `deckSummary`, exists for a third carry-in: deck results join
// the card as their OWN line (N cards, observed vs self-graded split NAMED — a self-grade is
// never presented as an observed grade, capabilityLedger's own doctrine, reused here rather than
// re-invented via `deck.ts`'s `deckTally`).
//
// FIX ROUND 1 (reviewer-ruled, C1 — the headline finding): `armAggregate(attempts)` takes whatever
// population its caller already scoped to ONE arm (armAggregate.ts's own header: "this module does
// not group by arm itself... Tasks 5/8... own that split"). Both call sites (App.tsx's
// deck-completion seam, telemetry.ts's `snapshot()`) were handing it the WHOLE sitting's attempts
// instead, so a sitting that switched register or shell mid-run (Task 6's own register-switch
// feature; a shell change) produced a card that attributed every prior arm's trials to whichever
// arm happened to be current when it was drawn — and fed `winsWhen` a `control` that was not
// disjoint from the arm under test. `attemptsForArm` below closes that gap.
//
// FIX ROUND 2 (reviewer-ruled, N1 — residual Critical): round 1 scoped `agg` alone and stopped.
// `ledger`/`latency`/`cost` stayed whole-sitting, so the Watch loop below divided an UNSCOPED
// population by the now-scoped `agg.n` — a mixed-arm sitting could print `(3/1)`, a fraction
// greater than 1, on a card that is supposed to be one arm's own numbers. The CONTRACT this module
// now expects from its callers, stated once here because it applies to two parameters at once:
// `ledger` MUST be computed over the SAME arm-scoped population as `agg`
// (`capabilityLedger(events, attemptsForArm(attempts, arm), arm)` — the ledger's own pass 2 needs
// the `arm` argument too, since it reads raw events directly and was never touched by scoping
// `attempts`). `opts.events` may still be the whole-sitting stream; `scopeToArm` below re-scopes
// it internally for `latency`/`cost`, because turns carry no `arm` field of their own the way
// `Attempt` does — the arm has to be tracked ACROSS the stream instead. R3 (fix round 4): this
// paragraph used to end "— only `session_start` boundaries do", which was the claim P2 (round 3)
// refuted and `scopeToArm`'s own docblock below already contradicted: a `shell_switch` moves the
// arm too, with no reconnect and therefore no new `session_start`. Two arm boundary types, one
// state machine (`advanceArm`, ./types.ts), no second opinion in this file.
//
// FIX ROUND 4 (reviewer-ruled, R1/R2): the SUBJECT of the card — which arm it is built for and
// named after — is no longer `SessionConfig.arm` at either call site (see `currentArmFrom` in
// ./types.ts for why that was wrong and what replaced it), and the cold-start slot is now opened
// only by a real `session_start`, never by entering scope at a `shell_switch` (see `scopeToArm`).

import type { Arm, TelemetryEvent } from '../telemetry';
import type { ArmAggregate } from './armAggregate';
import { UNDERPOWERED_N, armAggregate, lowerMedian } from './armAggregate';
import type { LedgerRow } from './capabilityLedger';
import type { CardResult, EvalDimension } from './deck';
import { deckTallyOf, EVAL_DECK } from './deck';
import type { Attempt, ProbeVerdict } from './types';
import { advanceArm, sameArm } from './types';
import { REGISTERS } from '../register/registry';
import { SHELL_SKINS } from '../shell/skins/registry';

export interface ScorecardModel {
  headline: string;             // "Guided · Familiar · Gemini · 12 trials"
  // N2 (fix round 2, reviewer-ruled): §5.6 — "abandonment is data, not absence" — applies to the
  // CARD itself, not just the ledger's no-op-turn rows. Before this field, a deck closed on card 3
  // of 12 produced a model indistinguishable from one that finished all twelve; the caller's own
  // knowledge of which path it took (`isDeckComplete` vs `isAbandoned`, deck.ts) never reached the
  // model it built. `false` for a normally-completed deck or a non-deck session summary.
  //
  // SCOPE, stated because it is the ONE field on this card that is not arm-scoped (R6, fix round 4,
  // reviewer-ruled — ruled coherent, but undocumented): `abandoned` is SITTING-scoped. There is at
  // most one deck run per sitting (deck.ts's `deckReduce` 'start' case is idempotent once
  // `startedAt` is set, so a run cannot be restarted), and it may span arms — the participant can
  // switch register or shell between cards. So a deck abandoned under Guided marks the card of
  // whatever arm is current when the card is drawn, Terminal included. That matches `deckSummary`,
  // which is whole-sitting for the same reason (telemetry.ts's `snapshot()` reconstructs it from
  // every `eval_card` event, unscoped), and it is the honest answer: the run that was abandoned is
  // the sitting's only run, and the alternative — hiding the abandonment from every card whose arm
  // wasn't current at the moment Esc was pressed — is exactly the "absence" spec §5.6 forbids.
  abandoned: boolean;
  goodAt: string[];              // plain-language lines, each ending with (n/n)
  shaky: string[];
  watch: string[];
  latency: {
    medianMs: number | null;
    // I3 (fix round 1, reviewer-ruled): `medianMs`/`worst` used to render with no n at all —
    // armAggregate.ts's own doctrine ("a median computed from 2 samples and one from 200 must not
    // read as the same kind of number") applies just as much to this module's medians, which it
    // was not honouring for its own numbers. `warmN` is the sample size behind BOTH `medianMs` and
    // `worst` — they are drawn from the identical warm-turn population, so one count serves both.
    warmN: number;
    worst: { ms: number; label: string } | null;
    // Carry-in #2 (performance-realism spec §1): the first turn of EACH session in the stream is
    // excluded from `medianMs`/`worst` and reported here instead — never averaged, never dropped.
    // `null` when the sitting contains no timeable cold turn (e.g. every session's row 1 lost its
    // transcript, or `opts.events` is empty). It is itself a MEDIAN — the lower median of every
    // session's own cold row-1 — not a single figure; `coldStartN` names how many sessions
    // contributed one, and the view states this explicitly rather than implying a single connect.
    coldStartMs: number | null;
    coldStartN: number;
    // How many of THIS ARM's `session_start` boundaries the scoped stream contains (P6, fix round
    // 3, corrected — round 2's version said "opts.events"/"the whole sitting", but this is counted
    // AFTER `eventsForArm` scopes to the arm under test, N5/P2). I3's original point stands: latency
    // spans more than "this session" whenever this arm was visited more than once, and the card
    // must say so rather than imply a single run — but the scope is THIS ARM's sessions, not the
    // sitting's; a sitting with five sessions of which two are this arm reports 2 here, not 5.
    sessionCount: number;
  };
  cost: { frames: number; hints: number; sessionCount: number };
  comparison: string;            // "not enough trials to compare arms" below UNDERPOWERED_N
  deckSummary: string;           // "N cards: … — X observed, Y self-graded"
}

export interface ScorecardOpts {
  // The whole-sitting stream (`telemetry.eventsSnapshot()`), sourced for the two numbers neither
  // `ArmAggregate` nor `LedgerRow` carries: turn-level first-response latency, and which turns are
  // a session's cold row-1 (needs `session_start` boundaries `Attempt` does not retain). Same
  // stream `agg`/`ledger` were already derived from elsewhere — reading a different field off it
  // here is not parallel math, it is the one place this schema's latency signal actually lives.
  events: TelemetryEvent[];
  // Another arm's aggregate from the SAME sitting (e.g. Guided's, if the sitting visited it before
  // switching) — lets `comparison` run the arm's own pre-registered `winsWhen` instead of a
  // self-comparison or an invented one. Absent (or omitted) is honestly reported, not guessed.
  control?: ArmAggregate | null;
  backend?: string;              // SessionConfig.backend — `Arm` itself carries no backend field.
  unrecorded?: number;           // Task 7's off-recorder marker (EvalDeck.tsx's own `unrecorded`).
  abandoned?: boolean;           // N2 (fix round 2) — see `ScorecardModel.abandoned`. Omitted/false
                                  // means a normal completion; the caller states this, this module
                                  // never infers it from `deck`'s length (a legitimately full deck
                                  // and one closed exactly after its last card are indistinguishable
                                  // from `deck` alone — the caller already knows which happened).
}

/** §5.7's "ungradeable share exceeds a stated threshold" gate, pre-registered here as the Task
 *  5/8-shaped judgment call armAggregate.ts's header explicitly defers (same style as
 *  register/registry.ts's 0.05 completion-equal epsilon and 1.5x corrected-spike multiplier: a
 *  disclosed number, not a derived one). One in five ungradeable attempts is picked as the point
 *  past which "the session's aggregates are unreliable" stops being a rounding error. */
const UNGRADEABLE_UNRELIABLE_SHARE = 0.2;

const withN = (text: string, n: number, total: number): string => `${text} (${n}/${total})`;

/** Never the bare enum (carry-in #1): every rendered verdict carries its own `because`. */
function formatVerdict(label: string, v: ProbeVerdict): string {
  return `${label} — ${v.verdict}: ${v.because}`;
}

/** Everything the arm-scoped `latency`/`cost` blocks need, produced by ONE pass over the
 *  whole-sitting stream (`scopeToArm` below). Three of the four fields could not be computed
 *  correctly from the scoped event list alone, which is why this is a scope object rather than a
 *  filtered array — see the docblock below for each. */
interface ArmScope {
  /** The events that happened while `arm` was active — the population `cost` reduces over. */
  events: TelemetryEvent[];
  /** In-scope, timeable SESSION-first turns (carry-in #2's cold figure). */
  cold: number[];
  /** In-scope, timeable non-first turns — the population `medianMs`/`worst` are drawn from. */
  warm: { ms: number; label: string }[];
  /** How many of the sitting's SESSIONS this arm was active during (P6/P7 + R2, fix round 4).
   *  Counted as distinct sessions that contributed an in-scope event, NOT as `session_start`
   *  boundaries inside the scoped stream: an arm entered mid-session by a shell switch owns real
   *  turns in a session whose `session_start` belongs to the previous arm, and reporting
   *  `sessionCount: 0` beside a non-empty latency block (round 3 did) is a card contradicting
   *  itself. */
  sessionCount: number;
}

/** N5 (round 2) + P2 (round 3) + R2 (round 4), all reviewer-ruled: scopes the whole-sitting event
 *  stream down to the events that happened while `arm` was actually active, so `latency`/`cost`
 *  (which reduce directly over events — a `turn`/`session_complete` carries no `arm` field of its
 *  own the way `Attempt` does) cannot attribute one arm's numbers to another's card.
 *
 *  ARM BOUNDARIES: walked with the SAME `advanceArm` state machine `deriveAttempts.ts` and
 *  `capabilityLedger.ts` use, rather than session boundaries alone — P2 (round-2 re-review): a
 *  `session_start`-only version is blind to a mid-session SHELL switch (`App.tsx`'s
 *  `handleSkinSelect` does not reconnect, by spec — see `currentArmFrom`), so events after such a
 *  switch kept scoring under the PRE-switch shell, silently and uniformly (probe-confirmed: a
 *  Terminal sitting that switched Familiar->Material mid-session reported Material's own trial,
 *  deixis miss and slowest turn all as Familiar's). An event stream with no `session_start` at all
 *  (a hand-authored fragment) matches nothing and scopes to empty — silence, not a guess.
 *
 *  COLD TURNS (carry-in #2, performance-realism spec §1): classified against the WHOLE-SITTING
 *  stream, before scoping, and never re-derived from the scoped one. A session's cold row-1 is the
 *  first `turn` after a `session_start` — the joint-system connect number — and that is a property
 *  of the SESSION, not of whichever arm happens to be reading. R2 (round 4, a regression this
 *  fixes): round 3 split cold from warm inside the already-scoped stream, whose first event may be
 *  a `shell_switch` rather than a `session_start`, so the first turn an arm saw after a shell
 *  switch was reported to the participant as "cold start (session connect)" and pulled out of that
 *  arm's median — probe-confirmed at 120 ms on the card the app actually draws, while the sitting's
 *  real 5000 ms connect turn appeared on no card at all. A shell switch is not a connect. The slot
 *  is opened ONLY by a `session_start` and is consumed by the next turn in the stream whether or
 *  not that turn is in scope (it was still row 1) and whether or not it is timeable
 *  (no_response/transcription_lost contribute nothing numeric but WERE row 1). Consequence, and it
 *  is the honest one: a connect under Familiar whose first turn happens after a switch to Material
 *  puts that cold figure on MATERIAL's card — the arm that was actually on screen while it was
 *  measured — and leaves Familiar with `coldStartMs: null`, rather than dropping it from every
 *  card or crediting it to an arm that was not running. */
function scopeToArm(events: TelemetryEvent[], arm: Arm): ArmScope {
  const out: TelemetryEvent[] = [];
  const cold: number[] = [];
  const warm: { ms: number; label: string }[] = [];
  const sessions = new Set<number>();
  let currentArm: Arm | undefined;
  let inScope = false;
  let sessionIndex = -1;
  let coldSlotOpen = false;
  for (const e of events) {
    if (e.type === 'session_start') { sessionIndex += 1; coldSlotOpen = true; }
    let isCold = false;
    if (e.type === 'turn') { isCold = coldSlotOpen; coldSlotOpen = false; }
    if (e.type === 'session_start' || e.type === 'shell_switch') {
      currentArm = advanceArm(currentArm, e);
      inScope = sameArm(currentArm, arm);
    }
    if (!inScope) continue;
    out.push(e);
    sessions.add(sessionIndex);
    if (e.type === 'turn' && e.firstResponseMs !== null) {
      if (isCold) cold.push(e.firstResponseMs);
      else warm.push({ ms: e.firstResponseMs, label: e.request });
    }
  }
  return { events: out, cold, warm, sessionCount: sessions.size };
}

function buildLatency(scope: ArmScope): ScorecardModel['latency'] {
  const { cold, warm } = scope;
  const medianMs = lowerMedian(warm.map((w) => w.ms));
  const worst = warm.length
    ? warm.reduce((a, b) => (b.ms > a.ms ? b : a))
    : null;
  const coldStartMs = lowerMedian(cold);
  return { medianMs, warmN: warm.length, worst, coldStartMs, coldStartN: cold.length, sessionCount: scope.sessionCount };
}

function buildCost(scope: ArmScope): ScorecardModel['cost'] {
  const { frames, hints } = scope.events.reduce(
    (acc, e) => e.type === 'session_complete'
      ? { frames: acc.frames + e.framesSent, hints: acc.hints + e.hintsSent }
      : acc,
    { frames: 0, hints: 0 },
  );
  return { frames, hints, sessionCount: scope.sessionCount };
}

function buildComparison(agg: ArmAggregate, arm: Arm, control: ArmAggregate | null | undefined): string {
  if (agg.n < UNDERPOWERED_N) return 'not enough trials to compare arms'; // binding, verbatim
  if (!control) {
    // M7 (fix round 1, reviewer-ruled): Guided has no control to compare against for a structural
    // reason, not a data gap — it IS the control (register/registry.ts's own `winsWhen` doctrine: a
    // self-comparison predicate can only ever compute a tautology). Every OTHER register lacking a
    // control just hasn't visited Guided yet this sitting, which really is a gap. The two read very
    // differently to a human, so they say different things.
    if (arm.register === 'guided') {
      return `Guided is the control arm — there is no non-tautological comparison to run against itself (n=${agg.n})`;
    }
    return `no control-arm aggregate available this sitting to compare against (n=${agg.n})`;
  }
  const pieces: string[] = [];
  const regDef = REGISTERS.find((r) => r.key === arm.register);
  if (regDef?.winsWhen) pieces.push(formatVerdict(regDef.label, regDef.winsWhen(agg, control)));
  const skinDef = arm.shell ? SHELL_SKINS.find((s) => s.key === arm.shell) : undefined;
  if (skinDef?.winsWhen) pieces.push(formatVerdict(skinDef.label, skinDef.winsWhen(agg, control)));
  if (!pieces.length) {
    return `no pre-registered probe for this arm (register=${arm.register}${arm.shell ? `, shell=${arm.shell}` : ''})`;
  }
  return pieces.join(' | ');
}

/** Per-dimension deck tallies (excluding 'skipped' — a skip is a recorded result, but neither a
 *  good-at nor a shaky signal about the system; see deck.ts's own doctrine). */
function dimensionTallies(deck: CardResult[]): Map<EvalDimension, { done: number; total: number }> {
  // deck.ts's CardResult carries no `dimension` field (only EVAL_DECK's static cards do) — this
  // module is handed CardResult[] alone (the task-8 brief's signature), so dimension grouping is
  // read off EVAL_DECK by cardId. A result whose cardId is not in EVAL_DECK (a malformed/future
  // fixture) is skipped rather than guessed onto a dimension.
  const byId = new Map(EVAL_DECK.map((c) => [c.id, c.dimension] as const));
  const out = new Map<EvalDimension, { done: number; total: number }>();
  for (const r of deck) {
    if (r.grade === 'skipped') continue;
    const dim = byId.get(r.cardId);
    if (!dim) continue;
    const cur = out.get(dim) ?? { done: 0, total: 0 };
    cur.total += 1;
    if (r.grade === 'done') cur.done += 1;
    out.set(dim, cur);
  }
  return out;
}

/** C1 (fix round 1, reviewer-ruled — the Critical finding): scopes a whole-sitting `Attempt[]`
 *  down to the ones belonging to ONE arm, so a caller can hand `armAggregate` a population that is
 *  actually what the resulting `ArmAggregate` claims to be. This is the split `armAggregate.ts`'s
 *  own header says it deliberately does not do itself ("Tasks 5/8... own that split").
 *
 *  IDENTITY RULE: `sameArm` (./types.ts) — see ITS doc comment for the full rationale (what
 *  excluding `dials` buys, and does not). P9 (fix round 3): kept in ONE place rather than repeated
 *  here, after round 2 left two copies of the same (then-incorrect) rationale in this file and
 *  types.ts, and only one of them got the mechanism right.
 *
 *  An attempt whose `arm` is `undefined` (a stream fragment with no `session_start` — see
 *  eval/types.ts's DEVIATION 2) NEVER matches any named arm and is excluded. Before this fix that
 *  case was silently counted as whichever arm happened to be current when the card was drawn —
 *  exactly the failure mode this function exists to close, so an unscoped attempt is dropped
 *  rather than guessed onto anything. */
export function attemptsForArm(attempts: Attempt[], arm: Arm): Attempt[] {
  return attempts.filter((a) => sameArm(a.arm, arm));
}

/** The one control aggregate a single sitting can honestly supply without a second export: the
 *  attempts THIS sitting recorded under Guided (register/registry.ts's fixed control arm), if the
 *  sitting ever visited it before switching to `currentRegister` — Task 6's register-switch
 *  feature is what makes that possible mid-sitting. `undefined` when the sitting never visited
 *  Guided, or when `currentRegister` already IS Guided (comparing it to itself is the tautology
 *  register/registry.ts's own header already rejects). Both `telemetry.ts`'s `snapshot()` and
 *  App.tsx's eval-deck completion seam call this rather than re-deriving it independently.
 *
 *  Deliberately scoped by `register` ALONE, not `attemptsForArm`'s register+shell rule: Guided is
 *  the control for every OTHER register regardless of which shell was active while visiting it, so
 *  narrowing to one shell would silently drop Guided trials run under a different shell from the
 *  baseline this exists to supply. N6 (fix round 2, corrected): this does NOT mean the shell axis
 *  gets an independent, shell-scoped control — no shell-vs-shell comparison exists anywhere in this
 *  code path. `buildComparison` below calls a shell skin's `winsWhen` with this SAME
 *  register-pooled-across-shells `control`, so a Material verdict is checked against an aggregate
 *  that differs from the arm under test in BOTH register and shell, and cannot be attributed to the
 *  shell alone. That confound predates this function and is not fixed here — the sentence removed
 *  from this comment previously claimed otherwise, which was not true. */
export function guidedControlFromSitting(attempts: Attempt[], currentRegister: string): ArmAggregate | undefined {
  if (currentRegister === 'guided') return undefined;
  const guidedAttempts = attempts.filter((a) => a.arm?.register === 'guided');
  return guidedAttempts.length ? armAggregate(guidedAttempts) : undefined;
}

export function scorecard(agg: ArmAggregate, ledger: LedgerRow[], deck: CardResult[], arm: Arm, opts: ScorecardOpts): ScorecardModel {
  const regLabel = REGISTERS.find((r) => r.key === arm.register)?.label
    ?? (arm.register === 'custom' ? 'Custom' : arm.register);
  const shellLabel = arm.shell ? (SHELL_SKINS.find((s) => s.key === arm.shell)?.label ?? arm.shell) : null;
  const backendLabel = opts.backend ? opts.backend.charAt(0).toUpperCase() + opts.backend.slice(1) : null;
  const headlineParts = [regLabel, shellLabel, backendLabel].filter((p): p is string => !!p);
  const headline = `${headlineParts.join(' · ')} · ${agg.n} trial${agg.n === 1 ? '' : 's'}`;

  const goodAt: string[] = [];
  const shaky: string[] = [];
  const watch: string[] = [];

  // M4 (fix round 1, reviewer-ruled): the headline number the whole program exists to produce —
  // completions — never reached Good at at all. Rendered only when non-zero, matching the style
  // every other bucket line already uses (a zero completion count is not "good at completing",
  // it is the ungradeable/refusal/shaky lines' story to tell instead).
  if (agg.completion.count > 0) goodAt.push(withN('completed', agg.completion.count, agg.n));

  // Refusals — ALWAYS good at, never a failure (spec §5.1 / the flattery test, verbatim).
  if (agg.refusal.count > 0) goodAt.push(withN('honest refusals', agg.refusal.count, agg.n));

  // Corrections / undone-after-landing — shaky, not good, not a refusal-shaped failure either.
  if (agg.corrected.count > 0) shaky.push(withN('corrected mid-attempt', agg.corrected.count, agg.n));
  if (agg.wrong.count > 0) shaky.push(withN('undone after landing', agg.wrong.count, agg.n));

  // Deck dimensions — perfect goes to Good at, anything short goes to Shaky. Neither bucket
  // invents a line for a dimension nothing was tried in (total === 0 is skipped entirely).
  for (const [dim, { done, total }] of dimensionTallies(deck)) {
    if (total === 0) continue;
    (done === total ? goodAt : shaky).push(withN(dim, done, total));
  }

  // Watch: every ledger row EXCEPT 'refusal' — refusals are already Good at (above), and a ledger
  // row keyed by (verb, program) would only duplicate the count already shown there. I2 (fix round
  // 1, reviewer-ruled): the other four kinds used to be filtered out entirely (`if (row.kind !==
  // 'no-op-turn') continue`), so `asked-and-dropped`, `deixis-miss` and `grounding-disagree` never
  // reached a human reading only this card — invisible even while the deck's own `pointing (2/2)`
  // line could sit under Good at in the same sitting the ledger recorded a wrong referent. Each
  // kind gets its own honest phrasing.
  //
  // N1 (fix round 2, reviewer-ruled — the residual Critical finding): `withN`'s "(n/total)" shape
  // is only honest for kinds that are 1:1 with an ATTEMPT — `no-op-turn` (one abandoned attempt =
  // one row bump) and `ask` (one asked-and-dropped attempt = one row bump), where `agg.n` (total
  // attempts) is genuinely the population a row's count was drawn from. `deixis-miss` and
  // `grounding-disagree` are built per SIGNAL in capabilityLedger.ts's pass 2 — a single attempt
  // can contain several deixis events, so `row.n` can exceed `agg.n` and `withN(..., row.n, agg.n)`
  // then prints a fraction greater than 1 (reproduced: one attempt, three deixis misses -> "(3/1)")
  // even when `ledger` is correctly arm-scoped. There is no honest attempt-shaped denominator for a
  // signal count, so these two kinds state the count alone rather than force it into a fraction
  // that would misreport what was actually counted.
  for (const row of ledger) {
    const example = row.examples[0] ?? '(no verbatim recorded)';
    if (row.kind === 'no-op-turn') {
      watch.push(withN(`"${example}" produced no committed action`, row.n, agg.n));
    } else if (row.kind === 'ask') {
      watch.push(withN(`"${example}" was asked and never answered`, row.n, agg.n));
    } else if (row.kind === 'deixis-miss') {
      watch.push(`wrong referent — ${example} (seen ${row.n}×)`);
    } else if (row.kind === 'grounding-disagree') {
      watch.push(`app/model disagreed on the referent — ${example} (seen ${row.n}×)`);
    }
    // 'refusal' rows: intentionally not rendered here — see the comment above the loop.
  }

  // Watch: ungradeable share (spec §5.7) — said, not averaged away.
  if (agg.n > 0 && agg.ungradeable.value > UNGRADEABLE_UNRELIABLE_SHARE) {
    watch.push(withN(
      `ungradeable share too high to trust this session's aggregates (${Math.round(agg.ungradeable.value * 100)}%)`,
      agg.ungradeable.count, agg.n,
    ));
  }

  // Watch: the partial-recording marker (Task 7) — rendered only when non-zero. M7 (fix round 1):
  // the count used to be stated TWICE — once spelled out in the prose ("2 card results...") and
  // again in `withN`'s own "(n/total)" suffix. It is now said once, in the suffix, same as every
  // other Watch line. The denominator itself is deliberately a DIFFERENT kind from every other line
  // on the card (those are all "out of `agg.n` trials"; this one is "out of `deck.length` cards
  // recorded", which is the only honest denominator for a count of card results) — `Math.max`
  // guards the pathological case where more results were recorded than the live deck currently
  // reports (a stale `deck.length` snapshot), so the fraction is never > 1.
  if (opts.unrecorded && opts.unrecorded > 0) {
    const n = opts.unrecorded;
    watch.push(withN(
      `card result${n === 1 ? '' : 's'} recorded in this panel only — the recorder was off`,
      n, Math.max(deck.length, n),
    ));
  }

  // N5 (fix round 2, reviewer-ruled): `opts.events` is the whole-sitting stream; `scopeToArm`
  // scopes it to the stretches where this arm was active before either block reduces over it, so a
  // Terminal-headed card can no longer report a Guided session's latency/cost under a
  // `Terminal · N trials` headline (reproduced: `medianMs`/`worst` were Guided's turns while
  // `agg.n` was Terminal's 1). One pass, shared by both blocks (and by the cold/warm split, which
  // R2 in round 4 moved out of the scoped stream and back onto the sitting's session boundaries).
  const scope = scopeToArm(opts.events, arm);
  const latency = buildLatency(scope);
  const cost = buildCost(scope);
  const comparison = buildComparison(agg, arm, opts.control);

  // M7 (fix round 1): `deckTallyOf` takes the `CardResult[]` this module actually has, rather than
  // synthesising a fake `DeckState` (`{ index: 0, results: deck, startedAt: ... }`) purely to
  // satisfy `deckTally`'s old signature.
  const t = deckTallyOf(deck);
  const deckSummary = deck.length === 0
    ? 'no eval-deck cards played this session'
    : `${t.total} cards: ${t.done} worked, ${t.failed} didn't, ${t.skipped} skipped — ${t.observed} observed, ${t.self} your call`;

  return { headline, abandoned: !!opts.abandoned, goodAt, shaky, watch, latency, cost, comparison, deckSummary };
}
