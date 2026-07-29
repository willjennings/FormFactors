// Deixis resolution: "what is the pointer over?" — ONE function, so the pill the user reads
// and the referent the model is told can never be two different entities.
//
// Why this exists as a module. The scene is a flat array (composeEntities: program elements,
// then artifact windows, then rail cards) and the array order has nothing to do with what is
// painted on top — click-to-raise makes paint order user-controlled while the array order stays
// fixed. Resolving with a bare `entities.find(...)` therefore returns "first registered", not
// "what you clicked": on the default `?artifacts=1` boot at 1600x1000, a first-match resolver
// and this one disagree at 1607 of 44589 points on a 6px grid, 645 of them cases where the
// pointer is over an artifact window but first-match answers with a program element underneath.
// The two pinned cases in resolveAt.test.ts are measured instances of exactly that.
//
// The rule is SMALLEST CONTAINING AREA, which is the app's existing hover rule and the one that
// matches the DOM: sub-entities (a paragraph, a cell, a field) are strictly inside their window,
// so the innermost box is the thing under the finger. Nesting is not ambiguity — the containers
// are not competitors (computePointingConfidence takes the same view).

import type { SceneEntity } from './registry';

/** bbox is [ymin, xmin, ymax, xmax] in the 0-1000 plane. */
export const entityArea = (e: SceneEntity): number =>
  (e.bbox[2] - e.bbox[0]) * (e.bbox[3] - e.bbox[1]);

/**
 * The entity under (x, y) in 0-1000 plane coordinates, or undefined if the point is bare plane.
 *
 * - Containment is INCLUSIVE of the edges (a click on a border still lands on the entity).
 * - Zero-HEIGHT bboxes never match. `updateLayout` degrades an unmeasurable window to
 *   [0,0,0,0] on purpose (closed/minimized program window), and an honest zero must not become
 *   a zero-area entity that wins every smallest-area contest at the origin.
 * - Ties go to the earlier entity in the array — arbitrary but deterministic, so the same point
 *   always resolves to the same entity within a layout.
 */
export function resolveAt(entities: SceneEntity[], x: number, y: number): SceneEntity | undefined {
  const containing = entities.filter((e) => {
    const [ymin, xmin, ymax, xmax] = e.bbox;
    return ymax - ymin > 0 && x >= xmin && x <= xmax && y >= ymin && y <= ymax;
  });
  if (!containing.length) return undefined;
  return containing.reduce((a, b) => (entityArea(b) < entityArea(a) ? b : a));
}
