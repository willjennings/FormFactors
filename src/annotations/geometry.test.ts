import { describe, it, expect } from 'vitest';
import { isDegenerate, bboxOf, center, unionBbox, placementPoint } from './geometry';
import type { Bbox } from './geometry';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, bbox: Bbox): SceneEntity => ({
  id: id as EntityId, title: id, url: '', category: 'content', aliases: [id], bbox, sub: false,
});

describe('geometry', () => {
  it('isDegenerate flags zero/negative extents', () => {
    expect(isDegenerate([100, 100, 100, 200])).toBe(true);   // zero height
    expect(isDegenerate([100, 100, 200, 100])).toBe(true);   // zero width
    expect(isDegenerate([100, 100, 200, 200])).toBe(false);
  });

  it('bboxOf returns the bbox, or null when missing or degenerate', () => {
    const es = [ent('a', [100, 100, 200, 200]), ent('z', [0, 0, 0, 0])];
    expect(bboxOf(es, 'a' as EntityId)).toEqual([100, 100, 200, 200]);
    expect(bboxOf(es, 'z' as EntityId)).toBeNull();          // degenerate → null
    expect(bboxOf(es, 'missing' as EntityId)).toBeNull();    // absent → null
  });

  it('center midpoints a bbox', () => {
    expect(center([100, 200, 300, 400])).toEqual({ x: 300, y: 200 }); // x=(200+400)/2, y=(100+300)/2
  });

  it('unionBbox covers the group and ignores degenerate members', () => {
    expect(unionBbox([[100, 100, 200, 200], [300, 400, 500, 600]])).toEqual([100, 100, 500, 600]);
    expect(unionBbox([[100, 100, 200, 200], [0, 0, 0, 0]])).toEqual([100, 100, 200, 200]);
    expect(unionBbox([[0, 0, 0, 0]])).toBeNull();
    expect(unionBbox([])).toBeNull();
  });

  it('placementPoint offsets just outside the bbox per placement', () => {
    const b: Bbox = [100, 200, 300, 400]; // top=100,left=200,bottom=300,right=400; cx=300,cy=200
    expect(placementPoint(b, 'top')).toEqual({ x: 300, y: 100 });
    expect(placementPoint(b, 'bottom')).toEqual({ x: 300, y: 300 });
    expect(placementPoint(b, 'left')).toEqual({ x: 200, y: 200 });
    expect(placementPoint(b, 'right')).toEqual({ x: 400, y: 200 });
  });
});
