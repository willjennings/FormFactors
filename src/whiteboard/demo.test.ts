import { describe, it, expect } from 'vitest';
import { buildWhiteboardDemo } from './demo';

describe('buildWhiteboardDemo', () => {
  it('scripts a small diagram (nodes → connectors) then clear, in time order', () => {
    const script = buildWhiteboardDemo();
    expect(script.length).toBeGreaterThan(3);
    expect(script.map((s) => s.at)).toEqual([...script.map((s) => s.at)].sort((a, b) => a - b)); // ascending
    expect(script[0].event).toMatchObject({ type: 'wb.add', spec: { kind: 'node' } });
    expect(script[script.length - 1].event).toEqual({ type: 'wb.clear' });
  });
});
