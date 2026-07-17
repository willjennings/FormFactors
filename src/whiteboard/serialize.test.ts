import { describe, it, expect } from 'vitest';
import { serializeWhiteboard } from './serialize';
import { initialWhiteboardState, reduce } from './store';

describe('serializeWhiteboard', () => {
  it('returns null for an empty board', () => {
    expect(serializeWhiteboard(initialWhiteboardState())).toBeNull();
  });
  it('names nodes by key and connectors by from→to', () => {
    let s = reduce(initialWhiteboardState(), { type: 'wb.add', spec: { kind: 'node', key: 'start', x: 100, y: 100, text: 'Start', shape: 'box' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'node', key: 'end', x: 800, y: 100, text: 'End', shape: 'box' } });
    s = reduce(s, { type: 'wb.add', spec: { kind: 'connector', from: 'start', to: 'end', label: 'go' } });
    const out = serializeWhiteboard(s)!;
    expect(out).toContain('nodes: start, end');
    expect(out).toContain('start→end ("go")');
    expect(out.startsWith('[WHITEBOARD:')).toBe(true);
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });
});
