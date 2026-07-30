/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Grades a battery run's exports and writes the summary doc (task-9 brief). The actual grading —
// `deriveAttempts` / `armAggregate` / `capabilityLedger` / each register's & shell's `winsWhen` —
// runs in `ts-bridge.ts` via `npx tsx` (decision 6): this file stays plain `node`, reads that
// subprocess's JSON back, and is responsible only for turning it into markdown. No parallel math:
// every number below is read off the bridge's output, never recomputed here.
//
// Usage:
//   node scripts/battery/summarize.mjs [path/to/manifest.json]
//   (omit the path to grade the most recently written run under scripts/battery/out/)

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BRIDGE = path.join(HERE, 'ts-bridge.ts');
const OUT_ROOT = path.join(HERE, 'out');
const EVALS_DIR = path.join(ROOT, 'docs', 'superpowers', 'evals');

function findLatestManifest() {
  let runDirs;
  try { runDirs = readdirSync(OUT_ROOT); } catch {
    throw new Error(`no runs found under ${OUT_ROOT} — run scripts/battery/run.mjs first`);
  }
  const withManifest = runDirs
    .map((d) => path.join(OUT_ROOT, d, 'manifest.json'))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!withManifest.length) throw new Error(`no manifest.json found under ${OUT_ROOT} — run scripts/battery/run.mjs first`);
  return withManifest[0];
}

function pct(rate) {
  return `${Math.round(rate.value * 100)}% (${rate.count}/${rate.n})`;
}

function fmtDuration(ms) {
  return ms === null || ms === undefined ? 'n/a' : `${ms}ms`;
}

function renderCellTable(cells) {
  const header = '| Register | Shell | Corpus | Runs | n | Completed | Corrected | Wrong | Refusal | Ask | Abandoned | Ungradeable | Median turns | Median dur |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = cells.map((c) => {
    const a = c.agg;
    return `| ${c.register} | ${c.shell} | ${c.corpus} | ${c.runs} | ${a.n} | ${pct(a.completion)} | ${pct(a.corrected)} | ${pct(a.wrong)} | ${pct(a.refusal)} | ${pct(a.ask)} | ${pct(a.abandoned)} | ${pct(a.ungradeable)} | ${a.medianTurns.value ?? 'n/a'} (n=${a.medianTurns.n}) | ${fmtDuration(a.medianDurationMs.value)} (n=${a.medianDurationMs.n}) |`;
  });
  return [header, sep, ...rows].join('\n');
}

function renderProbeVerdicts(cells) {
  return cells.map((c) => `- **${c.register} · ${c.shell} · ${c.corpus}** (n=${c.agg.n}): ${c.comparison}`).join('\n');
}

function renderLedger(ledgerTop) {
  if (!ledgerTop.length) return '_No capability-ledger rows — no refusal, dropped ask, no-op turn, deixis miss or grounding disagreement was recorded in this run._';
  const header = '| # | Kind | Key | n | Verbatim example |';
  const sep = '|---|---|---|---|---|';
  const rows = ledgerTop.map((r, i) => `| ${i + 1} | ${r.kind} | ${r.key} | ${r.n} | ${(r.examples[0] ?? '(none)').replace(/\|/g, '\\|')} |`);
  return [header, sep, ...rows].join('\n');
}

function main() {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : findLatestManifest();
  console.log(`[summarize] grading ${path.relative(ROOT, manifestPath)}`);
  const out = execFileSync('npx', ['tsx', BRIDGE, 'grade', manifestPath], { cwd: ROOT, encoding: 'utf8' });
  const graded = JSON.parse(out);

  const date = new Date().toISOString().slice(0, 10);
  const dryBanner = graded.mode === 'dry'
    ? '\n> **DRY RUN — no model.** Every session ran against a stubbed socket that never replies '
      + '(scripts/battery/run.mjs\'s `STUB_SOCKET_SCRIPT`) — zero API spend, zero real model output. '
      + 'Every attempt below graded `abandoned` (the turn machinery\'s `no_response`/`speech_only` '
      + 'path) by construction, not by model behavior. This doc exists to prove the harness itself — '
      + 'boot, connect, type, export, grade — works end to end before Task 10 spends a single real '
      + 'token.\n'
    : '';

  const doc = `# Battery run — ${date}
${dryBanner}
Mode: **${graded.mode}**. ${graded.totalRuns} session(s) graded, ${graded.totalAttempts} total attempt(s) across ${graded.cells.length} cell(s).

## Per-cell results

${renderCellTable(graded.cells)}

_Rates always carry their n (spec §5.8) — a rate at n < ${8} is \`underpowered\` per the register/
shell probes below, never read as "no effect" on its own._

## Probe verdicts (winsWhen, register/shell registries)

${renderProbeVerdicts(graded.cells)}

## Capability ledger — top ${Math.min(10, graded.ledgerTop.length)} (unioned across every run)

${renderLedger(graded.ledgerTop)}
`;

  mkdirSync(EVALS_DIR, { recursive: true });
  const docPath = path.join(EVALS_DIR, `${date}-battery.md`);
  writeFileSync(docPath, doc);
  console.log(`[summarize] wrote ${path.relative(ROOT, docPath)}`);

  // Self-check (part of THE GATE, task-9 brief): the doc must carry zero literal "undefined"
  // strings and a nonzero attempt count. Checked here, not just eyeballed, so a future edit that
  // reintroduces an unformatted `undefined` fails loudly instead of shipping a doc that lies by
  // omission.
  const undefinedCount = (doc.match(/undefined/g) ?? []).length;
  const gatePass = undefinedCount === 0 && graded.totalAttempts > 0;
  console.log(`[summarize] gate check: zero-undefined=${undefinedCount === 0} (found ${undefinedCount}) nonzero-attempts=${graded.totalAttempts > 0} (${graded.totalAttempts}) -> ${gatePass ? 'PASS' : 'FAIL'}`);
  if (!gatePass) process.exit(1);
}

main();
