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
import { deriveAttempts } from '../../src/eval/deriveAttempts';
import { armAggregate } from '../../src/eval/armAggregate';
import type { ArmAggregate } from '../../src/eval/armAggregate';
import { capabilityLedger } from '../../src/eval/capabilityLedger';
import type { LedgerRow } from '../../src/eval/capabilityLedger';
import type { Attempt } from '../../src/eval/types';
import { REGISTERS } from '../../src/register/registry';
import { SHELL_SKINS } from '../../src/shell/skins/registry';
import type { TelemetryEvent } from '../../src/telemetry';

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
  entries: ManifestEntry[];
}

interface CellSummary {
  register: string;
  shell: string;
  backend: string;
  corpus: 'default' | 'wide';
  runs: number;                 // how many export files fed this cell
  agg: ArmAggregate;
  comparison: string;           // same shape as scorecard.ts's buildComparison, computed here
                                 // rather than imported: that function is not exported (it is
                                 // scorecard.ts's own internal helper, deliberately private —
                                 // duplicating its ~15 lines here is smaller and safer than
                                 // widening that module's public surface for a one-off script).
}

export interface GradeOutput {
  mode: 'dry' | 'live';
  totalAttempts: number;
  totalRuns: number;
  cells: CellSummary[];
  ledgerTop: LedgerRow[];       // top 10, UNIONED across every run in the manifest (spec §2)
}

function cellKey(e: { register: string; shell: string; backend: string; corpus: string }): string {
  return `${e.register}|${e.shell}|${e.backend}|${e.corpus}`;
}

/** Mirrors scorecard.ts's private `buildComparison` (not exported — see `CellSummary.comparison`'s
 *  own comment): runs the register's and/or shell's pre-registered `winsWhen` against `control`,
 *  joining `label — verdict: because` pieces exactly like the app's own scorecard does, so a human
 *  reading this doc and the app's Scorecard view see the identical sentence shape for the identical
 *  arm. `winsWhen`'s own signature is `(ArmAggregate, ArmAggregate) => ProbeVerdict` — no `Arm`
 *  object is needed, just the register/shell KEYS to look up which def's predicate to run, so this
 *  takes those two strings directly rather than fabricating a full `Arm` (which would need a
 *  `dials: DialValues` this script has no honest value for). Guided is the fixed control and
 *  carries no `winsWhen` (register/registry.ts's own header); a cell with no control cell in THIS
 *  manifest reports that honestly rather than guessing one. */
function buildComparison(agg: ArmAggregate, register: string, shell: string, control: ArmAggregate | undefined): string {
  if (agg.n === 0) return 'no attempts graded for this cell';
  if (!control) {
    if (register === 'guided') {
      return `Guided is the control arm — there is no non-tautological comparison to run against itself (n=${agg.n})`;
    }
    return `no control-arm (Guided) aggregate available in this manifest to compare against (n=${agg.n})`;
  }
  const pieces: string[] = [];
  const regDef = REGISTERS.find((r) => r.key === register);
  if (regDef?.winsWhen) {
    const v = regDef.winsWhen(agg, control);
    pieces.push(`${regDef.label} — ${v.verdict}: ${v.because}`);
  }
  const skinDef = shell ? SHELL_SKINS.find((s) => s.key === shell) : undefined;
  if (skinDef?.winsWhen) {
    const v = skinDef.winsWhen(agg, control);
    pieces.push(`${skinDef.label} — ${v.verdict}: ${v.because}`);
  }
  if (!pieces.length) return `no pre-registered probe for this arm (register=${register}${shell ? `, shell=${shell}` : ''})`;
  return pieces.join(' | ');
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
      events.push(...(exported.events as TelemetryEvent[]));
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
    cells.push({
      register: first.register, shell: first.shell, backend: first.backend, corpus: first.corpus,
      runs: entries.length, agg, comparison: buildComparison(agg, first.register, first.shell, control),
    });
  }
  cells.sort((a, b) => (a.register + a.shell + a.corpus).localeCompare(b.register + b.shell + b.corpus));

  // The ledger is UNIONED across every run in the manifest (spec §2, verbatim) — not per-cell —
  // same discipline as `telemetry.ts`'s own whole-sitting `ledger` field (deliberately not arm-
  // scoped there either; a capability failure is worth recording regardless of which cell produced
  // it). Top 10 by n, `capabilityLedger`'s own sort.
  const ledgerTop = capabilityLedger(allEvents, allAttempts).slice(0, 10);

  return { mode: manifest.mode, totalAttempts, totalRuns, cells, ledgerTop };
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
