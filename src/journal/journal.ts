// The session journal (spec §3): an append-only event log over the island stores, folded
// through each store's OWN pure reducer. Determinism is inherited, not new — reducers never
// read the clock (the S1-S3 rule), so replay of the same entries always yields the same
// states. `t` is provenance for humans; no reducer may ever read it.
export interface JournalEntry {
  seq: number;                 // monotonically increasing, 1-based
  t: number;                   // wall-clock at APPEND time — never read by reducers
  store: string;               // registry key
  event: unknown;              // the store's own event type, opaque to the journal
  label?: string;              // human-readable provenance, e.g. 'pinned a3'
}

export interface StoreSpec<S, E> {
  initial: () => S;
  reduce: (state: S, event: E) => S;
  /** One event that reconstructs this exact state from initial — compaction's raw material.
   *  Journal-only: no tool maps to restore events, same discipline as artifact.close. */
  snapshotEvent: (state: S) => E;
}

export type JournalRegistry = Record<string, StoreSpec<any, any>>;

export function appendEntry(
  entries: JournalEntry[], store: string, event: unknown, t: number, label?: string,
): JournalEntry[] {
  return [...entries, { seq: entries.length + 1, t, store, event, ...(label ? { label } : {}) }];
}

/** Fold every entry through its store's reducer. Unknown store keys are SKIPPED: a journal
 *  written by a newer build may name stores this build lacks — skipping is honest degradation,
 *  crashing would hold the whole desk hostage to one unknown entry. */
export function replay(entries: JournalEntry[], registry: JournalRegistry): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const key of Object.keys(registry)) states[key] = registry[key].initial();
  for (const e of entries) {
    const spec = registry[e.store];
    if (!spec) continue;
    states[e.store] = spec.reduce(states[e.store], e.event);
  }
  return states;
}
