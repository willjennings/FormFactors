import { describe, it, expect } from 'vitest';
import { clampWindow } from './windowState';

// The sessionStorage round-trip that used to live here went with loadWindowRect/saveWindowRect
// (fix round 1, I1): the journal is the only store of window geometry now, and the desk's own
// coverage for that is in journal/replayEqualsLive.test.ts + shell/desk/selectors.test.ts
// (fitWindows). What remains is the pure geometry rule everything else clamps through.
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
  it('returns a NEW rect, never the one passed in — a shared module constant must never be aliased', () => {
    // journal/registry.ts's DEFAULT_DESK_RECT is handed to initialDeskState by reference, so a
    // clampWindow that aliased its input would put the constant itself inside a live window.
    const rect = { x: 10, y: 20, w: 640, h: 480 };
    const out = clampWindow(rect, { width: 1200, height: 800 });
    expect(out).toEqual(rect);
    expect(out).not.toBe(rect);
  });
});
