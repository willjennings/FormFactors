// Double-apply guard (fix round 1, I3; tightened fix round 2, I3; rebuilt fix round 3, I3/#1).
//
// A voice-confirm call can be a harmless follow-up to an action the Confirm BUTTON already
// applied — same verb, same effective target, often with the value dropped because the button
// already supplied it. Swallowing that replay as a no-op success is safe.
//
// Round 1 made `isDuplicateConfirm` alone gate this, checked BEFORE the gate — that let ANY
// confirm:true call matching a confirmed pending action's verb+target dedupe on payload alone,
// including a call carrying a genuinely different, new value.
//
// Round 2 required the gate to independently agree (`ok`/`needsContent`) before deduping. That
// closed the MISSING-value hole but not the DIFFERENT-value one: a well-formed but different
// detail (e.g. detail:'260' replaying over an applied '250') still passes the gate on its own
// terms — the gate has no memory of what was already written — so it still deduped to a
// fabricated success. (Round 2's comments claimed this case was covered; it wasn't. Round 3 fixes
// the code AND the false claim — see the coordinator's note: shipping a new comment that claims
// coverage it lacks is the same defect this whole task removes, one level up.)
//
// The fix: compare the PAYLOAD, not the gate. `pending.detail` (round 3's discovery: it was
// available all along — `App.tsx` types it at `pendingAction`'s declaration, sets it from
// `describeAction`'s verbatim `detail: args.detail` pass-through on every commit, and preserves it
// unchanged across the witness→confirm transition) is exactly the value that was actually written
// into the document. A replay is safe to dedupe when it carries EITHER no new value (the button
// already supplied it) OR the SAME value (an inert repeat) — never a different one, which is a
// genuinely new edit and must reach the gate and the reducer like any other.
//
// This no longer needs the gate at all: `pending.confirmed === true` is only ever set past an
// identity bail (App.tsx's voice-commit and button-confirm paths both set it AFTER `applyAction`
// produced a real, non-identity `nextDoc`), so it is a true statement that the action landed — and
// it is invalidated (`setPendingAction(null)`) on undo, a program swap, and a session reset, so a
// stale claim can't outlive the state it describes. Once the payload can't differ, there is
// nothing left for the gate to have an opinion about that the pending record hasn't already
// settled.
import { normText } from '../entities/registry';

export interface PendingActionLike {
  verb: string;
  target: string;
  detail?: string;
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
 *  Requires the verb+target shape to match a confirmed pending action AND the incoming detail to
 *  carry nothing new: either absent/blank, or the SAME value (case/whitespace-insensitive) as what
 *  the pending action already applied. A genuinely different value is a new edit, not a replay —
 *  it must reach the gate and the reducer, never be swallowed here. */
export function shouldDedupeConfirm(
  pending: PendingActionLike | null | undefined,
  verb: string,
  target: string | undefined,
  detail: string | undefined,
  confirmed: boolean,
): boolean {
  if (!confirmed || !isDuplicateConfirm(pending, verb, target)) return false;
  const d = (detail ?? '').trim();
  return d === '' || normText(d) === normText(pending!.detail ?? '');
}
