/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Testbed instrumentation. Records per-attempt signals so configs (voice backend × autonomy ×
// feedback × form factor × …) can be compared on the same scenario set — the evidence base for
// the "where does point-and-speak work best (mobile/tablet/desktop)" decision. Dependency-free,
// in-memory, with a JSON export. Ground truth for deixis = the active scenario's targetElement.

// Omit that distributes over a discriminated union (so per-variant fields survive).
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

import type { DialValues } from './register/types';
import type { SkinKey } from './shell/skins/types';

export type FormFactor = 'mobile' | 'tablet' | 'desktop';
export type InputModality = 'voice' | 'typed' | 'direct';
// 'rejected' added fix round 1, I5: the gate refusing a malformed call is itself a measurable
// per-attempt outcome (the gate's firing rate is the headline number this plan produces) — it is
// NOT a witness and NOT a commit, so folding it into either would misreport what happened.
export type ActionDecision = 'commit' | 'witness' | 'rejected';

export interface DeviceInfo {
  width: number;
  height: number;
  touch: boolean;
  pointer: string; // 'fine' | 'coarse' | 'none'
  formFactor: FormFactor;
  ua: string;
}

export interface Arm {
  register: string;        // named register key, or 'custom'
  base?: string;           // when custom: the named register the twiddle started from
  dials: DialValues;       // fully resolved — the cohort definition
  shell?: SkinKey;         // the shell skin in effect — a second, independent measured axis
}

export interface SessionConfig {
  backend: string;   // gemini | azure | openai
  autonomy: string;  // manual | confirm | auto-safe | autonomous
  feedback: string;  // silent | earcon | speech
  program: string;   // word | excel | ...
  honest: boolean;
  device: DeviceInfo;
  arm?: Arm;
}

export type TelemetryEvent =
  | { t: number; type: 'session_start'; config: SessionConfig }
  | { t: number; type: 'deixis'; keyword: string; resolved: string | null; target: string | null; confidence: 'high' | 'low'; correct: boolean | null; modality: InputModality }
  | { t: number; type: 'action'; verb: string; verbClass: string; decision: ActionDecision; modality: InputModality }
  | { t: number; type: 'grounding'; appReferent: string | null; modelTarget: string | null; agree: boolean | null; resolution: 'structural' | 'visual' | 'none' }
  | { t: number; type: 'map'; query: string }
  | { t: number; type: 'correction'; slotId?: string; overAgent?: boolean } // undo, or a ramble user-edit (overAgent = the key trust signal)
  | { t: number; type: 'fill'; slotId: string; source: string; confidence: number }
  | { t: number; type: 'gap_question'; slotId: string }
  | { t: number; type: 'readback'; accepted: boolean }
  | { t: number; type: 'stall' }
  | { t: number; type: 'session_complete'; timeToCompleteMs: number; slotsFilled: number; inferredCount: number; framesSent: number; hintsSent: number }
  | { t: number; type: 'error'; message: string }
  | { t: number; type: 'guidance'; kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown' | 'card_dealt' | 'why_opened' | 'card_flipped' | 'show_me' | 'check_auto_pass' | 'check_auto_fail' | 'check_user_confirmed' | 'rail_complete' | 'rail_abandoned'; taskKey?: string; posture?: string; fadeLevel?: number; cardType?: string; band?: string }
  | { t: number; type: 'mission_start'; key: string; run: number }
  | { t: number; type: 'mission_step_done'; key: string; stepKey: string }
  | { t: number; type: 'mission_complete'; key: string; run: number; durationMs: number; steps: number }
  | { t: number; type: 'mission_abandoned'; key: string; stepIndex: number }
  | { t: number; type: 'register_switch'; from: string; to: string; midSession: boolean }
  | { t: number; type: 'shell_switch'; from: SkinKey; to: SkinKey; midSession: boolean }
  | { t: number; type: 'unspecified_ask'; field: string; answered: boolean; viaChip: boolean }
  // Every user utterance/typed submit opens a turn; the model's response (tool call, speech-only,
  // silence, or a lost transcript) closes it. `speech_only`/`no_response` are the rows that do not
  // exist anywhere else today — the worst failures, currently invisible to any completion rate.
  | { t: number; type: 'turn'; id: string; modality: InputModality; request: string;
      outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost';
      firstResponseMs: number | null; settledMs: number | null }
  | { t: number; type: 'pin'; cardType: string; artifactId?: string; error?: string }
  | { t: number; type: 'combine_tray'; count: number; kind: string; ok: boolean }
  // One per eval-deck card that reached a result (src/eval/deck.ts). The deck's own state is
  // session-scoped React state and is deliberately not journaled, so this event is the ONLY durable
  // record that a trial was run — including a skip, which the deck treats as a result and not an
  // absence. `graded` is carried verbatim and never collapsed: a scorecard that counted a human's
  // "it worked" alongside an observed commit would be measuring optimism.
  | { t: number; type: 'eval_card'; cardId: string; dimension: string; grade: 'done' | 'failed' | 'skipped'; graded: 'observed' | 'self' };

export function detectDevice(): DeviceInfo {
  const width = typeof window !== 'undefined' ? window.innerWidth : 0;
  const height = typeof window !== 'undefined' ? window.innerHeight : 0;
  const minDim = Math.min(width, height);
  const touch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator as any).maxTouchPoints > 0);
  let pointer = 'fine';
  try {
    if (window.matchMedia('(pointer: coarse)').matches) pointer = 'coarse';
    else if (window.matchMedia('(pointer: none)').matches) pointer = 'none';
  } catch { /* no-op */ }
  // Key on width (+ touch for large touch devices); raw width/height/touch/pointer are kept
  // in the record for precise analysis, so this label is just a convenience bucket.
  void minDim;
  const formFactor: FormFactor =
    width < 600 ? 'mobile' : width < 1024 ? 'tablet' : touch ? 'tablet' : 'desktop';
  return { width, height, touch, pointer, formFactor, ua: typeof navigator !== 'undefined' ? navigator.userAgent : '' };
}

/** The `arm`/`shell`/`cfg` segment of exportJSON's download filename, pulled out as a pure
 *  function so it is unit-testable without a DOM: exportJSON's construction of it lives inside
 *  an `if (typeof window !== 'undefined')` guard that vitest (node, no jsdom) never executes, so
 *  logic left inline there is invisible to the suite. Both fallbacks are 'unset', never a
 *  guessed default — an absent register or shell must read as genuinely unset. */
export function exportConfigString(config: SessionConfig | null): string {
  if (!config) return 'session';
  const arm = config.arm?.register ?? 'unset';
  const shell = config.arm?.shell ?? 'unset';
  return `${arm}-${shell}-${config.backend}-${config.autonomy}-${config.feedback}`;
}

class Telemetry {
  private events: TelemetryEvent[] = [];
  private config: SessionConfig | null = null;
  private startedAt = 0;
  // Growth subscribers. Exists for ONE consumer: the eval deck's observe loop, which grades a card
  // by re-reading the stream whenever it grows (src/eval/deck.ts). A listener is called after the
  // event is in the array, so a listener that immediately reads `eventsSnapshot()` sees it.
  private listeners = new Set<() => void>();

  start(config: SessionConfig) {
    this.events = [];
    this.config = config;
    this.startedAt = Date.now();
    this.events.push({ t: 0, type: 'session_start', config });
    this.notify(); // a restart SHRINKS the stream — every index-based reader must hear about it
  }

  private notify() {
    // Copy first: a listener that unsubscribes itself (React effect cleanup racing a push) must not
    // mutate the set mid-iteration. A throwing listener must not swallow the event either — the
    // stream is the record, and one bad subscriber cannot be allowed to stop the rest.
    for (const fn of [...this.listeners]) {
      try { fn(); } catch { /* a subscriber's failure is not the recorder's problem */ }
    }
  }

  /** Subscribe to event growth (and to a session restart). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** A COPY of the stream, for readers that grade over it (the deck's run-baselined predicates
   *  index into it). A copy rather than the live array because `push` mutates in place: a consumer
   *  holding the live reference would see its own "snapshot" change underneath it, which is exactly
   *  the kind of thing that makes a StrictMode double-invoke non-idempotent. */
  eventsSnapshot(): TelemetryEvent[] { return [...this.events]; }

  /** The current stream length — the baseline index an eval-deck card is dealt at. Read
   *  synchronously at the moment a card is dealt; never derived from a React render. */
  eventCount(): number { return this.events.length; }

  private push(ev: DistributiveOmit<TelemetryEvent, 't'>) {
    if (!this.config) return; // only record within a started session
    this.events.push({ t: Date.now() - this.startedAt, ...ev } as TelemetryEvent);
    this.notify();
  }

  deixis(keyword: string, resolved: string | null, target: string | null, confidence: 'high' | 'low', modality: InputModality = 'voice') {
    const correct = target ? resolved === target : null;
    this.push({ type: 'deixis', keyword, resolved, target, confidence, correct, modality });
  }
  action(verb: string, verbClass: string, decision: ActionDecision, modality: InputModality = 'voice') {
    this.push({ type: 'action', verb, verbClass, decision, modality });
  }
  grounding(appReferent: string | null, modelTarget: string | null, agree: boolean | null, resolution: 'structural' | 'visual' | 'none' = 'none') {
    this.push({ type: 'grounding', appReferent, modelTarget, agree, resolution });
  }
  map(query: string) { this.push({ type: 'map', query }); }
  correction(slotId?: string, overAgent?: boolean) { this.push({ type: 'correction', slotId, overAgent }); }
  fill(slotId: string, source: string, confidence: number) { this.push({ type: 'fill', slotId, source, confidence }); }
  gapQuestion(slotId: string) { this.push({ type: 'gap_question', slotId }); }
  readback(accepted: boolean) { this.push({ type: 'readback', accepted }); }
  stall() { this.push({ type: 'stall' }); }
  // framesSent/hintsSent default to 0 so existing call sites (which predate the traffic-cost
  // fold-in) keep compiling unchanged.
  sessionComplete(timeToCompleteMs: number, slotsFilled: number, inferredCount: number, framesSent = 0, hintsSent = 0) {
    this.push({ type: 'session_complete', timeToCompleteMs, slotsFilled, inferredCount, framesSent, hintsSent });
  }
  error(message: string) { this.push({ type: 'error', message }); }
  guidance(kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown' | 'card_dealt' | 'why_opened' | 'card_flipped' | 'show_me' | 'check_auto_pass' | 'check_auto_fail' | 'check_user_confirmed' | 'rail_complete' | 'rail_abandoned', detail: { taskKey?: string; posture?: string; fadeLevel?: number; cardType?: string; band?: string } = {}) {
    this.push({ type: 'guidance', kind, ...detail });
  }
  missionStart(key: string, run: number) { this.push({ type: 'mission_start', key, run }); }
  missionStepDone(key: string, stepKey: string) { this.push({ type: 'mission_step_done', key, stepKey }); }
  missionComplete(key: string, run: number, durationMs: number, steps: number) { this.push({ type: 'mission_complete', key, run, durationMs, steps }); }
  missionAbandoned(key: string, stepIndex: number) { this.push({ type: 'mission_abandoned', key, stepIndex }); }
  registerSwitch(from: string, to: string, midSession: boolean) { this.push({ type: 'register_switch', from, to, midSession }); }
  shellSwitch(from: SkinKey, to: SkinKey, midSession: boolean) { this.push({ type: 'shell_switch', from, to, midSession }); }
  /** An unspecified ask is CORRECT collaborative behaviour, never a failure. Counted separately
   *  so a register arm that asks more does not look like an arm that errors more. Emitted when an
   *  ask CLOSES, which is when `answered` is known — so an ask still open when the session ends
   *  emits nothing, honestly, because its outcome is genuinely unknown. A question REFINED in
   *  place (App's openAsk: same field, candidates added) is one ask and one event; a question
   *  replaced by one about a different field records the displaced one as unanswered. */
  unspecifiedAsk(field: string, answered: boolean, viaChip: boolean) { this.push({ type: 'unspecified_ask', field, answered, viaChip }); }
  /** One push per `ClosedTurn` (src/eval/turns.ts). Takes primitive args mirroring the event
   *  fields, not the `ClosedTurn` object itself, so this file has no dependency on `src/eval`. */
  turn(id: string, modality: InputModality, request: string, outcome: 'tool_call' | 'speech_only' | 'no_response' | 'transcription_lost', firstResponseMs: number | null, settledMs: number | null) {
    this.push({ type: 'turn', id, modality, request, outcome, firstResponseMs, settledMs });
  }
  pin(cardType: string, artifactId?: string, error?: string) { this.push({ type: 'pin', cardType, artifactId, error }); }
  combineTray(count: number, kind: string, ok: boolean) { this.push({ type: 'combine_tray', count, kind, ok }); }
  /** One call per eval-deck card result — the durable half of an unjournaled deck run. Takes
   *  primitives rather than the deck's `CardResult` so this file keeps no dependency on src/eval. */
  evalCard(cardId: string, dimension: string, grade: 'done' | 'failed' | 'skipped', graded: 'observed' | 'self') {
    this.push({ type: 'eval_card', cardId, dimension, grade, graded });
  }

  /** Aggregated, human-readable summary for the live readout + export. */
  metrics() {
    const deixis = this.events.filter(e => e.type === 'deixis') as Extract<TelemetryEvent, { type: 'deixis' }>[];
    const graded = deixis.filter(d => d.correct !== null);
    const correct = graded.filter(d => d.correct).length;
    const conf = (lvl: 'high' | 'low') => {
      const g = graded.filter(d => d.confidence === lvl);
      return { n: g.length, correct: g.filter(d => d.correct).length };
    };
    const byMod = (mod: InputModality) => {
      const g = graded.filter(d => d.modality === mod);
      return { n: g.length, correct: g.filter(d => d.correct).length };
    };
    const actions = this.events.filter(e => e.type === 'action') as Extract<TelemetryEvent, { type: 'action' }>[];
    const corrections = this.events.filter(e => e.type === 'correction').length;
    const errors = this.events.filter(e => e.type === 'error').length;
    const grounding = this.events.filter(e => e.type === 'grounding') as Extract<TelemetryEvent, { type: 'grounding' }>[];
    const gGraded = grounding.filter(g => g.agree !== null);
    const gAgree = gGraded.filter(g => g.agree).length;
    const byResolution = (r: 'structural' | 'visual' | 'none') => {
      const g = gGraded.filter(e => e.resolution === r);
      return { total: g.length, agree: g.filter(e => e.agree).length };
    };
    const actByMod = (mod: InputModality) => {
      const a = actions.filter(x => x.modality === mod);
      // `rejected` here for the same reason it is on the top-level block: without it these three
      // numbers do not add up, and every gate refusal falls silently between them.
      return { total: a.length, commits: a.filter(x => x.decision === 'commit').length,
               witnesses: a.filter(x => x.decision === 'witness').length,
               rejected: a.filter(x => x.decision === 'rejected').length };
    };
    const asks = this.events.filter(e => e.type === 'unspecified_ask') as Extract<TelemetryEvent, { type: 'unspecified_ask' }>[];
    const guid = this.events.filter(e => e.type === 'guidance') as Extract<TelemetryEvent, { type: 'guidance' }>[];
    const gk = (k: string) => guid.filter(e => e.kind === k).length;
    // The actions that actually reached the document. Named once because two numbers below depend
    // on the same distinction (see correctionRate).
    const commits = actions.filter(a => a.decision === 'commit').length;
    const witnesses = actions.filter(a => a.decision === 'witness').length;
    return {
      durationMs: this.config ? Date.now() - this.startedAt : 0,
      deixis: {
        total: deixis.length,
        graded: graded.length,
        correct,
        accuracy: graded.length ? +(correct / graded.length).toFixed(2) : null,
        // Calibration: how often each confidence level was actually right.
        calibration: { high: conf('high'), low: conf('low') },
        byModality: { voice: byMod('voice'), typed: byMod('typed'), direct: byMod('direct') },
      },
      actions: {
        total: actions.length,
        commits,
        witnesses,
        // Reported so the three decisions SUM to total. Before this, `total` counted the
        // 'rejected' decision (added with the gate) while only commits and witnesses were
        // shown, so the readout silently lost every rejection between two numbers.
        rejected: actions.filter(a => a.decision === 'rejected').length,
        byModality: { voice: actByMod('voice'), typed: actByMod('typed'), direct: actByMod('direct') },
      },
      corrections,
      // Denominator is what actually reached the document — commits and witnesses — NOT every
      // action event. `actions` was widened to include the 'rejected' decision when the gate
      // landed, which silently inverted this rate: an arm whose gate refuses MORE scored a LOWER
      // correction rate, i.e. looked better at not needing correction, for refusing to act at all.
      // A refusal is not a corrected action; it is an action that never happened.
      correctionRate: commits + witnesses ? +(corrections / (commits + witnesses)).toFixed(2) : 0,
      errors,
      // Kept OUT of `errors` on purpose (validate.ts's header states the doctrine): asking the
      // user what their heading should say is the behaviour this testbed wants to see more of,
      // so folding it into the error rate would penalise the arms that do it right.
      asks: {
        total: asks.length,
        answered: asks.filter(a => a.answered).length,
        viaCandidate: asks.filter(a => a.viaChip).length,
      },
      guidance: {
        sequences: gk('sequence_start'),
        completions: gk('sequence_complete'),
        unaidedCompletions: guid.filter(e => e.kind === 'sequence_complete' && e.fadeLevel === 2).length,
        blocked: gk('blocked'), reveals: gk('reveal'), abandoned: gk('sequence_abandoned'), relatesShown: gk('relate_shown'),
      },
      // G5: how often the model's read of the referent agrees with the app's hit-test.
      grounding: {
        total: gGraded.length,
        agree: gAgree,
        disagree: gGraded.length - gAgree,
        agreementRate: gGraded.length ? +(gAgree / gGraded.length).toFixed(2) : null,
        byResolution: {
          structural: byResolution('structural'),
          visual: byResolution('visual'),
          none: byResolution('none'),
        },
      },
    };
  }

  snapshot() {
    return { config: this.config, metrics: this.metrics(), events: this.events };
  }

  /** Download the session as JSON for offline analysis / A/B aggregation. */
  exportJSON() {
    const json = JSON.stringify(this.snapshot(), null, 2);
    if (typeof window !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ff = this.config?.device.formFactor ?? 'unknown';
      const cfg = exportConfigString(this.config);
      a.href = url;
      a.download = `testbed-${ff}-${cfg}-${this.startedAt}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return json;
  }
}

export const telemetry = new Telemetry();
