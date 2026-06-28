import type { MockDoc } from '../scenarios';

export type CellData = { ref: string; value: string; isCurrency: boolean };

export type SpreadsheetSnapshot = {
  cells: CellData[];
  chart: boolean;
  saved: boolean;
  selection: string | null;
};

/** Structured data-layer view of the live spreadsheet (non-empty cells only, sorted). */
export function buildSpreadsheetSnapshot(doc: MockDoc, selection: string | null = null): SpreadsheetSnapshot {
  if (doc.kind !== 'excel') {
    return { cells: [], chart: false, saved: false, selection: null };
  }
  const cells: CellData[] = Object.entries(doc.cells)
    .filter(([, v]) => v !== '' && v != null)
    .map(([ref, value]) => ({ ref, value, isCurrency: doc.currency.includes(ref) }))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  return { cells, chart: doc.chart, saved: doc.saved, selection };
}

/** Render the snapshot as a structured text hint for the model (sent alongside the pixels). */
export function formatSnapshotForModel(s: SpreadsheetSnapshot): string {
  if (s.cells.length === 0) return '[SPREADSHEET DATA: empty sheet]';
  const cellStr = s.cells
    .map((c) => `${c.ref}=${c.isCurrency && c.value ? '$' + c.value : c.value}`)
    .join(' ');
  const sel = s.selection ? ` selected:${s.selection}` : '';
  return `[SPREADSHEET DATA: ${cellStr} chart:${s.chart ? 'yes' : 'no'} saved:${s.saved ? 'yes' : 'no'}${sel}. This is the live cell data; the SPREADSHEET image shows its pixels. DO NOT acknowledge this message.]`;
}
