// Quick-fire chips: digits 1-9 fire the matching suggestion chip WITHOUT moving the
// pointer — clicking a chip forces abandoning the very hover target the question is
// about (user finding 2026-07-18: pointing and asking must not fight each other).

/** Digit key → chip index, or null when it must not fire. Pure. */
export function quickFireIndex(key: string, targetIsEditable: boolean, chipCount: number): number | null {
  if (targetIsEditable) return null;
  if (!/^[1-9]$/.test(key)) return null;
  const i = parseInt(key, 10) - 1;
  return i < chipCount ? i : null;
}

/** True when a keydown's target is a place where digits mean text entry. */
export function isEditableTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || !!e.isContentEditable;
}
