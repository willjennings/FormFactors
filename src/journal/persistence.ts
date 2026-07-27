// Journal <-> localStorage (spec §5). Fail-soft in the missions/persistence.ts style, with one
// difference the spec demands: a failed LOAD is not silent. The caller receives the reason and
// must show it — the user HAD material, and its absence must be explained. The unparseable
// payload is preserved under a quarantine key so a bug report has evidence.
import type { JournalEntry } from './journal';

export const JOURNAL_KEY = 'ff-journal';
export const QUARANTINE_KEY = 'ff-journal-quarantine';
export const JOURNAL_VERSION = 1;
export const JOURNAL_CAP = 500;                    // compaction threshold (spec §7)

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const defaultStorage = (): StorageLike | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export type LoadResult = { ok: JournalEntry[] } | { empty: true } | { failed: string };

function isEntry(x: unknown): x is JournalEntry {
  const e = x as JournalEntry;
  return !!e && typeof e === 'object'
    && typeof e.seq === 'number' && typeof e.t === 'number' && typeof e.store === 'string'
    && 'event' in e;
}

export function loadJournal(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { empty: true };            // no storage at all = nothing to restore
  let raw: string | null = null;
  try { raw = storage.getItem(JOURNAL_KEY); } catch { return { empty: true }; }
  if (raw === null) return { empty: true };
  const fail = (reason: string): LoadResult => {
    // Quarantine BEFORE clearing: the evidence outlives the failure (spec §5). Overwrites the
    // previous quarantine — one incident of evidence is the contract.
    try { storage.setItem(QUARANTINE_KEY, raw!); storage.removeItem(JOURNAL_KEY); } catch { /* fail-soft */ }
    return { failed: reason };
  };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fail('not an object');
    if (parsed.v !== JOURNAL_VERSION) return fail(`unsupported version ${String(parsed.v)}`);
    if (!Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) return fail('malformed entries');
    return { ok: parsed.entries };
  } catch {
    return fail('corrupt JSON');
  }
}

export function saveJournal(entries: JournalEntry[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify({ v: JOURNAL_VERSION, entries }));
    return true;
  } catch { return false; }                        // quota etc. — in-memory life goes on
}

export function clearJournal(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(JOURNAL_KEY); storage?.removeItem(QUARANTINE_KEY); } catch { /* fail-soft */ }
}
