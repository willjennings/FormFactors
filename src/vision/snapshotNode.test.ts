import { describe, it, expect } from 'vitest';
import { makeThrottle } from './snapshotNode';

describe('makeThrottle', () => {
  it('allows the first call and blocks until the interval elapses', () => {
    const gate = makeThrottle(500);
    expect(gate(1000)).toBe(true);   // first call always allowed
    expect(gate(1200)).toBe(false);  // 200ms < 500ms
    expect(gate(1500)).toBe(true);   // 500ms elapsed
    expect(gate(1600)).toBe(false);
  });
});
