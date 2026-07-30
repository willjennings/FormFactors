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
// disjoint from the arm under test. `attemptsForArm` below closes that gap; both call sites now
// scope BEFORE calling `armAggregate`, and this module no longer accepts an unscoped attempt list
// silently — it takes an already-`ArmAggregate`d `agg`, as it always did, but the two production
// callers can no longer get that wrong without an explicit filter call visibly missing.

import type { Arm, TelemetryEvent } from '../telemetry';
import type { ArmAggregate } from './armAggregate';
import { UNDERPOWERED_N, armAggregate, lowerMedian } from './armAggregate';
import type { LedgerRow } from './capabilityLedger';
import type { CardResult, EvalDimension } from './deck';
import { deckTallyOf, EVAL_DECK } from './deck';
import type { Attempt, ProbeVerdict } from './types';
import { REGISTERS } from '../register/registry';
import { SHELL_SKINS } from '../shell/skins/registry';

export interface ScorecardModel {
  headline: string;             // "Guided · Familiar · Gemini · 12 trials"
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
    // How many `session_start` boundaries `opts.events` contains — the scope every number in this
    // block actually spans (I3: latency/cost read the WHOLE sitting, not "this session", and the
    // card must say so honestly rather than imply a single run).
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

/** Per-session cold-first-turn split (carry-in #2). A single pass over the whole-sitting stream:
 *  `session_start` resets "have we seen this session's first turn yet"; the first `turn` event
 *  touching each session is that session's cold row-1 and is pulled OUT of the warm pool entirely
 *  (never averaged in). Turns with no measurable `firstResponseMs` (no_response/transcription_lost)
 *  contribute nothing numeric either way but still consume their session's cold slot — they WERE
 *  row 1, whether or not they produced a timeable number. */
function splitColdAndWarmTurns(events: TelemetryEvent[]): {
  cold: number[];
  warm: { ms: number; label: string }[];
} {
  const cold: number[] = [];
  const warm: { ms: number; label: string }[] = [];
  let seenTurnThisSession = false;
  for (const e of events) {
    if (e.type === 'session_start') { seenTurnThisSession = false; continue; }
    if (e.type !== 'turn') continue;
    const isCold = !seenTurnThisSession;
    seenTurnThisSession = true;
    if (e.firstResponseMs === null) continue; // nothing timeable — no_response/transcription_lost
    if (isCold) cold.push(e.firstResponseMs);
    else warm.push({ ms: e.firstResponseMs, label: e.request });
  }
  return { cold, warm };
}

/** How many `session_start` boundaries `events` contains — the scope disclosure for the
 *  latency/cost block (I3): both read the whole sitting, and the number of sessions that spans is
 *  what makes "across N sessions" honest rather than a guess. */
const sessionCount = (events: TelemetryEvent[]): number =>
  events.filter((e) => e.type === 'session_start').length;

function buildLatency(events: TelemetryEvent[]): ScorecardModel['latency'] {
  const { cold, warm } = splitColdAndWarmTurns(events);
  const medianMs = lowerMedian(warm.map((w) => w.ms));
  const worst = warm.length
    ? warm.reduce((a, b) => (b.ms > a.ms ? b : a))
    : null;
  const coldStartMs = lowerMedian(cold);
  return { medianMs, warmN: warm.length, worst, coldStartMs, coldStartN: cold.length, sessionCount: sessionCount(events) };
}

function buildCost(events: TelemetryEvent[]): ScorecardModel['cost'] {
  const { frames, hints } = events.reduce(
    (acc, e) => e.type === 'session_complete'
      ? { frames: acc.frames + e.framesSent, hints: acc.hints + e.hintsSent }
      : acc,
    { frames: 0, hints: 0 },
  );
  return { frames, hints, sessionCount: sessionCount(events) };
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
 *  IDENTITY RULE: two attempts are the same arm iff `register` AND `shell` match. `dials` are
 *  EXCLUDED even though `Arm.dials` is the fully-resolved cohort definition — a `custom` twiddle
 *  mid-sitting is still meant to roll up with the register it was twiddled from for the purposes
 *  of this card (this module measures at register+shell granularity everywhere else too: the
 *  headline, `winsWhen`'s `control` argument, `guidedControlFromSitting` below). Finer-grained
 *  dial drift within one register+shell is out of scope for anything in this file.
 *
 *  An attempt whose `arm` is `undefined` (a stream fragment with no `session_start` — see
 *  eval/types.ts's DEVIATION 2) NEVER matches any named arm and is excluded. Before this fix that
 *  case was silently counted as whichever arm happened to be current when the card was drawn —
 *  exactly the failure mode this function exists to close, so an unscoped attempt is dropped
 *  rather than guessed onto anything. */
export function attemptsForArm(attempts: Attempt[], arm: Arm): Attempt[] {
  return attempts.filter((a) => a.arm?.register === arm.register && a.arm?.shell === arm.shell);
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
 *  the control for every OTHER register regardless of which shell was active while visiting it —
 *  the shell axis is measured independently (SHELL_SKINS' own `winsWhen`, called with this same
 *  control), so narrowing the control to one shell would silently drop Guided trials run under a
 *  different shell from the baseline this exists to supply. */
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
  // kind gets its own honest phrasing; all four still carry their own n and a verbatim example,
  // same discipline as the no-op-turn line that was already here.
  for (const row of ledger) {
    const example = row.examples[0] ?? '(no verbatim recorded)';
    if (row.kind === 'no-op-turn') {
      watch.push(withN(`"${example}" produced no committed action`, row.n, agg.n));
    } else if (row.kind === 'ask') {
      watch.push(withN(`"${example}" was asked and never answered`, row.n, agg.n));
    } else if (row.kind === 'deixis-miss') {
      watch.push(withN(`wrong referent — ${example}`, row.n, agg.n));
    } else if (row.kind === 'grounding-disagree') {
      watch.push(withN(`app/model disagreed on the referent — ${example}`, row.n, agg.n));
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

  const latency = buildLatency(opts.events);
  const cost = buildCost(opts.events);
  const comparison = buildComparison(agg, arm, opts.control);

  // M7 (fix round 1): `deckTallyOf` takes the `CardResult[]` this module actually has, rather than
  // synthesising a fake `DeckState` (`{ index: 0, results: deck, startedAt: ... }`) purely to
  // satisfy `deckTally`'s old signature.
  const t = deckTallyOf(deck);
  const deckSummary = deck.length === 0
    ? 'no eval-deck cards played this session'
    : `${t.total} cards: ${t.done} worked, ${t.failed} didn't, ${t.skipped} skipped — ${t.observed} observed, ${t.self} your call`;

  return { headline, goodAt, shaky, watch, latency, cost, comparison, deckSummary };
}
