# Persisted Journal — Design Spec

*The desk survives the reload. Every event that shapes the user's material is journaled through
the island stores' own pure reducers, the journal persists to localStorage, and restore is
replay. One mechanism closes blindspot B-1 (durable material evaporates) AND lands the roadmap's
S5 journal substrate — checkpoints, the timeline UI, and failure-recovery (P2) all build on it.*

Date: 2026-07-27
Branch: `honest-mode`
Status: Approved design — ready for implementation planning
Scope: **P1 of the three-blindspot program (persistence → failure-as-state → stacking honesty),
absorbing the master plan's II.4 data side (S5).** Checkpoint/restore (S6), the timeline UI
(Part III), and `turnId` stamping stay out — they consume this substrate later.

---

## 1. Purpose & scope

The material grammar now *sells* durability: pin exists precisely so a response outlives its
rail, artifacts carry revision histories with provenance, and the thesis frames all of it as the
user's material. Yet every store is in-memory. Refresh the page and the desk is empty — rev
histories, provenance, pins, corpus edits, all gone. Artifact persistence was explicitly
out-of-scoped in the combinatory spec (2026-07-16) and never picked back up. Material that does
not outlive a refresh is a false promise.

Separately, the roadmap's S5 phase already designed a session journal: an append-only event log
over the island stores with pure replay (master plan II.4). Building persistence as store
snapshots would create a second, redundant mechanism that S5 would then have to reconcile with.
**The ruling (user, 2026-07-27): persist the journal itself.** Restore-on-load is replay; the
journal S6 and the timeline need is simply already there and already durable.

**In scope:** the pure journal core (`JournalEntry`, `StoreSpec` registry, `append`, `replay`);
localStorage persistence with versioning, fail-soft parsing, and visible failure; journaling of
the material + session-shape stores; replay-on-load; deterministic compaction; a user-only "New
desk" reset; the keystone replay-equals-live test.

**Out of scope (deliberate):** checkpoint/restore and `withRestore` (S6 — mid-session time
travel, with its hint-gate resets and framing hint); the timeline UI (Part III); `turnId`
(requires per-utterance tracking that does not exist yet — inventing it here would be scope
creep; the `JournalEntry` shape leaves room); persistence of conversational state (rail, tray,
grounding, witness cards, teaching) — restoring those for a model that no longer remembers them
would manufacture false shared context; cross-device or server persistence; export/import.

## 2. Architecture

| Module | Responsibility |
|---|---|
| `src/journal/journal.ts` | **New, pure.** `JournalEntry`, `StoreSpec`, `appendEntry`, `replay(entries, registry)`, `compact(entries, registry, cap)`. |
| `src/journal/persistence.ts` | **New.** `loadJournal()` / `saveJournal(entries)` — localStorage, version stamp, fail-soft parse, corruption reported to the caller (never thrown, never silently empty). |
| `src/journal/registry.ts` | **New, pure.** The `StoreSpec` registry for the journaled stores — the single list of what persists. |
| `src/App.tsx` | Journal-wrapped dispatch for the journaled stores; replay-on-load lazy init; save-on-change (debounced); the restore-failure notice; the "New desk" control wiring. |
| `src/shell/DebugDrawer.tsx` (or MenuBar) | The "New desk" control — user-only, explicit, confirm-gated. |

The journal core knows nothing about localStorage; persistence knows nothing about reducers.
The registry is the one place that says what persists.

## 3. Data model

```ts
interface JournalEntry {
  seq: number;                 // monotonically increasing, 1-based
  t: number;                   // wall-clock at append time — provenance, NEVER read by reducers
  store: string;               // registry key, e.g. 'artifacts', 'doc', 'goal', 'dials'
  event: unknown;              // the store's own event type, opaque to the journal
  label?: string;              // human-readable provenance, e.g. 'pinned a3'
}

interface StoreSpec<S, E> {
  initial: () => S;
  reduce: (state: S, event: E) => S;
}

type JournalRegistry = Record<string, StoreSpec<any, any>>;

replay(entries: JournalEntry[], registry: JournalRegistry): Record<string, unknown>
// Folds each entry through its store's reduce. Unknown store keys are SKIPPED (a journal
// written by a newer build may name stores this build lacks — skipping is honest degradation;
// crashing would hold the whole desk hostage to one unknown entry).
```

**Determinism is inherited, not new.** Reducers never read the clock (`at` arrives on events —
the S1-S3 rule), so replay of the same entries always yields the same states. The keystone test
(§9) is the tripwire.

**Rejected events are journaled too.** A stale revise or an at-cap create is appended like any
other event; the reducer no-ops on replay exactly as it did live. This keeps counters honest
(`rejectedAtCap`, `rejectedStale` reconstruct correctly) and the journal a truthful record
rather than a sanitized one.

## 4. What journals — and what does not

**The registry (material + session shape, per the user's ruling):**

| Store key | Source | Event granularity |
|---|---|---|
| `artifacts` | `artifactReduce` | The existing events verbatim: create / close / revise / revertTo. Rev history and provenance reconstruct exactly. |
| `workspace` | `mockDoc` + `corpus` + `activeProgram` useStates | **One store, not three** — its state is `{ corpus, activeProgram }`, with events `{ type: 'doc.set', program, doc }` (post-state snapshot at every existing doc commit point: applyAction commit, revise confirm, direct edit — the master plan blessed this granularity) folding `corpus[program] = doc`, and `{ type: 'program.set', program }` on swap. Unified deliberately: as separate stores, the active doc's latest edits (in `doc.set`) and the corpus (saved only on swaps) can disagree on restore, and without the active program a reload could restore a doc into the wrong program. One state, no disagreement; boot reads `mockDoc = corpus[activeProgram]`. |
| `goal` | `goalReduce` | Existing events verbatim. |
| `dials` | `DialValues` useState + `registerKey` | `{ type: 'dials.set', dials, registerKey }` on change — the desk's configuration is session shape. |

**Not journaled, with the reason on the record:** rail state and the combine tray (conversation
in flight); grounding chips (deixis is momentary); pending witness cards (a confirmation card
for a proposal the model no longer remembers making is a fabricated shared context); teaching
state (sequences are live guidance; the *fade counters* already persist separately and stay
where they are); mission runs and window rects (already persisted by their own mechanisms —
this spec does not migrate them, one honest mechanism per datum).

## 5. Persistence

- **Key:** `ff-journal`. **Format:** `{ v: 1, entries: JournalEntry[] }`.
- **Save:** debounced (~500ms trailing) on journal growth, `try/catch` fail-soft in the
  `missions/persistence.ts` style. A quota failure logs once, visibly, and the app continues —
  in-memory behaviour is never held hostage by storage.
- **Load:** parse defensively. Three outcomes, all explicit: `{ ok: entries }`;
  `{ empty: true }` (first run — silent); `{ failed: reason }` (corrupt JSON, wrong version,
  shape violation). **A failed load is REPORTED**: the app boots the seed desk and shows a
  one-line notice — "Your previous desk couldn't be restored (reason). Starting fresh." — via
  the existing feedback toast + a log entry. Never a silent empty desk: the user had material,
  and its absence must be explained. The unparseable payload is preserved under
  `ff-journal-quarantine` (overwriting the previous quarantine) so a bug report has evidence.
- **Version mismatch is a failed load** (v1 has no migrations). Future versions may migrate;
  v1 quarantines and says so.

## 6. Restore-on-load

Replay runs ONCE, synchronously, before first render — the journaled stores' initial values
come from `replay` (lazy `useState`/`useReducer` initializers reading a module-level
`restoredStates` computed at import/boot time). No flash of seed desk, no post-mount reconcile.

**No model-facing framing is needed, by design.** The standing `[ARTIFACTS]`/`[CORPUS]`/
`[GOAL STATE]` hints derive from current state, and a freshly connected model never had memory
of the prior session — so a restored desk is simply the desk, described by the same hints as
always. This is the honest asymmetry with S6's *mid-session* restore, which must demote the
model's live memory ("trust fresh hints") — that machinery belongs to S6, not here.

**Interaction with `handleReset`:** the existing reset (program-swap-style reset of live state)
does not touch the journal. Only "New desk" (§8) erases persistence.

## 7. Compaction

`doc.set` snapshots accumulate — a long-lived desk would eventually hit localStorage's ~5MB.

- `compact(entries, registry, cap)`: pure. When `entries.length > cap` (default **500**),
  replay the whole journal, then rebuild it as one synthetic snapshot event per store (the
  store's canonical `*.set` / rebuild event) followed by nothing — seq restarts, a
  `label: 'compacted <n> entries'` on each snapshot records that it happened.
- Runs at SAVE time (not load), so the on-disk journal is always within bounds.
- **The trade is stated, not hidden:** compaction discards fine-grained history older than the
  snapshot. Within-session history for S6's checkpoints lives in memory regardless; what
  compaction bounds is *cross-reload* archaeology, which nothing consumes yet. When the
  timeline UI (Part III) wants deeper history, it can raise the cap or add tiering — a
  documented extension point, not a promise.
- **Artifacts compact losslessly by construction:** an artifact's `history` rides inside its
  state snapshot, so rev history survives compaction even though the *events* that built it
  are folded away.

## 8. "New desk" — the only eraser

A user-only control (Control Center / DebugDrawer, beside the existing reset affordances):
**New desk** — clears `ff-journal` (and quarantine), resets the journaled stores to seed, and
says so. Confirm-gated (a destructive, irreversible act on the user's material — the same
witness discipline as everything else). No agent tool maps to it; nothing else deletes the
journal. `artifact.close` discipline, desk-wide.

## 9. Testing

Pure TDD per repo convention; component paths by tsc/build/drive.

- **Keystone: replay-equals-live.** For each registered store, drive its demo/test event stream
  live and via `replay`; the end states must be deeply equal. This is the standing tripwire
  against any future reducer reading `Date.now()` internally.
- `journal.ts`: append monotonic seq; replay folds per-store; unknown store keys skipped
  without error; empty journal yields all initials.
- `compact`: post-compact replay equals pre-compact replay (the definition of correct);
  artifact rev history survives; cap respected; labels present.
- `persistence.ts`: round-trip; corrupt JSON → `{ failed }` + quarantine written; wrong
  version → `{ failed }`; quota-full save fails soft (mock storage throwing).
- `registry.ts`: every registered spec's `initial`/`reduce` are the real store's (identity
  check against the imported reducers — a registry pointing at a copy would fork behaviour).
- **Browser drive (keyless):** build a desk (pin, combine via demo, edit a doc, twiddle a
  dial), reload — everything back, rev chips intact, provenance intact, dials held; corrupt
  `ff-journal` by hand, reload — visible "couldn't be restored" notice + seed desk +
  quarantine present; New desk → confirm → empty desk, journal gone; mutation probe still
  settles.

## 10. Risks

| Risk | Mitigation |
|---|---|
| A reducer someday reads the clock and replay diverges | Keystone test fails the suite the day it happens |
| Corrupt journal bricks the boot | Fail-soft parse, visible notice, quarantine, seed desk |
| Quota exhaustion | Debounced saves, compaction cap, fail-soft write with one visible log |
| Two tabs racing on one key | Out of scope for v1 and stated: last-writer-wins, matching every existing localStorage use in this repo (missions, theme, windowRect) |
| Restored desk confuses the model | Nothing to mitigate — hints derive from state; the model never had the old session's memory |
| Registry drifts from the real reducers | Identity-check test (§9) |
