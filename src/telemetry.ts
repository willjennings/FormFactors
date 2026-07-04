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

export type FormFactor = 'mobile' | 'tablet' | 'desktop';
export type InputModality = 'voice' | 'typed' | 'direct';

export interface DeviceInfo {
  width: number;
  height: number;
  touch: boolean;
  pointer: string; // 'fine' | 'coarse' | 'none'
  formFactor: FormFactor;
  ua: string;
}

export interface SessionConfig {
  backend: string;   // gemini | azure | openai
  autonomy: string;  // manual | confirm | auto-safe | autonomous
  feedback: string;  // silent | earcon | speech
  program: string;   // word | excel | ...
  honest: boolean;
  device: DeviceInfo;
}

export type TelemetryEvent =
  | { t: number; type: 'session_start'; config: SessionConfig }
  | { t: number; type: 'deixis'; keyword: string; resolved: string | null; target: string | null; confidence: 'high' | 'low'; correct: boolean | null; modality: InputModality }
  | { t: number; type: 'action'; verb: string; verbClass: string; decision: 'commit' | 'witness'; modality: InputModality }
  | { t: number; type: 'grounding'; appReferent: string | null; modelTarget: string | null; agree: boolean | null; resolution: 'structural' | 'visual' | 'none' }
  | { t: number; type: 'map'; query: string }
  | { t: number; type: 'correction' } // undo
  | { t: number; type: 'error'; message: string }
  | { t: number; type: 'guidance'; kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown' | 'card_dealt' | 'why_opened' | 'card_flipped' | 'show_me' | 'check_auto_pass' | 'check_auto_fail' | 'check_user_confirmed' | 'rail_complete' | 'rail_abandoned'; taskKey?: string; posture?: string; fadeLevel?: number; cardType?: string; band?: string };

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

class Telemetry {
  private events: TelemetryEvent[] = [];
  private config: SessionConfig | null = null;
  private startedAt = 0;

  start(config: SessionConfig) {
    this.events = [];
    this.config = config;
    this.startedAt = Date.now();
    this.events.push({ t: 0, type: 'session_start', config });
  }

  private push(ev: DistributiveOmit<TelemetryEvent, 't'>) {
    if (!this.config) return; // only record within a started session
    this.events.push({ t: Date.now() - this.startedAt, ...ev } as TelemetryEvent);
  }

  deixis(keyword: string, resolved: string | null, target: string | null, confidence: 'high' | 'low', modality: InputModality = 'voice') {
    const correct = target ? resolved === target : null;
    this.push({ type: 'deixis', keyword, resolved, target, confidence, correct, modality });
  }
  action(verb: string, verbClass: string, decision: 'commit' | 'witness', modality: InputModality = 'voice') {
    this.push({ type: 'action', verb, verbClass, decision, modality });
  }
  grounding(appReferent: string | null, modelTarget: string | null, agree: boolean | null, resolution: 'structural' | 'visual' | 'none' = 'none') {
    this.push({ type: 'grounding', appReferent, modelTarget, agree, resolution });
  }
  map(query: string) { this.push({ type: 'map', query }); }
  correction() { this.push({ type: 'correction' }); }
  error(message: string) { this.push({ type: 'error', message }); }
  guidance(kind: 'sequence_start' | 'step_done' | 'sequence_complete' | 'sequence_abandoned' | 'blocked' | 'reveal' | 'relate_shown' | 'card_dealt' | 'why_opened' | 'card_flipped' | 'show_me' | 'check_auto_pass' | 'check_auto_fail' | 'check_user_confirmed' | 'rail_complete' | 'rail_abandoned', detail: { taskKey?: string; posture?: string; fadeLevel?: number; cardType?: string; band?: string } = {}) {
    this.push({ type: 'guidance', kind, ...detail });
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
      const g = graded.filter(d => (d as any).modality === mod);
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
      const a = actions.filter(x => (x as any).modality === mod);
      return { total: a.length, commits: a.filter(x => x.decision === 'commit').length, witnesses: a.filter(x => x.decision === 'witness').length };
    };
    const guid = this.events.filter(e => e.type === 'guidance') as Extract<TelemetryEvent, { type: 'guidance' }>[];
    const gk = (k: string) => guid.filter(e => e.kind === k).length;
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
        commits: actions.filter(a => a.decision === 'commit').length,
        witnesses: actions.filter(a => a.decision === 'witness').length,
        byModality: { voice: actByMod('voice'), typed: actByMod('typed'), direct: actByMod('direct') },
      },
      corrections,
      correctionRate: actions.length ? +(corrections / actions.length).toFixed(2) : 0,
      errors,
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
    if (typeof window === 'undefined') return;
    const blob = new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ff = this.config?.device.formFactor ?? 'unknown';
    const cfg = this.config ? `${this.config.backend}-${this.config.autonomy}-${this.config.feedback}` : 'session';
    a.href = url;
    a.download = `testbed-${ff}-${cfg}-${this.startedAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const telemetry = new Telemetry();
