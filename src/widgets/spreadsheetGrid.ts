import type { MockDoc } from '../scenarios';

export type GridCell = { ref: string; display: string; isCurrency: boolean; selected: boolean };
export type GridModel = { columns: string[]; rows: number[]; cells: GridCell[][] };

const COLUMNS = ['A', 'B', 'C', 'D'];
const ROWS = [1, 2, 3, 4, 5, 6];

/** Build the visual grid for the Spreadsheet component from the live doc. */
export function buildGridModel(doc: MockDoc, selection: string | null = null): GridModel {
  const cellMap = doc.kind === 'excel' ? doc.cells : {};
  const currency = doc.kind === 'excel' ? doc.currency : [];
  const cells = ROWS.map((row) =>
    COLUMNS.map((col) => {
      const ref = `${col}${row}`;
      const raw = cellMap[ref] ?? '';
      const isCurrency = currency.includes(ref);
      const display = raw && isCurrency ? `$${raw}` : raw;
      return { ref, display, isCurrency, selected: selection === ref };
    }),
  );
  return { columns: COLUMNS, rows: ROWS, cells };
}
