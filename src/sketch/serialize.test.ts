import { describe, it, expect } from 'vitest';
import { initialSketchState, reduce } from './sketchStore';
import { serializeSketch } from './serialize';
import type { XY } from './types';

const rect = (): XY[] => {
  const pts: XY[] = [];
  for (let i = 0; i <= 10; i++) pts.push({ x: 200 + i * 20, y: 300 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 400, y: 300 + i * 10 });
  for (let i = 1; i <= 10; i++) pts.push({ x: 400 - i * 20, y: 400 });
  for (let i = 1; i <= 9; i++) pts.push({ x: 200, y: 400 - i * 10 });
  return pts;
};
const zig = (): XY[] => Array.from({ length: 30 }, (_, i) => ({ x: 500 + i * 10, y: 600 + (i % 2 ? 50 : -50) }));

describe('serializeSketch', () => {
  it('is null for an empty sketch (no hint sent)', () => {
    expect(serializeSketch(initialSketchState())).toBeNull();
  });
  it('describes shapes with ids, groups scribbles, and states the honesty floor', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: rect() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: zig() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: zig().map((p) => ({ x: p.x, y: p.y + 200 })) });
    const s = serializeSketch(st)!;
    expect(s).toMatch(/^\[SKETCH: /);
    expect(s.endsWith(']')).toBe(true);
    expect(s.slice(1, -1)).not.toContain(']');
    expect(s).toContain('a box at (300,350) ~200×100 (s1)');
    expect(s).toContain('2 scribbles (s2, s3)');
    expect(s).toContain('You see measured geometry only — you cannot read drawn words.');
    expect(s).toContain('DO NOT acknowledge');
  });
  it('mentions the cap drop when strokes were discarded (no silent truncation)', () => {
    const st = { ...initialSketchState(), strokes: [], droppedAtCap: 0 };
    let full = reduce(st, { type: 'sketch.strokeAdd', points: rect() });
    full = { ...full, droppedAtCap: 3 };
    expect(serializeSketch(full)).toContain('3 oldest strokes were dropped at the 64-stroke cap');
  });
});
