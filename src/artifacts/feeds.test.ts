import { describe, it, expect } from 'vitest';
import { FEEDS, FeedUnavailable } from './feeds';

describe('feeds registry (spec §8)', () => {
  it('declares exactly clock, weather, stock', () => {
    expect(Object.keys(FEEDS).sort()).toEqual(['clock', 'stock', 'weather']);
  });

  it('clock is LIVE and formats the injected `now` deterministically', () => {
    expect(FEEDS.clock.provenance).toBe('live');
    const now = new Date(2026, 6, 16, 14, 30, 5).getTime();
    const formatted = FEEDS.clock.read(now);
    expect(formatted).toBe(new Date(now).toLocaleTimeString());
    // same `now` in, same string out — no hidden reliance on wall-clock time
    expect(FEEDS.clock.read(now)).toBe(formatted);
  });

  it('weather is LIVE (descriptor shape only — the fetch itself is untested here)', () => {
    expect(FEEDS.weather.provenance).toBe('live');
    expect(FEEDS.weather.id).toBe('weather');
    expect(typeof FEEDS.weather.label).toBe('string');
    expect(FEEDS.weather.label.length).toBeGreaterThan(0);
    expect(typeof FEEDS.weather.refreshMs).toBe('number');
    expect(FEEDS.weather.refreshMs).toBeGreaterThan(0);
    expect(typeof FEEDS.weather.read).toBe('function');
  });

  it('stock is SIMULATED and is a deterministic walk in `now`', () => {
    expect(FEEDS.stock.provenance).toBe('simulated');
    const now = 123456;
    const a = FEEDS.stock.read(now);
    const b = FEEDS.stock.read(now);
    expect(a).toBe(b); // same now → same value
    expect(a).toMatch(/^MERI \$\d+\.\d{2}$/);
  });

  it('stock adjacent ticks differ but stay within a bounded delta', () => {
    const t0 = 1_000_000;
    const t1 = t0 + 5000; // one tick per the refreshMs cadence
    const v0 = parseFloat((FEEDS.stock.read(t0) as string).replace('MERI $', ''));
    const v1 = parseFloat((FEEDS.stock.read(t1) as string).replace('MERI $', ''));
    expect(v0).not.toBe(v1);
    expect(Math.abs(v1 - v0)).toBeLessThan(1); // no wild jumps between adjacent ticks
  });

  it('stock stays within a sane bounded range across a wide sweep of `now`', () => {
    for (let now = 0; now < 10_000_000; now += 137_000) {
      const v = parseFloat((FEEDS.stock.read(now) as string).replace('MERI $', ''));
      expect(v).toBeGreaterThan(30);
      expect(v).toBeLessThan(55);
    }
  });

  it('every descriptor carries id/label/provenance/refreshMs/read', () => {
    for (const [id, descriptor] of Object.entries(FEEDS)) {
      expect(descriptor.id).toBe(id);
      expect(typeof descriptor.label).toBe('string');
      expect(['live', 'simulated']).toContain(descriptor.provenance);
      expect(descriptor.refreshMs).toBeGreaterThan(0);
      expect(typeof descriptor.read).toBe('function');
    }
  });

  it('FeedUnavailable is a typed, named error the renderer can catch', () => {
    const err = new FeedUnavailable('weather');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FeedUnavailable');
    expect(err.feedId).toBe('weather');
  });
});
