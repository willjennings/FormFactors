// Pure mark geometry for AnnotationLayer — kept out of the .tsx so it is unit-testable in the
// node test env (no jsdom). All coordinates are 0-1000 plane space; the renderer converts to %.
import type { SceneEntity, EntityId } from '../entities/registry';
import type { LabelPlacement } from './types';

export type Bbox = [number, number, number, number]; // ymin, xmin, ymax, xmax

export function isDegenerate(b: Bbox): boolean {
  return b[2] - b[0] <= 0 || b[3] - b[1] <= 0;
}

/** The measured bbox for an entity id, or null if it is missing OR degenerate (→ render nothing). */
export function bboxOf(entities: SceneEntity[], id: EntityId): Bbox | null {
  const e = entities.find((x) => x.id === id);
  if (!e) return null;
  const b = e.bbox as Bbox;
  return isDegenerate(b) ? null : b;
}

export function center(b: Bbox): { x: number; y: number } {
  return { x: (b[1] + b[3]) / 2, y: (b[0] + b[2]) / 2 };
}

/** Union of the non-degenerate boxes; null when none are valid. */
export function unionBbox(boxes: Bbox[]): Bbox | null {
  const valid = boxes.filter((b) => !isDegenerate(b));
  if (!valid.length) return null;
  return valid.reduce<Bbox>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

/** The attach point on the bbox edge for a placement (label leader-line target). */
export function placementPoint(b: Bbox, placement: LabelPlacement): { x: number; y: number } {
  const c = center(b);
  switch (placement) {
    case 'top': return { x: c.x, y: b[0] };
    case 'bottom': return { x: c.x, y: b[2] };
    case 'left': return { x: b[1], y: c.y };
    case 'right': return { x: b[3], y: c.y };
  }
}
