/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// The turn state machine: makes the evaluation denominator real. Today a request the model
// answers with speech only, or ignores outright, produces no telemetry event at all — so any
// completion rate computed from `action`/`session_complete` events alone is survivorship-biased
// at the schema level (a request that got no response is invisible, not counted as a miss). A
// `turn` opens on every user utterance/submit and closes on whatever actually happened —
// including nothing — so `deriveAttempts` (a later task) can grade the ones that vanish today.
//
// Pure by design: App holds exactly one `OpenTurn | null` in a ref and calls these functions at
// the seams (transcript arrival, response start, ack, next-turn-open, session end). No clocks,
// no DOM, no side effects here — every `t` is a millis-since-session-start value the caller reads
// from `Date.now() - startedAtRef.current`, mirroring how `telemetry.ts` timestamps events.

import type { InputModality } from '../telemetry';

export interface OpenTurn {
  id: string;
  t: number;                       // when this turn opened, ms since session start
  modality: InputModality;
  request: string;                 // verbatim; replaced (never mutated — updateRequest is pure) as deltas accumulate
  firstResponseAt: number | null;  // ms since session start of the first model output of any kind
}

export type TurnClose =
  | { kind: 'tool_call' }
  | { kind: 'speech_only' }
  | { kind: 'no_response' }
  | { kind: 'transcription_lost' };

export interface ClosedTurn {
  id: string;
  t: number;
  modality: InputModality;
  request: string;
  outcome: TurnClose['kind'];
  firstResponseMs: number | null;  // time to first model output, relative to the turn's own open
  settledMs: number | null;        // time to commit/refusal/ask ack, when one occurred
}

/** Open a new turn. If one is already open (the caller never closed it before the next utterance
 *  arrived), it is closed here first: `speech_only` if the model had produced any output for it
 *  (`firstResponseAt` was set), else `no_response` — a turn that got neither a tool call nor even
 *  a word back. Neither case has a settlement time (there was no ack), so `settledMs` is null. */
export function openTurn(
  prev: OpenTurn | null,
  id: string,
  t: number,
  modality: InputModality,
  request: string,
): { open: OpenTurn; closedPrev: ClosedTurn | null } {
  const open: OpenTurn = { id, t, modality, request, firstResponseAt: null };
  if (!prev) return { open, closedPrev: null };
  const kind: TurnClose['kind'] = prev.firstResponseAt !== null ? 'speech_only' : 'no_response';
  // Reference `prev.t` (its own open time), not the new turn's `t` — firstResponseMs must be
  // relative to when THIS (closing) turn started, never to the turn that superseded it.
  const closedPrev = closeTurn(prev, prev.t, { kind }, null);
  return { open, closedPrev };
}

/** Idempotent: the first model output wins. A voice run can emit several deltas/partials before
 *  any of them counts as "the model responded" — later calls with a later `t` must not overwrite
 *  the true first-response latency. */
export function noteFirstResponse(open: OpenTurn, t: number): OpenTurn {
  if (open.firstResponseAt !== null) return open;
  return { ...open, firstResponseAt: t };
}

/** Pure update of the open turn's verbatim request text. Exists because a spoken utterance
 *  arrives as accumulated deltas within one run (mirrors the app's run-accumulation scoping for
 *  transcripts) — the caller updates the SAME open turn's request rather than opening a new turn
 *  per delta; only App decides what counts as "the same run". */
export function updateRequest(open: OpenTurn, request: string): OpenTurn {
  return { ...open, request };
}

/** The one place "is a turn open, and if not, why" becomes a string a DOM attribute can carry.
 *  App.tsx writes this onto the omnibox form's `data-turn-open` at the exact same call sites that
 *  write `openTurnRef` itself (its `setOpenTurn` helper — never a separate effect mirroring the
 *  ref, which would only ever run a render behind). scripts/battery/run.mjs's settle-detector
 *  polls that attribute:
 *
 *  '1' — a turn is open. Covers a `speech_only` turn that has not yet been superseded, too — this
 *  function (and the attribute it drives) cannot distinguish "the model answered with speech only
 *  and will never call a tool for this turn" from "still working on it"; only the next `openTurn`
 *  call (superseding close) resolves that, on purpose (see `openTurn`'s own doc on why a
 *  speech-only turn is not closed here).
 *
 *  '0' — settled HONESTLY: closed by a tool-call ack (any commit, refusal, or ask — App.tsx's
 *  `ack()`, the one wrapper every tool call's result flows through) or by `transcription_lost`.
 *  This is the app answering (or definitively failing to transcribe) the user's own request.
 *
 *  'f' — force-closed: `flushOpenTurn` (App.tsx) called this with no ack and no lost transcript,
 *  because the SESSION ended out from under the open turn — an unrequested socket drop
 *  (`onClose`), or any of the three reconnect effects (dial/backend/program-swap changes), or an
 *  ordinary explicit end (mic toggle, idle guard). This is NOT the app answering the request; it
 *  is the request never getting a chance to be answered before its session went away. Settle-
 *  detector review (2026-07-30, C-cycle I1): folding this into '0' let a mid-poll reconnect or
 *  socket death read as a genuine settle, over-reporting harness health in exactly the failure
 *  mode the counter exists to catch. `closeReason` defaults to `'settled'` so every EXISTING call
 *  site (ack, transcription_lost) needs no change; only `flushOpenTurn` passes `'flushed'`. */
export function turnOpenAttr(open: OpenTurn | null, closeReason: 'settled' | 'flushed' = 'settled'): '0' | '1' | 'f' {
  if (open) return '1';
  return closeReason === 'flushed' ? 'f' : '0';
}

/** Close an open turn with a known outcome. `t` is the turn's own open time (normally `open.t`;
 *  `openTurn` passes `prev.t` explicitly when a new turn forces the previous one closed, so the
 *  reference point is always the CLOSING turn's own start, never the caller's current clock).
 *  `settledAt`, when non-null, is the ms-since-session-start of the commit/refusal/ask ack.
 *  A `transcription_lost` close means the run died without text ever reaching the model, so
 *  neither timing question has an answer — both millis are null regardless of what was recorded
 *  before the loss. */
export function closeTurn(open: OpenTurn, t: number, close: TurnClose, settledAt: number | null): ClosedTurn {
  const lost = close.kind === 'transcription_lost';
  const firstResponseMs = !lost && open.firstResponseAt !== null ? open.firstResponseAt - t : null;
  const settledMs = !lost && settledAt !== null ? settledAt - t : null;
  return {
    id: open.id,
    t: open.t,
    modality: open.modality,
    request: open.request,
    outcome: close.kind,
    firstResponseMs,
    settledMs,
  };
}
