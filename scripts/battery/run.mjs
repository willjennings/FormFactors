/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The battery harness (performance-realism spec §2, task-9 brief). Drives the FIXED utterance set
// (./utterances.mjs, sourced from src/eval/utterances.ts — never duplicated) through the real app
// over a dependency-free CDP connection to `chrome-headless-shell`, one session per arm, exporting
// each session's telemetry JSON via the app's OWN export path (the "Export session JSON" button in
// the debug drawer — telemetry.ts's `exportJSON()`). `summarize.mjs` grades the exports afterward.
//
// TWO MODES:
//   --dry   Zero spend. Own vite server, inline STUB env (never reads/writes .env). Both live
//           channels to Gemini's real API host are faked in-browser (see STUB_SOCKET_SCRIPT below):
//           the WebSocket live-connect path (used by every typed utterance this harness sends) AND
//           the REST path (`GoogleGenAI(...).models.generateContent`, App.tsx's `speakFeedback` —
//           unreachable from a stub socket that never lets a real commit happen, since nothing
//           calls it without one, but faked anyway rather than merely disclosed as unreachable —
//           M5, task-9 review round 1). The app runs its real gate, real telemetry, real turn
//           machinery; nothing leaves this machine on EITHER channel. The model never replies on
//           its own, so every ORDINARY turn eventually settles `no_response`/`speech_only` and
//           every ordinary attempt grades `abandoned` — a real, honest measurement of the harness
//           itself, not a fabricated pass. ONE designated utterance per dry cell is the sole
//           exception (I2, settle-detector review, 2026-07-30, `injectDrySettleReply`): this script
//           itself — not the stub, and not a real model — injects a synthetic tool-call reply
//           through the exact same path a real server frame would arrive on, so the dry gate can
//           prove the settle-detector's OWN wiring works (`settleTotals.settled >= 1`) rather than
//           being structurally blind to whether it does. This is what THE GATE (task-9 brief) runs.
//   --live  Real spend. Starts `npm run dev` (which reads `.env` itself — this script never does)
//           and drives real utterances against the real model. Task 10's job, under its own
//           protocol. `server.ts` reads `PORT` from the environment (default 3000, unchanged) —
//           `--live` spawns it on its own dedicated `getFreePort()` pick (honoring
//           `FORBIDDEN_PORTS`, so it can never land on the human's real-keyed :3000 LAN dev server
//           or the :3002 one documented elsewhere in this repo) via `PORT=<port> npm run dev`, and
//           waits on THAT port. See `startViteOrDry` below.
//
// SAFETY: this script does real I/O (spawns processes, writes files) even in --dry mode, and
// --live spends real API tokens. It must NEVER run inside the test suite or a CI pipeline — the
// guard immediately below is unconditional, at module load, before any argument parsing.
if (process.env.VITEST || process.env.CI) {
  throw new Error(
    'scripts/battery/run.mjs must never run under VITEST or CI — it drives a real browser and ' +
    '(in --live mode) spends real API tokens. Run it directly: node scripts/battery/run.mjs --dry',
  );
}

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUtterances } from './utterances.mjs';

// ---- Hard caps (compiled in, verbatim per the task-9 brief — grepped in review) ----
const MAX_SESSIONS = 12;
// C1 (settle-detector review, 2026-07-30): 360_000 (the task-9 brief's original figure) fit the
// OLD fixed `SETTLE_MS.live = 8000` sleep with ~70s of margin — which is exactly why the
// 2026-07-30 pilot completed 12/12. Task 10 changed the per-utterance wait to a 20s CEILING
// (`MAX_SETTLE_MS.live`, below) without re-deriving this constant, and the corpus this harness
// actually drives (`scripts/battery/utterances.mjs`) rides that ceiling on ~90% of turns (the
// 2026-07-30 pilot's own per-cell table shows 87-93% Abandoned — precisely the turns a
// `speech_only`/`no_response` close can never settle early, per `pollTurnSettled`'s own doc). The
// worst real cell (the wide corpus: 30 utterances, 16 mid-session program swaps) needs up to
// `30 x 20000 + 16 x 1800 + FIXED_SESSION_OVERHEAD_MS` = `600000 + 28800 + 60000` = 688800ms — a
// session that legitimately needs that long was, before this fix, torn down by `withTimeout` at
// ~360s, BEFORE `exportSession` ever ran: every utterance already driven (and, under --live,
// already paid for) produced nothing, and two such sessions in a row aborted the whole pilot.
// Raised to 780_000 (≈76s of margin over the 688800ms worst case) — not re-derived to the brief's
// original number, because that number was sized for a wait shape (`SETTLE_MS.live`'s fixed 8s
// sleep) this file no longer has. `assertSessionBudget` in `main()` is the structural half of this
// fix: it recomputes the SAME worst-case arithmetic against the REAL plan at startup and refuses
// to run rather than let this constant and the corpus/ceiling drift apart silently again.
const SESSION_TIMEOUT_MS = 780_000;
const MAX_CONSECUTIVE_FAILURES = 2;

// M2 (task-9 review round 1): NOT a brief requirement — the brief names no ports. These are
// carried over from this project's own operational history: 3002 is documented in this repo's
// smoke docs as a real-keyed dev server; 3000 is `server.ts`'s DEFAULT port (still its default
// when `PORT` is unset — task-10 made it env-overridable, not renumbered) and is where this
// machine's human-driven, real-keyed LAN dev server actually runs (see `startViteOrDry`).
// `getFreePort()` (used for the vite/dev-server port in EITHER mode, and the CDP port) must never
// land on either by accident — stated here as this script's own operational discipline, not as
// something the brief mandated.
const FORBIDDEN_PORTS = new Set([3000, 3002]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_ROOT = path.join(HERE, 'out');

// Per-utterance settle wait. Task 10 (settle-detector): a real poll of the turn machine's own
// `data-turn-open` attribute (App.tsx's `setOpenTurn`, `src/eval/turns.ts`'s `turnOpenAttr`)
// replaces the fixed sleep this constant used to name outright — see `pollTurnSettled`'s own doc
// for exactly which settle paths that attribute can and cannot see. `MAX_SETTLE_MS` is now a
// CEILING, not a wait duration: the poll returns the moment the turn closes, and only rides the
// ceiling when it does not.
//
// DRY has no model to wait for — the stub socket never calls `onToolCall`/`onResponseStart` (see
// `STUB_SOCKET_SCRIPT` below), so `data-turn-open` never flips to '0' on its own; every dry-mode
// poll rides its ceiling by construction, same as the fixed sleep it replaces. Kept small (900ms,
// unchanged from the old `SETTLE_MS.dry`) so the dry gate stays fast — the NEXT submit's `openTurn`
// supersede-closes the previous turn regardless (turns.ts: a new turn opening while one is still
// pending force-closes the previous as `no_response`/`speech_only`), which is what actually makes
// every dry-run attempt gradeable at zero spend; the poll ceiling here only bounds how long this
// script waits before moving on to that next submit.
//
// LIVE's ceiling is generous (20s, up from the old fixed 8s sleep) precisely because it is now a
// ceiling, not a per-utterance tax: a turn that settles in 1s now costs this script 1s, not 8s: a
// fast reply no longer wastes wall-clock, and a genuinely slow one gets more room before being
// force-closed than the old fixed sleep ever gave it.
const MAX_SETTLE_MS = { dry: 900, live: 20000 };
const SETTLE_POLL_INTERVAL_MS = 250;
const BOOT_WAIT_MS = 2500;
const CONNECT_TIMEOUT_MS = 15000;

// C1 (settle-detector review, 2026-07-30): the fixed sleep after a mid-session program swap
// (`driveSession`'s utterance loop, below) — named here, not just inline, so `assertSessionBudget`
// and the actual `await sleep(PROGRAM_SWAP_WAIT_MS)` call can never disagree about what a swap
// costs. Value unchanged from before this fix (1800ms); only its role changed, from "a number
// used once" to "a number the session-budget arithmetic also depends on."
const PROGRAM_SWAP_WAIT_MS = 1800;

// C1: the fixed per-session cost OUTSIDE the utterance loop — everything `assertSessionBudget`'s
// worst-case arithmetic has to account for besides `utterances x ceiling` and `swaps x
// PROGRAM_SWAP_WAIT_MS`. Real components, summed generously rather than measured exactly (each is
// itself a worst-case bound already, so summing worst-cases here is deliberately pessimistic):
// BOOT_WAIT_MS (2500) + the initial connect's own CONNECT_TIMEOUT_MS-bound poll (15000, almost
// always far faster in practice) + the initial program-switch settle (600) + `endSession`'s own
// CONNECT_TIMEOUT_MS-bound poll (15000) + its trailing settle (500) + `exportSession`'s drawer-open
// wait (400) + its download poll (10000) + its size-stabilize loop (20 x 150 = 3000) + `Page.close`'s
// own bound (5000) ≈ 52000ms. Rounded up to 60000 for margin against anything this list missed.
const FIXED_SESSION_OVERHEAD_MS = 60_000;

/** How many times consecutive utterances in `utterances` name a DIFFERENT `program` — i.e. how
 *  many mid-session reconnects (`driveSession`'s utterance loop) a cell's own utterance sequence
 *  forces. The FIRST utterance never counts (there is no reconnect before the first program is
 *  ever chosen — `driveSession` handles that as a one-time pre-loop switch, not a loop-body swap;
 *  see `FIXED_SESSION_OVERHEAD_MS`'s own accounting for that). Pure and total: any array in,
 *  including empty, a non-negative integer out. */
function countProgramSwaps(utterances) {
  let count = 0;
  let current = null;
  for (const u of utterances) {
    if (current !== null && u.program !== current) count += 1;
    current = u.program;
  }
  return count;
}

/** C1 (settle-detector review, 2026-07-30): the worst-case wall-clock ONE session of `cell` could
 *  legitimately need, computed from the REAL utterance list and REAL swap count rather than a
 *  hand-maintained estimate — this is what `assertSessionBudget` checks against `SESSION_TIMEOUT_MS`
 *  at startup, so a future corpus change that makes a cell's worst case worse fails LOUDLY there
 *  (before any browser/vite process spawns) instead of silently reopening the exact defect this
 *  function exists to close (a session torn down by `withTimeout` mid-drive, before `exportSession`
 *  ever runs, losing everything already paid for). */
function worstCaseSessionBudgetMs(cell, mode) {
  return cell.utterances.length * MAX_SETTLE_MS[mode]
    + countProgramSwaps(cell.utterances) * PROGRAM_SWAP_WAIT_MS
    + FIXED_SESSION_OVERHEAD_MS;
}

/** Refuses to start if ANY cell in `plan` needs more wall-clock than `SESSION_TIMEOUT_MS` gives it
 *  — the structural half of the C1 fix (settle-detector review, 2026-07-30). Checked against the
 *  ACTUAL plan `buildPlan` produced, not a hardcoded utterance/swap count, so this assertion cannot
 *  itself go stale the way the constant it protects already did once. Called from `main()` before
 *  any browser/vite process spawns — failing here costs nothing; failing at utterance ~17 of a real
 *  paid --live session (this defect's actual prior failure mode) costs a torn-down session and,
 *  after two in a row, the whole pilot. */
function assertSessionBudget(plan, mode) {
  if (!plan.length) return;
  const worst = plan.reduce((acc, cell) => {
    const budget = worstCaseSessionBudgetMs(cell, mode);
    return budget > acc.budget ? { cell, budget } : acc;
  }, { cell: plan[0], budget: worstCaseSessionBudgetMs(plan[0], mode) });
  if (worst.budget > SESSION_TIMEOUT_MS) {
    throw new Error(
      `refusing to start: the worst-case session in this plan (${worst.cell.register}/${worst.cell.shell}/` +
      `${worst.cell.corpus}, ${worst.cell.utterances.length} utterances, ${countProgramSwaps(worst.cell.utterances)} ` +
      `program swaps) needs up to ${worst.budget}ms (${worst.cell.utterances.length} x MAX_SETTLE_MS.${mode}=` +
      `${MAX_SETTLE_MS[mode]} + ${countProgramSwaps(worst.cell.utterances)} x PROGRAM_SWAP_WAIT_MS=${PROGRAM_SWAP_WAIT_MS} ` +
      `+ FIXED_SESSION_OVERHEAD_MS=${FIXED_SESSION_OVERHEAD_MS}), which exceeds SESSION_TIMEOUT_MS=${SESSION_TIMEOUT_MS}ms. ` +
      `Raise SESSION_TIMEOUT_MS, lower MAX_SETTLE_MS.${mode}, or shrink the corpus/plan — do not silently proceed: ` +
      `a session that hits SESSION_TIMEOUT_MS is torn down by withTimeout BEFORE exportSession runs, losing every ` +
      `utterance already driven (and, under --live, already paid for).`,
    );
  }
}

function usageError(msg) {
  console.error(`error: ${msg}\nusage: node scripts/battery/run.mjs --dry|--live`);
  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args.includes('--dry') ? 'dry' : args.includes('--live') ? 'live' : null;
if (!mode) usageError('exactly one of --dry or --live is required');
if (args.includes('--dry') && args.includes('--live')) usageError('--dry and --live are mutually exclusive');

// ---- small utilities ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A free TCP port, picked fresh each call — never a fixed guess, and never one of the
 *  `FORBIDDEN_PORTS` (a free-port race could theoretically hand back one of those the instant
 *  after whatever was using it exits; explicitly re-rolling on collision costs nothing). */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => {
        if (FORBIDDEN_PORTS.has(port)) resolve(getFreePort());
        else resolve(port);
      });
    });
  });
}

/** Locates the `chrome-headless-shell` binary puppeteer's installer already cached on this
 *  machine (confirmed present: `~/.cache/puppeteer/chrome-headless-shell/...`) — no `puppeteer-
 *  core` import, no new dependency, just a directory walk. `CHROME_HEADLESS_SHELL_PATH` overrides
 *  outright for a machine laid out differently. Throws loudly rather than silently falling back to
 *  some OTHER browser — a battery run is worthless evidence if it silently drove a different
 *  engine than the one every other browser drive in this repo used. */
function resolveChromeHeadlessShell() {
  if (process.env.CHROME_HEADLESS_SHELL_PATH) return process.env.CHROME_HEADLESS_SHELL_PATH;
  const base = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  let versions;
  try { versions = readdirSync(base); } catch {
    throw new Error(`chrome-headless-shell not found under ${base} — set CHROME_HEADLESS_SHELL_PATH`);
  }
  // M3 (task-9 review round 1) / N9 (round 2, comment scope): a bare lexicographic sort is wrong
  // for version strings (a "99.x" directory would sort AFTER "138.x" and get picked as "newest" —
  // deterministic, but not newest). Parses the dotted numeric run out of each directory name and
  // compares component-wise, longest/most-significant first; a name with no parseable numbers
  // sorts last rather than throwing, so an oddly-named directory never crashes resolution outright
  // — it is just never preferred over a real version string. The exact tuple this produces is
  // PLATFORM-DEPENDENT, not always a pure version: on macOS, `mac_arm-145.0.7632.77` -> `[145, 0,
  // 7632, 77]`, a clean version tuple; on Linux, `linux64-138.0.7204.100` -> `[64, 138, 0, 7204,
  // 100]` — `64` (from "linux64") is a PLATFORM digit, not a version component, leading the tuple.
  // Harmless: that leading digit is constant across every entry on any one machine (there is only
  // ever one platform's cache locally), so it never changes which comparison wins — but a reader
  // should not assume the parsed tuple is always a clean version number.
  const versionKey = (name) => (name.match(/\d+/g) ?? []).map(Number);
  const compareVersions = (a, b) => {
    const ka = versionKey(a), kb = versionKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const diff = (kb[i] ?? -1) - (ka[i] ?? -1); // descending — newest first
      if (diff !== 0) return diff;
    }
    return 0;
  };
  versions.sort(compareVersions);
  for (const v of versions) {
    const dir = path.join(base, v);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // Exactly one platform subfolder per version in practice (e.g.
    // `chrome-headless-shell-mac-arm64/`, `chrome-headless-shell-linux64/`) — rather than pattern-
    // match its name (fragile across platforms/archs), just walk every directory entry looking for
    // the binary itself, one level down.
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bin = path.join(dir, entry.name, 'chrome-headless-shell');
      const binWin = `${bin}.exe`;
      try { statSync(bin); return bin; } catch { /* try .exe */ }
      try { statSync(binWin); return binWin; } catch { /* try next entry */ }
    }
  }
  throw new Error(`no chrome-headless-shell binary found under ${base} — set CHROME_HEADLESS_SHELL_PATH`);
}

/** `expectProc` (optional — P3, task-9 review round 3): when given, a successful HTTP response is
 *  trusted ONLY while that child process is still alive. This is what actually closes the
 *  spawn-to-bind race C4/N6 disclosed but did not close: `isPortOccupied` proves the port was
 *  free an instant BEFORE spawn; it says nothing about what happens in the window between spawn
 *  and this process's own bind. If something else won that race and bound first, `npm run dev`'s
 *  own `app.listen` fails with EADDRINUSE and the child exits — but WITHOUT this check,
 *  `waitForHttp` would keep polling, get a 200 from the OTHER (possibly real-keyed) server, and
 *  report success as if it were this script's own. Checking `exitCode` on every poll means a dead
 *  child can never be mistaken for a live one that happens to share a port some other process also
 *  answers on. */
async function waitForHttp(url, timeoutMs, label, expectProc) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    // Q3 (task-9 review round 4, Minor — the cheap half; the bind-race ordering gap itself is
    // disclosed above and PARKED for the settle-detector pass): `exitCode` alone misses a
    // SIGKILLed child — Node reports `exitCode: null` and `signalCode: 'SIGKILL'` (or another
    // signal) for a process the OS terminated rather than one that exited normally, so a dead
    // child killed by a signal would slip this guard and let the next poll read from whatever won
    // the bind race after it died.
    if (expectProc && (expectProc.exitCode !== null || expectProc.signalCode !== null)) {
      throw new Error(`${label}: the process that was supposed to serve ${url} already exited (code ${expectProc.exitCode}, signal ${expectProc.signalCode}) — refusing to trust any response from ${url} as this script's own server (it may be a pre-existing one that won a bind race)`);
    }
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch (e) { lastErr = e; }
    await sleep(200);
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms (${lastErr?.message ?? 'no response'})`);
}

// ---- process management (browser + vite) ----

function spawnBrowser(cdpPort, userDataDir) {
  const bin = resolveChromeHeadlessShell();
  mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(bin, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=old', // the mode this repo's prior drives used — Page.setDownloadBehavior (the
                       // per-page download-capture call this script relies on) is a "old headless"
                       // era CDP method; the newer headless mode wants Browser.setDownloadBehavior.
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1600,1000',
    `--user-data-dir=${userDataDir}`,
    // Media stream flags (established pattern — seen on every prior drive's chrome-headless-shell
    // invocation in this repo): the app's voice connect path calls `getUserMedia({audio:true})`
    // BEFORE opening the socket (src/voice/gemini.ts), and headless Chrome has no real microphone.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ], { stdio: 'ignore' });
  return proc;
}

/** A real TCP probe, not a guess: tries to CONNECT to `127.0.0.1:port`. Something answering the
 *  connect means something is listening — refusing on that alone (rather than trying an HTTP
 *  request first) is deliberately conservative: a listener that never speaks HTTP is still a
 *  listener this script has no business colliding with. */
function isPortOccupied(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: timeoutMs });
    const done = (occupied) => { socket.destroy(); resolve(occupied); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Task 10 (env-overridable port — the KNOWN LIMITATION this docstring used to describe is now
 *  resolved): `server.ts` reads `PORT` from the environment (`Number(process.env.PORT ?? 3000)`
 *  — default unchanged), so `--live` no longer has to fight `--dry`'s "own dedicated port"
 *  discipline. Both modes now call `getFreePort()` in `main()` for the SAME `vitePort` variable;
 *  `--live` passes it through as `PORT=<vitePort>` to `npm run dev`'s environment and waits on
 *  that port, never on a hardcoded :3000 — so it can never collide with (or need to refuse
 *  because of) the human's real-keyed LAN dev server actually bound there.
 *
 *  The port-collision guards below predate this fix and are kept, now parameterized by whichever
 *  port this run actually picked rather than a hardcoded one:
 *
 *  C4 (task-9 review round 1, reviewer-ruled — this docstring PREVIOUSLY claimed a real refusal
 *  existed here and it did not; `waitForHttp` happily succeeds against a pre-existing server, so
 *  `--live` could silently drive whatever real-keyed dev session was already on the target port).
 *  The check below is the actual fix: a real TCP probe of the target port BEFORE spawning
 *  anything, refusing loudly if something is already there rather than reusing it.
 *
 *  N6 (task-9 review round 2) / P3 (task-9 review round 3, corrected — N6's own disclosure
 *  contained a false safety claim): there is an inherent check-then-start race between
 *  `isPortOccupied`'s probe and `npm run dev`'s own bind a few lines below — something could start
 *  listening on the target port in that window. N6 claimed "neither [failure] silently drives a
 *  session this script didn't intend to start" — FALSE for the "`waitForHttp` talks to the other,
 *  pre-existing server" branch: that is EXACTLY C4's failure mode, reopened through the timing gap
 *  C4's own probe closes only for the moment before spawn. The race itself is not eliminated (that
 *  would need an atomic probe-and-reserve, which TCP does not offer without actually binding the
 *  port first) — but `waitForHttp` below is now called WITH this function's own `proc` handle
 *  (`expectProc`, its own doc), which closes the specific failure this paragraph used to
 *  mis-describe as already closed: a response is trusted only while the process that was supposed
 *  to produce it is still alive, so a `npm run dev` that lost the bind race and exited can never
 *  have its silence mistaken for the other server's success.
 *
 *  Since `vitePort` is now a freshly picked `getFreePort()` value (honoring `FORBIDDEN_PORTS`,
 *  which excludes 3000/3002 outright) rather than a hardcoded, human-occupied port, the pre-spawn
 *  `isPortOccupied` probe below is closer to belt-and-suspenders than the primary defense C4
 *  originally needed — but it costs nothing to keep, and a free-port pick racing something else
 *  for the same port is still a real (if narrow) possibility (see `getFreePort`'s own doc). */
async function startViteOrDry(mode, vitePort) {
  if (mode === 'dry') {
    const proc = spawn('npx', ['vite', '--port', String(vitePort), '--strictPort'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        // Inline stub values — NEVER read from or written to .env (the file header's SAFETY note,
        // and the task brief's absolute constraint). Matches the established pattern from
        // docs/superpowers/smokes/2026-07-29-shell-browser-drive.md exactly.
        GEMINI_API_KEY: 'STUBKEY_BATTERY',
        AZURE_OPENAI_API_KEY: 'STUBAZ_BATTERY',
        AZURE_OPENAI_ENDPOINT: 'https://stub.invalid/',
        AZURE_REALTIME_DEPLOYMENT: 'stub-deployment',
        AZURE_TRANSCRIBE_DEPLOYMENT: 'stub-deployment',
      },
    });
    await waitForHttp(`http://localhost:${vitePort}/`, 20000, 'dry vite server', proc);
    return { proc, url: `http://localhost:${vitePort}` };
  }
  // --live: `server.ts` reads `.env` itself (this script never does) AND now reads `PORT` from
  // the environment, so a dedicated `vitePort` reaches it the same way it always reached `--dry`'s
  // raw `vite` invocation.
  if (await isPortOccupied(vitePort)) {
    throw new Error(
      `refusing to start --live: something is already listening on :${vitePort}, the dedicated ` +
      'port this run just picked for its own server.ts instance. Extremely unlikely for a fresh ' +
      '`getFreePort()` pick, but this script will not silently drive (and possibly clobber the ' +
      'desk state of) whatever that is.',
    );
  }
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(vitePort) },
  });
  await waitForHttp(`http://localhost:${vitePort}/`, 20000, 'live dev server', proc);
  return { proc, url: `http://localhost:${vitePort}` };
}

function killProc(proc) {
  if (!proc || proc.killed) return;
  try { proc.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => { try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* already gone */ } }, 3000);
}

// ---- dependency-free CDP client (node's built-in fetch + WebSocket — no puppeteer-core, no new
// dependency; the pattern established by .superpowers/sdd/2026-07-29-artifact-remeasure/cdp.mjs) ----

function makeRpc(ws, pending) {
  let seq = 0;
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** N5 (task-9 review round 2, Minor — the residual tail of C2): `Page.close` sent over a PAGE's own
 *  CDP session still needs that page's session to answer. If it times out (round 1's bound was 5s,
 *  kept here), round 1's fallback was just `ws.close()` — which discards the only HANDLE to the
 *  page without actually closing it, so a genuinely wedged renderer (and, under --live, its live
 *  provider socket) survives for the rest of the WHOLE run, not just this session. `Target.
 *  closeTarget` on the BROWSER-level endpoint (a fresh, separate connection — `/json/version`'s own
 *  `webSocketDebuggerUrl`, not the per-page one) does not depend on the wedged page/session
 *  answering at all; it is the browser process itself tearing the target down. Best-effort: if even
 *  this fails, the page is genuinely stuck until `killProc(browserProc)` ends the whole run — there
 *  is no third tier short of that. */
async function forceCloseTarget(cdpPort, targetId) {
  try {
    const verRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    const { webSocketDebuggerUrl } = await verRes.json();
    const bws = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    await withTimeout(new Promise((resolve, reject) => {
      bws.addEventListener('open', resolve);
      bws.addEventListener('error', reject);
    }), 5000, 'browser-level CDP connect (forceCloseTarget)');
    bws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    const browserRpc = makeRpc(bws, pending);
    await withTimeout(browserRpc('Target.closeTarget', { targetId }), 5000, 'Target.closeTarget (forceCloseTarget)');
    bws.close();
  } catch {
    // Last resort exhausted — the whole-run browser kill at the end of `main()` is the final
    // backstop; nothing more targeted can be done from here.
  }
}

async function openPage(cdpPort) {
  // Created blank, deliberately (see STUB_SOCKET_SCRIPT below): the WebSocket override must be
  // injected via Page.addScriptToEvaluateOnNewDocument BEFORE the real boot URL's bundle ever
  // runs, and the only way to guarantee that ordering over CDP is to attach to a page that has not
  // navigated to the real app yet, THEN navigate.
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleLines = [];
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(text);
    }
  });
  const rpc = makeRpc(ws, pending);
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  return { ws, rpc, target, consoleLines };
}

async function evalJs(rpc, expression, awaitPromise = false) {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error('EVAL ERROR: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

// ---- the silent-mic stub socket + REST stub (--dry only) ----
// Fakes BOTH of Gemini's real-API channels (generativelanguage.googleapis.com — confirmed by
// reading node_modules/@google/genai's BrowserWebSocket AND its REST client, which both resolve to
// the bare global `WebSocket`/`fetch` the bundler leaves pointing at `window.*`): the live-connect
// WebSocket (used by every typed utterance this harness sends) and the REST
// `models.generateContent` TTS path (`App.tsx`'s `speakFeedback` — unreachable from a stub socket
// that never lets a real commit happen, since nothing calls it without one, but faked anyway rather
// than merely disclosed as unreachable — M5, task-9 review round 1). Every OTHER socket/fetch —
// Vite's HMR client and asset requests in particular — passes through to the real implementation
// untouched, exactly like the prior drive's documented "only sockets to stub.invalid are faked"
// rule, just matched by hostname instead of by a redirect target since nothing here needs a real
// network hop at all.
//
// The SDK's own `onopen` callback fires on the RAW socket's open event (read from
// dist/web/index.mjs's `live.connect`: `conn.connect()` sets `ws.onopen = callbacks.onopen`
// directly — there is no server handshake message gating it, e.g. no `setupComplete` wait before
// the app's `cb.onOpen()` runs). So the stub only needs to become "open" — it never needs to speak
// Gemini's wire protocol at all. BY ITSELF it never calls `onmessage`, so the model never replies:
// every ORDINARY turn the battery opens is destined to settle `no_response`/`speech_only`, which is
// the honest, zero-spend measurement this mode exists to produce (see the file header).
//
// I2 (settle-detector review, 2026-07-30): `window.__ffLiveSocket` below exposes the CURRENT stub
// instance so `injectDrySettleReply` (driveSession) can fire ITS `onmessage` directly, from Node,
// for exactly one designated utterance per cell — the SDK's own `handleWebSocketMessage`
// (`node_modules/@google/genai`) JSON.parses a raw socket frame straight into the object it hands
// `onmessage`, so a hand-built `{ toolCall: { functionCalls: [...] } }` string exercises the app's
// REAL `onToolCall` -> `ack()` path exactly as a genuine model reply would; nothing about the app
// is faked beyond the socket transport itself, which this whole file already fakes. This is what
// makes the dry gate able to prove `settleTotals.settled >= 1` STRUCTURALLY (a wrong selector, an
// unattached ref, or a never-written attribute now fails the gate) instead of the gate being
// blind to the detector's own correctness (every prior dry run produced `0 settled` whether the
// instrument worked or was completely broken, because nothing dry-mode ever answered anything).
const STUB_SOCKET_SCRIPT = `(function(){
  if (window.__ffStubInstalled) return;
  window.__ffStubInstalled = true;
  window.__ffBatterySent = [];
  var GEMINI_HOST = 'generativelanguage.googleapis.com';
  var RealWS = window.WebSocket;
  function StubSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    window.__ffLiveSocket = this; // I2: the ONE currently-in-use stub instance, for injection from Node
    var self = this;
    setTimeout(function () {
      self.readyState = 1;
      if (self.onopen) self.onopen({ target: self });
    }, 0);
  }
  StubSocket.prototype.send = function (data) {
    try { window.__ffBatterySent.push(String(data).slice(0, 200)); } catch (e) {}
  };
  StubSocket.prototype.close = function () {
    this.readyState = 3;
    if (this.onclose) this.onclose({ target: this, code: 1000, wasClean: true });
  };
  StubSocket.CONNECTING = 0; StubSocket.OPEN = 1; StubSocket.CLOSING = 2; StubSocket.CLOSED = 3;
  function FakeWebSocket(url, protocols) {
    if (typeof url === 'string' && url.indexOf(GEMINI_HOST) !== -1) {
      return new StubSocket(url);
    }
    return new RealWS(url, protocols);
  }
  FakeWebSocket.prototype = RealWS.prototype;
  FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
  window.WebSocket = FakeWebSocket;

  // M5: the REST channel (App.tsx's speakFeedback -> GoogleGenAI(...).models.generateContent).
  // Never reached in practice (it only fires after a real tool-call commit, which the WS stub
  // above never lets happen), but faked for real rather than left as a merely-disclosed gap.
  var RealFetch = window.fetch ? window.fetch.bind(window) : null;
  if (RealFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf(GEMINI_HOST) !== -1) {
        return Promise.reject(new Error('battery --dry: REST calls to the live model host are stubbed — zero spend, not a network failure'));
      }
      return RealFetch(input, init);
    };
  }
})();`;

function bootUrl(baseUrl, cell) {
  const params = new URLSearchParams({ shell: cell.shell, register: cell.register });
  if (cell.corpus === 'wide') params.set('corpus', 'wide');
  return `${baseUrl}/?${params.toString()}`;
}

const OMNIBOX_FORM = "document.querySelector('[data-shell] form')";

// scenarios.ts's PROGRAMS labels, verbatim — the taskbar's launcher/chip aria-labels are built
// from these ("Open Microsoft Excel", "Microsoft Excel — in front", …), so switching the active
// program means finding a button whose accessible name starts with (chip) or equals "Open " +
// (launcher) one of these strings. Not imported from scenarios.ts (that module is TypeScript,
// browser-only; this is a plain-node string table, four labels, unlikely to drift silently since
// `UTTERANCES` only ever carries these four `ProgramId`s — `tsc --noEmit` would fail loudly on a
// fifth from `src/eval/utterances.ts` well before this file ever saw it).
const PROGRAM_LABELS = {
  word: 'Microsoft Word', excel: 'Microsoft Excel', powerpoint: 'Microsoft PowerPoint', photo: 'Photo Editor',
};

/** Switches the desk's active program via the Familiar taskbar (the skin this harness always
 *  boots — `?shell=familiar`), the same click path a person uses: the program's own taskbar chip
 *  if it already has a window (`WindowChip`, aria-label starts with the program's label), else its
 *  launcher (`ProgramLauncher`, aria-label is exactly "Open <label>"). Returns false if neither is
 *  found (a malformed boot — the caller treats that as fatal, same as any other missing element). */
async function switchProgram(rpc, programId) {
  const label = PROGRAM_LABELS[programId];
  if (!label) throw new Error(`switchProgram: unknown ProgramId "${programId}" — PROGRAM_LABELS needs an entry`);
  return evalJs(rpc, `(function(){
    var chip = document.querySelector('[aria-label^=${JSON.stringify(label)}]');
    if (chip) { chip.click(); return true; }
    var launcher = document.querySelector('[aria-label=${JSON.stringify(`Open ${label}`)}]');
    if (launcher) { launcher.click(); return true; }
    return false;
  })()`);
}

/** N1 (task-9 review round 2, Critical — replaces round 1's `readFrontProgram`) / P1 (round 3,
 *  Important — round 2's REPLACEMENT was itself wrong, fixed here without another rename since the
 *  question this function answers ("which program is active") is still the right one to ask).
 *
 *  Round 1's `readFrontProgram` asked "which window has FOCUS" (the taskbar's `"… — in front"`
 *  chip) and treated that as "which PROGRAM is active" — true only on a desk with no artifact
 *  windows; a `?corpus=wide` boot seeds six artifacts whose windows open and the LAST one takes
 *  focus, so it returned `null` and the boot assertion threw unconditionally on the one cell spec
 *  §3 exists to measure.
 *
 *  Round 2's fix over-corrected: it matched ANY chip whose label starts with a `PROGRAM_LABELS`
 *  value, on the claimed invariant that "exactly one taskbar chip's label ever starts with a
 *  program name". FALSE, and the parenthetical in that same sentence contradicts it: a program
 *  swap MINIMIZES the outgoing program window rather than closing it (`App.tsx`'s program-swap
 *  effect) — it stays in `desk.windows`, `barItems` (`src/shell/desk/selectors.ts`) keeps
 *  rendering its chip, and `WindowChip.tsx` labels a minimized window `"<title> — put away — click
 *  to bring it back"`. So after one swap there are TWO chips whose labels start with a program
 *  name, and the round-2 predicate took the first in DOM order — the OLDEST-opened, i.e. Word,
 *  almost always — regardless of which program is actually active. Probed live: after a journal
 *  restore that left the app genuinely on Excel, the round-2 predicate still returned `word` and
 *  the boot assertion PASSED — I5's original failure mode, now silently undetectable.
 *
 *  THE ACTUAL INVARIANT (verified against all four reachable states — clean default boot, after a
 *  swap, a journal-restore boot, a clean wide boot): exactly ONE program chip is ever NOT
 *  minimized (a program swap minimizes the outgoing window rather than closing it, so the desk can
 *  hold MORE than one program window at once once a swap has happened — the minimized ones persist,
 *  per the paragraph above; there is simply nothing to minimize until the first swap, and the
 *  incoming window never boots minimized). "Program chip AND label does not contain the put-away marker" —
 *  not `aria-pressed`/focus, which a wide boot's artifact window can also claim — is the predicate
 *  that is correct in all four states. */
async function readActiveProgram(rpc) {
  const label = await evalJs(rpc, `(function(){
    var labels = ${JSON.stringify(Object.values(PROGRAM_LABELS))};
    var PUT_AWAY = 'put away';
    var chips = Array.from(document.querySelectorAll('[aria-label]'));
    var chip = chips.find(function(c){
      var a = c.getAttribute('aria-label');
      return labels.some(function(l){ return a.indexOf(l) === 0; }) && a.indexOf(PUT_AWAY) === -1;
    });
    return chip ? chip.getAttribute('aria-label') : null;
  })()`);
  if (!label) return null;
  for (const [id, progLabel] of Object.entries(PROGRAM_LABELS)) {
    if (label.indexOf(progLabel) === 0) return id;
  }
  return null;
}

// P5 (task-9 review round 3, Minor): src/artifacts/wideCorpus.ts seeds exactly this many artifacts
// on a `?corpus=wide` boot. Kept as its own named constant (not a bare `6`) so it reads as a claim
// about the SEED, not a magic number in the assertion below.
const WIDE_CORPUS_ARTIFACT_COUNT = 6;

/** P5 (task-9 review round 3, Minor): the dry gate's wide cell (N1, round 2) proves `?corpus=wide`
 *  does not CRASH the boot; it does not, on its own, prove the wide corpus actually SEEDED —
 *  nothing in a telemetry export names which corpus a session ran under (the `wide` label a cell
 *  carries is the harness's own unchecked claim, same class of risk C1/N1 exist to catch
 *  elsewhere). Counts taskbar buttons that are neither a program chip (`PROGRAM_LABELS`-prefixed)
 *  nor a program launcher (`"Open …"`-prefixed) — the remainder are artifact chips, one per seeded
 *  artifact window (`WindowChip.tsx`, rendered for every desk window regardless of kind). Asserted
 *  by the caller only for `cell.corpus === 'wide'`; a default-corpus cell never calls this. */
async function countArtifactChips(rpc) {
  return evalJs(rpc, `(function(){
    var labels = ${JSON.stringify(Object.values(PROGRAM_LABELS))};
    var bar = document.querySelector('[aria-label="Open windows"]');
    if (!bar) return -1;
    var buttons = Array.from(bar.querySelectorAll('button[aria-label]'));
    return buttons.filter(function(b){
      var a = b.getAttribute('aria-label');
      var isProgram = labels.some(function(l){ return a.indexOf(l) === 0; });
      var isLauncher = a.indexOf('Open ') === 0;
      return !isProgram && !isLauncher;
    }).length;
  })()`);
}

/** Types `text` into the omnibox using the native-setter trick (React tracks its own value
 *  setter on the input, so a bare `el.value = x` is invisible to it — this is the standard,
 *  well-established way to drive a React-controlled input from outside React) and submits via
 *  `form.requestSubmit()`, which fires a real `submit` event React's `onSubmit` handles (App.tsx's
 *  own `e.preventDefault()` stops the native navigation the same way it would for a real user). */
async function typeAndSubmit(rpc, text) {
  const escaped = JSON.stringify(text);
  const ok = await evalJs(rpc, `(function(){
    var form = ${OMNIBOX_FORM};
    if (!form) return false;
    var input = form.querySelector('input');
    if (!input) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${escaped});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  return ok;
}

async function clickMicToggle(rpc) {
  return evalJs(rpc, `(function(){
    var form = ${OMNIBOX_FORM};
    var btn = form ? form.querySelector('button') : null;
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
}

async function isLiveNow(rpc) {
  return evalJs(rpc, `(function(){
    var form = ${OMNIBOX_FORM};
    var btn = form ? form.querySelector('button') : null;
    return !!(btn && btn.className.indexOf('bg-green-500') !== -1);
  })()`);
}

async function pollUntil(fn, { timeoutMs, intervalMs = 300 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Reads the omnibox form's `data-turn-open` attribute (App.tsx's `setOpenTurn`, the turn
 *  machine's own single writer for `openTurnRef` — `src/eval/turns.ts`'s `turnOpenAttr` decides
 *  what the string says). `null` if the form is not mounted at all (a malformed boot); treated the
 *  same as '1' (open) below — an unreadable signal must never be silently read as "settled". */
/** Reads the omnibox form's `data-turn-open` (App.tsx's `setOpenTurn`, the turn machine's own
 *  single writer for `openTurnRef` — `src/eval/turns.ts`'s `turnOpenAttr` decides the string).
 *  `null` from EITHER of two distinct sources, both read the same way by the caller (M2,
 *  settle-detector review, 2026-07-30 — the previous version of this doc named only the first):
 *  (1) the form is not mounted at all (a malformed boot), or (2) the form IS mounted but no turn
 *  has ever opened on it yet (`dataset.turnOpen` is simply `undefined` pre-first-turn — `??`
 *  below normalizes that to the same `null` case 1 already returns). Both fail SAFE toward "open"
 *  in `pollTurnSettled` below (neither `'0'` nor `'f'`), which is the right direction for either
 *  cause — an unreadable signal must never be silently read as settled. */
async function readTurnOpen(rpc) {
  return evalJs(rpc, `(function(){
    var form = ${OMNIBOX_FORM};
    return form ? (form.dataset.turnOpen ?? null) : null;
  })()`);
}

/** THE SETTLE-DETECTOR (Task 10, revised — I1/M1, settle-detector review, 2026-07-30): polls
 *  `data-turn-open` every `SETTLE_POLL_INTERVAL_MS` until it reads a terminal value or `ceilingMs`
 *  elapses, whichever comes first. Replaces the old fixed sleep between submits — a fast turn no
 *  longer wastes wall-clock, and a genuinely slow one is not cut off before `ceilingMs` the way the
 *  old fixed `SETTLE_MS.live` cut off anything past 8s.
 *
 *  THREE OUTCOMES, not two — `turnOpenAttr`'s own doc (turns.ts) has the full reasoning; summary:
 *  - `'settled'` ('0'): the turn closed through a tool-call ack — a commit, a refusal, or a
 *    collaborative `ask` (App.tsx's `ack()` is the ONE wrapper every tool call's result flows
 *    through, so all three are `'0'`, not just successful commits) — or through
 *    `transcription_lost` (an unreadable transcript closes on the spot). Ordinary conversational
 *    replies in this app ARE tool calls too (the `respond` tool), so most turns settle this way.
 *    This is the app genuinely answering (or definitively failing to transcribe) the request.
 *  - `'forceClosed'` ('f'): `flushOpenTurn` (App.tsx) closed it with NO ack and no lost transcript
 *    — the session ended out from under the open turn (an unrequested socket drop, or any of the
 *    three reconnect effects: dial/backend/program-swap changes). I1 (settle-detector review):
 *    folding this into "settled" let a mid-poll reconnect read as the app answering, over-reporting
 *    harness health in exactly the failure mode this counter exists to catch. Reported separately
 *    so a run's SETTLE-DETECTOR STATUS can say which happened, not just "closed, not our problem."
 *  - `'timedOut'`: neither of the above happened before `ceilingMs`. WHAT THIS CANNOT DISTINGUISH:
 *    a turn that settles as `speech_only` — the model said something but never called ANY tool —
 *    never flips the attribute on its own; it stays `'1'` until the NEXT utterance's `openTurn`
 *    supersede-closes it, or the session ends. From this poll alone that is indistinguishable from
 *    `no_response` (the model never answered at all) — both land here. That is not a harness
 *    shortcoming to fix from outside: turns.ts's own header says a speech-only turn is deliberately
 *    left OPEN rather than given an invented close event. The ceiling is the honest fallback for
 *    exactly that case.
 *
 *  Returns `{ outcome, waitedMs }` — `waitedMs` is ALWAYS the real elapsed time (`Date.now() -
 *  startedAt`), on every path including timeout (M1: the previous version reported the ceiling
 *  verbatim on timeout, overshooting real elapsed by up to one poll interval plus CDP round-trip
 *  latency — measured ~1040ms against a 900ms dry ceiling). On `'timedOut'`, the caller proceeds
 *  exactly as the old fixed sleep did (the next submit's `openTurn` supersede-closes whatever is
 *  still open) — this function only changes HOW LONG that takes, and now reports which of the
 *  three outcomes happened plus a genuinely-measured latency for it. */
async function pollTurnSettled(rpc, ceilingMs) {
  const startedAt = Date.now();
  const deadline = startedAt + ceilingMs;
  while (Date.now() < deadline) {
    const open = await readTurnOpen(rpc);
    if (open === '0') return { outcome: 'settled', waitedMs: Date.now() - startedAt };
    if (open === 'f') return { outcome: 'forceClosed', waitedMs: Date.now() - startedAt };
    await sleep(SETTLE_POLL_INTERVAL_MS);
  }
  return { outcome: 'timedOut', waitedMs: Date.now() - startedAt };
}

// I2 (settle-detector review, 2026-07-30): which utterance, per dry cell, the stub answers for
// real — see `injectDrySettleReply`'s own doc for the mechanism. Index 0 (the FIRST utterance of
// every dry cell): simplest to reason about (always exists, `cell.utterances.length` is never 0
// in any planned dry cell — see `buildPlan`), and exercising it on every cell rather than just
// once across the whole gate means each of the three dry sessions independently proves its own
// wiring rather than the gate leaning on a single lucky session.
const DRY_SETTLES_UTTERANCE_INDEX = 0;

/** I2 (settle-detector review, 2026-07-30): fires the CURRENT stub socket's `onmessage` (exposed
 *  as `window.__ffLiveSocket` — `STUB_SOCKET_SCRIPT`'s own doc) with a hand-built Gemini live
 *  frame naming the `respond` tool — the same tool this app's OWN conversational replies use, and
 *  the same wire shape the SDK's `handleWebSocketMessage` (`node_modules/@google/genai`) parses a
 *  real server frame into before calling the app's `onmessage`. This drives App.tsx's REAL
 *  `onToolCall` -> `handleVoiceToolCall` -> `ack()` path exactly as a genuine model reply would —
 *  nothing about the app's OWN turn-closing logic is faked, only the transport underneath it
 *  (which this whole file already fakes for --dry). Used for exactly `DRY_SETTLES_UTTERANCE_INDEX`
 *  of each dry cell's utterances, so `settleTotals.settled >= 1` becomes a STRUCTURAL property of
 *  a working dry gate rather than something no dry run could ever demonstrate either way. Throws
 *  loudly (not a silent no-op that would just look like an ordinary timeout) if `__ffLiveSocket`
 *  is missing — that would mean the stub wiring itself is broken, a materially different failure
 *  than "the settle-detector didn't detect a settle," and deserves a distinguishable error. */
async function injectDrySettleReply(rpc) {
  const dispatched = await evalJs(rpc, `(function(){
    var s = window.__ffLiveSocket;
    if (!s || !s.onmessage) return false;
    var msg = { toolCall: { functionCalls: [{ id: 'dry-settle-probe-' + Date.now(), name: 'respond',
      args: { seq: 'answer', guideLine: 'answer', cards: [{ t: 'answer', text: 'dry gate settle probe' }] } }] } };
    s.onmessage({ data: JSON.stringify(msg) });
    return true;
  })()`);
  if (!dispatched) {
    throw new Error(
      'injectDrySettleReply: window.__ffLiveSocket not found or has no onmessage handler — the ' +
      'dry stub socket wiring itself is broken (STUB_SOCKET_SCRIPT), not just "no settle detected"',
    );
  }
}

/** Opens the debug drawer, clicks "Export session JSON" (DebugDrawer.tsx — calls
 *  `telemetry.exportJSON()`, which triggers a real browser download via a synthetic `<a download>`
 *  click), and waits for `downloadDir` to receive a new, size-stable file (a partial/in-flight
 *  write would otherwise be read as truncated JSON). Requires `Page.setDownloadBehavior` to have
 *  already been set on this page (see `driveSession`). */
async function exportSession(rpc, downloadDir) {
  const opened = await evalJs(rpc, `(function(){
    var btn = document.querySelector('[aria-label="Debug drawer"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!opened) throw new Error('debug drawer toggle button not found — cannot export');
  await sleep(400); // Sheet mount (Radix Dialog)
  const clicked = await evalJs(rpc, `(function(){
    var btns = Array.from(document.querySelectorAll('button'));
    var b = btns.find(function(x){ return x.textContent && x.textContent.indexOf('Export session JSON') !== -1; });
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!clicked) throw new Error('"Export session JSON" button not found — cannot export');

  const before = new Set(safeReaddir(downloadDir));
  const found = await pollUntil(() => {
    const now = safeReaddir(downloadDir).filter((f) => !before.has(f) && f.endsWith('.json'));
    return now.length > 0;
  }, { timeoutMs: 10000, intervalMs: 300 });
  if (!found) throw new Error(`export did not produce a new .json file in ${downloadDir} within 10s`);

  const newFile = safeReaddir(downloadDir).find((f) => !before.has(f) && f.endsWith('.json'));
  const fullPath = path.join(downloadDir, newFile);
  // Wait for the file size to stabilize — Chrome writes downloads incrementally.
  let lastSize = -1;
  for (let i = 0; i < 20; i++) {
    const size = statSync(fullPath).size;
    if (size === lastSize && size > 0) break;
    lastSize = size;
    await sleep(150);
  }
  return fullPath;
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** C1 (task-9 review round 1, Critical): the app journals to `localStorage['ff-journal']` and
 *  restores desk/workspace/corpus/artifacts/dials from it at boot (`src/journal/registry.ts`,
 *  `src/App.tsx`'s various `bootStates?.` initializers) — ONE browser profile driving several
 *  sessions in a row therefore does NOT get a clean boot per session: session 2 restores session
 *  1's desk (probe-confirmed live: a second boot on the same profile restored 1407 bytes of
 *  journal and landed on Excel, not Word), and worse, a `corpus:'wide'` cell whose session isn't
 *  actually the FIRST to touch that profile boots the RESTORED default corpus while `manifest.json`
 *  and the summary doc both still call it `wide` — a false claim about the one thing §3's wide-
 *  corpus cell exists to test.
 *
 *  P2 (task-9 review round 3, Minor — supersedes round 1's original fix and round 2's N4 patch):
 *  the first two rounds cleared storage by NAVIGATING to the origin, which loads the FULL APP —
 *  including whatever the PREVIOUS session's journal restores into a live React tree — for a
 *  throwaway ~600ms before `localStorage.clear()` ever ran. That is a real risk class: `App.tsx`
 *  installs a `pagehide` handler that flushes the journal on unload once a save timer has ever
 *  armed, and the debounce callback never nulls that timer handle, so a SINGLE `journalAppend`
 *  during the throwaway boot arms it permanently — a later `Page.navigate` (the unload that fires
 *  `pagehide`) could then re-write the journal AFTER the clear, silently reopening C1 through a
 *  side door. Round 2's guard (re-reading `localStorage` right after `clear()`) could not catch
 *  this because the resurrection it names fires ON UNLOAD, strictly AFTER that read.
 *
 *  THE FIX: CDP's `Storage.clearDataForOrigin` clears an origin's storage directly, at the
 *  browser/storage-partition level — no navigate, no mount, no throwaway React tree, ever. Probed
 *  working from a page still on `about:blank` that had NEVER visited the target origin (i.e. the
 *  exact shape `driveSession` uses): a dirty profile (834B journal, mid-Excel-switch) cleared in
 *  0ms, and the next real boot on that profile came up with a fresh, small journal and Word in
 *  front — same outcome as the navigate-based approach, with the entire risk class removed rather
 *  than guarded. */
async function clearOriginStorage(rpc, browserUrl) {
  // Q2 (task-9 review round 4, Minor): `session_storage` is not a valid CDP `StorageType` (the real
  // enum members are `cookies`, `local_storage`, `indexeddb`, `websql`, `service_workers`, `cache_storage`
  // and a few others — no `session_storage`); CDP silently ignores the unrecognized member rather than
  // erroring, so this was an inert no-op ingredient, not a functional bug (a fresh target's own
  // sessionStorage is empty anyway). `'all'` clears everything CDP knows about this origin, which is
  // both correct and simpler than naming individual types.
  await rpc('Storage.clearDataForOrigin', { origin: browserUrl, storageTypes: 'all' });
}

/** I1 (task-9 review round 1, Important): `recordSessionEnd` (App.tsx) — which flushes the last
 *  OPEN turn (`flushOpenTurn`, closing it `speech_only`/`no_response` exactly like a superseding
 *  turn would) and pushes `session_complete` (the run's `framesSent`/`hintsSent`, spec §1's cost
 *  requirement) — only fires from `closeLiveSession`, which only fires from an explicit end (mic
 *  toggle off, "End session", the idle guard, or a reconnect effect). Nothing in the utterance loop
 *  below ever calls it, so the LAST utterance of every run was exported still pending (never
 *  graded) and the LAST run's cost never reached the export at all — measured before this fix: 6
 *  typed -> 5 `turn` events, `session_complete` present for 2 of 3 runs. Toggling the mic off here
 *  (the same button `clickMicToggle` uses — it toggles either direction) is the ordinary,
 *  documented way a user ends a session, and is what makes the LAST utterance's turn and the LAST
 *  run's cost actually reach the export. */
// N3 (task-9 review round 2, Important): `endSession` had no post-condition (and no pre-condition
// either) — `clickMicToggle` only reports "a button was clicked", never "the session actually
// ended". The connect path already checks BOTH directions (`clickMicToggle` + `pollUntil(isLiveNow)`
// below, in `driveSession`); this mirrors it. Two real failure modes this closes: (1) if the
// session was ALREADY down when this fires (a dropped socket, or a reconnect from the LAST
// program swap still in flight — every default cell does 15 mid-session swaps, one per program
// change between consecutive rows of the 28-row default utterance corpus (counted once, off the
// corpus's own `program` sequence — Q4/task-9 review round 4 — not a rounded estimate), each a real
// close/reconnect), clicking the toggle STARTS a session instead of ending one — the last turn is never
// flushed (I1's defect, reintroduced silently) and, under --live, a real billed connection opens
// and runs until the page closes; (2) if the click lands but the app never actually tears down
// (a wedged reconnect effect), the export would still be attempted against a live-but-unflushed
// stream. Both now fail LOUDLY here instead of silently truncating the export.
// P4 (task-9 review round 3, disclosed rather than fixed — both residual, both narrower than what
// N3 closed):
// (a) The post-check asserts "not live NOW", not "was live, THEN went not-live" — `pollUntil`
//     samples its predicate before its first sleep, so if the session drops in the ~one-RPC window
//     between the pre-check above and the click, the click itself STARTS a fresh session and the
//     very first `!isLiveNow` sample already reads true, reporting a clean end while a new
//     (billed, under --live) connection is coming up. Far narrower than round-1's N3 (that version
//     had no checks at all), but not eliminated — a real fix needs either an observed true->false
//     transition or a post-hoc check that the exported stream's `session_complete` count equals
//     its `session_start` count.
// (b) The pre-check's throw discards the WHOLE export, including every turn already paid for, if
//     the session dropped on its own near the end (a mid-session program swap's reconnect racing
//     the final settle sleep). At 15 program-swap reconnects per live default session (the default
//     corpus's own program sequence — see the `15 mid-session swaps` comment above) and
//     `MAX_CONSECUTIVE_FAILURES = 2`, two such sessions in a row would abort a paid 12-session
//     pilot run over a single dropped socket near the finish line. A softer alternative (export
//     anyway, flag the manifest entry `endedCleanly: false` instead of discarding) was considered
//     and left undone — it is a real behavior/schema change, not a one-line fix, and belongs in a
//     dedicated pass rather than folded into this round.
async function endSession(rpc) {
  const wasLive = await isLiveNow(rpc);
  if (!wasLive) {
    throw new Error('endSession: the session was already down before the end-toggle — clicking now would START a new one rather than end the current one');
  }
  const clicked = await clickMicToggle(rpc);
  if (!clicked) throw new Error('mic toggle button not found when ending the session — the final turn/session_complete would be lost');
  const ended = await pollUntil(async () => !(await isLiveNow(rpc)), { timeoutMs: CONNECT_TIMEOUT_MS, intervalMs: 300 });
  if (!ended) throw new Error(`session did not actually end within ${CONNECT_TIMEOUT_MS}ms after the toggle — export would have been taken against a still-live stream`);
  await sleep(500); // let recordSessionEnd's synchronous work (already done by click time) settle into a render
}

/** Drives one session end to end: clean boot -> connect -> type every utterance in
 *  `cell.utterances` -> end the session -> export -> return `{ path, settleStats }`.
 *
 *  SETTLE-WAIT SCOPE NOTE (Task 10, resolved): the fixed `SETTLE_MS` sleep this docstring used to
 *  name is gone. Each utterance now waits on `pollTurnSettled` — a real poll of `data-turn-open`,
 *  the turn machine's own state (App.tsx's `setOpenTurn`, written at the exact seams `openTurnRef`
 *  itself is written; `src/eval/turns.ts`'s `turnOpenAttr`) — with `MAX_SETTLE_MS[mode]` as a
 *  ceiling rather than a flat tax. See `pollTurnSettled`'s own doc for exactly which settle paths
 *  it can and cannot see (tool-call ack, including `respond`, covers most turns; a pure
 *  `speech_only` reply with no tool call at all still rides the ceiling, by the app's own honest
 *  design — turns.ts leaves that case open rather than inventing a close event for it; a session end
 *  or reconnect force-closes it too, counted separately as `forceClosed` rather than folded into a
 *  genuine settle — I1, settle-detector review, 2026-07-30). `settleStats` (settled / forceClosed /
 *  timed-out, plus each genuine settle's real latency, per session) is this poll's own health
 *  record, carried into the manifest.
 *
 *  C2 (task-9 review round 1, Critical): the actual work below runs inside `withTimeout`, INSIDE
 *  this function's own try/finally — not, as before, wrapped from the OUTSIDE by the caller. That
 *  distinction is the whole fix: wrapping from outside let `SESSION_TIMEOUT_MS` bound how long
 *  `main()` waited without ever touching the page/socket the abandoned call left running — a
 *  wedged renderer kept a live page, a live provider socket, and (under --live) live spend, while
 *  the NEXT session started on the same browser. Timing out in here still runs the `finally` below,
 *  which tears the page and its CDP socket down for real before `driveSession` returns/rejects. */
async function driveSession(browserUrl, cdpPort, cell, mode, outDir) {
  const { rpc, ws, target, consoleLines } = await openPage(cdpPort);
  const work = async () => {
    if (mode === 'dry') await rpc('Page.addScriptToEvaluateOnNewDocument', { source: STUB_SOCKET_SCRIPT });
    const downloadDir = path.join(outDir, 'downloads', `${cell.register}-${cell.shell}-${cell.corpus}-${Date.now()}`);
    mkdirSync(downloadDir, { recursive: true });
    await rpc('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    // C1: clean boot BEFORE the real navigate — see clearOriginStorage's own doc.
    await clearOriginStorage(rpc, browserUrl);

    const url = bootUrl(browserUrl, cell);
    await rpc('Page.navigate', { url });
    await sleep(BOOT_WAIT_MS);

    // Belt-and-suspenders device gate bypass (App.tsx's `isWideEnough` — should never trigger at
    // 1600x1000, but a headless quirk that reports the wrong metrics should not silently stall a
    // whole session on a screen this script never looks at otherwise).
    await evalJs(rpc, `(function(){
      var btns = Array.from(document.querySelectorAll('button'));
      var b = btns.find(function(x){ return x.textContent && x.textContent.indexOf('Continue anyway') !== -1; });
      if (b) b.click();
      return !!b;
    })()`);

    // I5 (task-9 review round 1) / N1 (round 2) / P1 (round 3): with C1's clean boot, the desk
    // should always land on DEFAULT_PROGRAM ('word' — scenarios.ts; there is no `?program=` boot
    // param) — but "should" is exactly the word that was silently wrong before C1 existed (a
    // journal restore put Excel in front). ASSERT the real active program via CDP rather than
    // assume it: an excel/powerpoint/photo utterance sent while the wrong program is active is
    // meaningless (`expect` is a property of (text, program), not text alone — utterances.ts's own
    // header), and a silent mismatch here is exactly how a pilot's cell labels end up lying.
    // `readActiveProgram`'s own doc has the two-round history of getting this predicate right —
    // it now works under BOTH a `corpus:'wide'` boot (an artifact window, not a program window,
    // can hold visual focus) and a post-swap/journal-restore boot (a minimized program chip must
    // not be mistaken for the active one).
    const active = await readActiveProgram(rpc);
    if (active !== 'word') {
      throw new Error(`boot assertion failed: expected active program 'word' (DEFAULT_PROGRAM) after a clean boot, got '${active ?? 'none detected'}' — journal not actually clean, or the desk failed to mount`);
    }
    // P5 (task-9 review round 3, Minor): the cell's `corpus:'wide'` label is otherwise an
    // unverified claim (see `countArtifactChips`'s own doc) — assert the seed actually landed
    // rather than trusting the boot URL alone did its job.
    if (cell.corpus === 'wide') {
      const artifactCount = await countArtifactChips(rpc);
      if (artifactCount !== WIDE_CORPUS_ARTIFACT_COUNT) {
        throw new Error(`wide-corpus boot assertion failed: expected ${WIDE_CORPUS_ARTIFACT_COUNT} seeded artifact chips, found ${artifactCount} — ?corpus=wide did not seed as expected, or the desk failed to mount them`);
      }
    }
    // M4 (settle-detector review, 2026-07-30): `OMNIBOX_FORM` (`document.querySelector('[data-shell]
    // form')`) is FIRST-MATCH-WINS and is now load-bearing for measurement (`typeAndSubmit`,
    // `readTurnOpen` — the whole settle-detector reads `data-turn-open` off whatever this selector
    // finds first). Verified at HEAD that exactly one `<form>` sits under `[data-shell]` in this
    // app's tree, but nothing enforces that staying true — a future form mounted earlier in
    // document order would silently turn every utterance into a ceiling-ride that LOOKS like a
    // 100%-timeout slow-model run rather than a selector bug. Asserted once per session, right
    // beside the other boot assertions, rather than trusted forever.
    const formCount = await evalJs(rpc, `document.querySelectorAll('[data-shell] form').length`);
    if (formCount !== 1) {
      throw new Error(`boot assertion failed: expected exactly 1 form under [data-shell], found ${formCount} — OMNIBOX_FORM ("${OMNIBOX_FORM}") is first-match-wins and load-bearing for the settle-detector (typeAndSubmit, readTurnOpen); a second form earlier in document order would silently read the wrong element`);
    }
    let currentProgram = active;
    if (cell.utterances.length && cell.utterances[0].program !== currentProgram) {
      const switched = await switchProgram(rpc, cell.utterances[0].program);
      if (!switched) throw new Error(`program launcher/chip not found for "${cell.utterances[0].program}"`);
      currentProgram = cell.utterances[0].program;
      await sleep(600); // window-swap settle — no live session yet, nothing to reconnect
    }

    // Session order (decision 5): connect BEFORE typing.
    const clicked = await clickMicToggle(rpc);
    if (!clicked) throw new Error('mic toggle button not found at boot — omnibox never mounted?');
    const connected = await pollUntil(() => isLiveNow(rpc), { timeoutMs: CONNECT_TIMEOUT_MS, intervalMs: 300 });
    if (!connected) throw new Error(`session never reached isLive within ${CONNECT_TIMEOUT_MS}ms`);

    // Settle-detector health for THIS session (Task 10; three-bucket shape — I1, settle-detector
    // review, 2026-07-30): how many of its utterances settled via a real close (`data-turn-open`
    // '0'), force-closed out from under an open turn (session end/reconnect — 'f'), or rode
    // `MAX_SETTLE_MS[mode]`'s ceiling with no close at all. `settledWaitedMs` (M1) keeps the real
    // elapsed time for every GENUINE settle only — `forceClosed`/`timedOut` latencies are not a
    // measurement of how fast the app answered anything, so they are counted but not averaged in.
    // Surfaced in the manifest per session — a run with many timeouts is still harness-limited on
    // whatever fraction that is; a run with few is finally measuring the app, not the poll ceiling.
    const settleStats = { settled: 0, forceClosed: 0, timedOut: 0, settledWaitedMs: [] };
    for (const [idx, u] of cell.utterances.entries()) {
      if (u.program !== currentProgram) {
        // A mid-session program swap reconnects (App.tsx's `activeProgram` effect: close, wait
        // 800ms, reconnect — the tool list/system prompt are program-scoped). NOT a
        // `pollUntil(isLiveNow, ...)` wait here, deliberately: `isLive` is ALREADY true from the
        // session this swap is about to tear down, so polling that same condition would read the
        // stale "true" on its very first check and return immediately, before the close/800ms-
        // delay/reconnect cycle even starts — a real race, not a hypothetical one. `data-turn-open`
        // does not help here either, but NOT because a reconnect leaves it alone — it does not:
        // `closeLiveSession` -> `recordSessionEnd` -> `flushOpenTurn` force-closes whatever turn
        // was open (App.tsx's `setOpenTurn(null, 'flushed')`, read here as `'f'` — I1,
        // settle-detector review, 2026-07-30). That close fires at the START of the reconnect, not
        // when the NEW session becomes ready, so polling `data-turn-open` here would read
        // `settled`/`forceClosed` almost instantly and tell us nothing about whether the 800ms
        // close/reconnect cycle actually finished. This stays a fixed sleep past the app's own
        // 800ms reconnect delay (with margin for the stub connect itself) because THIS wait is
        // about session readiness, a different question than the per-utterance turn wait below.
        const switched = await switchProgram(rpc, u.program);
        if (!switched) throw new Error(`program launcher/chip not found for "${u.program}"`);
        currentProgram = u.program;
        await sleep(PROGRAM_SWAP_WAIT_MS);
      }
      const ok = await typeAndSubmit(rpc, u.text);
      if (!ok) throw new Error(`omnibox not found when submitting utterance "${u.key}"`);
      // I2 (settle-detector review, 2026-07-30): in dry mode, make the designated utterance
      // genuinely settle instead of riding the ceiling like every other dry utterance — see
      // `injectDrySettleReply`'s own doc for why. Injected BEFORE the poll below starts (rather
      // than raced against it) so the poll's very first check can already see it, keeping the dry
      // gate exactly as fast as it was — this reply is not meant to simulate real latency, only to
      // prove the detector's wiring end to end.
      if (mode === 'dry' && idx === DRY_SETTLES_UTTERANCE_INDEX) {
        await injectDrySettleReply(rpc);
      }
      // THE SETTLE-DETECTOR (Task 10) — see `pollTurnSettled`'s own doc for exactly which settle
      // paths it can and cannot see, and why a ceiling remains even with a real poll in place.
      const { outcome, waitedMs } = await pollTurnSettled(rpc, MAX_SETTLE_MS[mode]);
      if (outcome === 'settled') { settleStats.settled += 1; settleStats.settledWaitedMs.push(waitedMs); }
      else if (outcome === 'forceClosed') settleStats.forceClosed += 1;
      else settleStats.timedOut += 1;
    }

    // I1: end the session for real BEFORE exporting — this is what flushes the LAST utterance's
    // still-open turn and pushes `session_complete` (cost data) into the stream `exportJSON()`
    // reads. A trailing sleep alone (the pre-fix code) supersedes nothing; only a genuine close
    // does (see `endSession`'s own doc).
    await endSession(rpc);

    const savedPath = await exportSession(rpc, downloadDir);
    const destName = `${cell.register}-${cell.shell}-${cell.backend}-${cell.corpus}-${Date.now()}.json`;
    const destPath = path.join(outDir, 'exports', destName);
    mkdirSync(path.dirname(destPath), { recursive: true });
    copyFileSync(savedPath, destPath);
    return { path: destPath, settleStats };
  };

  try {
    return await withTimeout(work(), SESSION_TIMEOUT_MS, `session (${cell.register}/${cell.shell}/${cell.corpus})`);
  } catch (err) {
    // M4 (task-9 review round 1): `consoleLines` was being collected and never read — a failed
    // session printed no page console output despite the harness having captured it the whole
    // time. Surfaced only on failure (a passing session's console is noise; a failing one's is
    // often the fastest way to see WHY, e.g. a React error boundary or an uncaught exception in
    // the injected stub script).
    if (consoleLines.length) {
      console.error(`[battery]   page console (last ${Math.min(10, consoleLines.length)} of ${consoleLines.length} lines):`);
      for (const line of consoleLines.slice(-10)) console.error(`[battery]     ${line}`);
    }
    throw err;
  } finally {
    // C2: unconditional, and each step individually bounded — a wedged renderer must not be able
    // to hang the CLEANUP too (a `Page.close` CDP round-trip still needs the target to answer;
    // `ws.close()` alone is purely client-side and can never hang, so it always runs regardless of
    // whether the bounded `Page.close` attempt above it succeeded, timed out, or errored).
    try {
      await withTimeout(rpc('Page.close'), 5000, 'Page.close during cleanup');
    } catch {
      // N5: `Page.close` itself timed out/errored — fall back to a browser-level close, which does
      // not depend on this (possibly wedged) page's own session answering (see forceCloseTarget's
      // own doc). Best effort: `ws.close()` below still runs regardless of how this goes.
      await forceCloseTarget(cdpPort, target.id);
    }
    try { ws.close(); } catch { /* already gone */ }
  }
}

// ---- session plan ----

// I3 (task-9 review round 1): `wide-corpus-far-row-ask`/`wide-corpus-near-row-answer`
// (src/eval/utterances.ts) are explicit, by their OWN comments, about running "ONLY under
// `?corpus=wide`" — against the default ~4-element Meridian corpus there is no row 30 (or row 3 in
// the sense the row means) to ask about at all, so sending them into a `corpus:'default'` cell
// isn't a harder trial, it's a meaningless one. Filtered here, once, so every plan (dry or live)
// gets it right rather than relying on the dry slice happening to exclude them by position.
function utterancesForCorpus(utterances, corpus) {
  return utterances.filter((u) => !u.key.startsWith('wide-corpus-') || corpus === 'wide');
}

function buildPlan(mode, utterances) {
  if (mode === 'dry') {
    // THE GATE (task-9 brief, verbatim): "--dry across 2 arms (guided + terminal)". A short
    // utterance slice keeps the dry gate fast — zero-spend means there is nothing to lose by
    // sending fewer rows, and the gate only requires >=2 gradeable exports with a nonzero attempt
    // count, not full corpus coverage (that is what a full --live pilot run is for).
    const defaultSlice = utterancesForCorpus(utterances.slice(0, 6), 'default');
    // N1 (task-9 review round 2, Critical): the dry plan used to be default-corpus-only, so the
    // gate could not have caught the round-1 boot assertion breaking every `corpus:'wide'` session
    // (discovered only by the reviewer's own probe, after the round-1 fix would have burned ~50
    // minutes of real spend on session 9 of a live run before failing). A third cell here — real
    // `?corpus=wide` boot, real wide-only utterance rows via `utterancesForCorpus` — closes that
    // structural gap: this class of defect fails THE GATE from now on, at zero cost.
    const wideSlice = utterancesForCorpus(
      [...utterances.slice(0, 3), ...utterances.filter((u) => u.key.startsWith('wide-corpus-'))],
      'wide',
    );
    return [
      { register: 'guided', shell: 'familiar', backend: 'gemini', corpus: 'default', utterances: defaultSlice },
      { register: 'terminal', shell: 'familiar', backend: 'gemini', corpus: 'default', utterances: defaultSlice },
      { register: 'guided', shell: 'familiar', backend: 'gemini', corpus: 'wide', utterances: wideSlice },
    ];
  }
  // --live: the pilot spec (§5, rulings 2026-07-29) — "3 repeats x 4 registers, Gemini only; the
  // wide corpus runs on Guided only." Read literally that is 12 default-corpus sessions PLUS an
  // unspecified number of wide-corpus ones, which would exceed MAX_SESSIONS=12 — a cap chosen to
  // equal exactly 3x4. JUDGMENT CALL (undocumented in the spec, flagged for Task 10 to confirm):
  // one of Guided's three repeats is spent on the wide corpus instead of a fourth default-corpus
  // slot, so the total stays 12. Every other register's three repeats stay default-corpus.
  const registers = ['terminal', 'ambient', 'guided', 'cockpit'];
  const plan = [];
  for (const register of registers) {
    for (let i = 0; i < 3; i++) {
      const corpus = register === 'guided' && i === 2 ? 'wide' : 'default';
      plan.push({ register, shell: 'familiar', backend: 'gemini', corpus, utterances: utterancesForCorpus(utterances, corpus) });
    }
  }
  return plan;
}

async function main() {
  const utterances = loadUtterances();
  const plan = buildPlan(mode, utterances);
  if (plan.length > MAX_SESSIONS) {
    throw new Error(`planned ${plan.length} sessions, exceeds MAX_SESSIONS=${MAX_SESSIONS} — refusing to start`);
  }
  // C1 (settle-detector review, 2026-07-30): fail loud HERE, before any browser/vite process
  // spawns, if this plan's own worst-case session would exceed SESSION_TIMEOUT_MS — see
  // `assertSessionBudget`'s own doc for why (a session that hits the timeout is torn down before
  // `exportSession` ever runs, losing everything already driven and, under --live, already paid
  // for; two in a row aborts the whole pilot with zero data from either).
  assertSessionBudget(plan, mode);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(OUT_ROOT, runId);
  mkdirSync(outDir, { recursive: true });
  console.log(`[battery] mode=${mode} sessions=${plan.length} outDir=${outDir}`);

  const cdpPort = await getFreePort();
  // Task 10: both modes now get their own dedicated free port — server.ts's `PORT` env override
  // makes `--live` able to honor this the same way `--dry`'s raw `vite` invocation always could.
  const vitePort = await getFreePort();
  const userDataDir = path.join(os.tmpdir(), `ff-battery-${runId}`);

  const browserProc = spawnBrowser(cdpPort, userDataDir);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 15000, 'chrome-headless-shell CDP endpoint', browserProc);
  const { proc: viteProc, url } = await startViteOrDry(mode, vitePort);

  const manifestEntries = [];
  let consecutiveFailures = 0;
  // I2 (task-9 review round 1, Important): captured rather than left to propagate straight past
  // the manifest write below. Before this fix, hitting `MAX_CONSECUTIVE_FAILURES` threw out of the
  // loop and `main()` never reached the `writeFileSync` two blocks down — every already-PAID-FOR
  // successful export in `manifestEntries` was stranded with no manifest to graded it by. The
  // manifest (and therefore `summarize.mjs`'s ability to grade whatever succeeded) is now written
  // UNCONDITIONALLY; `abortError`, if set, is re-thrown only after that write, so the exit code
  // still honestly reflects an aborted run.
  let abortError = null;
  try {
    for (const cell of plan) {
      console.log(`[battery] session: register=${cell.register} shell=${cell.shell} corpus=${cell.corpus}`);
      try {
        // C2: `driveSession` now bounds AND tears down internally (see its own docstring) — no
        // outer `withTimeout` here any more. The old outer wrap was the C2 bug itself: it bounded
        // how long THIS LOOP waited without ever reaching into `driveSession` to close the page/
        // socket a timeout abandoned, so a wedged session kept running (and, under --live, kept
        // spending) while the next one started on the same browser.
        const { path: exportPath, settleStats } = await driveSession(url, cdpPort, cell, mode, outDir);
        manifestEntries.push({
          file: exportPath, register: cell.register, shell: cell.shell,
          backend: cell.backend, corpus: cell.corpus, settleStats,
        });
        consecutiveFailures = 0;
        console.log(`[battery]   -> exported ${path.relative(ROOT, exportPath)} `
          + `(settle: ${settleStats.settled} settled, ${settleStats.forceClosed} force-closed, `
          + `${settleStats.timedOut} timed out)`);
      } catch (err) {
        consecutiveFailures += 1;
        console.error(`[battery]   FAILED (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          abortError = new Error(`aborting: ${MAX_CONSECUTIVE_FAILURES} consecutive session failures`);
          break;
        }
      }
    }
  } finally {
    killProc(viteProc);
    killProc(browserProc);
  }

  // N2 (task-9 review round 2, Important): I2 (round 1) made the manifest survive an abort but
  // stopped there — an aborted run's manifest was indistinguishable in SHAPE from a healthy short
  // run's, so the rendered doc read exactly like a complete pilot with fewer cells, not like a run
  // that stopped early. `aborted`/`abortReason`/`plannedSessions` are the fields
  // `ts-bridge.ts`/`summarize.mjs` need to render an explicit banner naming what happened — the
  // plan's own words: "the aborted pilot's partial summary IS the deliverable" — it must SAY it
  // was aborted, not just avoid losing the data.
  // Task 10 (settle-detector): the run-wide roll-up of every session's `settleStats` — harness-
  // health data, not app-grading data (that stays ts-bridge's job; this is plain arithmetic over
  // what `pollTurnSettled` already recorded per utterance). A run with many timeouts is still
  // harness-limited on whatever fraction that is; a run with few is finally measuring the app.
  //
  // M5 (settle-detector review, 2026-07-30): this reduces over `manifestEntries` ONLY — sessions
  // that produced a gradeable export. A session that THREW (a `catch` below, never reaching the
  // `manifestEntries.push`) contributes NOTHING here, including whatever utterances it drove
  // before failing — its `settleStats` never left `driveSession`'s local scope. `sessionsCounted`
  // records that denominator explicitly (== `manifestEntries.length`) so a reader — or
  // `summarize.mjs`'s banner — can say what these totals do and do not cover, rather than let
  // "N of TOTAL utterance(s)" imply TOTAL was every utterance this run attempted.
  const settleTotals = manifestEntries.reduce((acc, e) => ({
    settled: acc.settled + (e.settleStats?.settled ?? 0),
    forceClosed: acc.forceClosed + (e.settleStats?.forceClosed ?? 0),
    timedOut: acc.timedOut + (e.settleStats?.timedOut ?? 0),
    settledWaitedMs: acc.settledWaitedMs.concat(e.settleStats?.settledWaitedMs ?? []),
  }), { settled: 0, forceClosed: 0, timedOut: 0, settledWaitedMs: [] });
  // M1 (settle-detector review): the payoff number this whole feature exists to produce — how
  // fast a GENUINE settle actually happens, not just how many did. Median, not mean: a handful of
  // slow real acks should not be able to drag the headline number the way an outlier mean would.
  const sortedSettledMs = [...settleTotals.settledWaitedMs].sort((a, b) => a - b);
  const medianSettledWaitedMs = sortedSettledMs.length
    ? (sortedSettledMs.length % 2 === 1
        ? sortedSettledMs[(sortedSettledMs.length - 1) / 2]
        : Math.round((sortedSettledMs[sortedSettledMs.length / 2 - 1] + sortedSettledMs[sortedSettledMs.length / 2]) / 2))
    : null;
  const manifest = {
    mode, createdAt: new Date().toISOString(),
    aborted: !!abortError, abortReason: abortError ? abortError.message : null,
    plannedSessions: plan.length, entries: manifestEntries,
    settleTotals: {
      settled: settleTotals.settled, forceClosed: settleTotals.forceClosed, timedOut: settleTotals.timedOut,
      medianSettledWaitedMs, sessionsCounted: manifestEntries.length,
    },
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[battery] manifest: ${path.relative(ROOT, manifestPath)}`);
  console.log(`[battery] ${manifestEntries.length}/${plan.length} sessions produced a gradeable export`);
  console.log(`[battery] settle-detector: ${settleTotals.settled} settled (median ${medianSettledWaitedMs ?? 'n/a'}ms), `
    + `${settleTotals.forceClosed} force-closed, ${settleTotals.timedOut} timed out (ceiling ${MAX_SETTLE_MS[mode]}ms)`);
  // P7 (task-9 review round 3): the EXACT command, not just the bare path — a bare
  // `node scripts/battery/summarize.mjs` (no argument) grades the NEWEST manifest under `out/`,
  // which is only this run's if nothing else has run since. Printing the full invocation removes
  // that ambiguity for a human copy-pasting the last line, on a healthy run or an aborted one alike.
  console.log(`node scripts/battery/summarize.mjs ${path.relative(ROOT, manifestPath)}`);

  if (abortError) throw abortError;
  if (manifestEntries.length === 0) {
    throw new Error('no session produced a gradeable export — nothing for summarize.mjs to grade');
  }
}

main().catch((err) => {
  console.error('[battery] FATAL:', err.stack ?? err.message ?? err);
  process.exit(1);
});
