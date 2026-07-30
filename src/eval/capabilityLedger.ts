/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The capability ledger — the "not good at" half (spec §3). Aggregates, across sessions, every
// honest statement of a limit: refusals, dropped gate asks, wrong-referent deixis, app/model
// grounding disagreement, and the no-op turn (a request that produced nothing at all). The output
// is a ranked list of *things this system cannot do, in the words people used to ask for them* —
// this is the artefact the whole evaluation program exists to produce.
//
// Sources two different shapes, deliberately: `attempts` (Task 3's `deriveAttempts` output) for
// anything the turn/outcome machinery already resolved (refusal, dropped ask, no-op turn), and the
// raw `events` for `deixis`/`grounding`, which are graded per-signal and never rolled into an
// `Attempt` at all — there is no `Attempt` field for "the referent resolved wrong".
//
// SCOPE DISCLOSURE 1 (refusal "reason"): spec §3's table describes refusal rows as "grouped by
// (verb, program, reason)". The `reason` component is not available from this schema: the gate's
// own message (`gate.error` in src/actions/validate.ts) is only ever written to `addLog` in
// App.tsx, never onto the `action` TelemetryEvent (which carries only `verb`/`verbClass`/
// `decision`/`modality`) — and telemetry's OWN `error` event type is a different, session-level
// channel entirely (mic/connection failures — see App.tsx's `onError` and RambleLive.tsx), not the
// gate's per-call message. So refusal rows here are grouped by (verb, program) only. A true
// per-reason breakdown would require the gate's message to be threaded onto the `action` event
// first — out of scope for this task.
//
// SCOPE DISCLOSURE 2 (ask "field"): spec §3 also wants asks grouped by which FIELD gets asked
// about most. `Attempt` carries no `field` — `unspecified_ask`'s `field` is consumed entirely
// inside `deriveAttempts`'s state machine and never copied onto the record it produces (and
// `Attempt.verb` is null for a pure ask flow: App.tsx's `needsContent` branch never calls
// `telemetry.action`). A raw-event join was considered and rejected: `deriveAttempts` collapses
// MULTIPLE `unspecified_ask{answered:false}` events touching the same pending window into ONE
// `asked-and-dropped` attempt (each just re-sets `p.decided`, idempotently), so there is no clean
// 1:1 pairing between dropped-ask events and dropped-ask attempts to zip by index. This module
// therefore reports 'ask' rows keyed by (verb-or-'ask', program) — same disclosed shape as
// refusals — sourced from `Attempt`s, which does give the one thing the spec's table cares about
// most for this row class: the verbatim request that went unanswered.
//
// HALLUCINATED-TOOL DECISION (ordered by the task-4 brief): `deriveAttempts` grades a tool call for
// an unknown/hallucinated tool name as `ungradeable`/`'tool-call-without-action'` (never
// `refused-honestly` — see deriveAttempts.ts's M1 comment: that outcome is reserved for a call that
// actually reached validate.ts's gate, and a hallucinated tool name never does). Decision: YES,
// this belongs in the ledger — it is exactly as truthful a statement of a limit as a real gate
// refusal ("the model asked for a tool that doesn't exist" is something a person reading this
// ledger needs to know, arguably MORE than an ordinary refusal, since it means the tool surface
// itself is being misjudged). It is folded into `kind: 'refusal'` rather than given a new kind
// (the brief fixes the `LedgerRow['kind']` union; adding a literal wasn't offered as an option),
// with a key that can never collide with a real verb-keyed refusal row: `'unknown-tool/<program>'`
// (`Attempt.verb` is always null for this case, so a verb-shaped key isn't available anyway). Other
// `ungradeableReason`s (`'ambiguous-boundary'`, `'transcription-lost'`) are NOT folded in — those
// are genuine "we cannot tell", not a truthful statement of a limit, and belong nowhere near a
// ledger that must never present something false (see the design spec's framing paragraph).
//
// Ranking is "by n desc" (brief). Ties keep first-seen row order: rows are built into a `Map` in
// one pass over `attempts` (refusal/ask/no-op-turn/hallucinated-tool) followed by one pass over
// `events` (deixis-miss/grounding-disagree), and `Array.prototype.sort` is stable (ES2019+), so a
// tie's relative order reflects which kind of row was FIRST ENCOUNTERED, never re-sorted as counts
// grow. `examples` within a row follow the same discipline: pushed only while `< 5`, in encounter
// order, never re-ordered or replaced by a "better" example later.

import type { TelemetryEvent } from '../telemetry';
import type { Attempt } from './types';

export interface LedgerRow {
  kind: 'refusal' | 'ask' | 'deixis-miss' | 'grounding-disagree' | 'no-op-turn';
  key: string;            // e.g. "insert_object/powerpoint/aggregate-refused"
  n: number;
  examples: string[];     // verbatim requests, capped at 5, first-seen order
}

const EXAMPLE_CAP = 5;

function bump(rows: Map<string, LedgerRow>, kind: LedgerRow['kind'], key: string, example: string): void {
  const mapKey = `${kind}:${key}`;
  let row = rows.get(mapKey);
  if (!row) {
    row = { kind, key, n: 0, examples: [] };
    rows.set(mapKey, row);
  }
  row.n += 1;
  if (row.examples.length < EXAMPLE_CAP) row.examples.push(example);
}

export function capabilityLedger(events: TelemetryEvent[], attempts: Attempt[]): LedgerRow[] {
  const rows = new Map<string, LedgerRow>();

  // Pass 1: attempt-derived rows. `attempts` already knows each attempt's `program`/`verb`/
  // `request`, resolved by deriveAttempts from the same event stream — no re-derivation here.
  for (const a of attempts) {
    const program = a.program ?? 'unknown';
    if (a.outcome === 'refused-honestly') {
      bump(rows, 'refusal', `${a.verb ?? 'unknown'}/${program}`, a.request);
    } else if (a.outcome === 'ungradeable' && a.ungradeableReason === 'tool-call-without-action') {
      // See the file-header HALLUCINATED-TOOL DECISION. `unknown-tool/` can never collide with a
      // real verb-keyed refusal row above (verbs are never literally `'unknown-tool'`, and
      // `a.verb` is null here regardless — see SCOPE DISCLOSURE 2's App.tsx citation).
      bump(rows, 'refusal', `unknown-tool/${program}`, a.request);
    } else if (a.outcome === 'asked-and-dropped') {
      // NOT 'asked-and-answered' — that outcome is success-shaped (§5 anti-flattery) and must
      // never appear here. See SCOPE DISCLOSURE 2 for why the key is (verb, program) rather than
      // the asked field.
      bump(rows, 'ask', `${a.verb ?? 'ask'}/${program}`, a.request);
    } else if (a.outcome === 'abandoned') {
      // Every `abandoned` attempt becomes a no-op-turn row, regardless of which of the two paths
      // in deriveAttempts produced it (a bare speech_only/no_response turn, or an answered ask
      // whose commit never landed) — `Attempt` retains no field that distinguishes the two, and
      // both are the same thing from the ledger's point of view: the intent went nowhere. This is
      // the row class the whole turn feature exists to surface (task-4 brief, verbatim).
      bump(rows, 'no-op-turn', `${a.verb ?? 'speech-only'}/${program}`, a.request);
    }
    // completed/corrected/wrong/asked-and-answered: success-shaped or already-graded-elsewhere —
    // never ledger rows (§5.1: a refusal, and only a refusal-shaped outcome, is never a failure;
    // the converse holds too — a success is never smuggled into the "cannot do" roll-up).
  }

  // Pass 2: raw-event rows. `deixis`/`grounding` are graded per-signal and never reach `Attempt` —
  // there is no field on `Attempt` for "the referent resolved wrong" or "the app and model
  // disagreed about the referent". Track the active program the same way deriveAttempts does (the
  // most recent `session_start`), since these events carry no program of their own.
  let program: string = 'unknown';
  for (const ev of events) {
    if (ev.type === 'session_start') {
      program = ev.config.program;
    } else if (ev.type === 'deixis') {
      // `correct === null` is UNGRADED (no ground truth for this keyword), never wrong — must
      // never produce a row (binding, per the task-4 brief).
      if (ev.correct === false) {
        // No verbatim user utterance is exported alongside deixis grading (the event carries only
        // `keyword`/`resolved`/`target`/`confidence`/`modality`) — `keyword` is the closest
        // truthful substitute for "the phrase that failed", so the example text says what actually
        // happened (what it resolved to vs. what it should have) rather than fabricating a request.
        bump(rows, 'deixis-miss', `${ev.keyword}/${program}`,
          `"${ev.keyword}" -> resolved "${ev.resolved ?? '?'}" (wanted "${ev.target ?? '?'}")`);
      }
    } else if (ev.type === 'grounding') {
      // Same rule as deixis: `agree === null` means ungraded (no resolvable app referent to check
      // against), not disagreement.
      if (ev.agree === false) {
        bump(rows, 'grounding-disagree', `${ev.appReferent ?? 'unknown'}/${program}`,
          `app said "${ev.appReferent ?? '?'}", model said "${ev.modelTarget ?? '?'}"`);
      }
    }
  }

  return [...rows.values()].sort((a, b) => b.n - a.n);
}
