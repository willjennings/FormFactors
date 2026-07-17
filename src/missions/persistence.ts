// Per-mission completed-run counts → localStorage (spec §5: fade survives sessions).
// Fail-soft parsing mirrors src/teaching/persistence.ts.
const KEY = 'ff-mission-runs';

export function parseRuns(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch { return {}; }
}
export function loadRuns(): Record<string, number> {
  try { return parseRuns(localStorage.getItem(KEY)); } catch { return {}; }
}
export function saveRuns(r: Record<string, number>): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* fail-soft */ }
}
