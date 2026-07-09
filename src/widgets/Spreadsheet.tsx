import React, { forwardRef } from 'react';
import type { MockDoc } from '../scenarios';
import { buildGridModel } from './spreadsheetGrid';

type Props = {
  doc: MockDoc;
  selection?: string | null;
  /** Full entity id for a cell ref, e.g. (ref) => `excel-cell-${ref}`. Stamps data-entity-id. */
  entityIdFor?: (ref: string) => string;
  onCellClick?: (ref: string) => void;
};

/** A real DOM spreadsheet grid bound to MockDoc.excel — the node the vision pipeline snapshots. */
export const Spreadsheet = forwardRef<HTMLDivElement, Props>(({ doc, selection = null, entityIdFor, onCellClick }, ref) => {
  const model = buildGridModel(doc, selection);
  return (
    <div
      ref={ref}
      className="spreadsheet-box w-full h-full bg-white text-slate-900 overflow-auto select-none"
      data-widget="spreadsheet"
    >
      <table className="border-collapse w-full text-sm font-mono">
        <thead>
          <tr>
            <th className="w-10 bg-slate-100 border border-slate-300"></th>
            {model.columns.map((col) => (
              <th key={col} className="bg-slate-100 border border-slate-300 px-3 py-1 text-slate-600 font-semibold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row, r) => (
            <tr key={row}>
              <th className="bg-slate-100 border border-slate-300 px-2 py-1 text-slate-600 font-semibold">{row}</th>
              {model.cells[r].map((cell) => (
                <td
                  key={cell.ref}
                  data-cell={cell.ref}
                  data-entity-id={entityIdFor?.(cell.ref)}
                  onClick={onCellClick ? (e) => { e.stopPropagation(); onCellClick(cell.ref); } : undefined}
                  className={`border border-slate-300 px-3 py-1 text-right ${
                    cell.selected ? 'bg-blue-100 outline outline-2 outline-blue-500' : ''
                  }`}
                >
                  {cell.display}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
Spreadsheet.displayName = 'Spreadsheet';
