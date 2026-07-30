// Pure window geometry. Persistence used to live here too — a per-program rect in
// sessionStorage — and is GONE (fix round 1, I1): the journal owns window geometry now. Every
// settled move is a journaled `window.move`, a minimized window keeps its rect in the inventory,
// and the boot-fit effect re-fits the whole desk to the current screen through the same event.
// A second store could only disagree with that one, and disagree invisibly, since replay cannot
// see sessionStorage.
//
// `clampWindow` is the one geometry rule, and it has exactly five callers: App's program-open
// (App.tsx:1349) and artifact-reconcile (App.tsx:1444) paths, `fitWindows`
// (shell/desk/selectors.ts:111), ProgramWindow's drag (shell/ProgramWindow.tsx:72), and
// `projectDesk` (shell/skins/projectDesk.ts:118). The first three put the clamped rect straight
// inside a journaled event. The drag is the one exception worth naming: its intermediate frames
// are state-only (deskDispatchLive), and only the settled rect — the same clamped rect, at rest —
// is journaled. The fifth journals nothing at all: a projection is drawn, never stored, so its
// clamp keeps a rect on the plane for one paint and the authored rect it came from is untouched.
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
