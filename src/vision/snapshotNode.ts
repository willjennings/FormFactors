import { toCanvas } from 'html-to-image';

/**
 * Rasterize a DOM node to a canvas (real pixels of exactly what the user sees).
 * Returns null on ANY failure (taint, detached node, library error) so the vision
 * loop degrades gracefully to the existing schematic path (learnings §6: fail soft).
 */
export async function snapshotNode(node: HTMLElement): Promise<HTMLCanvasElement | null> {
  try {
    return await toCanvas(node, { cacheBust: false, pixelRatio: 1, skipFonts: true });
  } catch {
    return null;
  }
}

/** Pure throttle gate: returns true at most once per intervalMs. Caller supplies `now`. */
export function makeThrottle(intervalMs: number): (now: number) => boolean {
  let last = -Infinity;
  return (now: number): boolean => {
    if (now - last >= intervalMs) {
      last = now;
      return true;
    }
    return false;
  };
}
