import { describe, it, expect } from 'vitest';
import { resolveAt, entityArea } from './resolveAt';
import { asId, type SceneEntity } from './registry';

const ent = (id: string, bbox: [number, number, number, number]): SceneEntity =>
  ({ id: asId(id), title: id, url: '', category: 'content', aliases: [], bbox });

// MEASURED FIXTURE — not invented geometry. These are the real entity bboxes read out of the
// running app at 1600x1000 on the default `?artifacts=1` boot with no window dragged, in
// composeEntities order (program elements, then artifact windows, then artifact sub-entities).
// Two artifact windows overlap the program window, which is what makes array order and
// geometry disagree.
const MEASURED: SceneEntity[] = [
  ent('word-1', [102, 35.63, 165, 449.38]),                 // Word Ribbon
  ent('word-2', [109, 68.13, 158, 99.39]),
  ent('word-3', [109, 101.89, 158, 144.4]),
  ent('word-4', [173, 35.63, 635, 449.38]),                 // Document body
  ent('artifact-a1', [135.5, 350.63, 190.5, 586.88]),       // Q3 Status Brief
  ent('artifact-a2', [159.5, 360.63, 304.25, 596.88]),      // Status Board
  ent('artifact-a1-para-1', [143.5, 358.13, 182.5, 579.38]),
  ent('artifact-a2-field-1', [167.5, 368.13, 185.38, 589.38]),
  ent('artifact-a2-field-2', [193.38, 368.13, 227.88, 589.38]),
  ent('artifact-a2-field-3', [235.88, 368.13, 270.38, 589.38]),
  ent('artifact-a2-field-4', [278.38, 368.13, 296.25, 589.38]),
];

/** The old resolver: first match in array order. Kept only to show what these pins are pinning. */
const firstMatch = (es: SceneEntity[], x: number, y: number) =>
  es.find((e) => {
    const [ymin, xmin, ymax, xmax] = e.bbox;
    return x >= xmin && x <= xmax && y >= ymin && y <= ymax;
  });

describe('resolveAt', () => {
  it('returns undefined on bare plane and on an empty scene', () => {
    expect(resolveAt([], 500, 500)).toBeUndefined();
    expect(resolveAt(MEASURED, 900, 900)).toBeUndefined();
  });

  it('picks the innermost box when entities nest', () => {
    // word-2 is a control strictly inside the word-1 ribbon.
    expect(resolveAt(MEASURED, 80, 130)!.id).toBe('word-2');
  });

  it('includes the edges — a point on the border still lands on the entity', () => {
    const box = ent('b', [100, 100, 200, 200]);
    expect(resolveAt([box], 100, 100)!.id).toBe('b');
    expect(resolveAt([box], 200, 200)!.id).toBe('b');
    expect(resolveAt([box], 200.01, 150)).toBeUndefined();
  });

  it('ignores zero-height bboxes — a closed/minimized window degrades to [0,0,0,0]', () => {
    // Without the guard the zeroed entity wins every contest at the origin, because its area
    // is 0. updateLayout emits exactly this shape when the program window is not on screen.
    const zeroed = ent('word-1', [0, 0, 0, 0]);
    const real = ent('artifact-a1', [0, 0, 100, 100]);
    expect(resolveAt([zeroed, real], 0, 0)!.id).toBe('artifact-a1');
    expect(resolveAt([zeroed], 0, 0)).toBeUndefined();
  });

  it('breaks ties deterministically toward the earlier entity', () => {
    const a = ent('a', [0, 0, 100, 100]);
    const b = ent('b', [0, 0, 100, 100]);
    expect(entityArea(a)).toBe(entityArea(b));
    expect(resolveAt([a, b], 50, 50)!.id).toBe('a');
  });

  // --- The two measured disagreements this function exists to stop. ---
  // Both were read off the live DOM with elementFromPoint at the same boot as MEASURED: the
  // element genuinely under the cursor is the artifact one in each case.

  it('pin: over the brief paragraph — not the Word Ribbon registered first', () => {
    // Viewport pixel (575, 147) -> plane (359.375, 147). DOM: artifact-a1-para-1 (a <p>).
    const x = 359.375, y = 147;
    expect(firstMatch(MEASURED, x, y)!.id).toBe('word-1');
    expect(resolveAt(MEASURED, x, y)!.id).toBe('artifact-a1-para-1');
  });

  it('pin: over the status board Weather field — not the Document body underneath', () => {
    // Viewport pixel (594, 282) -> plane (371.25, 282). DOM: artifact-a2-field-4 (a <span>).
    const x = 371.25, y = 282;
    expect(firstMatch(MEASURED, x, y)!.id).toBe('word-4');
    expect(resolveAt(MEASURED, x, y)!.id).toBe('artifact-a2-field-4');
  });
});
