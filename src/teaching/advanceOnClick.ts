import type { TeachPosture } from './types';

/** Contract A — advancement authority. Pure. */
export function advanceOnClick(isLive: boolean, posture: TeachPosture | null): boolean {
  // Demo (no agent) → clicks pace any sequence. Live → clicks pace only teach posture
  // (the user performs the steps); live guide is agent-paced via teach_step_done.
  return !isLive || posture === 'teach';
}
