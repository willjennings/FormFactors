import type { VoiceProvider } from '../voice/types';

export type Traffic = { frames: number; hints: number };

/** Glanceable burn meter: counts what actually leaves the browser. Wraps the provider at
 *  the single assignment point so every send site is covered without touching call sites. */
export function withTrafficCount(p: VoiceProvider, onChange: (t: Traffic) => void): VoiceProvider {
  const t: Traffic = { frames: 0, hints: 0 };
  return {
    ...p,
    sendVideoFrame: (f) => { t.frames++; onChange({ ...t }); p.sendVideoFrame(f); },
    sendTextHint: (x) => { t.hints++; onChange({ ...t }); p.sendTextHint(x); },
    sendUserText: (x) => { t.hints++; onChange({ ...t }); p.sendUserText(x); },
  };
}
