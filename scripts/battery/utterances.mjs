/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The battery's copy of "what to ask" is not a copy at all — it is `src/eval/utterances.ts`'s
// `UTTERANCES` array, read through `ts-bridge.ts` (see that file's header for why a subprocess
// rather than a direct import: `run.mjs` is launched with plain `node`, which cannot import a
// `.ts` module). This is the mechanism behind the design spec's §4b guarantee that a human eval-
// deck run and an automated battery run are "the same trials ... comparable by construction" — if
// this file duplicated the list instead of deriving it, that guarantee would be a coincidence
// someone has to re-establish by hand every time either list changes.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BRIDGE = path.join(HERE, 'ts-bridge.ts');

let cached = null;

/** The shared trial set, verbatim from `src/eval/utterances.ts`. Cached per process — this is
 *  called once per session by `run.mjs` (and once by `summarize.mjs` if it ever needs the text
 *  behind a `key`), not once per utterance, so a `tsx` subprocess per call would be wasteful but
 *  is not a correctness concern either way (the source array does not change mid-run). */
export function loadUtterances() {
  if (cached) return cached;
  const out = execFileSync('npx', ['tsx', BRIDGE, 'utterances'], { cwd: ROOT, encoding: 'utf8' });
  cached = JSON.parse(out);
  return cached;
}

/** Look up one row by key — undefined for an unknown key, never a guessed default (same rule as
 *  `utterances.ts`'s own `utteranceFor`, which this mirrors rather than re-imports for the same
 *  plain-`node`-can't-import-`.ts` reason as `loadUtterances` above). */
export function utteranceFor(key) {
  return loadUtterances().find((u) => u.key === key);
}
