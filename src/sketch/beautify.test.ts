import { describe, it, expect } from 'vitest';
import { validateBeautifyCall, BEAUTIFY_TOOL } from './beautify';
import { initialSketchState, reduce } from './sketchStore';
import { initialWhiteboardState, reduce as wbReduce, MAX_MARKS } from '../whiteboard/store';
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
    }, sketchWith2(), initialWhiteboardState());
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.removeIds).toEqual(['s1', 's2']);
      expect(r.events).toHaveLength(3);
      expect(r.summary).toBe('Replace 2 strokes with 2 nodes + 1 connector?');
    }
  });
  it('a stale strokeId fails the WHOLE call, naming the live ids', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1', 's9'], marks: [{ kind: 'node', key: 'a', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2(), initialWhiteboardState());
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('s9');
    expect((r as { error: string }).error).toContain('Live stroke ids: s1, s2');
  });
  it('an invalid mark fails the whole call with the wb validation error', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1'], marks: [{ kind: 'node', key: '', x: 1, y: 1, text: 'x', shape: 'box' }] }, sketchWith2(), initialWhiteboardState());
    expect((r as { error: string }).error).toContain('wb_node needs a key');
  });
  it('empty strokeIds or marks → error (a beautify must do both halves)', () => {
    expect(validateBeautifyCall({ strokeIds: [], marks: [] }, sketchWith2(), initialWhiteboardState())).toHaveProperty('error');
  });
});

describe('beautify honesty (probes 2026-07-16)', () => {
  it('rejects a proposal that would silently evict existing marks past MAX_MARKS', () => {
    let wb = initialWhiteboardState();
    for (let i = 0; i < MAX_MARKS - 1; i++) wb = wbReduce(wb, { type: 'wb.add', spec: { kind: 'node', key: `k${i}`, x: 10, y: 10, text: 'n', shape: 'box' } });
    const r = validateBeautifyCall({ strokeIds: ['s1'], marks: [
      { kind: 'node', key: 'new1', x: 1, y: 1, text: 'a', shape: 'box' },
      { kind: 'node', key: 'new2', x: 2, y: 2, text: 'b', shape: 'box' },
    ] }, sketchWith2(), wb);
    expect((r as { error: string }).error).toContain('capacity');
    expect((r as { error: string }).error).toContain('evict');
  });
  it('duplicate node keys in one proposal count ONCE in the summary (replace-by-key)', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1'], marks: [
      { kind: 'node', key: 'a', x: 1, y: 1, text: 'first', shape: 'box' },
      { kind: 'node', key: 'a', x: 2, y: 2, text: 'second', shape: 'box' },
    ] }, sketchWith2(), initialWhiteboardState());
    expect((r as { summary: string }).summary).toBe('Replace 1 stroke with 1 node?');
  });
  it('duplicate strokeIds are deduped in the count and removal', () => {
    const r = validateBeautifyCall({ strokeIds: ['s1', 's1'], marks: [
      { kind: 'node', key: 'a', x: 1, y: 1, text: 'x', shape: 'box' },
    ] }, sketchWith2(), initialWhiteboardState());
    if (!('error' in r)) {
      expect(r.removeIds).toEqual(['s1']);
      expect(r.summary).toBe('Replace 1 stroke with 1 node?');
    } else { throw new Error('should validate'); }
  });
});
