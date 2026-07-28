import { describe, it, expect } from 'vitest';
import { applyAction } from '../scenarios';
import { seedCorpus } from '../artifacts/seeds';
import { validateActionCall } from './validate';
import type { MockDoc } from '../scenarios';

const excel = () => seedCorpus().excel;

describe('applyAction no longer invents payloads', () => {
  it('an Excel cell edit with no detail writes NOTHING — it must never invent 100', () => {
    const doc = excel();
    const after = applyAction(doc, 'edit_content', { target: 'Cell B5' }) as any;
    expect(after.cells.B5).toBeUndefined();
  });
  it('a heading edit with no detail writes NOTHING — it must never write "Heading"', () => {
    const after = applyAction(seedCorpus().word, 'edit_content', { target: 'heading' }) as any;
    expect(after.heading).toBeUndefined();
  });
});

describe('the aggregate writes into the totalled column, not hardcoded A', () => {
  it('totals column B and lands the result below it, formatted like its column', () => {
    const doc = { kind: 'excel' as const, currency: [], chart: false, saved: false,
      cells: { B1: 'Q3', B2: '$4.2M', B3: '$3.4M' } };
    const after = applyAction(doc, 'insert_object', { target: 'Cell B2', detail: 'sum' }) as any;
    expect(after.cells.B4).toBe('$7.6M');     // below the last used row, in the column's idiom
    expect(after.cells.A4).toBeUndefined();   // NOT column A
  });
  it('a column with nothing summable is left untouched (the validator refuses upstream)', () => {
    const doc = excel();
    const after = applyAction(doc, 'insert_object', { target: 'Cell A2', detail: 'sum' });
    expect(after).toEqual(doc);
  });
  it('an unrecognised insert no longer silently becomes a chart', () => {
    const doc = excel();
    const after = applyAction(doc, 'insert_object', { target: 'grid', detail: 'total' }) as any;
    expect(after.chart).toBe(false);          // "total" is an aggregate, never a chart
  });
});

// Fix round 1, C1: the gate (validateActionCall) and the reducer (applyAction) must resolve the
// SAME column for the same call — two functions deciding independently is the exact defect class
// this task exists to remove, one level up. Both reproductions are the reviewer's exact repro.
describe('C1 — the gate and the reducer resolve the same column (fix round 1)', () => {
  it('reviewer repro 1: {target:"column B", detail:"total"} on a doc with numeric A AND B totals B, not A', () => {
    const doc: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '5', A2: '7', B1: '$4.2M', B2: '$3.4M' } };
    const gate = validateActionCall('insert_object', { target: 'column B', detail: 'total' }, doc);
    expect(gate).toEqual({ ok: true });         // the gate approves — it resolves column B
    const after = applyAction(doc, 'insert_object', { target: 'column B', detail: 'total' }) as any;
    expect(after.cells.B3).toBe('$7.6M');       // the reducer must ALSO total B
    expect(after.cells.A3).toBeUndefined();     // NOT A — no wrong number in a wrong column
  });

  it('reviewer repro 2: {detail:"total"} with only B numeric — gate infers B; the reducer must not silently fall back to A and no-op', () => {
    const doc: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: 'Header', B1: '5', B2: '7' } };
    const gate = validateActionCall('insert_object', { detail: 'total' }, doc);
    expect(gate).toEqual({ ok: true });         // the gate infers the single numeric column, B
    const after = applyAction(doc, 'insert_object', { detail: 'total' }) as any;
    expect(after.cells.B3).toBe('12');          // the reducer must ALSO infer B — not a silent no-op on A
  });
});

// Fix round 1, C2: the gate has no way to know a totalled column is already full (it never checks
// a landing row exists), so it can approve a call the reducer then no-ops. This is the disagreement
// that makes App.tsx's identity-bail (nextDoc === prevDoc) necessary as a backstop — there is no
// component harness in this repo to exercise that App.tsx wiring directly (see report), so this
// test pins the underlying disagreement at the pure-function boundary instead.
describe('C2 — the gate can approve a call the reducer no-ops on (fix round 1)', () => {
  it('a full column: gate says ok, reducer returns the SAME reference (no free row to land the total)', () => {
    const doc: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', A6: '6' } };
    const gate = validateActionCall('insert_object', { target: 'Cell A2', detail: 'sum' }, doc);
    expect(gate).toEqual({ ok: true });
    expect(applyAction(doc, 'insert_object', { target: 'Cell A2', detail: 'sum' })).toBe(doc); // identity, not just equality
  });

  it('M1 folds in here: "slide"/"shape" pass INSERT_KINDS regardless of doc kind, so an Excel doc no-ops the same way', () => {
    const doc = excel();
    const gate = validateActionCall('insert_object', { target: 'grid', detail: 'slide' }, doc);
    expect(gate).toEqual({ ok: true });         // the gate doesn't check the kind against doc.kind
    expect(applyAction(doc, 'insert_object', { target: 'grid', detail: 'slide' })).toBe(doc); // reducer no-ops — same identity-bail catches it
  });
});

// Fix round 1, I4: the cell LOCATION must never be invented, same defect class as the four `||`
// fallbacks removed in the first pass, one branch over. Reviewer's exact repro.
describe('I4 — the cell an edit lands in must be real, never guessed as A1 (fix round 1)', () => {
  it("reviewer repro: {target:'the total row', detail:'250'} must not overwrite A1", () => {
    const doc = excel();
    const gate = validateActionCall('edit_content', { target: 'the total row', detail: '250' }, doc);
    expect('error' in gate).toBe(true);         // the gate refuses — no cell named
    const after = applyAction(doc, 'edit_content', { target: 'the total row', detail: '250' });
    expect(after).toBe(doc);                    // the reducer refuses too — A1 survives untouched
  });
  it('a target with no letter+digit anywhere (undefined target) is refused the same way', () => {
    const doc = excel();
    const gate = validateActionCall('edit_content', { detail: '250' }, doc);
    expect('error' in gate).toBe(true);
    expect(applyAction(doc, 'edit_content', { detail: '250' })).toBe(doc);
  });
});
