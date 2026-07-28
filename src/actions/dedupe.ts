// Double-apply guard (fix round 1, I3; tightened round 2; rebuilt round 3, I3/#1; tightened
// again round 4).
//
// A voice-confirm call can be a harmless follow-up to an action the Confirm BUTTON already
// applied — same verb, same effective target, often with the value dropped because the button
// already supplied it. Acking that replay as an already-applied duplicate is safe.
//
// HISTORY, because each round's fix opened the next round's hole and the record should say so.
// Round 1 matched verb+target alone, so ANY confirm:true call against a confirmed pending action
// deduped — including one carrying a genuinely different value. Round 2 required the gate to agree
// first; that closed the missing-value hole for authorial fields only, because a well-formed but
// DIFFERENT detail passes the gate on its own terms (the gate has no memory of what was asked
// before) and so still acked a fabricated success. Round 3 replaced the gate clause with a payload
// comparison — the right discriminator — but normalised both sides with `normText`, which is an
// ENTITY-NAME normaliser (`[^a-z0-9]+` → ' '): it erases the minus sign, parentheses, currency
// symbols and percent signs. Probed at round-3 HEAD: '-250' vs '250' deduped, as did '(500)'/'500',
// '$4.2M'/'4.2m' and '5%'/'5'. A sign flip acked as "already applied" is the same fabricated
// success one level down. Round 4 compares TRIMMED EXACT strings: for a payload, two values are
// the same value or they are not. Only surrounding whitespace is insignificant.
//
// WHAT IS COMPARED, precisely. `pending.detail` is the INSTRUCTION that was previously requested,
// not the text that landed in the document. (App.tsx types it on `pendingAction`, sets it from
// `describeAction`'s verbatim `detail: args.detail` pass-through, and preserves it across the
// witness→confirm transition via `{ ...p, confirmed: true }`.) The two genuinely differ:
// `applyAction` ignores `detail` entirely for word/excel `format_content`, defaults a dropped one
// to 'Fade' for powerpoint `format_content`, turns `insert_object 'dup'` into
// '<last slide> (copy)', turns an unmatched `photo_edit` into `cropped: true`, and writes a
// COMPUTED total for `insert_object 'sum'`. So this is instruction-to-instruction, and nothing
// here may be read as a claim about the document's contents.
//
// Instruction-to-instruction is nevertheless the comparison this guard wants, because an
// instruction is not in general idempotent. Probed: `insert_object 'sum'` on
// {B1:'Q3',B2:'$4.2M',B3:'$3.4M'} writes B4='$7.6M'; applying the identical call again totals the
// column INCLUDING that new total and writes B5='$15.2M'. Re-running the identical request is
// exactly what must not happen — which is what this guard prevents.
//
// The rule: dedupe only when the shape matches a CONFIRMED pending action AND the incoming detail
// carries nothing new — absent/blank (the button already supplied it), or trimmed-identical to the
// instruction already applied. Anything else is a new request and must reach the gate and the
// reducer like any other call.
//
// `pending.confirmed === true` is a true statement that the action landed: it is only ever set
// past an identity bail (App.tsx's voice-commit and button-confirm paths both set it AFTER
// `applyAction` returned a non-identity `nextDoc`). It is cleared on undo, a program swap, a
// session reset, a spoken cancel — and, as of round 4, when a direct-manipulation edit commits
// through `handleSurfaceAction`, which previously left the confirmed record standing while the
// user hand-edited what it described. One doc mutation still bypasses that list, and this comment
// will not pretend otherwise: `revise_text` pre-flushes an uncommitted Word textarea draft into
// `mockDoc` (App.tsx, inside the revise_text branch) without touching the pending record. It is
// logged in the round-4 report rather than fixed here.

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

/** The incoming tool call, as a named record. `target` and `detail` are both `string | undefined`
 *  and were adjacent positional parameters until round 4 — a swap at the call site was type-clean
 *  and nothing would have caught it. Naming them is the whole point of this shape. */
export interface ConfirmCall {
  verb: string;
  target?: string;
  detail?: string;
  confirmed: boolean;
}

/** True when this call should be acked as an already-applied duplicate rather than re-run.
 *  Requires the verb+target shape to match a confirmed pending action AND the incoming detail to
 *  carry nothing new: either absent/blank, or — after trimming surrounding whitespace — the exact
 *  same string as the instruction the pending action already applied. Any other difference,
 *  including one only in punctuation, case or sign ('-250' is not '250'), is a new request: it
 *  must reach the gate and the reducer, never be swallowed here. */
export function shouldDedupeConfirm(
  pending: PendingActionLike | null | undefined,
  call: ConfirmCall,
): boolean {
  if (!call.confirmed || !isDuplicateConfirm(pending, call.verb, call.target)) return false;
  const d = (call.detail ?? '').trim();
  return d === '' || d === (pending!.detail ?? '').trim();
}
