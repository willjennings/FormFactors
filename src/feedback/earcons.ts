/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// A tiny WebAudio earcon synth — the app's deterministic, sub-100ms confirmation channel.
// Design follows the research (see docs/feedback-controller-architecture.md):
//   - VALENCE → pitch contour: ascending = create/success, descending = error/close.
//   - SEVERITY → timbre + loudness: brighter/louder reserved for irreversible/destructive.
//   - Instrument-ish timbres (triangle/sine stacks), NOT raw square waves.
//   - Fundamentals kept low (accessibility), pitch band ~150 Hz–4 kHz, each cue ≤ ~450 ms.
//   - Consonant for routine, mild dissonance reserved ONLY for error.
//   - A small, deliberately heterogeneous set (heterogeneity aids learnability).
// No assets, fully tunable. Never the only channel — App always pairs a visual cue (WCAG).

export type EarconKind =
  | 'listening'       // attention / session ready
  | 'commit-control'  // command/control accepted (navigate, show map) — flat tick
  | 'commit-transform'// transform (format) committed — resolve down (closure)
  | 'commit-mutate'   // mutate (edit value, save) committed — settle
  | 'create'          // create (insert) — rising (completion)
  | 'confirm-needed'  // needs confirmation — rising, suspended (a question)
  | 'error'           // rejected / can't-tell — falling, mildly dissonant
  | 'undo';           // reverse of a commit — mirror contour

// Note → frequency (equal temperament, A4 = 440). Kept in a low, accessible band.
const NOTE: Record<string, number> = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
  Fs4: 369.99, Bb4: 466.16,
};

type Step = { note: number; t: number; dur: number; type?: OscillatorType; gain?: number };

// Each earcon is a short score of steps (start time t, duration, pitch, timbre).
const SCORES: Record<EarconKind, Step[]> = {
  // soft open tone — "I'm listening"
  listening: [{ note: NOTE.A4, t: 0, dur: 0.22, type: 'sine', gain: 0.18 }],
  // flat tactile tick — lowest-commitment ack
  'commit-control': [{ note: NOTE.G5, t: 0, dur: 0.07, type: 'triangle', gain: 0.16 }],
  // resolve DOWN — closure, a formatting change settled
  'commit-transform': [
    { note: NOTE.E5, t: 0, dur: 0.09, type: 'triangle' },
    { note: NOTE.C5, t: 0.09, dur: 0.16, type: 'triangle' },
  ],
  // two-note settle — a value/file mutation landed
  'commit-mutate': [
    { note: NOTE.G5, t: 0, dur: 0.08, type: 'triangle' },
    { note: NOTE.E5, t: 0.08, dur: 0.16, type: 'triangle' },
  ],
  // ASCENDING triad — something was created/added
  create: [
    { note: NOTE.C5, t: 0, dur: 0.08, type: 'triangle' },
    { note: NOTE.E5, t: 0.08, dur: 0.08, type: 'triangle' },
    { note: NOTE.G5, t: 0.16, dur: 0.18, type: 'triangle' },
  ],
  // rising + SUSPENDED (held, unresolved) — reads as a question
  'confirm-needed': [
    { note: NOTE.C5, t: 0, dur: 0.1, type: 'sine' },
    { note: NOTE.G5, t: 0.1, dur: 0.28, type: 'sine', gain: 0.14 },
  ],
  // FALLING + mild dissonance (minor 2nd-ish) — the only intentionally "off" cue
  error: [
    { note: NOTE.Bb4, t: 0, dur: 0.1, type: 'sawtooth', gain: 0.1 },
    { note: NOTE.A4, t: 0.06, dur: 0.22, type: 'sawtooth', gain: 0.1 },
  ],
  // mirror of a commit — rising back, "taken back"
  undo: [
    { note: NOTE.C5, t: 0, dur: 0.09, type: 'triangle' },
    { note: NOTE.E5, t: 0.09, dur: 0.16, type: 'triangle' },
  ],
};

// Ordered list for the audition UI.
export const EARCON_KINDS: EarconKind[] = [
  'commit-control', 'commit-transform', 'commit-mutate', 'create',
  'confirm-needed', 'error', 'undo', 'listening',
];

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const DEFAULT_GAIN = 0.13;

/** Play a one-shot earcon. Safe to call anytime; no-ops if WebAudio is unavailable. */
export function playEarcon(kind: EarconKind): void {
  const ac = audio();
  if (!ac) return;
  const score = SCORES[kind];
  const start = ac.currentTime + 0.001; // fire effectively immediately (<100ms perceptual)
  for (const step of score) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = step.type ?? 'triangle';
    osc.frequency.value = step.note;
    const peak = step.gain ?? DEFAULT_GAIN;
    const t0 = start + step.t;
    const t1 = t0 + step.dur;
    // Short ADSR to avoid clicks; quick attack, smooth exponential release.
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

/** Unlock/prepare the audio context on a user gesture (call when the session starts). */
export function primeEarcons(): void {
  audio();
}
