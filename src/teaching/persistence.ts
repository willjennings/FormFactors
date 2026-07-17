const KEY = 'ff-teach-competence';

export function serializeCompetence(c: Record<string, number>): string {
  return JSON.stringify(c);
}

/** Fail-soft: anything malformed yields an empty record (fresh scaffold, never a crash). */
export function parseCompetence(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    return out;
  } catch { return {}; }
}

export function loadCompetence(): Record<string, number> {
  try { return parseCompetence(sessionStorage.getItem(KEY)); } catch { return {}; }
}
export function saveCompetence(c: Record<string, number>): void {
  try { sessionStorage.setItem(KEY, serializeCompetence(c)); } catch { /* fail-soft */ }
}
