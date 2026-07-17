import { describe, it, expect } from 'vitest';
import { initialWhiteboardState, reduce, MAX_MARKS } from './store';
import type { WbSpec } from './types';

const node = (key: string, x = 500, y = 500): WbSpec => ({ kind: 'node', key, x, y, text: key, shape: 'box' });

describe('whiteboard store', () => {
  it('adds a node; re-adding the same key replaces in place (keeps order)', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: node('a', 100, 100) });
    s = reduce(s, { type: 'wb.add', spec: node('b', 200, 200) });
    s = reduce(s, { type: 'wb.add', spec: node('a', 900, 900) }); // replace a
    expect(s.marks.length).toBe(2);
    const a = s.marks.find((m) => m.kind === 'node' && m.key === 'a') as any;
    expect([a.x, a.y]).toEqual([900, 900]);
    expect(s.marks[0].kind === 'node' && s.marks[0].key).toBe('a'); // order preserved
  });

  it('stamps deterministic ids on connectors/labels', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'connector', from: 'a', to: 'b' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'label', x: 10, y: 10, text: 'hi' } });
    expect(s.marks.map((m) => (m.kind !== 'node' ? m.id : '·'))).toEqual(['1', '2']);
    expect(s.nextId).toBe(3);
  });

  it('caps at MAX_MARKS, dropping oldest', () => {
    let s = initialWhiteboardState();
    for (let i = 0; i < MAX_MARKS + 3; i++) s = reduce(s, { type: 'wb.add', spec: node(`n${i}`) });
    expect(s.marks.length).toBe(MAX_MARKS);
    expect((s.marks[0] as any).key).toBe('n3'); // oldest three dropped
  });

  it('clear empties marks but keeps nextId monotonic', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'label', x: 1, y: 1, text: 'x' } });
    s = reduce(s, { type: 'wb.clear' });
    expect(s.marks).toEqual([]);
    expect(s.nextId).toBe(2);
  });
});
