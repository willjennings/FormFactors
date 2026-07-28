import { describe, it, expect } from 'vitest';
import { parseCellValue, formatTotal, totalColumn } from './columnTotal';
import { seedCorpus } from '../artifacts/seeds';

const excelCells = () => (seedCorpus().excel as { kind: 'excel'; cells: Record<string, string> }).cells;

describe('parseCellValue', () => {
  it('reads bare numbers', () => {
    expect(parseCellValue('42')).toEqual({ n: 42, unit: '' });
    expect(parseCellValue('-3.5')).toEqual({ n: -3.5, unit: '' });
  });
  it('reads currency, expanding magnitude suffixes', () => {
    expect(parseCellValue('$4.2M')).toEqual({ n: 4_200_000, unit: '$' });
    expect(parseCellValue('$900K')).toEqual({ n: 900_000, unit: '$' });
    expect(parseCellValue('$1.2B')).toEqual({ n: 1_200_000_000, unit: '$' });
    expect(parseCellValue('$500')).toEqual({ n: 500, unit: '$' });
  });
  it('reads percent', () => {
    expect(parseCellValue('18%')).toEqual({ n: 18, unit: '%' });
  });
  it('returns null for everything the REAL corpus actually holds that is not a number', () => {
    for (const raw of ['Metric', 'Q3', 'Riverside Tower', '2 wks behind', '', '   ']) {
      expect(parseCellValue(raw)).toBeNull();
    }
  });
});

describe('formatTotal', () => {
  it('round-trips the numeric values the shipped corpus contains (currently 3)', () => {
    for (const raw of Object.values(excelCells())) {
      const p = parseCellValue(raw);
      if (p) expect(formatTotal(p.n, p.unit)).toBe(raw);
    }
  });
  it('re-applies the largest magnitude that leaves a value >= 1', () => {
    expect(formatTotal(7_600_000, '$')).toBe('$7.6M');
    expect(formatTotal(900, '$')).toBe('$900');
    expect(formatTotal(18, '%')).toBe('18%');
    expect(formatTotal(60, '')).toBe('60');
  });
  it('trims trailing zeros', () => {
    expect(formatTotal(7_000_000, '$')).toBe('$7M');
    expect(formatTotal(2.5, '')).toBe('2.5');
  });
  it('round-trips shapes the corpus does not contain', () => {
    for (const raw of ['$900K', '$1.2B', '$500', '42', '-3.5', '0', '18%', '$7.6M']) {
      const p = parseCellValue(raw);
      expect(p, `${raw} should parse`).not.toBeNull();
      expect(formatTotal(p!.n, p!.unit)).toBe(raw);
    }
  });
});

describe('totalColumn', () => {
  const clean = { B1: 'Widgets', B2: '10', B3: '20', B4: '30' };

  it('sums a clean column, skipping the text header', () => {
    expect(totalColumn(clean, 'B', 'sum')).toEqual({ value: 60, unit: '', usedRefs: ['B2', 'B3', 'B4'] });
  });
  it('averages a clean column', () => {
    expect(totalColumn(clean, 'B', 'average')).toEqual({ value: 20, unit: '', usedRefs: ['B2', 'B3', 'B4'] });
  });

  it('column A of the REAL seed corpus has no numbers — and the error says what IS there', () => {
    const r = totalColumn(excelCells(), 'A', 'sum') as { error: string };
    expect(r.error).toContain('no numbers');
    for (const label of ['Metric', 'Revenue', 'Costs', 'Margin']) expect(r.error).toContain(label);
  });

  it('column B of the REAL seed corpus mixes units — and the error names both groups', () => {
    // This is the exact column the user pointed at. $4.2M + $3.4M + 18% is meaningless.
    const r = totalColumn(excelCells(), 'B', 'sum') as { error: string };
    expect(r.error).toContain('$4.2M');
    expect(r.error).toContain('18%');
  });

  it('preserves magnitude across a real currency sum', () => {
    const r = totalColumn({ B2: '$4.2M', B3: '$3.4M' }, 'B', 'sum') as { value: number; unit: string };
    expect(formatTotal(r.value, r.unit)).toBe('$7.6M');
  });

  it('an empty column reports having nothing, not a zero total', () => {
    const r = totalColumn({}, 'C', 'sum') as { error: string };
    expect(r.error).toContain('no numbers');
  });
});
