import { describe, it, expect } from 'vitest';
import { initialSketchState, reduce, MAX_STROKES } from './sketchStore';
import type { XY } from './types';

const line = (n = 0): XY[] => Array.from({ length: 8 }, (_, i) => ({ x: 100 + n + i * 30, y: 200 }));

describe('sketchStore', () => {
  it('strokeAdd classifies and assigns deterministic ids', () => {
    const st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    expect(st.strokes).toHaveLength(1);
    expect(st.strokes[0].id).toBe('s1');
    expect(st.strokes[0].classified.kind).toBe('line');
  });
  it('drops taps: <3 points or path <8 units', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    st = reduce(st, { type: 'sketch.strokeAdd', points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 5, y: 1 }] });
    expect(st.strokes).toHaveLength(0);
  });
  it('caps at MAX_STROKES, dropping the oldest and counting the drop', () => {
    let st = initialSketchState();
    for (let i = 0; i < MAX_STROKES + 2; i++) st = reduce(st, { type: 'sketch.strokeAdd', points: line(i) });
    expect(st.strokes).toHaveLength(MAX_STROKES);
    expect(st.strokes[0].id).toBe('s3'); // s1, s2 dropped
    expect(st.droppedAtCap).toBe(2);
  });
  it('clear empties strokes (user-only affordance)', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    st = reduce(st, { type: 'sketch.clear' });
    expect(st.strokes).toHaveLength(0);
    expect(st.droppedAtCap).toBe(0);
  });
  it('replace removes exactly the named ids; unknown ids are a no-op (fail-soft)', () => {
    let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
    st = reduce(st, { type: 'sketch.strokeAdd', points: line(200) });
    const after = reduce(st, { type: 'sketch.replace', removeIds: ['s1', 'zzz'] });
    expect(after.strokes.map((s) => s.id)).toEqual(['s2']);
  });
});
