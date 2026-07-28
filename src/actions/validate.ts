// The gate (spec §4). Everything here follows one question: WHOSE information is missing?
//   the USER underspecified  -> { needsContent } -> ask them, with candidate answers
//   the MODEL called wrong   -> { error }        -> tell the model; never bother the user
// Keeping these apart is not taste: this is a measurement testbed, and logging an ask as an
// error would inflate every register arm's error rate with correct collaborative behaviour.
import { normText } from '../entities/registry';
import type { MockDoc } from '../scenarios';
import { totalColumn } from './columnTotal';

export type ActionValidation =
  | { ok: true }
  | { needsContent: { field: string; question: string } }
  | { error: string };

export const INSERT_KINDS = ['chart', 'slide', 'shape', 'sum', 'average'] as const;

const SUM_WORDS = ['sum', 'total'];
const AVG_WORDS = ['average', 'avg', 'mean'];

/** What insert_object can actually make HERE. An aggregate needs cells, so only a spreadsheet
 *  offers them. Both refusal messages below are built from this one derivation: the unknown-detail
 *  message used to advertise `sum, average` on a deck where the aggregate branch four lines later
 *  refuses exactly those two — the same loop-invitation that message's sibling was fixed to
 *  remove, with the two strings inside one function disagreeing about what is valid. */
function insertableKinds(doc: MockDoc): string[] {
  return doc.kind === 'excel' ? [...INSERT_KINDS] : INSERT_KINDS.filter((k) => k !== 'sum' && k !== 'average');
}

/** Which aggregate the detail asks for, or null. `total`/`mean` included: the observed
 *  near-miss was `detail: "total"` silently inserting a chart. Token match, not substring —
 *  "subtotal row" and "meantime" are not aggregate requests; `detail` is model-generated free
 *  text, not a constrained enum, so substring matching reintroduces the same failure class. */
export function aggregateMode(detail?: string): 'sum' | 'average' | null {
  const words = normText(detail ?? '').split(' ').filter(Boolean);
  if (words.some((w) => AVG_WORDS.includes(w))) return 'average';
  if (words.some((w) => SUM_WORDS.includes(w))) return 'sum';
  return null;
}

/** AUTHORIAL fields only — words that become the user's document. A cell value the user already
 *  stated ("put 100 here") is NOT authorial; asking for it would be nagging. */
function authorialField(doc: MockDoc, target?: string, detail?: string): { field: string; question: string } | null {
  const t = normText(target ?? ''), d = normText(detail ?? '');
  if (doc.kind === 'word') {
    return t.includes('head') || d.includes('head')
      ? { field: 'heading', question: 'What would you like the heading to say?' }
      : { field: 'body', question: 'What would you like it to say?' };
  }
  if (doc.kind === 'powerpoint') {
    return { field: 'slideTitle', question: 'What would you like the slide title to say?' };
  }
  return null;                                   // excel cells, photos: not authorial
}

const PLACEHOLDERS = ['heading', 'title', 'text', 'body', 'content', 'value'];

/** Spec §4.1: a placeholder is `normText(detail)` equal to a generic noun, to the FIELD's own
 *  noun, **or to the TARGET's noun**. That last clause was dropped when this landed, and it is the
 *  one carrying the weight — because authorialField collapses every non-"head" target on a word
 *  document to the single field `body`, so `d === normText(field)` fires only on the literal word
 *  "body" and is otherwise dead. What a model emits is the noun it was handed: "add a subtitle
 *  here" → target "subtitle", detail "Subtitle". Nine such nouns (subtitle, caption, footer,
 *  header, label, summary, intro, section, paragraph) wrote themselves into the document in the
 *  default register with no licence and no confirm — the origin bug, one noun over.
 *
 *  HONEST survives for free: the licence (userSuppliedLiteral) is keyed on the field and the
 *  user's own text, so someone who answers "Subtitle" is still written "Subtitle". */
function isPlaceholder(detail: string | undefined, field: string, target?: string): boolean {
  const d = normText(detail ?? '');
  if (!d) return true;                           // absent or blank
  const t = normText(target ?? '');
  return PLACEHOLDERS.includes(d) || d === normText(field) || (!!t && d === t);
}

/** What the USER themselves last said in answer to an ask — captured app-side when the ask closed,
 *  from what they actually sent. */
export interface AskAnswer { field: string; text: string }

/** An AskAnswer plus the identity of the transcript run it was captured from, and whether it was
 *  captured from SPEECH. Both are stamped at capture (App's clearAsk) and never re-derived, for
 *  the same reason: what may be done to a held answer is a property of the answer, not of whatever
 *  arrives afterwards. */
export interface HeldAnswer extends AskAnswer { turn: number; voice: boolean }

/** The accumulated speech of ONE transcript run, as two parts: everything already finished
 *  (`committed`) and the fragment still in flight (`fragment`). The whole utterance is
 *  `runUtterance` — see below for why this is not just a string.
 *
 *  Providers deliver a run as deltas of three different kinds, and telling them apart is the
 *  entire job: a GROWING partial ("Head" → "Heading"), a NEW piece of a longer utterance ("the
 *  heading" → "should say Q3 Summary"), and the closing event, which restates the WHOLE run
 *  (azure.ts / openai.ts pass `ev.transcript` there, not an increment). A partial replaces what it
 *  grew from, a new piece is appended, a restatement replaces the lot — and each of those is a
 *  superset of what it replaces, so the utterance only ever grows.
 *
 *  App's display accumulator (App.tsx:2406-2415) does exactly this test, but against the previous
 *  RAW delta, which `:2471` writes back over the accumulated value for the keyword diff. So its
 *  result can COLLAPSE mid-run: held "Q3 Summary", delta "Head", delta "Heading" leaves it holding
 *  "Heading" — the bare placeholder, licensed by a licence the user never gave for that word (fix
 *  round 4). Hence a separate accumulation whose committed half is APPEND-ONLY: only the trailing
 *  in-flight fragment can ever be rewritten, so the utterance can grow and can never shrink to a
 *  word the user said as part of something longer.
 *
 *  Literal append (`acc + ' ' + delta`) was the obvious version and is wrong in the other
 *  direction: the ordinary one-word run `delta "Heading"` + `completed "Heading"` would accumulate
 *  "Heading Heading", so the user who genuinely wants the word Heading could never say so on
 *  voice — the escape hatch userSuppliedLiteral exists for would be dead on the primary modality. */
export interface RunAccum { committed: string; fragment: string }

export const EMPTY_RUN_ACCUM: RunAccum = { committed: '', fragment: '' };

const startsCI = (s: string, p: string) => s.toLowerCase().startsWith(p.toLowerCase());

/** Fold one transcript delta into the run. Growth only: every return value CONTAINS the previous
 *  utterance, which is the property the licence depends on. */
export function accumulateRun(acc: RunAccum, delta: string): RunAccum {
  const d = delta.trim();
  if (!d) return acc;                            // noise-only deltas add nothing
  const whole = runUtterance(acc);
  // The run's closing event carries the WHOLE transcript, not an increment (azure.ts:151-152 and
  // openai.ts:135-136 pass `ev.transcript` on `…transcription.completed`). A delta that begins
  // with everything said so far therefore restates the run rather than extending it — replacing
  // is safe BECAUSE it is a prefix (the new text contains the old, so nothing can be lost), and
  // appending would double the utterance.
  if (whole && startsCI(d, whole)) return { committed: '', fragment: d };
  const prev = acc.fragment.trim();
  // A delta that begins with the fragment in flight is that same fragment, grown.
  if (prev && startsCI(d, prev)) return { ...acc, fragment: d };
  return { committed: [acc.committed, prev].filter(Boolean).join(' '), fragment: d };
}

/** Everything said in the run so far. */
export function runUtterance(acc: RunAccum): string {
  return [acc.committed, acc.fragment].filter(Boolean).join(' ');
}

/** What becomes of a held answer when more transcript arrives.
 *
 *  A spoken answer closes the ask on its FIRST fragment, so the rest of the utterance only lands
 *  afterwards and the recorded answer has to grow to match it. But growth has to be scoped to the
 *  utterance it started in, and the guard that did this had no turn identity (fix round 3): with a
 *  licence still live — the model's retry can be refused above the spend, or never come — the
 *  accumulator restarts after 3s, and the user's NEXT turn simply opening with the bare word
 *  ("Heading… can you make that bigger?") rewrote the licence to "Heading". That wrote the literal
 *  word a turn after they said it, about something else entirely.
 *
 *  `accumulated` is the whole run (runUtterance above), never the display accumulator: this rule
 *  can only be as honest as the text it is handed.
 *
 *  A later run therefore DROPS the answer rather than leaving it: it was captured from a fragment
 *  of an utterance that has since ended, so it can never be completed, and keeping it would
 *  preserve exactly the hazard. A prefix test is no substitute — once the accumulator holds an
 *  earlier utterance, the closing fragment is not a prefix of what accumulates next. */
export function reviseHeldAnswer(
  held: HeldAnswer | null,
  ev: { turn: number; voice: boolean; askOpen: boolean; accumulated: string },
): HeldAnswer | null {
  if (!held) return null;
  if (held.turn !== ev.turn) return null;        // a later utterance: this answer's turn is over
  if (ev.askOpen) return held;                   // that text belongs to the new question
  // MODALITY IS THE HELD ANSWER'S, NOT THE ARRIVING DELTA'S. This gated on `ev.voice`, which is
  // the modality of whatever just arrived — so the sentence "typed and chip answers arrive
  // complete" stated an intent the code could not enforce. Executed: the user TYPES "Q3 Summary"
  // to answer, the hot mic picks up the word "heading" later in the SAME run (so round 3's turn
  // identity does not apply), ev.voice is true, and the typed answer is rewritten to "heading" —
  // which the gate then licenses. Only a SPOKEN answer is incomplete by construction (the ask
  // closes on its first fragment), so only a spoken answer may grow.
  if (!held.voice) return held;                  // typed and chip answers arrived complete
  // …and it may only grow on more speech: the run accumulator folds typed text into the same run
  // (App's processInputTranscript is the one seam both modalities cross), so an arriving typed
  // delta would otherwise append itself to what the user said.
  if (!ev.voice) return held;
  if (!ev.accumulated.trim()) return held;       // nothing to revise with
  return { ...held, text: ev.accumulated };
}

/** May a placeholder-SHAPED word be written after all? Only when the user's whole answer WAS that
 *  word. Nothing else — not `confirm` (a model-set argument, which is how the origin bug walked
 *  through the default register), and not a mention inside a longer sentence.
 *
 *  EQUALITY, not containment (fix round 2). Containment could not tell asking for a word from
 *  mentioning one, and this question — "What would you like the heading to say?" — primes the user
 *  to say "heading": `"the heading should say Q3 Summary"` licensed writing "Heading", which is the
 *  origin bug with the user's real answer discarded. The failure modes are asymmetric: equality
 *  costs one extra re-ask, containment silently writes the placeholder.
 *
 *  The escape hatch survives without a stop-word list, which I evaluated and rejected: to accept
 *  "the word Heading" a list must strip "the", and stripping "the" licenses the spoken fragment
 *  "the heading" and (with "make"/"it") "make it a heading" — so every version either fails the
 *  phrasing it exists for or admits one it must not. A user who says "just the word Heading" is
 *  simply asked once more and answers "Heading", which passes. One extra exchange, no list to
 *  get wrong. */
export function userSuppliedLiteral(answer: AskAnswer | null | undefined, field: string, detail?: string): boolean {
  if (!answer || answer.field !== field) return false;
  const d = normText(detail ?? '');
  if (!d) return false;                          // silence is never licensed, however they answered
  return normText(answer.text) === d;
}

/** Cell ref named by a target string ("Cell A1", "A1"), or null if none is named. Never guesses
 *  A1 — an unnamed cell means write nothing (fix round 1, I4). Shared by the gate and the reducer
 *  (scenarios.ts) so "is this a real cell" can't be answered two different ways, same as C1. */
export function resolveCellRef(target?: string): string | null {
  return target?.match(/[A-Za-z]\d+/)?.[0]?.toUpperCase() ?? null;
}

/** Column for an aggregate: the target's letter, else the only numeric column, else ask.
 *  Exported (fix round 1, C1) so the reducer (scenarios.ts) calls this SAME function instead of
 *  its own letter-matching regex — two functions deciding the column is exactly the defect class
 *  this task exists to remove, one level up. */
export function resolveColumn(cells: Record<string, string>, target?: string): string | null {
  const named = target?.match(/\b([A-Da-d])\s*\d/)?.[1]
    ?? target?.match(/\bcolumn\s+([A-Da-d])\b/i)?.[1]
    ?? target?.trim().match(/^([A-Da-d])$/)?.[1];
  // A NAMED column is honoured even if it turns out unusable — totalColumn then refuses
  // honestly. Substituting a different column would be a silently wrong answer.
  if (named) return named.toUpperCase();
  const numeric = ['A', 'B', 'C', 'D'].filter((c) => 'value' in totalColumn(cells, c, 'sum'));
  return numeric.length === 1 ? numeric[0] : null;
}

export function validateActionCall(
  verb: string, args: { target?: string; detail?: string; confirm?: boolean }, doc: MockDoc,
  /** The user's own last answer to an ask (App passes `lastAnswerRef.current`). Absent in the
   *  ordinary case; only ever WIDENS what is allowed, and only on the user's words. */
  answer?: AskAnswer | null,
): ActionValidation {
  // format_content / save_file / photo_edit have honest defaults or no payload.
  if (verb !== 'edit_content' && verb !== 'insert_object') return { ok: true };

  if (verb === 'edit_content') {
    const field = authorialField(doc, args.target, args.detail);
    if (!field) {
      // Not authorial. A missing value is the MODEL's omission — it had the number.
      const detail = (args.detail ?? '').trim();
      if (!detail) {
        const where = args.target?.trim() || 'that cell';
        return { error: `edit_content on ${where} needs the value to enter — the user said it; pass it as detail.` };
      }
      // Excel cells are ADDRESSED, not authored — but the address itself must be real (fix round
      // 1, I4). A target that doesn't name a cell (e.g. "the total row") must never fall back to
      // guessing A1 and overwriting whatever happens to sit there.
      if (doc.kind === 'excel' && !resolveCellRef(args.target)) {
        return { error: `edit_content needs a real cell reference (like "B5") — "${args.target ?? ''}" doesn't name one.` };
      }
      return { ok: true };
    }
    // Real content passes untouched. A placeholder-shaped word passes ONLY on the user's own
    // say-so (see userSuppliedLiteral) — never on `confirm`, which the model sets itself.
    if (!isPlaceholder(args.detail, field.field, args.target)) return { ok: true };
    return userSuppliedLiteral(answer, field.field, args.detail) ? { ok: true } : { needsContent: field };
  }

  // insert_object
  const mode = aggregateMode(args.detail);
  if (!mode) {
    const d = normText(args.detail ?? '');
    if (!d || !INSERT_KINDS.some((k) => d.includes(k))) {
      return { error: `insert_object doesn't know "${args.detail ?? ''}". Valid: ${insertableKinds(doc).join(', ')}.` };
    }
    return { ok: true };
  }
  // An aggregate needs cells. insert_object is offered to powerpoint as well as excel, and the
  // reducer's powerpoint branch reads `detail` only for "dup" (scenarios.ts) and otherwise appends
  // "Slide N" — so falling through to {ok:true} here answered "total that column" with a blank
  // slide, acked as done. Same near-miss class as `detail:"total"` inserting a chart (see
  // aggregateMode above): refuse where the capability does not exist, rather than do something
  // else silently. The alternatives offered exclude the aggregate words themselves — suggesting
  // "sum, average" as valid replacements for a refused "sum" is an invitation to loop.
  if (doc.kind !== 'excel') {
    return { error: `insert_object can only total a column in a spreadsheet — this is a ${doc.kind} document, which has no cells. Here you can insert: ${insertableKinds(doc).join(', ')}.` };
  }
  const column = resolveColumn(doc.cells, args.target);
  if (!column) return { error: 'Which column should I total? Point at a cell in it, or name it.' };
  const r = totalColumn(doc.cells, column, mode);
  return 'error' in r ? { error: r.error } : { ok: true };
}
