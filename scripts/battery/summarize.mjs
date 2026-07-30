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

/** P7 (task-9 review round 3): the pre-fix version picked the newest MANIFEST among every run
 *  directory, silently skipping over any newer directory that had none — a run that crashed before
 *  writing one (a throw outside the session loop: `startViteOrDry`, `waitForHttp`, `spawnBrowser`;
 *  or a Ctrl-C) left no trace of that skip, so a bare `node scripts/battery/summarize.mjs` quietly
 *  graded and published the PREVIOUS run's numbers under TODAY's date, with no banner and no way to
 *  tell from the doc alone. Now: find the newest run DIRECTORY (its name is an ISO timestamp —
 *  `main()`'s own `runId` — so lexicographic sort is chronological), and REFUSE outright if that
 *  specific directory has no manifest, rather than silently falling back to an older one. */
function findLatestManifest() {
  let runDirs;
  try { runDirs = readdirSync(OUT_ROOT); } catch {
    throw new Error(`no runs found under ${OUT_ROOT} — run scripts/battery/run.mjs first`);
  }
  const dirsWithStat = runDirs
    .map((d) => ({ name: d, dir: path.join(OUT_ROOT, d) }))
    .filter((e) => { try { return statSync(e.dir).isDirectory(); } catch { return false; } })
    .sort((a, b) => b.name.localeCompare(a.name)); // ISO-timestamp names sort chronologically
  if (!dirsWithStat.length) throw new Error(`no runs found under ${OUT_ROOT} — run scripts/battery/run.mjs first`);
  const newest = dirsWithStat[0];
  const manifestPath = path.join(newest.dir, 'manifest.json');
  try { if (!statSync(manifestPath).isFile()) throw new Error('not a file'); } catch {
    throw new Error(
      `the newest run directory (${path.relative(ROOT, newest.dir)}) has no manifest.json — it did ` +
      `not finish far enough to write one (a crash before the session loop, or an interrupted run). ` +
      `Refusing to fall back to an OLDER run's manifest and grade it under today's date. Pass a ` +
      `manifest path explicitly if you really want to re-grade a specific earlier run: ` +
      `node scripts/battery/summarize.mjs path/to/manifest.json`,
    );
  }
  return manifestPath;
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

// C3 (task-9 review round 1): spec §1's cold-start rule, verbatim — "exclude the first turn of
// each session from the arm's latency aggregate and report it separately as a cold-start figure —
// never average the two, and never silently drop it." Its own table, not a couple of extra columns
// folded into the outcomes table above, so "warm" and "cold" can never be misread as the same kind
// of number at a glance.
function renderLatencyTable(cells) {
  const header = '| Register | Shell | Corpus | Warm median | Warm worst | Warm n | Cold-start median | Cold-start n | Sessions |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const rows = cells.map((c) => {
    const l = c.latency;
    const worst = l.worst ? `${l.worst.ms}ms ("${l.worst.label}")` : 'n/a';
    return `| ${c.register} | ${c.shell} | ${c.corpus} | ${fmtDuration(l.medianMs)} | ${worst} | ${l.warmN} | ${fmtDuration(l.coldStartMs)} | ${l.coldStartN} | ${l.sessionCount} |`;
  });
  return [header, sep, ...rows].join('\n');
}

// Q4/Important-2 (task-9 final review): the Runs-vs-Sessions footnote used to illustrate the point
// with a HARDCODED example ("Runs=3, Sessions=48") that matched no cell any real or dry run could
// ever produce — a fabricated number sitting next to a table of real ones. Picks an ACTUAL cell out
// of THIS run's own `graded.cells` instead, so the illustration can never drift from the table above
// it again — it IS a row of that table, read back. Prefers a cell with more than one run (the point
// is clearest there); falls back to whatever cell exists, or to null if this run graded none.
function pickRunsSessionsExample(cells) {
  if (!cells.length) return null;
  return cells.find((c) => c.runs > 1) ?? cells[0];
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
  // N2 (task-9 review round 2, Important): I2 (round 1) made an aborted run's manifest survive;
  // this is what makes the DOC say so. As prominent as the DRY RUN banner, deliberately — the
  // plan's own words are "the aborted pilot's partial summary IS the deliverable", which only
  // holds if a reader can tell it's partial without cross-referencing the console log.
  const abortedBanner = graded.aborted
    ? `\n> **ABORTED RUN.** ${graded.totalRuns} of ${graded.plannedSessions} planned session(s) `
      + `completed before this run stopped early. Reason: ${graded.abortReason ?? '(not recorded)'}. `
      + 'Everything below reflects ONLY the sessions that finished — read every count against '
      + `\`${graded.plannedSessions}\` planned, not as a complete pilot.\n`
    : '';
  // Important-1 (task-9 final review, 2026-07-30): the dominant fact about the abandonment/
  // completion numbers below is a harness ceiling, not an app measurement — see the matching
  // "Known limitations" bullet for the full explanation. Said HERE too, right beside the table a
  // reader hits first, deliberately: the ledger already knows this ("tracks the harness's OWN
  // pre-flagged limitation... not necessarily an app defect"), and the one thing a future reader
  // sees is this doc, not the ledger. Skipped for a dry run — the dry banner above already states
  // (correctly, and more strongly) that every attempt there is `abandoned` by construction, not by
  // any timing effect.
  const settleCeilingBanner = graded.mode !== 'dry'
    ? '\n> **READ THE ABANDONMENT/COMPLETION NUMBERS BELOW AGAINST A HARNESS CEILING FIRST.** A '
      + 'fixed 8-second settle sleep between submits (`SETTLE_MS.live`, run.mjs) force-closes any '
      + 'response slower than 8s as `speech_only`/`no_response`, and roughly 15 mid-session program '
      + 'reconnects per live default run force-close whatever turn was open when each one fired. See '
      + '"Known limitations" below for the full explanation.\n'
    : '';

  const runsSessionsExample = pickRunsSessionsExample(graded.cells);
  const runsSessionsExampleSentence = runsSessionsExample
    ? `This is exactly what this run's own numbers show: **${runsSessionsExample.register} · ` +
      `${runsSessionsExample.shell} · ${runsSessionsExample.corpus}** is a real cell with ` +
      `Runs=${runsSessionsExample.runs}, Sessions=${runsSessionsExample.latency.sessionCount} — ` +
      `not a made-up round number, and not necessarily ${runsSessionsExample.runs} x 16 either ` +
      '(see the reconnect-count paragraph above: the observed count runs somewhat above the ' +
      'theoretical floor).'
    : 'This run graded no cells, so there is no real cell to illustrate the point with here.';

  const doc = `# Battery run — ${date}
${dryBanner}${abortedBanner}${settleCeilingBanner}
Mode: **${graded.mode}**. ${graded.totalRuns} of ${graded.plannedSessions} planned session(s) graded, ${graded.totalAttempts} total attempt(s) across ${graded.cells.length} cell(s).

## Per-cell results

${renderCellTable(graded.cells)}

_Rates always carry their n (spec §5.8) — a rate at n < ${graded.underpoweredN} is \`underpowered\`
per the register/shell probes below, never read as "no effect" on its own._

## Latency (spec §1 — cold first turn excluded, never averaged in, never dropped)

${renderLatencyTable(graded.cells)}

_"Warm" excludes each session's own row 1 (the connect-cost turn — mic pre-flight + socket open +
queued-text flush, a joint-system number, not model latency); "Cold-start" is that excluded row 1,
reported on its own rather than silently discarded. A cell whose sessions all failed before a
timeable first turn landed shows \`n/a\` for both, honestly, rather than a manufactured zero.
**"Runs" (per-cell table above) and "Sessions" (this table) are NOT the same count** (N7, task-9
review round 2; corrected P6, round 3; corrected again Q4/Important-2, final review — the previous
wording claimed a live cell always gets exactly THREE runs, which is false whenever Guided's
wide-corpus split is in play, below): "Runs" counts EXPORT FILES fed into that cell — MOST cells in
the pilot plan get three
repeats, but Guided's three repeats split across two corpora instead (the pilot spec's own §5
ruling): two default-corpus runs and one wide-corpus run, so those two cells show Runs=2 and Runs=1
respectively, never three. "Sessions" counts telemetry \`session_start\`s summed across every run fed
into the cell, because a mid-session program swap reconnects (App.tsx's \`activeProgram\` effect) and
\`scopeToArm\` opens a fresh cold slot on every one. A single live default RUN (one session, the full
28-row default-corpus utterance set) has 15 program-swap reconnects built into its own utterance
sequence — counted once, off the corpus's own \`program\` field (scripts/battery/run.mjs), not a
rounded estimate — so 16 sessions per run in principle (1 initial connect + 15 reconnects). Real runs
land somewhat above that: other things reconnect too (a dropped socket, the idle guard) that are not
program swaps, so the theoretical 16-per-run floor is not the same as the observed count.
${runsSessionsExampleSentence} Expect most turns in a live cell to classify "cold-start" for exactly
this reason._

## Probe verdicts (winsWhen, register/shell registries)

${renderProbeVerdicts(graded.cells)}

## Capability ledger — top ${Math.min(10, graded.ledgerTop.length)} (unioned across every run)

${renderLedger(graded.ledgerTop)}

## Known limitations

- **Abandonment and completion rates are bounded by the harness, not just the model** (Important-1,
  task-9 final review, 2026-07-30). This is the DOMINANT fact about the table above, so it is stated
  first, not last. Every submit is followed by a FIXED 8-second sleep before the next one fires
  (\`SETTLE_MS.live\`, \`scripts/battery/run.mjs\`) — not a real "wait for the model to finish
  responding" poll (\`driveSession\`'s own SETTLE-WAIT SCOPE NOTE says so explicitly). Any response
  slower than 8 seconds is therefore force-closed \`speech_only\`/\`no_response\` by the next submit,
  exactly as if the model had never answered at all. On top of that, a live default run's own program
  sequence forces around 15 mid-session reconnects (see the latency table's own footnote above), and
  each one force-closes whatever turn happened to be open when it fired. Read the Abandoned and
  Completed columns in the per-cell table above against THIS ceiling first: they are at least as
  much a measurement of the harness's settle-wait and reconnect cadence as of the app's own
  responsiveness, and this run cannot separate the two. A real settle-detector (poll the omnibox's
  busy state, or grow-watch the telemetry stream, instead of a fixed sleep) is the named next
  investment before these rates can be read as app numbers on their own.
- **Recorded requests are not always byte-identical to the utterance sent** (M7, task-9 review
  round 1, pre-existing app behavior — not introduced by this harness). \`App.tsx\`'s transcript
  ASCII filter strips non-ASCII punctuation from what it records, so e.g. \`point-by-number\`'s em
  dash is gone from the exported \`request\` text ("Number three — make that one bold." exports as
  "Number three make that one bold."). The corpus's "verbatim" claim (design spec, decision 2) holds
  for what the MODEL received; it is weaker for what this doc's ledger examples show.
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
