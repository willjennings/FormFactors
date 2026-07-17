import { describe, it, expect } from 'vitest';
import { clampWindow, loadWindowRect, saveWindowRect } from './windowState';

// In-memory sessionStorage stub — keeps the suite dependency-free (node env has no storage).
const store = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
} as Storage;

describe('windowState', () => {
  it('clamps below minimum size up to 320x240', () => {
    expect(clampWindow({ x: 0, y: 0, w: 100, h: 100 }, { width: 1200, height: 800 })).toEqual({ x: 0, y: 0, w: 320, h: 240 });
  });
  it('keeps the window fully on the plane', () => {
    const r = clampWindow({ x: 1100, y: 700, w: 400, h: 300 }, { width: 1200, height: 800 });
    expect(r.x + r.w).toBeLessThanOrEqual(1200);
    expect(r.y + r.h).toBeLessThanOrEqual(800);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });
  it('round-trips through sessionStorage and fails soft on garbage', () => {
    saveWindowRect('word', { x: 10, y: 20, w: 640, h: 480 });
    expect(loadWindowRect('word')).toEqual({ x: 10, y: 20, w: 640, h: 480 });
    sessionStorage.setItem('shell.window.excel', '{nope');
    expect(loadWindowRect('excel')).toBeNull();
    expect(loadWindowRect('missing')).toBeNull();
  });
});
