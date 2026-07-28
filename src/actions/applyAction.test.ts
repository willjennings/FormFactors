import { describe, it, expect } from 'vitest';
import { applyAction } from '../scenarios';
import { seedCorpus } from '../artifacts/seeds';

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
