import { describe, it, expect } from 'vitest';
import { isDuplicateConfirm, shouldDedupeConfirm } from './dedupe';
import { validateActionCall } from './validate';
import { applyAction } from '../scenarios';
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

// Fix round 3, I3/#1: round 2 required the gate to independently agree before deduping, which
// closed the MISSING-value hole but not a DIFFERENT-value one — a well-formed but genuinely
// different detail still passes the gate on its own terms (the gate has no memory of what was
// asked before), so it still deduped to a fabricated success. Round 3 replaced the gate-agreement
// clause with a PAYLOAD clause: dedupe only when the incoming detail carries nothing new
// (absent/blank, or the same instruction already applied).
//
// Fix round 4 tightens what "the same" means. Round 3 compared via `normText`, the entity-NAME
// normaliser, which strips every non-alphanumeric character — so '-250' and '250' compared equal
// and a sign flip was acked "already applied". The comparison is now trimmed EXACT string
// equality: only surrounding whitespace is insignificant. See dedupe.ts for why the compared
// values are INSTRUCTIONS (not the document's contents), and why comparing instructions is
// nonetheless the right rule here (an instruction is not idempotent — a repeated 'sum' compounds).
describe('shouldDedupeConfirm — payload discriminator, no gate needed (fix round 3, I3/#1; round 4)', () => {
  it('a replay with the SAME value as the pending action dedupes (round 1\'s original guarantee — now holds for Excel/insert_object too, not just authorial fields)', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true })).toBe(true);
  });

  it('a replay with NO detail (the button already supplied it) dedupes', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: undefined, confirmed: true })).toBe(true);
  });

  it('surrounding whitespace is insignificant — "250 " is the same value as "250"', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '250 ', confirmed: true })).toBe(true);
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '  250', confirmed: true })).toBe(true);
  });

  it('a SIGN FLIP is a different value and must NOT dedupe (round 4: normText stripped the minus, so "-250" deduped against "250")', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '-250', confirmed: true })).toBe(false);
    const negPending = { verb: 'edit_content', target: 'Cell B5', detail: '-5', confirmed: true };
    expect(shouldDedupeConfirm(negPending, { verb: 'edit_content', target: 'Cell B5', detail: '5', confirmed: true })).toBe(false);
  });

  it('punctuation, currency and percent are part of the value, not noise (every one of these deduped under normText)', () => {
    // One assertion over all four pairs so a regression reports every pair it re-opens, not just
    // the first: [what the pending action applied, what the replay carries].
    const pairs: [string, string][] = [['(500)', '500'], ['5%', '5'], ['$4.2M', '4.2m'], ['=SUM(B1:B9)', 'sum b1 b9']];
    const deduped = pairs.map(([applied, replay]) => shouldDedupeConfirm(
      { verb: 'edit_content', target: 'Cell B5', detail: applied, confirmed: true },
      { verb: 'edit_content', target: 'Cell B5', detail: replay, confirmed: true },
    ));
    expect(deduped).toEqual([false, false, false, false]);
  });

  it("the round-3 repro still holds: a DIFFERENT value must NOT dedupe — it is a new edit, not a replay", () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '260', confirmed: true })).toBe(false);
  });

  it('never dedupes when this call itself is not a confirm (confirmed=false), regardless of payload', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: undefined, confirmed: false })).toBe(false);
  });

  it('never dedupes when verb/target do not match the pending action', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell C9', detail: undefined, confirmed: true })).toBe(false);
  });
});

// Both directions, verified against the REAL gate and reducer (not stubs) on seedCorpus(), per the
// coordinator's explicit instruction: same value dedupes (the gate/reducer are never even
// reached); a different value does NOT dedupe and reaches the reducer, which applies the NEW one.
describe('shouldDedupeConfirm — both directions against the real gate + reducer (fix round 3, I3/#1; round 4)', () => {
  it('same-value replay dedupes before the gate or reducer ever run', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true })).toBe(true);
  });

  it("different-value replay does NOT dedupe — it reaches the gate (which allows it) and the reducer (which writes the NEW value, never silently drops it)", () => {
    const base = seedCorpus().excel as { kind: 'excel'; cells: Record<string, string>; currency: string[]; chart: boolean; saved: boolean };
    const doc = { ...base, cells: { ...base.cells, B5: '250' } }; // B5 already holds the FIRST applied value
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '260', confirmed: true })).toBe(false);
    const gate = validateActionCall('edit_content', { target: 'Cell B5', detail: '260', confirm: true }, doc);
    expect(gate).toEqual({ ok: true });
    const after = applyAction(doc, 'edit_content', { target: 'Cell B5', detail: '260' }) as any;
    expect(after.cells.B5).toBe('260'); // the new value lands — not the stale '250' from a fabricated dedupe
  });

  it("a sign-flipped replay reaches the reducer and writes '-250' — the cell must not be left holding '250' behind an 'already applied' ack", () => {
    const base = seedCorpus().excel as { kind: 'excel'; cells: Record<string, string>; currency: string[]; chart: boolean; saved: boolean };
    const doc = { ...base, cells: { ...base.cells, B5: '250' } };
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: '-250', confirmed: true })).toBe(false);
    const gate = validateActionCall('edit_content', { target: 'Cell B5', detail: '-250', confirm: true }, doc);
    expect(gate).toEqual({ ok: true });
    const after = applyAction(doc, 'edit_content', { target: 'Cell B5', detail: '-250' }) as any;
    expect(after.cells.B5).toBe('-250');
  });
});

// The two shapes the prior rounds regressed in opposite directions: round 1 acked malformed calls
// as fabricated successes, round 2 fixed that but showed a ✕ for actions that HAD succeeded. Both
// of these are bare replays (no detail) of an action that landed, on the two non-authorial paths
// the gate cannot vouch for on its own — they must dedupe, not error.
describe('a bare replay of an action that already landed never becomes a ✕ (rounds 1-2 regression pins)', () => {
  it('Excel edit_content: the confirm re-fire drops the value because the button supplied it', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'edit_content', target: 'Cell B5', detail: undefined, confirmed: true })).toBe(true);
    // …and the gate on its own WOULD have refused this call, which is why the guard has to run first.
    const gate = validateActionCall('edit_content', { target: 'Cell B5', confirm: true }, seedCorpus().excel);
    expect('error' in gate).toBe(true);
  });

  it('Excel insert_object: same bare replay, same answer', () => {
    const pending = { verb: 'insert_object', target: 'column B', detail: 'sum', confirmed: true };
    expect(shouldDedupeConfirm(pending, { verb: 'insert_object', target: 'column B', detail: undefined, confirmed: true })).toBe(true);
  });
});
