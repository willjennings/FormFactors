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

function isPlaceholder(detail: string | undefined, field: string): boolean {
  const d = normText(detail ?? '');
  if (!d) return true;                           // absent or blank
  return PLACEHOLDERS.includes(d) || d === normText(field);
}

/** Column for an aggregate: the target's letter, else the only numeric column, else ask. */
function resolveColumn(cells: Record<string, string>, target?: string): string | null {
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
      return { ok: true };
    }
    // The user has SEEN the witness card and confirmed: their words win, placeholder or not.
    if (args.confirm === true) return { ok: true };
    return isPlaceholder(args.detail, field.field) ? { needsContent: field } : { ok: true };
  }

  // insert_object
  const mode = aggregateMode(args.detail);
  if (!mode) {
    const d = normText(args.detail ?? '');
    if (!d || !INSERT_KINDS.some((k) => d.includes(k))) {
      return { error: `insert_object doesn't know "${args.detail ?? ''}". Valid: ${INSERT_KINDS.join(', ')}.` };
    }
    return { ok: true };
  }
  if (doc.kind !== 'excel') return { ok: true };
  const column = resolveColumn(doc.cells, args.target);
  if (!column) return { error: 'Which column should I total? Point at a cell in it, or name it.' };
  const r = totalColumn(doc.cells, column, mode);
  return 'error' in r ? { error: r.error } : { ok: true };
}
