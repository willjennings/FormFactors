import { describe, it, expect } from 'vitest';
import { idleExceeded, IDLE_LIMIT_MS } from './idle';

describe('idle watchdog', () => {
  it('trips only past the limit', () => {
    expect(idleExceeded(1000 + IDLE_LIMIT_MS, 1000)).toBe(false);
    expect(idleExceeded(1001 + IDLE_LIMIT_MS, 1000)).toBe(true);
    expect(idleExceeded(5000, 1000, 3000)).toBe(true);
  });
});
