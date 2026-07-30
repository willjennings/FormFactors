/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The shared trial set — ONE definition of "what was asked", imported by BOTH the human eval deck
// (./deck.ts, where each card's `utteranceKey` joins here) and the machine battery
// (scripts/battery/, Task 9, which sends `text` verbatim and extends this list toward ~30 entries).
//
// That shared import is the entire mechanism behind the design spec's §4b requirement that "a human
// deck run and an automated battery run are the same trials ... comparable by construction". If the
// deck and the battery each kept their own phrasings, any overlap between the two corpora would be
// a coincidence someone has to re-establish by hand; with one list, the join is a compile-time fact.
//
// This module is deliberately data-only: no predicates, no grading. `expect` records what the
// HONEST outcome of each ask is, which is a property of the ask itself (the world it is asked in),
// not of any particular run — the deck's `observe` predicates and the battery's grader each decide
// separately whether a given session met it. Keeping `expect` here rather than in either consumer
// is what stops the two from drifting into two different ideas of what "success" meant.

import type { ProgramId } from '../scenarios';

/** What the honest system SHOULD do with this ask, given the program it is asked in.
 *  - `commit`   — the change should land in the document.
 *  - `answer`   — words back, no document change (a question about what's there).
 *  - `refusal`  — the ask is impossible here; saying so, with a reason, is the correct outcome.
 *  - `question` — the ask is underspecified; a question back is the correct outcome. */
export type UtteranceExpectation = 'commit' | 'answer' | 'refusal' | 'question';

export interface Utterance {
  key: string;              // stable join key — deck cards and battery rows both cite it
  text: string;             // sent verbatim by the battery; the deck's card copy paraphrases it
  program: ProgramId;       // the program that must be in front for the ask to mean what it says
  expect: UtteranceExpectation;
}

/** Twelve entries now (Task 9 extends, never renames: a key is a corpus join key, so changing one
 *  silently orphans every earlier session that recorded it). Two entries are battery-only — no
 *  deck card cites them — and are marked as such; the deck is a 45-minute sitting and cannot
 *  carry every probe the battery can afford to run. */
export const UTTERANCES: Utterance[] = [
  { key: 'point-what-is-this', text: "What's this?", program: 'excel', expect: 'answer' },
  { key: 'point-change-cell', text: 'Change this number to 42.', program: 'excel', expect: 'commit' },
  { key: 'point-by-number', text: 'Number three — make that one bold.', program: 'excel', expect: 'commit' },
  // The §4b example refusal probe: there is no column to total in a slide deck, so the honest
  // outcome is a refusal that says why. Graded as a WIN, never as an error (eval spec §5).
  { key: 'refuse-total-in-deck', text: 'Total the column.', program: 'powerpoint', expect: 'refusal' },
  { key: 'ambiguous-make-it-pop', text: 'Make this pop.', program: 'word', expect: 'question' },
  // A paraphrase of `point-change-cell`, not a new intent — the robustness pair. Same expectation
  // by construction: if the two disagree, the pair is measuring two different things.
  { key: 'point-change-cell-rephrase', text: 'Put 42 in that cell instead.', program: 'excel', expect: 'commit' },
  { key: 'latency-simple-question', text: "What's in this document right now?", program: 'word', expect: 'answer' },
  { key: 'material-pin-answer', text: 'Which three numbers in the sheet are the biggest?', program: 'excel', expect: 'answer' },
  { key: 'material-combine-two', text: 'Combine the report and the numbers into one brief.', program: 'word', expect: 'commit' },
  // The same intent as `point-change-cell`, run through the other input route (spoken vs typed).
  // A separate key because the MODALITY is the variable under test — folding it into
  // `point-change-cell` would make the two runs indistinguishable in the corpus.
  { key: 'either-input-choice', text: 'Change that number to 42.', program: 'excel', expect: 'commit' },
  // BATTERY-ONLY (no deck card): no tool undoes anything — undo is a user affordance (⌘Z), so the
  // honest answer is to say it cannot. The deck exercises the real keystroke instead.
  { key: 'undo-last-change', text: 'Undo that.', program: 'word', expect: 'refusal' },
  // BATTERY-ONLY: a second underspecified ask, so `question` has n > 1 in a battery run. The deck
  // has room for one vagueness card, not two.
  { key: 'ambiguous-tidy-this', text: 'Tidy this up.', program: 'word', expect: 'question' },
];

/** Lookup by join key. Returns undefined for an unknown key rather than a guessed default — the
 *  getProgram anti-pattern (scenarios.ts, where an unknown program id silently becomes Word) is
 *  exactly what must not happen to a corpus join key. */
export function utteranceFor(key: string): Utterance | undefined {
  return UTTERANCES.find((u) => u.key === key);
}
