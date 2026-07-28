// Double-apply guard (fix round 1, I3; tightened fix round 2, I3).
//
// A voice-confirm call can be a harmless follow-up to an action the Confirm BUTTON already
// applied — same verb, same effective target, often with the value dropped because the button
// already supplied it. Swallowing that replay as a no-op success is safe.
//
// Round 1 made `isDuplicateConfirm` alone gate this, checked BEFORE the gate — but that let ANY
// confirm:true call matching a confirmed pending action's verb+target dedupe on payload alone,
// including one the real gate would refuse (e.g. a genuinely different, wrong, or missing value
// that just happens to share a target). That is a fabricated success ack — the exact class of
// dishonesty this task exists to remove, one level up.
//
// The fix: dedupe never overrides the gate's verdict. `shouldDedupeConfirm` takes the gate's
// ALREADY-COMPUTED result (App.tsx calls `validateActionCall` first) and only treats the call as
// a duplicate when the gate independently agrees it's fine (`ok`, or `needsContent` — which can
// only occur here on an already-confirmed action, since `confirmed` is required below and
// validate.ts's authorial branch short-circuits to `ok` whenever `confirm === true`). A call the
// gate would REJECT is never acked as a duplicate success, no matter how well its verb+target
// matches a confirmed pending action.
//
// NOTE for readers of `validate.test.ts:92-95` ("confirm never bypasses a malformed call"): that
// test calls `validateActionCall` directly and does NOT exercise this module or App.tsx's
// dedupe/gate interaction — it does not guard the ordering bug this comment describes. See
// `dedupe.test.ts` for the test that does.
import type { ActionValidation } from './validate';

export interface PendingActionLike {
  verb: string;
  target: string;
  confirmed: boolean;
}

export function isDuplicateConfirm(
  pending: PendingActionLike | null | undefined,
  verb: string,
  target: string | undefined,
): boolean {
  return pending?.confirmed === true
    && pending.verb === verb
    && pending.target === (target ?? pending.target);
}

/** True when this call should be acked as an already-applied duplicate rather than re-run.
 *  Requires BOTH: the verb+target shape matches a confirmed pending action, AND the gate (run on
 *  the call as actually received) does not refuse it. */
export function shouldDedupeConfirm(
  pending: PendingActionLike | null | undefined,
  verb: string,
  target: string | undefined,
  confirmed: boolean,
  gate: ActionValidation,
): boolean {
  if (!confirmed || !isDuplicateConfirm(pending, verb, target)) return false;
  return 'ok' in gate || 'needsContent' in gate;
}
