import { toCanvas, getFontEmbedCSS } from 'html-to-image';

// Font-embed CSS is fetched once per session and reused: the per-snapshot cost is string
// injection, not network. Embedding keeps the model's frame glyph-identical to the screen
// (the old skipFonts:true rendered ALL webfont labels in fallback faces — an honesty gap
// the hand-drawn-ink final review caught). Failure falls back to skipFonts, never blocks.
//
// The scan root is document.body, NOT the snapshotted node, for two reasons (review C1):
// 1. html-to-image's used-font traversal recurses only into HTMLElement children, so fonts
//    used exclusively on SVG <text> (Caveat, all ink labels) are invisible to it — App.tsx
//    plants a hidden HTML primer span (.font-ink) to declare the ink font, and the scan
//    must cover wherever that primer lives.
// 2. The cache is shared by BOTH snapshot roots (surface + instruction layer); whichever
//    ticks first would otherwise poison the session with its subtree's font subset.
// A transient first-tick failure (fonts still loading, network blip) retries on later
// snapshots instead of downgrading the whole session to skipFonts; after MAX_FONT_ATTEMPTS
// consecutive failures the null result is permanent (genuinely offline — stop retrying at
// the snapshot cadence).
const MAX_FONT_ATTEMPTS = 3;
let fontCssPromise: Promise<string | null> | null = null;
let fontCssAttempts = 0;
function cachedFontCss(node: HTMLElement): Promise<string | null> {
  if (!fontCssPromise) {
    if (fontCssAttempts >= MAX_FONT_ATTEMPTS) return Promise.resolve(null);
    fontCssAttempts++;
    fontCssPromise = getFontEmbedCSS(node.ownerDocument?.body ?? node).catch(() => {
      fontCssPromise = null; // next snapshot retries (bounded by MAX_FONT_ATTEMPTS)
      return null;
    });
  }
  return fontCssPromise;
}

/**
 * Rasterize a DOM node to a canvas (real pixels of exactly what the user sees).
 * Returns null on ANY failure (taint, detached node, library error) so the vision
 * loop degrades gracefully to the existing schematic path (learnings §6: fail soft).
 */
export async function snapshotNode(node: HTMLElement): Promise<HTMLCanvasElement | null> {
  try {
    const fontEmbedCSS = await cachedFontCss(node);
    return await toCanvas(node, {
      cacheBust: false, pixelRatio: 1,
      ...(fontEmbedCSS !== null ? { fontEmbedCSS } : { skipFonts: true }),
    });
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
