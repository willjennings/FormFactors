// Pure window geometry + fail-soft persistence for the single program window.
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
