// One-shot boot restore (spec §6): load → replay BEFORE first render, memoized so StrictMode's
// double-invoke and multiple lazy initializers all read the same result. No model-facing
// framing is needed: the standing hints derive from state, and a freshly connected model never
// had the prior session's memory — a restored desk is simply the desk.
import { replay, type JournalEntry } from './journal';
import { JOURNAL_REGISTRY } from './registry';
import { loadJournal } from './persistence';

export interface BootResult {
  entries: JournalEntry[];                      // the journal to keep appending to
  states: Record<string, unknown> | null;       // null = nothing restored (fresh or failed)
  failure: string | null;                       // non-null = MUST be shown to the user
}

let memo: BootResult | null = null;
export function bootJournal(): BootResult {
  if (memo) return memo;
  const r = loadJournal();
  if ('ok' in r) memo = { entries: r.ok, states: replay(r.ok, JOURNAL_REGISTRY), failure: null };
  else if ('failed' in r) memo = { entries: [], states: null, failure: r.failed };
  else memo = { entries: [], states: null, failure: null };
  return memo;
}
/** Test/reset hook: forget the memo (New desk uses this after clearing storage). */
export function resetBootMemo(): void { memo = null; }
