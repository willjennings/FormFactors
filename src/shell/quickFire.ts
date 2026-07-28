// Quick-fire chips: digits 1-9 fire the matching suggestion chip WITHOUT moving the
// pointer — clicking a chip forces abandoning the very hover target the question is
// about (user finding 2026-07-18: pointing and asking must not fight each other).

/** Same-key cooldown: swallow key bounce/hold artifacts, allow deliberate re-fires. */
export const QUICK_FIRE_COOLDOWN_MS = 400;

/** Digit key → chip index, or null when it must not fire. Pure. */
export function quickFireIndex(
  key: string, targetIsEditable: boolean, chipCount: number,
  opts: { repeat?: boolean; lastFire?: { key: string; at: number } | null; now?: number } = {},
): number | null {
  if (targetIsEditable) return null;
  // A held key auto-repeats keydown — one tap must mean ONE send (user 2026-07-19: a held
  // "2" fired five slide inserts).
  if (opts.repeat) return null;
  if (opts.lastFire && opts.now !== undefined && opts.lastFire.key === key
      && opts.now - opts.lastFire.at < QUICK_FIRE_COOLDOWN_MS) return null;
  if (!/^[1-9]$/.test(key)) return null;
  const i = parseInt(key, 10) - 1;
  return i < chipCount ? i : null;
}

/** Does the pointer-free deixis listener own this digit?
 *
 *  Two window-level keydown listeners see the same digit: quick-fire (registered first, so it runs
 *  first) and the numbered-target selector. `preventDefault` does not stop the second listener from
 *  running — but it DOES set `defaultPrevented`, which the second listener can read, and that is
 *  the only signal that survives: quick-fire closes the open ask SYNCHRONOUSLY, before the second
 *  listener gets the event, so by then `askRef.current` is already null and "is an ask open?"
 *  answers no. The question has to be asked of the event, not of the ask.
 *
 *  Without this, pressing "2" to fire ask candidate 2 also selected target 2: attributing the
 *  answered edit to `direct` input rather than typed, dropping a THIS marker, pushing a graded
 *  deixis event, and telling the model "[USER SELECTED target 2 … Treat this as what they are
 *  pointing at.]" while the user was answering a content question — after which grounding
 *  reconciliation graded the model's edit against that phantom referent, so in an honest arm a
 *  bogus mismatch could force an answered edit into a witness card. */
export function digitSelectsTarget(key: string, bandOpen: boolean, alreadyClaimed: boolean): boolean {
  if (alreadyClaimed) return false;              // quick-fire or the band already spent this key
  if (bandOpen) return false;                    // an open band's digits pick a notch
  return /^[1-9]$/.test(key);
}

/** True when a keydown's target is a place where digits mean text entry. */
export function isEditableTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || !!e.isContentEditable;
}
