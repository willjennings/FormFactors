// Honest per-word geometry for the Word textarea (C2b Part A). The pure cores here are unit-tested;
// the DOM Range glue (measureWords, added in the next task) reads the REAL text layout — no OCR,
// no perception model.

/** A measured word: its text, character span in the source value, and 0-1000 plane-space box. */
export interface WordBox {
  text: string;
  charStart: number;
  charEnd: number;
  box: [number, number, number, number]; // ymin, xmin, ymax, xmax
}

/** Split text into non-whitespace word runs with exact character offsets. Pure. */
export function tokenizeWords(text: string): { text: string; charStart: number; charEnd: number }[] {
  const out: { text: string; charStart: number; charEnd: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], charStart: m.index, charEnd: m.index + m[0].length });
  }
  return out;
}

/** True if the word box's centre lies within the visible frame (both boxes in 0-1000 plane space). */
export function wordInFrame(box: [number, number, number, number], frame: [number, number, number, number]): boolean {
  const cy = (box[0] + box[2]) / 2;
  const cx = (box[1] + box[3]) / 2;
  return cy >= frame[0] && cy <= frame[2] && cx >= frame[1] && cx <= frame[3];
}

/** Map a viewport client rect into 0-1000 plane space — matches updateLayout's toBBox convention. */
export function rectToBox(
  rect: { top: number; left: number; bottom: number; right: number },
  plane: { top: number; left: number; width: number; height: number },
): [number, number, number, number] {
  return [
    ((rect.top - plane.top) / plane.height) * 1000,
    ((rect.left - plane.left) / plane.width) * 1000,
    ((rect.bottom - plane.top) / plane.height) * 1000,
    ((rect.right - plane.left) / plane.width) * 1000,
  ];
}

// Build a hidden div that reproduces the textarea's text layout at its exact on-screen position,
// so Range.getClientRects() over its text node yields the words' real viewport rects.
function buildMirror(textarea: HTMLTextAreaElement): HTMLDivElement {
  const r = textarea.getBoundingClientRect();
  const cs = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const copy = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform',
    'lineHeight', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
  ] as const;
  for (const p of copy) mirror.style[p as any] = cs[p as any];
  mirror.style.position = 'fixed';
  mirror.style.top = `${r.top - textarea.scrollTop}px`;
  mirror.style.left = `${r.left - textarea.scrollLeft}px`;
  mirror.style.width = `${r.width}px`;
  mirror.style.height = `${r.height}px`;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordWrap = 'break-word';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.zIndex = '-1';
  mirror.textContent = textarea.value;
  return mirror;
}

/**
 * Measure per-word boxes for a textarea via a transient mirror div + Range. Returns [] on any
 * failure (fail-soft → whole-element pointing). Boxes are in 0-1000 plane space.
 */
export function measureWords(
  textarea: HTMLTextAreaElement,
  plane: { top: number; left: number; width: number; height: number },
): WordBox[] {
  const tokens = tokenizeWords(textarea.value);
  if (!tokens.length) return [];
  let mirror: HTMLDivElement | null = null;
  try {
    mirror = buildMirror(textarea);
    document.body.appendChild(mirror);
    const node = mirror.firstChild;
    if (!node) return [];
    const range = document.createRange();
    const boxes: WordBox[] = [];
    for (const t of tokens) {
      range.setStart(node, t.charStart);
      range.setEnd(node, t.charEnd);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const r = rects[0]; // first fragment if the word wraps a line
      boxes.push({ text: t.text, charStart: t.charStart, charEnd: t.charEnd, box: rectToBox(r, plane) });
    }
    const tr = textarea.getBoundingClientRect();
    const frame = rectToBox({ top: tr.top, left: tr.left, bottom: tr.bottom, right: tr.right }, plane);
    return boxes.filter((b) => wordInFrame(b.box, frame));
  } catch {
    return [];
  } finally {
    if (mirror && mirror.parentNode) mirror.parentNode.removeChild(mirror);
  }
}
