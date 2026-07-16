// ?sketch=1 demo strokes: replayed through the REAL store so the demo proves the actual
// classification + serialization path with no model (spec §9).
import type { XY } from './types';

export function buildSketchDemo(): XY[][] {
  const box: XY[] = [];
  for (let i = 0; i <= 10; i++) box.push({ x: 150 + i * 20, y: 250 });
  for (let i = 1; i <= 10; i++) box.push({ x: 350, y: 250 + i * 12 });
  for (let i = 1; i <= 10; i++) box.push({ x: 350 - i * 20, y: 370 });
  for (let i = 1; i <= 9; i++) box.push({ x: 150, y: 370 - i * 12 });
  const arrow: XY[] = [
    ...Array.from({ length: 19 }, (_, i) => ({ x: 380 + i * 21, y: 310 })),
    { x: 780, y: 310 }, { x: 745, y: 295 }, { x: 780, y: 310 }, { x: 745, y: 325 },
  ];
  const scribble: XY[] = Array.from({ length: 24 }, (_, i) => ({ x: 430 + i * 12, y: 600 + (i % 2 ? 45 : -45) }));
  return [box, arrow, scribble];
}
