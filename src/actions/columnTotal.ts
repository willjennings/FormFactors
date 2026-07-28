// Unit-aware column arithmetic (spec §5). A total is only honest if it knows WHICH cells it came
// from and refuses when the units don't agree — $4.2M + 18% is a number nobody should be shown.
export interface ParsedCell { n: number; unit: string }   // unit: '' | '$' | '%'

export const COLUMN_ROWS = [1, 2, 3, 4, 5, 6];            // mirrors ROWS in widgets/spreadsheetGrid

const MAGNITUDES: [string, number][] = [['B', 1e9], ['M', 1e6], ['K', 1e3]];

/** Parse what a spreadsheet plausibly holds; null for anything else (headers, prose, blanks). */
export function parseCellValue(raw: string): ParsedCell | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = /^(-?)(\$?)(\d+(?:\.\d+)?)([KMB]?)(%?)$/.exec(s);
  if (!m) return null;
  const [, sign, dollar, digits, mag, pct] = m;
  if (dollar && pct) return null;                          // "$5%" is not a thing
  const factor = MAGNITUDES.find(([k]) => k === mag)?.[1] ?? 1;
  const n = Number(`${sign}${digits}`) * factor;
  if (!Number.isFinite(n)) return null;
  return { n, unit: dollar ? '$' : pct ? '%' : '' };
}

/** The inverse: render back into the column's own idiom, so a total looks like its column. */
export function formatTotal(value: number, unit: string): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  let body = String(Number(abs.toFixed(2)));
  if (unit === '$') {
    for (const [suffix, factor] of MAGNITUDES) {
      if (abs >= factor) { body = `${Number((abs / factor).toFixed(2))}${suffix}`; break; }
    }
    return `${sign}$${body}`;
  }
  return unit === '%' ? `${sign}${body}%` : `${sign}${body}`;
}

export type TotalResult =
  | { value: number; unit: string; usedRefs: string[] }
  | { error: string };

const list = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function totalColumn(
  cells: Record<string, string>, column: string, mode: 'sum' | 'average',
): TotalResult {
  const col = column.toUpperCase();
  const parsed: { ref: string; p: ParsedCell }[] = [];
  const skipped: string[] = [];
  for (const row of COLUMN_ROWS) {
    const ref = `${col}${row}`;
    const raw = (cells[ref] ?? '').trim();
    if (!raw) continue;
    const p = parseCellValue(raw);
    if (p) parsed.push({ ref, p }); else skipped.push(raw);
  }
  if (!parsed.length) {
    // Name what IS there — a refusal that describes the obstacle is actionable; "can't" is not.
    return { error: skipped.length
      ? `Column ${col} has no numbers to total — it holds ${list(skipped)}.`
      : `Column ${col} has no numbers to total — it is empty.` };
  }
  const units = Array.from(new Set(parsed.map((x) => x.p.unit)));
  if (units.length > 1) {
    const groups = units.map((u) => {
      const vals = parsed.filter((x) => x.p.unit === u).map((x) => cells[x.ref].trim());
      const name = u === '$' ? 'currency' : u === '%' ? 'percent' : 'plain numbers';
      return `${name} (${list(vals)})`;
    });
    return { error: `Column ${col} mixes ${list(groups)} — totalling them would be meaningless. Which cells did you mean?` };
  }
  const nums = parsed.map((x) => x.p.n);
  const total = nums.reduce((a, b) => a + b, 0);
  return {
    value: mode === 'average' ? total / nums.length : total,
    unit: units[0],
    usedRefs: parsed.map((x) => x.ref),
  };
}
