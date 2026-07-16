// The model's ONLY view of the sketch (spec §5): measured geometry as text, deduped by the
// caller via makeChangeGate. Never claims more than classify measured.
import type { SketchState, Stroke } from './types';
import { MAX_STROKES } from './sketchStore';

const r = Math.round;

function describe(s: Stroke): string {
  const c = s.classified;
  const [ymin, xmin, ymax, xmax] = c.bbox;
  const cx = r((xmin + xmax) / 2), cy = r((ymin + ymax) / 2);
  const w = r(xmax - xmin), h = r(ymax - ymin);
  switch (c.kind) {
    case 'box': return `a box at (${cx},${cy}) ~${w}×${h} (${s.id})`;
    case 'ellipse': return `an ellipse at (${cx},${cy}) ~${w}×${h} (${s.id})`;
    case 'line': return `a line from (${r(c.from.x)},${r(c.from.y)}) to (${r(c.to.x)},${r(c.to.y)}) (${s.id})`;
    case 'arrow': return `an arrow from (${r(c.from.x)},${r(c.from.y)}) to (${r(c.to.x)},${r(c.to.y)}) (${s.id})`;
    case 'scribble': return ''; // grouped below
  }
}

export function serializeSketch(state: SketchState): string | null {
  if (!state.strokes.length) return null;
  const shaped = state.strokes.filter((s) => s.classified.kind !== 'scribble').map(describe);
  const scribbles = state.strokes.filter((s) => s.classified.kind === 'scribble');
  const parts = [...shaped];
  if (scribbles.length === 1) parts.push(`1 scribble (${scribbles[0].id})`);
  if (scribbles.length > 1) parts.push(`${scribbles.length} scribbles (${scribbles.map((s) => s.id).join(', ')})`);
  const capNote = state.droppedAtCap > 0
    ? ` ${state.droppedAtCap} oldest strokes were dropped at the ${MAX_STROKES}-stroke cap.` : '';
  return `[SKETCH] The user has drawn on the whiteboard: ${parts.join('; ')}.${capNote} You see measured geometry only — you cannot read drawn words. DO NOT acknowledge this update.]`;
}
