import { describe, it, expect } from 'vitest';
import { validateBeautifyCall, BEAUTIFY_TOOL } from './beautify';
import { initialSketchState, reduce } from './sketchStore';
import type { XY } from './types';

const line = (n = 0): XY[] => Array.from({ length: 8 }, (_, i) => ({ x: 100 + n + i * 30, y: 200 }));
const sketchWith2 = () => {
  let st = reduce(initialSketchState(), { type: 'sketch.strokeAdd', points: line() });
  return reduce(st, { type: 'sketch.strokeAdd', points: line(300) });
};

describe('wb_beautify validation (errors are data; nothing partial)', () => {
  it('declares the tool', () => {
    expect(BEAUTIFY_TOOL.name).toBe('wb_beautify');
  });
  it('valid proposal → removeIds + wb events + a human summary', () => {
    const r = validateBeautifyCall({
      strokeIds: ['s1', 's2'],
      marks: [
        { kind: 'node', key: 'a', x: 300, y: 200, text: 'Start', shape: 'box' },
        { kind: 'node', key: 'b', x: 700, y: 200, text: 'End', shape: 'box' },
        { kind: 'connector', from: 'a', to: 'b' },
      ],
    }, sketchWith2());
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.removeIds).toEqual(['s1', 's2']);
      expect(r.events).toHaveLength(3);
      expect(r.summary).toBe('Replace 2 strokes with 2 nodes + 1 connector?');
    }
  });
  it('a stale strokeId fails the WHOLE call, naming the live ids', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1', 's9'], marks: [{ kind: 'node', key: 'a', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2());
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('s9');
    expect((r as { error: string }).error).toContain('Live stroke ids: s1, s2');
  });
  it('an invalid mark fails the whole call with the wb validation error', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1'], marks: [{ kind: 'node', key: '', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2());
    expect((r as { error: string }).error).toContain('wb_node needs a key');
  });
  it('empty strokeIds or marks → error (a beautify must do both halves)', () => {
    expect(validateBeautifyCall({ strokeIds: [], marks: [] }, sketchWith2())).toHaveProperty('error');
  });
});
