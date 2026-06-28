import { describe, it, expect } from 'vitest';
import { buildGridModel } from './spreadsheetGrid';
import type { MockDoc } from '../scenarios';

const excel = (over = {}): MockDoc => ({
  kind: 'excel', cells: { A1: '10', A2: '20', A3: '30' }, currency: [], chart: false, saved: false, ...over,
}) as MockDoc;

describe('buildGridModel', () => {
  it('produces a 6-row x 4-col grid (A-D, 1-6)', () => {
    const m = buildGridModel(excel());
    expect(m.columns).toEqual(['A', 'B', 'C', 'D']);
    expect(m.rows).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.cells).toHaveLength(6);
    expect(m.cells[0]).toHaveLength(4);
  });

  it('fills known cells, blanks the rest, and prefixes $ for currency cells', () => {
    const m = buildGridModel(excel({ cells: { A1: '50' }, currency: ['A1'] }), 'A1');
    expect(m.cells[0][0]).toEqual({ ref: 'A1', display: '$50', isCurrency: true, selected: true });
    expect(m.cells[0][1]).toEqual({ ref: 'B1', display: '', isCurrency: false, selected: false });
  });

  it('renders an empty grid for non-excel docs', () => {
    const m = buildGridModel({ kind: 'word', text: 'x', bold: false, saved: false } as MockDoc);
    expect(m.cells[0][0].display).toBe('');
  });
});
