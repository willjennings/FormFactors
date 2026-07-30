/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The ONE place `scripts/battery/*.mjs` reaches into `src/eval` and `src/register`/`src/shell`
// TypeScript. Not one of the three files the task-9 brief names (`run.mjs`, `utterances.mjs`,
// `summarize.mjs`) — it exists because two of those three need REAL TS values (the shared
// `UTTERANCES` array; `deriveAttempts`/`armAggregate`/`capabilityLedger`/`winsWhen`) and `run.mjs`
// is launched with plain `node` (the gate command is literally `node scripts/battery/run.mjs
// --dry` — no loader, no `tsx` prefix), so it cannot `import` a `.ts` module directly. Rather than
// duplicate `UTTERANCES` or reimplement grading math in `.mjs` (which is exactly the drift the
// task brief's "same trials by construction" / "no parallel math" rules exist to forbid), this
// file is invoked as a CHILD PROCESS via `npx tsx` (decision 6: tsx is already a devDependency,
// confirmed working — no new dependency), and talks to its `.mjs` callers over stdout JSON only.
// No network, no browser, no side effects beyond reading the export files it's pointed at.
//
// Usage:
//   npx tsx scripts/battery/ts-bridge.ts utterances
//     -> prints `UTTERANCES` (src/eval/utterances.ts) as JSON.
//   npx tsx scripts/battery/ts-bridge.ts grade <manifestPath>
//     -> reads the manifest run.mjs wrote (one entry per export file + the cell it was driven
//        under), grades every cell with the SAME derivation every other consumer in this repo
//        uses, and prints the result as JSON (see `GradeOutput` below).

import { readFileSync } from 'node:fs';
import { UTTERANCES } from '../../src/eval/utterances';
// NEW-2 (settle-detector re-review, 2026-07-30): the marker text run.mjs's dry-mode self-test
// utterance uses (`runDrySelfTest`/`injectDrySettleReply`) — imported, not duplicated, from the
// one shared module both ends of this contract read (`selfTestMarker.mjs`'s own doc). `grade`
// below filters any `turn` event carrying this exact `request` out of what it hands to
// `deriveAttempts`/`buildLatency`/the ledger: the self-test is harness-health data (did the
// settle-detector's own wiring work?), never corpus data, and must not be gradeable as either.
import { DRY_SELF_TEST_REQUEST } from './selfTestMarker.mjs';
import { deriveAttempts } from '../../src/eval/deriveAttempts';
import { armAggregate, UNDERPOWERED_N } from '../../src/eval/armAggregate';
import type { ArmAggregate } from '../../src/eval/armAggregate';
import { capabilityLedger } from '../../src/eval/capabilityLedger';
import type { LedgerRow } from '../../src/eval/capabilityLedger';
import type { Attempt } from '../../src/eval/types';
// C3/I4 (task-9 review round 1): both imported from scorecard.ts, not reimplemented — see each
// function's own EXPORTED comment there for exactly why duplicating them here was the drift the
// review caught. `buildComparison` needs a full `Arm` (register/shell/dials), so `DEFAULT_DIALS`
// comes along too — `dials` is never actually READ by `buildComparison` (only `.register`/`.shell`
// are), so this is a type-shape placeholder, not a claim about what dials this cell ran under.
import { buildComparison, scopeToArm, buildLatency } from '../../src/eval/scorecard';
import { DEFAULT_DIALS } from '../../src/register/registry';
import type { Arm, TelemetryEvent } from '../../src/telemetry';
import type { SkinKey } from '../../src/shell/skins/types';

interface ManifestEntry {
  file: string;                 // absolute or manifest-relative path to one export JSON
  register: string;
  shell: string;
  backend: string;
  corpus: 'default' | 'wide';
}
interface Manifest {
  mode: 'dry' | 'live';
  createdAt: string;
  // N2 (task-9 review round 2, Important): optional so a round-1-shaped manifest (no abort fields
  // at all) still parses — `aborted`/`abortReason`/`plannedSessions` are absent entirely on those,
  // not `false`/`null`/undefined. `aborted` un-set is read honestly (see `grade`'s own handling
  // below: treated as `false`, which is TRUE for every manifest round-1's code could have written
  // — it never had a concept of an abort marker to omit).
  //
  // P6 (task-9 review round 3, corrected — this comment previously claimed `plannedSessions`'s
  // fallback was equally honest; it is not): `grade`'s `manifest.plannedSessions ?? entries.length`
  // MANUFACTURES a value for an old manifest lacking the field — it renders as "N of N planned"
  // (a completeness claim) rather than "unknown planned count". Left as a documented, harmless gap
  // rather than widened into a real tri-state (present / absent-but-inferrable / genuinely
  // unknown): no round-1-shaped manifest survives anywhere in this repo (`scripts/battery/out/` is
  // gitignored, and `run.mjs` has written this field unconditionally since round 2), so the
  // fallback is dead code on every manifest this codebase can actually produce today — this note
  // exists so a future reader does not mistake the fallback for a considered "unknown" case.
  aborted?: boolean;
  abortReason?: string | null;
  plannedSessions?: number;
  entries: ManifestEntry[];
}

// C3 (task-9 review round 1): spec §1, binding — "exclude the first turn of each session from the
// arm's latency aggregate and report it separately as a cold-start figure — never average the two,
// and never silently drop it." `scopeToArm`/`buildLatency` (imported above) already implement this
// exactly; `Latency` below is that shared shape, not a battery-specific reinvention.
type Latency = ReturnType<typeof buildLatency>;

interface CellSummary {
  register: string;
  shell: string;
  backend: string;
  corpus: 'default' | 'wide';
  runs: number;                 // how many export files fed this cell
  agg: ArmAggregate;
  comparison: string;           // scorecard.ts's real `buildComparison` — imported, not reimplemented
  latency: Latency;             // scorecard.ts's real `scopeToArm` + `buildLatency` — cold turns split out
}

export interface GradeOutput {
  mode: 'dry' | 'live';
  totalAttempts: number;
  totalRuns: number;
  underpoweredN: number;        // armAggregate.ts's UNDERPOWERED_N, threaded through so
                                 // summarize.mjs never hardcodes the threshold it prints (M1)
  // N2 (task-9 review round 2, Important): a run that hit MAX_CONSECUTIVE_FAILURES still writes
  // its manifest (I2, round 1) but the manifest's SHAPE didn't say so — a healthy 2-cell run and
  // an aborted 12-planned/2-completed run looked identical past this point. `summarize.mjs` needs
  // these three to render an explicit banner naming what happened, not just avoid losing the data.
  aborted: boolean;
  abortReason: string | null;
  plannedSessions: number;
  cells: CellSummary[];
  ledgerTop: LedgerRow[];       // top 10, UNIONED across every run in the manifest (spec §2)
}

function cellKey(e: { register: string; shell: string; backend: string; corpus: string }): string {
  return `${e.register}|${e.shell}|${e.backend}|${e.corpus}`;
}

/** The `Arm` `buildComparison`/`scopeToArm` need — register/shell only ever get READ by either
 *  function (confirmed by reading both in scorecard.ts); `dials` is structurally required by the
 *  `Arm` interface but never inspected, so `DEFAULT_DIALS` here is a type-shape placeholder, not a
 *  claim about what dials this cell actually ran under (the real per-session dials ARE in every
 *  export's own `config.arm.dials` — this function just never needs to read them). */
function armFor(register: string, shell: string): Arm {
  return { register, shell: shell as SkinKey, dials: DEFAULT_DIALS };
}

function grade(manifestPath: string): GradeOutput {
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Group export files by cell (arm x backend x corpus — spec §2's "a cell = arm x backend";
  // corpus folded in too, since a wide-corpus run and a default-corpus run of the identical arm
  // are explicitly NOT the same trial — spec §3's whole point is that a rate holding on one and
  // not the other is itself the finding).
  const byCell = new Map<string, ManifestEntry[]>();
  for (const e of manifest.entries) {
    const k = cellKey(e);
    const arr = byCell.get(k) ?? [];
    arr.push(e);
    byCell.set(k, arr);
  }

  // Pass 1: derive attempts + raw events per cell. Each export file's own `events` array is
  // already ONE flattened sitting (telemetry.ts's `eventsSnapshot`, folding any `priorRuns` this
  // particular browser session accumulated); concatenating several export files' `events` end to
  // end and running `deriveAttempts` ONCE over the join is exactly how `deriveAttempts` already
  // expects to see a multi-run sitting (every run begins with its own `session_start`, which is
  // the boundary it keys on) — no different than App.tsx's own recorder archiving several runs
  // into one stream.
  const perCellAttempts = new Map<string, Attempt[]>();
  const perCellEvents = new Map<string, TelemetryEvent[]>();
  let totalRuns = 0;
  for (const [key, entries] of byCell) {
    const events: TelemetryEvent[] = [];
    for (const e of entries) {
      const exported = JSON.parse(readFileSync(e.file, 'utf8'));
      // NEW-2 (settle-detector re-review, 2026-07-30): drop the dry-mode settle-detector's own
      // self-test turn (run.mjs's `runDrySelfTest`) BEFORE it ever reaches `deriveAttempts` /
      // `buildLatency` / the ledger — filtered here, at collection, so every downstream consumer
      // (attempts, latency's cold-start column, the capability ledger) sees exactly the same
      // corpus a session with NO settle-detector self-test would have produced. A no-op on any
      // live manifest (nothing there ever carries this marker `request`) and on a manifest written
      // before the self-test existed at all.
      const filtered = (exported.events as TelemetryEvent[])
        .filter((ev) => !(ev.type === 'turn' && ev.request === DRY_SELF_TEST_REQUEST));
      events.push(...filtered);
      totalRuns += 1;
    }
    perCellEvents.set(key, events);
    perCellAttempts.set(key, deriveAttempts(events));
  }

  // Pass 2: build each cell's ArmAggregate + comparison, using Guided's cell (same shell/backend/
  // corpus) as control when one exists in this manifest.
  const cells: CellSummary[] = [];
  let totalAttempts = 0;
  const allEvents: TelemetryEvent[] = [];
  const allAttempts: Attempt[] = [];
  for (const [key, entries] of byCell) {
    const first = entries[0];
    const attempts = perCellAttempts.get(key)!;
    const events = perCellEvents.get(key)!;
    allEvents.push(...events);
    allAttempts.push(...attempts);
    totalAttempts += attempts.length;
    const agg = armAggregate(attempts);
    const controlKey = cellKey({ register: 'guided', shell: first.shell, backend: first.backend, corpus: first.corpus });
    const controlAttempts = controlKey === key ? undefined : perCellAttempts.get(controlKey);
    const control = controlAttempts ? armAggregate(controlAttempts) : undefined;
    const arm = armFor(first.register, first.shell);
    // C3: every session in `events` was booted under THIS cell's own fixed register/shell (no
    // shell switches happen in a battery-driven session), so scoping the cell's own event pool to
    // its own arm is no-op filtering in practice — but running it through the SHARED function
    // rather than skipping the scope step is what keeps this identical to the app's own path if a
    // future battery ever DOES vary shell mid-session.
    const latency = buildLatency(scopeToArm(events, arm));
    cells.push({
      register: first.register, shell: first.shell, backend: first.backend, corpus: first.corpus,
      runs: entries.length, agg, comparison: buildComparison(agg, arm, control), latency,
    });
  }
  cells.sort((a, b) => (a.register + a.shell + a.corpus).localeCompare(b.register + b.shell + b.corpus));

  // The ledger is UNIONED across every run in the manifest (spec §2, verbatim) — not per-cell —
  // same discipline as `telemetry.ts`'s own whole-sitting `ledger` field (deliberately not arm-
  // scoped there either; a capability failure is worth recording regardless of which cell produced
  // it). Top 10 by n, `capabilityLedger`'s own sort.
  const ledgerTop = capabilityLedger(allEvents, allAttempts).slice(0, 10);

  return {
    mode: manifest.mode, totalAttempts, totalRuns, underpoweredN: UNDERPOWERED_N,
    aborted: !!manifest.aborted, abortReason: manifest.abortReason ?? null,
    plannedSessions: manifest.plannedSessions ?? manifest.entries.length,
    cells, ledgerTop,
  };
}

function main() {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'utterances') {
    process.stdout.write(JSON.stringify(UTTERANCES));
    return;
  }
  if (cmd === 'grade') {
    if (!arg) throw new Error('ts-bridge.ts grade <manifestPath>: manifest path required');
    process.stdout.write(JSON.stringify(grade(arg)));
    return;
  }
  throw new Error(`ts-bridge.ts: unknown command "${cmd}" — expected "utterances" or "grade <manifestPath>"`);
}

main();
