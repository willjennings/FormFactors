// Pure window geometry + fail-soft persistence for the single program window.
//
// Since the desk landed (spec §1) the JOURNAL owns window geometry: every settled move is a
// journaled `window.move`, and a minimized window keeps its rect in the inventory, so there is
// nothing left for a second store to remember. App still calls `clampWindow` (drag, boot, and
// every rect it hands the desk) and still calls `loadWindowRect` as the boot fallback for a
// program window with no journal entry — but NOTHING WRITES THE KEY ANY MORE: `saveWindowRect`
// has no caller in src/ (its effect was deleted with `windowRect`), so that fallback can only
// see a value left by a pre-desk build in the same tab. Retiring both storage halves, and the
// test that covers them, is a deliberate follow-up rather than part of the wiring task.
export type WindowRect = { x: number; y: number; w: number; h: number };

export const MIN_W = 320;
export const MIN_H = 240;

export function clampWindow(rect: WindowRect, plane: { width: number; height: number }): WindowRect {
  const w = Math.min(Math.max(rect.w, MIN_W), plane.width);
  const h = Math.min(Math.max(rect.h, MIN_H), plane.height);
  const x = Math.min(Math.max(rect.x, 0), Math.max(0, plane.width - w));
  const y = Math.min(Math.max(rect.y, 0), Math.max(0, plane.height - h));
  return { x, y, w, h };
}

const key = (programId: string) => `shell.window.${programId}`;

export function loadWindowRect(programId: string): WindowRect | null {
  try {
    const raw = sessionStorage.getItem(key(programId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && typeof p?.w === 'number' && typeof p?.h === 'number') return p;
    return null;
  } catch { return null; }
}

export function saveWindowRect(programId: string, rect: WindowRect): void {
  try { sessionStorage.setItem(key(programId), JSON.stringify(rect)); } catch { /* fail-soft */ }
}
