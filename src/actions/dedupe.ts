// Double-apply guard (fix round 1, I3). A voice-confirm call can be a harmless follow-up to an
// action the Confirm BUTTON already applied — same verb, same effective target. This predicate is
// checked BEFORE the gate in App.tsx: a dedupe hit commits nothing (it only replays the earlier
// success), so running it first cannot violate "nothing may be witnessed or committed on missing
// information" — it just stops a corrected retry (e.g. the model re-firing confirm=true without
// resending detail, because the button already supplied it) from being mistaken by the gate for a
// malformed call. A genuinely malformed lone call still errors — see validate.test.ts's "confirm
// never bypasses a malformed call".
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
