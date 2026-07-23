// R1 (spec 2026-07-23-register-system-design.md §3): every user-facing dial that shapes
// the interaction, as ONE object. NOT included (debug-only): voiceBackend, sendFrequency,
// whiteboardMode. The honesty floor (witnessed mutations, visual feedback floor, live/mic
// status) is never dialable.
import type { Autonomy } from '../scenarios';
import type { FeedbackMode } from '../feedback';

export interface DialValues {
  honest: boolean;                                  // prompt variant A/B
  autonomy: Autonomy;                               // friction dial (decideCommit)
  feedback: FeedbackMode;                           // silent | earcon | speech
  confirmGoals: boolean;                            // C3 eval: set_goal asks first
  markings: boolean;                                // highlight rings + legend
  chipDensity: 'none' | 'grounded' | 'full';        // chips + quick-fire gate
  traceView: 'hidden' | 'ticker' | 'ledger';        // ActivityTrace presentation
  teaching: 'off' | 'normal' | 'eager';             // teach offers + fade baseline (prompt gate)
  proactivity: 'never' | 'on-goal' | 'idle-offer';  // suggest_next / idle behavior (prompt gate)
}
