// Pure window geometry. Persistence used to live here too — a per-program rect in
// sessionStorage — and is GONE (fix round 1, I1): the journal owns window geometry now. Every
// settled move is a journaled `window.move`, a minimized window keeps its rect in the inventory,
// and the boot-fit effect re-fits the whole desk to the current screen through the same event.
// A second store could only disagree with that one, and disagree invisibly, since replay cannot
// see sessionStorage.
//
// `clampWindow` is the one geometry rule: callers are ProgramWindow's drag (src/shell/
// ProgramWindow.tsx), `fitWindows` (src/shell/desk/selectors.ts), and App's program-open and
// artifact-reconcile paths — in every case the clamped rect ends up inside a journaled event, so
// what is on screen and what replays are the same rect.
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
