import { describe, it, expect } from 'vitest';
import { buildSpreadsheetSnapshot, formatSnapshotForModel } from './spreadsheetData';
import type { MockDoc } from '../scenarios';

const excel = (over: Partial<Extract<MockDoc, { kind: 'excel' }>> = {}): MockDoc => ({
  kind: 'excel', cells: { A1: '10', A2: '20', A3: '30' }, currency: [], chart: false, saved: false, ...over,
});

describe('buildSpreadsheetSnapshot', () => {
  it('keeps only non-empty cells, sorted by ref, flags currency', () => {
    const snap = buildSpreadsheetSnapshot(excel({ cells: { B1: '', A1: '10', A2: '5' }, currency: ['A2'] }), 'A1');
    expect(snap.cells).toEqual([
      { ref: 'A1', value: '10', isCurrency: false },
      { ref: 'A2', value: '5', isCurrency: true },
    ]);
    expect(snap.selection).toBe('A1');
  });

  it('returns an empty snapshot for non-excel docs', () => {
    const snap = buildSpreadsheetSnapshot({ kind: 'word', text: 'hi', bold: false, saved: false } as MockDoc);
    expect(snap.cells).toEqual([]);
    expect(snap.selection).toBeNull();
  });
});

describe('formatSnapshotForModel', () => {
  it('renders currency cells with a $ and includes chart/saved/selection', () => {
    const out = formatSnapshotForModel({
      cells: [{ ref: 'A1', value: '50', isCurrency: true }], chart: true, saved: false, selection: 'A1',
    });
    expect(out).toContain('A1=$50');
    expect(out).toContain('chart:yes');
    expect(out).toContain('saved:no');
    expect(out).toContain('selected:A1');
    expect(out).toContain('DO NOT acknowledge');
  });

  it('reports an empty sheet', () => {
    expect(formatSnapshotForModel({ cells: [], chart: false, saved: false, selection: null }))
      .toBe('[SPREADSHEET DATA: empty sheet]');
  });
});
