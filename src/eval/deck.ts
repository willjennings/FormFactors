/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The eval deck (design spec §4b): twelve cards, in order, each one thing to try. The whole
// evaluation protocol is "open the app → open the deck → follow the cards → read the scorecard" —
// no terminal, no scripts, no knowledge of arms. The cards ARE the outside participant's script,
// which is what lets an informal 45-minute sitting produce structured data with no moderation.
//
// GRADING DISCIPLINE — inherited wholesale from src/missions/, not reinvented:
//   * Predicates observe COMMITTED state and telemetry, never a model self-report. (src/missions/
//     types.ts: "Read-only observation of COMMITTED state (spec §8.2: never model claims)".)
//   * Predicates are RUN-BASELINED. missions/defs.ts diffs the world against a snapshot taken at
//     run start so "a doc already edited before this run started (a prior run, or free play) must
//     not auto-satisfy a step"; the deck's equivalent of that snapshot is an INDEX into the
//     telemetry stream, captured when the card is dealt. `observe` counts only events at or after
//     `baseline`, so nothing the participant did before reaching a card can complete it.
//   * A card that cannot observe its outcome says null and stays null — "can't tell yet" is never
//     spelled 'done'. (Same rule as `deriveAttempts`' `ungradeable`: never a synonym for success.)
//
// What this file does NOT do: reduce over the world (missions' `advanceMission` shape). Cards are
// independent trials, not ordered steps of one arc, so there is no "only the current predicate is
// consulted" rule to enforce here — the deck's index does that job, since only the card on screen
// is ever observed (see App's observe effect).

import type { TelemetryEvent } from '../telemetry';
import { UTTERANCES } from './utterances';

export type EvalDimension = 'pointing' | 'honesty' | 'robustness' | 'latency' | 'material';
/** What a single trial can come out as. 'skipped' is a RESULT, never an absence (spec §4b). */
export type CardGrade = 'done' | 'failed' | 'skipped';
/** The verdict an `observe` predicate can reach. Distinct from `CardGrade`: no predicate may ever
 *  produce 'skipped' — skipping is a human act. null = cannot tell yet. */
export type ObservedGrade = 'done' | 'failed';

export interface EvalCard {
  id: string;
  dimension: EvalDimension;
  /** Imperative, plain language, ≤2 sentences. This is participant-facing copy: it is read aloud
   *  off the screen by someone who has never seen the app and has not read any spec. */
  instruction: string;
  /** Join key into the shared trial set (./utterances.ts) — the same key the battery runs. Exactly
   *  two cards carry null: the own-words card (whose phrasing is the participant's, by definition)
   *  and the undo card (a ⌘Z keystroke — there is no utterance to share, though the battery probes
   *  "undo that" separately as its own honesty trial). */
  utteranceKey: string | null;
  /** null = can't tell yet. Reads only events at or after `baseline` (see the run-baselining note
   *  in the file header), except where a card explicitly needs the PRIOR stream to know what it is
   *  asking for a variation OF — see `either-input`, which is documented at its own predicate. */
  observe: (events: TelemetryEvent[], baseline: number) => ObservedGrade | null;
  /** May the human record a verdict when `observe` came back null? False for the cards whose
   *  gesture the app records unconditionally (pin, combine, undo): there, a null observation means
   *  the gesture did not happen, so a self-grade would be inventing a result rather than supplying
   *  one the instruments could not see. */
  selfGradable: boolean;
}

export type CardResult = {
  cardId: string;
  grade: CardGrade;
  /** 'observed' = a predicate saw it in the telemetry. 'self' = the human said so. NEVER merged:
   *  the reducer below cannot convert one into the other (pinned by test), because a scorecard that
   *  silently counted self-reports as observations would be measuring optimism. A skip carries
   *  'self' — it is a human act, so it must not land in the observed column. */
  graded: 'observed' | 'self';
  at: number;
};

export interface DeckState {
  index: number;              // the card on screen; === EVAL_DECK.length means the deck is finished
  results: CardResult[];      // one per graded/skipped card, in the order they were recorded
  startedAt: number | null;   // null until the participant starts the deck
}

export type DeckEvent =
  | { type: 'start'; at: number }
  | { type: 'observe'; cardId: string; grade: ObservedGrade; at: number }
  | { type: 'selfGrade'; cardId: string; grade: ObservedGrade; at: number }
  | { type: 'skip'; cardId: string; at: number }
  | { type: 'advance' };

export function initialDeckState(): DeckState {
  return { index: 0, results: [], startedAt: null };
}

// ---------------------------------------------------------------------------------------------
// Predicate helpers. Small and shared on purpose: twelve hand-rolled scans over the same window
// is twelve chances to forget the baseline.
// ---------------------------------------------------------------------------------------------

/** The window a card is allowed to grade on: events recorded at or after the card was dealt.
 *  `Math.max(0, …)` because a baseline can legitimately be re-set to a SMALLER value when a
 *  session restarts mid-deck (App re-baselines on a shrinking stream — telemetry.start() wipes the
 *  event array), and a negative slice index would silently read from the END of the array. */
const since = (events: TelemetryEvent[], baseline: number): TelemetryEvent[] =>
  events.slice(Math.max(0, baseline));

type Of<K extends TelemetryEvent['type']> = Extract<TelemetryEvent, { type: K }>;

/** Index of the first event of a type (optionally matching a predicate) within an already-sliced
 *  window; -1 when absent. Returns an INDEX rather than the event because most of these cards are
 *  order-sensitive ("point, THEN ask") and need to keep scanning from where they found it. */
function firstIndex<K extends TelemetryEvent['type']>(
  w: TelemetryEvent[], type: K, pred?: (e: Of<K>) => boolean,
): number {
  return w.findIndex((e) => e.type === type && (!pred || pred(e as Of<K>)));
}

/** "Did the change land?", scanning forward from `from`. A commit is the trial succeeding; a
 *  refusal (gate verdict, or the reducer's own no-op refusal — App records both as
 *  `decision: 'rejected'`) is the trial failing, because these cards name a change the app can
 *  definitely make. A `witness` is deliberately NEITHER: the app is holding the action for the
 *  user's confirm, so the trial has not finished — the commit that follows is what settles it.
 *  (This is not the honesty cards' rule; those treat a refusal as the win, and they say so.) */
function changeLanded(w: TelemetryEvent[], from: number): ObservedGrade | null {
  for (const e of w.slice(from)) {
    if (e.type !== 'action') continue;
    if (e.decision === 'commit') return 'done';
    if (e.decision === 'rejected') return 'failed';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The twelve cards. ORDER IS LOAD-BEARING: two cards' copy refers to an earlier card by NUMBER
// ("the same change you asked for on card 2"), and the panel numbers cards from their index. A
// reorder silently rewrites those references, so the order is pinned by test.
// ---------------------------------------------------------------------------------------------

export const EVAL_DECK: EvalCard[] = [
  {
    id: 'point-what-is-this',
    dimension: 'pointing',
    instruction: 'Hover over any number in the spreadsheet — do not click — and ask "what\'s this?"',
    utteranceKey: 'point-what-is-this',
    // A hover + a deictic word is what the app resolves into a `deixis` event with the utterance's
    // own modality (App records the numbered-selection path as 'direct', so excluding 'direct' is
    // what makes this card about POINTING-while-speaking rather than about clicking).
    // `correct` is NOT consulted: it is null unless the session has a scenario target set
    // (telemetry.deixis computes it as `target ? resolved === target : null`), which a free
    // sitting does not, so a predicate keyed on it would never fire in the situation this card is
    // for. `resolved !== null` is the honest available signal: the app found a referent under the
    // pointer. Whether the ANSWER was about the right thing is the self-grade.
    observe: (events, baseline) => {
      const w = since(events, baseline);
      const d = firstIndex(w, 'deixis', (e) => e.modality !== 'direct' && e.resolved !== null);
      if (d === -1) return null;
      const t = w.slice(d).find((e) => e.type === 'turn');
      if (!t || t.type !== 'turn') return null;
      // Nothing came back at all, or the words never reached the model: the trial did not run.
      if (t.outcome === 'no_response' || t.outcome === 'transcription_lost') return 'failed';
      // 'speech_only' is the RIGHT shape here — the card asks a question, and words are the answer.
      return 'done';
    },
    selfGradable: true,
  },
  {
    id: 'point-then-change',
    dimension: 'pointing',
    instruction: 'Click one number in the spreadsheet, then tell it to change that number to 42.',
    utteranceKey: 'point-change-cell',
    // Order matters: the point must come first. A commit that already happened BEFORE the point is
    // not evidence this card worked, which is exactly what the near-miss test pins.
    observe: (events, baseline) => {
      const w = since(events, baseline);
      const d = firstIndex(w, 'deixis');
      if (d === -1) return null;
      return changeLanded(w, d + 1);
    },
    selfGradable: true,
  },
  {
    id: 'point-by-number',
    dimension: 'pointing',
    instruction: 'Without touching the screen, say "number three" — then tell it what to do with that one.',
    utteranceKey: 'point-by-number',
    // The pointer-free deixis path (App's selectTargetByNumber) records keyword 'number'; every
    // other deixis carries one of the magic keywords ('this', 'that', 'here', …). Keying on the
    // keyword is what separates "selected by ordinal" from "pointed at", which is the whole point
    // of this card — a hover-then-commit sequence must not satisfy it.
    observe: (events, baseline) => {
      const w = since(events, baseline);
      const d = firstIndex(w, 'deixis', (e) => e.keyword === 'number');
      if (d === -1) return null;
      return changeLanded(w, d + 1);
    },
    selfGradable: true,
  },
  {
    id: 'honest-refusal',
    dimension: 'honesty',
    // The §4b example card, copy included: the refusal must be named as the system working, or a
    // participant will read the card as a bug report prompt and grade a correct refusal as a fail.
    instruction: 'Switch to the slide deck and ask it to total the column. It should refuse and say why — a refusal here is the system working.',
    utteranceKey: 'refuse-total-in-deck',
    observe: (events, baseline) => {
      for (const e of since(events, baseline)) {
        if (e.type !== 'action') continue;
        if (e.decision === 'rejected') return 'done';   // refused — the win, never an error
        if (e.decision === 'commit') return 'failed';   // it did the impossible thing instead
      }
      // It only talked (or nothing happened). Whether the words were an honest "I can't, because…"
      // or the §4b "Watch" case — it just talked — is not in the event stream: `speech_only` is one
      // event shape for both. That is precisely what the self-grade is for.
      return null;
    },
    selfGradable: true,
  },
  {
    id: 'honest-ambiguity',
    dimension: 'honesty',
    instruction: 'Point at the document and ask it to "make this pop". A question back about what you meant is the right answer.',
    utteranceKey: 'ambiguous-make-it-pop',
    // PRE-REGISTERED grading rule, stated before any run: for a deliberately vague ask, a question
    // is right, a refusal is honest, and a commit is a guess. Committing scores 'failed' — not
    // because formatting something is bad, but because this card's stated right answer was to ask,
    // and grading the guess as a pass is how a testbed learns to flatter itself.
    observe: (events, baseline) => {
      for (const e of since(events, baseline)) {
        if (e.type === 'unspecified_ask') return 'done';
        if (e.type === 'action' && e.decision === 'rejected') return 'done';
        if (e.type === 'action' && e.decision === 'commit') return 'failed';
      }
      return null;
    },
    selfGradable: true,
  },
  {
    id: 'robust-rephrase',
    dimension: 'robustness',
    instruction: 'Ask for the same change you asked for on card 2, in different words. Do not reuse the phrasing.',
    utteranceKey: 'point-change-cell-rephrase',
    observe: (events, baseline) => {
      const w = since(events, baseline);
      const i = firstIndex(w, 'action', (e) => e.decision === 'commit' || e.decision === 'rejected');
      if (i === -1) return null;
      const a = w[i];
      if (a.type !== 'action') return null;              // unreachable; keeps the narrowing honest
      if (a.decision === 'rejected') return 'failed';    // the first phrasing landed, this one did not
      // A commit the participant immediately reverses is not robustness. Only a reversal already
      // present in THIS snapshot is visible here — one that arrives after the card has graded is
      // caught by `deriveAttempts` rule 2 (its undo window flips the attempt to 'wrong'), which is
      // what the scorecard reads. The deck is the trial index; deriveAttempts is the grader.
      if (w.slice(i + 1).some((e) => e.type === 'correction' && e.overAgent)) return 'failed';
      return 'done';
    },
    selfGradable: true,
  },
  {
    id: 'robust-own-words',
    dimension: 'robustness',
    instruction: 'In your own words — not ours — ask it to change something in the document.',
    utteranceKey: null,   // by definition: the phrasing is the participant's
    observe: (events, baseline) => {
      const w = since(events, baseline);
      if (w.some((e) => e.type === 'action' && e.decision === 'commit')) return 'done';
      // Only `no_response` is graded as a failure. `speech_only` is deliberately NOT: a spoken
      // refusal and a spoken no-op are the SAME event shape, so calling it 'failed' would grade
      // honest refusals as failures — the one misgrade §4b forbids by name. It falls to the
      // self-grade, where a human can tell the two apart. A `rejected` action likewise stays null:
      // the participant's own words may well have asked for the impossible, and only they know.
      if (w.some((e) => e.type === 'turn' && e.outcome === 'no_response')) return 'failed';
      return null;
    },
    selfGradable: true,
  },
  {
    id: 'robust-undo',
    dimension: 'robustness',
    instruction: 'Press ⌘Z to undo the last thing it did. The document should go back.',
    utteranceKey: null,   // a keystroke, not an utterance (the battery probes "undo that" separately)
    // App emits `correction` on every undo that actually applied, and emits NOTHING when there was
    // nothing to undo — so absence means the undo did not happen, which is why this card is not
    // self-gradable: there is no instrument gap for a human to fill in.
    observe: (events, baseline) => (since(events, baseline).some((e) => e.type === 'correction') ? 'done' : null),
    selfGradable: false,
  },
  {
    id: 'latency-round-trip',
    dimension: 'latency',
    instruction: "Ask it what's in this document right now, and count in your head until it answers.",
    utteranceKey: 'latency-simple-question',
    // The timing lives on the `turn` event: `firstResponseMs` is computed inside turns.ts from the
    // turn's TRUE open time (the exported `t` is settle-adjacent and cannot be used for this — see
    // deriveAttempts' C1 note). This card only records THAT a round trip completed; the number
    // itself is the scorecard's to report, with its n.
    observe: (events, baseline) => {
      const t = since(events, baseline).find((e) => e.type === 'turn');
      if (!t || t.type !== 'turn') return null;
      if (t.outcome === 'no_response') return 'failed';      // nothing came back: not slow, absent
      if (t.firstResponseMs === null) return null;           // lost transcript — no trial to time
      return 'done';
    },
    selfGradable: true,
  },
  {
    id: 'material-pin',
    dimension: 'material',
    instruction: 'Ask it which three numbers in the sheet are biggest, then pin its answer card onto the desk.',
    utteranceKey: 'material-pin-answer',
    // Fully instrumented both ways: App emits `pin` with an artifactId on success and with an
    // `error` on every refusal (not pinnable, or at the artifact cap). Not self-gradable — a
    // missing pin event means no pin happened.
    observe: (events, baseline) => {
      const p = since(events, baseline).find((e) => e.type === 'pin');
      if (!p || p.type !== 'pin') return null;
      if (p.error) return 'failed';        // refused — the card's thing did not get onto the desk
      return p.artifactId ? 'done' : null;
    },
    selfGradable: false,
  },
  {
    id: 'material-combine',
    dimension: 'material',
    instruction: 'Put the report and the numbers into the combine tray, then make one brief out of them.',
    utteranceKey: 'material-combine-two',
    // `kind: 'add'` is a TRAY-MANAGEMENT event (App records a refused add at the cap that way), not
    // a combine — filtering it out is what stops a full tray from grading this card at all.
    observe: (events, baseline) => {
      const c = since(events, baseline).find((e) => e.type === 'combine_tray' && e.kind !== 'add');
      if (!c || c.type !== 'combine_tray') return null;
      if (!c.ok) return 'failed';
      return c.count >= 2 ? 'done' : 'failed';   // "out of THEM": one source is not a combine
    },
    selfGradable: false,
  },
  {
    id: 'either-input',
    dimension: 'robustness',
    instruction: 'Make card 2\'s change again by the other route: type it if you spoke it, speak it if you typed it.',
    utteranceKey: 'either-input-choice',
    // The ONE predicate that reads before the baseline — and it is not a baselining violation: what
    // is forbidden is letting a pre-baseline event SATISFY the card, and nothing before the baseline
    // can do that here. The prior stream is read only to learn which route was already used, i.e.
    // to establish what "the other" means. That is what a baseline IS (missions/defs.ts reads its
    // baseline world the same way, to diff against).
    observe: (events, baseline) => {
      const prior = [...events.slice(0, Math.max(0, baseline))].reverse()
        .find((e) => e.type === 'action' && e.decision === 'commit');
      const now = since(events, baseline).find((e) => e.type === 'action' && e.decision === 'commit');
      if (!now || now.type !== 'action') return null;
      if (!prior || prior.type !== 'action') return null;   // no earlier route on record — self-grade
      return now.modality !== prior.modality ? 'done' : 'failed';
    },
    selfGradable: true,
  },
];

// Fails the build (not a test) if a card cites a join key the shared trial set does not define —
// the corpus join is the whole point of ./utterances.ts, and a typo there is silent otherwise.
const UNKNOWN_KEYS = EVAL_DECK
  .map((c) => c.utteranceKey)
  .filter((k): k is string => k !== null && !UTTERANCES.some((u) => u.key === k));
if (UNKNOWN_KEYS.length) throw new Error(`EVAL_DECK cites unknown utterance keys: ${UNKNOWN_KEYS.join(', ')}`);

// ---------------------------------------------------------------------------------------------
// The reducer. Pure. Deck state is SESSION-SCOPED React state and is deliberately NOT journaled:
// there is no `JOURNAL_VERSION` change anywhere in this feature (it stays at 2). A deck run is a
// human sitting, not a document state — replaying a journal must reproduce the DOCUMENT, and
// re-dealing someone's half-finished eval cards during a replay would be a false record of a
// sitting that never happened. The durable artefact of a deck run is the telemetry export.
// ---------------------------------------------------------------------------------------------

const resultFor = (s: DeckState, cardId: string): CardResult | undefined =>
  s.results.find((r) => r.cardId === cardId);

export function deckReduce(s: DeckState, e: DeckEvent): DeckState {
  switch (e.type) {
    case 'start':
      // Idempotent by VALUE, not by a call count — the discipline App.tsx's desk/skin effects use,
      // and what makes StrictMode's double-invoked mount effect harmless here.
      return s.startedAt === null ? { index: 0, results: [], startedAt: e.at } : s;

    case 'observe':
    case 'selfGrade':
    case 'skip': {
      if (s.startedAt === null) return s;          // nothing is on screen to grade
      if (resultFor(s, e.cardId)) return s;        // NEVER re-grade a card that already has a result
      const card = EVAL_DECK.find((c) => c.id === e.cardId);
      if (!card) return s;                         // unknown card id: ignored, never recorded
      // A self-grade on a card whose gesture the app records unconditionally is refused here as
      // well as hidden in the UI — the UI is not the place where a data invariant lives.
      if (e.type === 'selfGrade' && !card.selfGradable) return s;
      const result: CardResult = e.type === 'skip'
        // A skip is a RESULT (spec §4b: "a skip is a recorded outcome, not an absence"), carrying
        // 'self' because a human produced it — so it can never be counted in the observed column.
        ? { cardId: e.cardId, grade: 'skipped', graded: 'self', at: e.at }
        : { cardId: e.cardId, grade: e.grade, graded: e.type === 'observe' ? 'observed' : 'self', at: e.at };
      return { ...s, results: [...s.results, result] };
    }

    case 'advance':
      if (s.startedAt === null) return s;
      return { ...s, index: Math.min(s.index + 1, EVAL_DECK.length) };
  }
}

/** The card on screen, or null when the deck has not started or has run out. */
export function currentCard(s: DeckState): EvalCard | null {
  if (s.startedAt === null) return null;
  return EVAL_DECK[s.index] ?? null;
}

export const isDeckComplete = (s: DeckState): boolean =>
  s.startedAt !== null && s.index >= EVAL_DECK.length;

/** Counts for the completion line and the Task 8 scorecard seam. Every number carries its own n by
 *  construction (they are counts, not rates) — the eval spec's §5 rule, which is why this returns
 *  no percentages at all. `observed`/`self` are reported separately for the same reason. */
export function deckTally(s: DeckState): {
  total: number; done: number; failed: number; skipped: number; observed: number; self: number;
} {
  const g = (grade: CardGrade) => s.results.filter((r) => r.grade === grade).length;
  return {
    total: s.results.length,
    done: g('done'), failed: g('failed'), skipped: g('skipped'),
    observed: s.results.filter((r) => r.graded === 'observed').length,
    self: s.results.filter((r) => r.graded === 'self').length,
  };
}
