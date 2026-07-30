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
//   --dry   Zero spend. Own vite server, inline STUB env (never reads/writes .env), and every
//           socket to Gemini's live endpoint is faked in-browser (see STUB_SOCKET_SCRIPT below) —
//           the app runs its real gate, real telemetry, real turn machinery; nothing leaves this
//           machine. The model never replies, so every turn eventually settles `no_response`/
//           `speech_only` and every attempt grades `abandoned` — a real, honest measurement of the
//           harness itself, not a fabricated pass. This is what THE GATE (task-9 brief) runs.
//   --live  Real spend. Starts `npm run dev` (which reads `.env` itself — this script never does)
//           and drives real utterances against the real model. NOT run by this task — Task 10's
//           job, under its own protocol. See the KNOWN LIMITATION comment on `startViteOrDev`
//           below: `server.ts` hardcodes port 3000, which is in tension with "a dedicated port"
//           for this mode; flagged, not silently worked around.
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
const SESSION_TIMEOUT_MS = 360_000;
const MAX_CONSECUTIVE_FAILURES = 2;

// ---- Ports the brief explicitly forbids this script from ever touching: real keys live there ----
const FORBIDDEN_PORTS = new Set([3000, 3002]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_ROOT = path.join(HERE, 'out');

// Per-utterance settle wait. DRY has no model to wait for — a short pause is enough for React to
// flush the submit and for the NEXT submit's `openTurn` to supersede-close this one (turns.ts: a
// new turn opening while one is still pending force-closes the previous as `no_response`/
// `speech_only` — the mechanism that makes every dry-run attempt gradeable with zero real spend).
// LIVE's figure is a fixed, generous placeholder, not a real settle-detector — see the docstring on
// `driveSession` below for why polling was deliberately NOT built for this task's scope.
const SETTLE_MS = { dry: 900, live: 8000 };
const BOOT_WAIT_MS = 2500;
const CONNECT_TIMEOUT_MS = 15000;

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
  versions.sort().reverse(); // newest version string last-modified-ish; good enough, deterministic
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

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
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

/** KNOWN LIMITATION (documented rather than silently worked around — see the file header):
 *  `server.ts` (the `npm run dev` entry --live uses) hardcodes `PORT = 3000` with no env override,
 *  so --live cannot actually honor "a dedicated port" the way --dry's raw `vite` invocation can.
 *  This function still refuses to run if 3000 looks occupied (a real dev session almost certainly
 *  IS running there per this repo's own history — see the smoke docs) rather than silently
 *  colliding with a server carrying real keys; it does not attempt to patch `server.ts`, which
 *  would be a source change outside this task's authorized scope (App.tsx's `?register=` param is
 *  the only one). Task 10 needs to resolve this before a live run can safely proceed unattended. */
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
    await waitForHttp(`http://localhost:${vitePort}/`, 20000, 'dry vite server');
    return { proc, url: `http://localhost:${vitePort}` };
  }
  // --live
  if (vitePort !== 3000) {
    console.warn(`[battery] --live ignores the picked free port (${vitePort}) — server.ts hardcodes 3000 (see KNOWN LIMITATION above).`);
  }
  const proc = spawn('npm', ['run', 'dev'], { cwd: ROOT, stdio: 'ignore', env: process.env });
  await waitForHttp('http://localhost:3000/', 20000, 'live dev server');
  return { proc, url: 'http://localhost:3000' };
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

// ---- the silent-mic stub socket (--dry only) ----
// Fakes ONLY sockets to Gemini's live endpoint (generativelanguage.googleapis.com — confirmed by
// reading node_modules/@google/genai's BrowserWebSocket, which calls the bare global `WebSocket`
// the bundler leaves pointing at `window.WebSocket`). Every other socket — Vite's HMR client in
// particular — passes through to the real constructor untouched, exactly like the prior drive's
// documented "only sockets to stub.invalid are faked" rule.
//
// The SDK's own `onopen` callback fires on the RAW socket's open event (read from
// dist/web/index.mjs's `live.connect`: `conn.connect()` sets `ws.onopen = callbacks.onopen`
// directly — there is no server handshake message gating it, e.g. no `setupComplete` wait before
// the app's `cb.onOpen()` runs). So the stub only needs to become "open" — it never needs to speak
// Gemini's wire protocol at all. It never calls `onmessage`, so the model never replies: every
// turn the battery opens is destined to settle `no_response`/`speech_only`, which is the honest,
// zero-spend measurement this mode exists to produce (see the file header).
const STUB_SOCKET_SCRIPT = `(function(){
  if (window.__ffStubInstalled) return;
  window.__ffStubInstalled = true;
  window.__ffBatterySent = [];
  var RealWS = window.WebSocket;
  function StubSocket(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
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
    if (typeof url === 'string' && url.indexOf('generativelanguage.googleapis.com') !== -1) {
      return new StubSocket(url);
    }
    return new RealWS(url, protocols);
  }
  FakeWebSocket.prototype = RealWS.prototype;
  FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
  window.WebSocket = FakeWebSocket;
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

/** Drives one session end to end: boot -> connect -> type every utterance in `cell.utterances` ->
 *  export -> return the export's saved path. SETTLE-WAIT SCOPE NOTE: this uses a fixed sleep
 *  between submits (`SETTLE_MS`), not a real "wait for the model to finish responding" poll. That
 *  is an honest simplification for THIS task's scope (the dry gate never gets a response to wait
 *  for at all — see the file header), not an oversight for --live: a real settle-detector (poll
 *  the omnibox's `aria-label="Assistant is working"` busy pulse, or grow-watch the telemetry
 *  stream) is real, additional work Task 10 should do before spending real tokens on a long
 *  session, and is flagged in this task's final report rather than half-built here. */
async function driveSession(browserUrl, cdpPort, cell, mode, outDir) {
  const { rpc, ws, target } = await openPage(cdpPort);
  try {
    if (mode === 'dry') await rpc('Page.addScriptToEvaluateOnNewDocument', { source: STUB_SOCKET_SCRIPT });
    const downloadDir = path.join(outDir, 'downloads', `${cell.register}-${cell.shell}-${cell.corpus}-${Date.now()}`);
    mkdirSync(downloadDir, { recursive: true });
    await rpc('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

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

    // The desk always boots on DEFAULT_PROGRAM ('word' — scenarios.ts; there is no `?program=`
    // boot param). An excel/powerpoint/photo utterance sent while Word is the front window is
    // meaningless — `expect` is a property of (text, program), not text alone (utterances.ts's own
    // header: "Sum this column" means something different, and honestly resolves differently, on
    // excel vs powerpoint). Land on the FIRST utterance's program BEFORE ever connecting, so the
    // session's first `session_start` already carries the right program's tools/prompt instead of
    // reconnecting a beat after connecting.
    let currentProgram = 'word';
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

    for (const u of cell.utterances) {
      if (u.program !== currentProgram) {
        // A mid-session program swap reconnects (App.tsx's `activeProgram` effect: close, wait
        // 800ms, reconnect — the tool list/system prompt are program-scoped). NOT a
        // `pollUntil(isLiveNow, ...)` wait here, deliberately: `isLive` is ALREADY true from the
        // session this swap is about to tear down, so polling that same condition would read the
        // stale "true" on its very first check and return immediately, before the close/800ms-
        // delay/reconnect cycle even starts — a real race, not a hypothetical one. A fixed sleep
        // past the app's own 800ms reconnect delay (with margin for the stub connect itself) is
        // the honest wait here; see `driveSession`'s own docstring on why a real settle-detector
        // was not built for this task's scope.
        const switched = await switchProgram(rpc, u.program);
        if (!switched) throw new Error(`program launcher/chip not found for "${u.program}"`);
        currentProgram = u.program;
        await sleep(1800);
      }
      const ok = await typeAndSubmit(rpc, u.text);
      if (!ok) throw new Error(`omnibox not found when submitting utterance "${u.key}"`);
      await sleep(SETTLE_MS[mode]);
    }
    // One more beat so the LAST utterance's turn actually supersedes/settles before export — the
    // next event to touch the stream is the export click itself, which opens no turn of its own.
    await sleep(SETTLE_MS[mode]);

    const savedPath = await exportSession(rpc, downloadDir);
    const destName = `${cell.register}-${cell.shell}-${cell.backend}-${cell.corpus}-${Date.now()}.json`;
    const destPath = path.join(outDir, 'exports', destName);
    mkdirSync(path.dirname(destPath), { recursive: true });
    copyFileSync(savedPath, destPath);
    return destPath;
  } finally {
    try { await rpc('Page.close'); } catch { /* best effort */ }
    try { ws.close(); } catch { /* best effort */ }
    void target;
  }
}

// ---- session plan ----

function buildPlan(mode, utterances) {
  if (mode === 'dry') {
    // THE GATE (task-9 brief, verbatim): "--dry across 2 arms (guided + terminal)". A short
    // utterance slice keeps the dry gate fast — zero-spend means there is nothing to lose by
    // sending fewer rows, and the gate only requires >=2 gradeable exports with a nonzero attempt
    // count, not full corpus coverage (that is what a full --live pilot run is for).
    const slice = utterances.slice(0, 6);
    return [
      { register: 'guided', shell: 'familiar', backend: 'gemini', corpus: 'default', utterances: slice },
      { register: 'terminal', shell: 'familiar', backend: 'gemini', corpus: 'default', utterances: slice },
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
      plan.push({ register, shell: 'familiar', backend: 'gemini', corpus, utterances });
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

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(OUT_ROOT, runId);
  mkdirSync(outDir, { recursive: true });
  console.log(`[battery] mode=${mode} sessions=${plan.length} outDir=${outDir}`);

  const cdpPort = await getFreePort();
  const vitePort = mode === 'dry' ? await getFreePort() : 3000;
  const userDataDir = path.join(os.tmpdir(), `ff-battery-${runId}`);

  const browserProc = spawnBrowser(cdpPort, userDataDir);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 15000, 'chrome-headless-shell CDP endpoint');
  const { proc: viteProc, url } = await startViteOrDry(mode, vitePort);

  const manifestEntries = [];
  let consecutiveFailures = 0;
  try {
    for (const cell of plan) {
      console.log(`[battery] session: register=${cell.register} shell=${cell.shell} corpus=${cell.corpus}`);
      try {
        const exportPath = await withTimeout(
          driveSession(url, cdpPort, cell, mode, outDir),
          SESSION_TIMEOUT_MS,
          `session (${cell.register}/${cell.shell}/${cell.corpus})`,
        );
        manifestEntries.push({
          file: exportPath, register: cell.register, shell: cell.shell,
          backend: cell.backend, corpus: cell.corpus,
        });
        consecutiveFailures = 0;
        console.log(`[battery]   -> exported ${path.relative(ROOT, exportPath)}`);
      } catch (err) {
        consecutiveFailures += 1;
        console.error(`[battery]   FAILED (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`aborting: ${MAX_CONSECUTIVE_FAILURES} consecutive session failures`);
        }
      }
    }
  } finally {
    killProc(viteProc);
    killProc(browserProc);
  }

  const manifest = { mode, createdAt: new Date().toISOString(), entries: manifestEntries };
  const manifestPath = path.join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[battery] manifest: ${path.relative(ROOT, manifestPath)}`);
  console.log(`[battery] ${manifestEntries.length}/${plan.length} sessions produced a gradeable export`);
  if (manifestEntries.length === 0) {
    throw new Error('no session produced a gradeable export — nothing for summarize.mjs to grade');
  }
  // Print the manifest path last, alone, so a caller (summarize.mjs's own docs, or a human) can
  // grab it off the final line without parsing the log.
  console.log(manifestPath);
}

main().catch((err) => {
  console.error('[battery] FATAL:', err.stack ?? err.message ?? err);
  process.exit(1);
});
