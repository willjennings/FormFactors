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
// already written), so it still deduped to a fabricated success. This round replaces the
// gate-agreement clause with a PAYLOAD clause: dedupe only when the incoming detail carries
// nothing new (absent/blank, or the SAME value already applied). See dedupe.ts for the full
// history and why `pending.confirmed === true` is a strong enough discriminator once payload is
// checked (it's only ever set past an identity bail, and invalidated on undo/program-swap/reset).
describe('shouldDedupeConfirm — payload discriminator, no gate needed (fix round 3, I3/#1)', () => {
  it('a replay with the SAME value as the pending action dedupes (round 1\'s original guarantee — now holds for Excel/insert_object too, not just authorial fields)', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', '250', true)).toBe(true);
  });

  it('a replay with NO detail (the button already supplied it) dedupes', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', undefined, true)).toBe(true);
  });

  it('the same-value comparison is whitespace/case-insensitive (normText), not exact-string', () => {
    const pending = { verb: 'edit_content', target: 'heading', detail: 'Quarterly Report', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'heading', '  quarterly   report  ', true)).toBe(true);
  });

  it("the coordinator's exact repro: a DIFFERENT value must NOT dedupe — it is a new edit, not a replay", () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', '260', true)).toBe(false);
  });

  it('never dedupes when this call itself is not a confirm (confirmed=false), regardless of payload', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', undefined, false)).toBe(false);
  });

  it('never dedupes when verb/target do not match the pending action', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell C9', undefined, true)).toBe(false);
  });
});

// Both new directions, verified against the REAL gate and reducer (not stubs) on seedCorpus(), per
// the coordinator's explicit instruction: same value dedupes (the gate/reducer are never even
// reached); different value does NOT dedupe and reaches the reducer, which applies the NEW value.
describe('shouldDedupeConfirm — both directions against the real gate + reducer (fix round 3, I3/#1)', () => {
  it('same-value replay dedupes before the gate or reducer ever run', () => {
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', '250', true)).toBe(true);
  });

  it("different-value replay does NOT dedupe — it reaches the gate (which allows it) and the reducer (which writes the NEW value, never silently drops it)", () => {
    const base = seedCorpus().excel as { kind: 'excel'; cells: Record<string, string>; currency: string[]; chart: boolean; saved: boolean };
    const doc = { ...base, cells: { ...base.cells, B5: '250' } }; // B5 already holds the FIRST applied value
    const pending = { verb: 'edit_content', target: 'Cell B5', detail: '250', confirmed: true };
    expect(shouldDedupeConfirm(pending, 'edit_content', 'Cell B5', '260', true)).toBe(false);
    const gate = validateActionCall('edit_content', { target: 'Cell B5', detail: '260', confirm: true }, doc);
    expect(gate).toEqual({ ok: true });
    const after = applyAction(doc, 'edit_content', { target: 'Cell B5', detail: '260' }) as any;
    expect(after.cells.B5).toBe('260'); // the new value lands — not the stale '250' from a fabricated dedupe
  });
});
