// Chord grammar for the register band, sibling of quickFire.ts: backtick toggles, digits
// 1-N select while open, Esc closes. Closed-band digits stay quick-fire's — the two
// grammars never contend because the band swallows digits only while visibly open.
export function bandKeyAction(
  key: string, targetIsEditable: boolean, bandOpen: boolean, notchCount: number,
): 'open' | 'close' | number | null {
  if (targetIsEditable) return null;
  if (key === '`') return bandOpen ? 'close' : 'open';
  if (!bandOpen) return null;
  if (key === 'Escape') return 'close';
  if (/^[1-9]$/.test(key)) {
    const i = Number(key) - 1;
    return i < notchCount ? i : null;
  }
  return null;
}
