import { toCanvas, getFontEmbedCSS } from 'html-to-image';

// Font-embed CSS is fetched once per session and reused: the per-snapshot cost is string
// injection, not network. Embedding keeps the model's frame glyph-identical to the screen
// (the old skipFonts:true rendered ALL webfont labels in fallback faces — an honesty gap
// the hand-drawn-ink final review caught). Failure falls back to skipFonts, never blocks.
let fontCssPromise: Promise<string | null> | null = null;
function cachedFontCss(node: HTMLElement): Promise<string | null> {
  if (!fontCssPromise) fontCssPromise = getFontEmbedCSS(node).catch(() => null);
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
