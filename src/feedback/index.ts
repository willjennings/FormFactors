/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Feedback router (DIAL B). Given a feedback event + the current modality notch, routes the
// AUDIO channel: a deterministic earcon, app-spoken TTS, or nothing. The VISUAL channel
// (toast / witness card / highlight) is owned by the App and is ALWAYS on — the minimum-
// feedback floor (Norman's gulf of evaluation + WCAG: never audio-only). The MODEL never
// self-confirms; in the Speech notch the APP speaks, not the LLM.

import { playEarcon, type EarconKind } from './earcons';
import type { VerbClass } from '../scenarios';

export type FeedbackMode = 'silent' | 'earcon' | 'speech';

export const FEEDBACK_OPTIONS: { id: FeedbackMode; label: string }[] = [
  { id: 'silent', label: 'Silent (visual only)' },
  { id: 'earcon', label: 'Earcon (default)' },
  { id: 'speech', label: 'Speech' },
];

export interface FeedbackEvent {
  outcome: 'committed' | 'needs-confirm' | 'error' | 'undo';
  verbClass?: VerbClass;
  /** Short human phrase for the toast + TTS, e.g. "Made the document body bold". */
  label: string;
}

function earconFor(ev: FeedbackEvent): EarconKind {
  if (ev.outcome === 'needs-confirm') return 'confirm-needed';
  if (ev.outcome === 'error') return 'error';
  if (ev.outcome === 'undo') return 'undo';
  switch (ev.verbClass) {
    case 'create': return 'create';
    case 'transform': return 'commit-transform';
    case 'mutate': return 'commit-mutate';
    case 'share': return 'commit-mutate';
    case 'query':
    case 'command':
    case 'control':
    default: return 'commit-control';
  }
}

function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel(); // avoid pile-up
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    u.volume = 0.9;
    synth.speak(u);
  } catch {
    /* no-op */
  }
}

/**
 * Audio side of the feedback router. App calls this on every feedback event and ALSO sets a
 * visual toast (always-on floor) regardless of mode.
 */
export function emitFeedbackAudio(ev: FeedbackEvent, mode: FeedbackMode): void {
  if (mode === 'silent') return;
  if (mode === 'earcon') {
    playEarcon(earconFor(ev));
    return;
  }
  // Speech notch: the app speaks the confirmation. Errors / needs-confirm also get the
  // (sharper, faster-to-notice) earcon alongside the spoken phrase.
  if (ev.outcome === 'error' || ev.outcome === 'needs-confirm') playEarcon(earconFor(ev));
  speak(ev.label);
}
