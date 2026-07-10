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
