import { describe, it, expect } from 'vitest';
import { isDuplicateConfirm, shouldDedupeConfirm } from './dedupe';
import { validateActionCall } from './validate';
import { seedCorpus } from '../artifacts/seeds';

describe('isDuplicateConfirm (fix round 1, I3)', () => {
  it('true when the pending action was confirmed and this call repeats its verb + target', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell B5')).toBe(true);
  });
  it('true when the follow-up call omits the target — it falls back to the pending target', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', undefined)).toBe(true);
  });
  it('false when there is no pending action', () => {
    expect(isDuplicateConfirm(null, 'edit_content', 'Cell B5')).toBe(false);
    expect(isDuplicateConfirm(undefined, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the pending action was never confirmed (still witnessed, awaiting the user)', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: false }, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the verb differs', () => {
    expect(isDuplicateConfirm({ verb: 'format_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell B5')).toBe(false);
  });
  it('false when the target genuinely differs (a real second edit, not a resend)', () => {
    expect(isDuplicateConfirm({ verb: 'edit_content', target: 'Cell B5', confirmed: true }, 'edit_content', 'Cell C9')).toBe(false);
  });
});

// Fix round 2, I3: round 1 made `isDuplicateConfirm` alone gate the dedupe decision, checked
// BEFORE the gate — which let ANY confirm:true call matching a confirmed pending action's
// verb+target dedupe on payload alone, including one the gate would genuinely refuse. These tests
// pin BOTH directions against the REAL gate (validateActionCall), not a stub, so a future reorder
// of "compute gate" vs "check dedupe" in App.tsx would need to also break this call shape to slip
// past — the two cases below are the reviewer's exact reproductions.
describe('shouldDedupeConfirm — dedupe must never override the gate (fix round 2, I3)', () => {
  it('direction 1 — a harmless replay the gate independently allows still dedupes (round 1\'s fix, preserved)', () => {
    // Authorial field (word heading): validate.ts's own confirm-bypass makes the gate say {ok}
    // unconditionally once confirm:true, even with no detail — the classic "button already
    // applied it, model re-fires confirm without resending the text" replay.
    const doc = seedCorpus().word;
    const pending = { verb: 'edit_content', target: 'heading', confirmed: true };
    const gate = validateActionCall('edit_content', { target: 'heading', confirm: true }, doc);
    expect(gate).toEqual({ ok: true });
    expect(shouldDedupeConfirm(pending, 'edit_content', 'heading', true, gate)).toBe(true);
  });

  it("direction 2 — reviewer's exact repro: a call the gate REJECTS must never be acked a duplicate success", () => {
    // Excel cell (non-authorial): the gate has no way to know a missing value was already
    // supplied via the button, so it genuinely refuses — that refusal must surface, never be
    // swallowed as a fake success just because verb+target match a confirmed pending action.
    const doc = seedCorpus().excel;
    const pending = { verb: 'edit_content', target: 'Cell B5', confirmed: true };
    const gate = validateActionCall('edit_content', { target: 'Cell B5', confirm: true }, doc);
    expect('error' in gate).toBe(true);
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', true, gate)).toBe(false);
  });

  it('a needsContent verdict on an already-confirmed action also dedupes (the shape the reviewer named, even though unreachable today — validate.ts\'s confirm-bypass returns {ok} first)', () => {
    const pending = { verb: 'edit_content', target: 'heading', confirmed: true };
    const gate = { needsContent: { field: 'heading', question: 'What would you like the heading to say?' } } as const;
    expect(shouldDedupeConfirm(pending, 'edit_content', 'heading', true, gate)).toBe(true);
  });

  it('never dedupes when this call itself is not a confirm (confirmed=false), regardless of the gate', () => {
    const pending = { verb: 'edit_content', target: 'heading', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'heading', false, { ok: true })).toBe(false);
  });

  it('never dedupes when verb/target do not match the pending action, even if the gate says ok', () => {
    const pending = { verb: 'edit_content', target: 'heading', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell C9', true, { ok: true })).toBe(false);
  });
});
