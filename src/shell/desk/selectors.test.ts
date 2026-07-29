import { describe, expect, it } from 'vitest';
import { deskReduce, initialDeskState, artifactWindowId, programWindowId } from './deskStore';
import { barItems, visibleWindows, deskSummary, reconcileArtifacts, fitWindows, ARTIFACT_BASE_RECT } from './selectors';
import type { DeskState } from './types';

const R = { x: 48, y: 48, w: 680, h: 620 };
const open = (s: DeskState, id: string, kind: 'program' | 'artifact', origin: 'you' | 'agent', at: number): DeskState =>
  deskReduce(s, { type: 'window.open', id, kind, refId: id.split(':')[1], rect: R, origin, at });

describe('barItems', () => {
  it('is ordered by openedAt ascending, and that order is unchanged after focusing the earlier window', () => {
    let s = initialDeskState('word', R);           // program:word, openedAt 0
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = open(s, artifactWindowId('a2'), 'artifact', 'agent', 20);
    // focus raises z on a1 — if barItems used z or focus order this would reshuffle
    s = deskReduce(s, { type: 'window.focus', id: artifactWindowId('a1') });
    const items = barItems(s, w => w.refId);
    expect(items.map(i => i.id)).toEqual([programWindowId('word'), artifactWindowId('a1'), artifactWindowId('a2')]);
  });

  it('titles come from the injected resolver', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    const items = barItems(s, w => w.refId.toUpperCase());
    expect(items.map(i => i.title)).toContain('A1');
  });

  it('focused reflects desk.focusedId', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    const items = barItems(s, w => w.refId);
    expect(items.find(i => i.id === artifactWindowId('a1'))!.focused).toBe(true);
    expect(items.find(i => i.id === programWindowId('word'))!.focused).toBe(false);
  });
});

describe('visibleWindows', () => {
  it('excludes minimized windows and sorts ascending by z', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = open(s, artifactWindowId('a2'), 'artifact', 'agent', 20);
    s = deskReduce(s, { type: 'window.minimize', id: artifactWindowId('a1') });
    const vis = visibleWindows(s);
    expect(vis.map(w => w.id)).toEqual([programWindowId('word'), artifactWindowId('a2')]);
    for (let i = 1; i < vis.length; i++) expect(vis[i].z).toBeGreaterThanOrEqual(vis[i - 1].z);
  });
});

describe('deskSummary', () => {
  it('counts pieces (artifacts) and sources (programs), including minimized windows', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = open(s, artifactWindowId('a2'), 'artifact', 'agent', 20);
    s = deskReduce(s, { type: 'window.minimize', id: artifactWindowId('a2') });
    expect(deskSummary(s)).toEqual({ pieces: 2, sources: 1 });
  });
});

describe('reconcileArtifacts', () => {
  it('adds a window for a live artifact that has none, origin agent, correct id', () => {
    const s = initialDeskState('word', R);
    const next = reconcileArtifacts(s, ['a1'], 100);
    const w = next.windows.find(w => w.id === artifactWindowId('a1'));
    expect(w).toBeDefined();
    expect(w!.origin).toBe('agent');
    expect(w!.kind).toBe('artifact');
    expect(w!.refId).toBe('a1');
  });

  it('removes a window whose artifact is no longer live', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    const next = reconcileArtifacts(s, [], 100);
    expect(next.windows.some(w => w.id === artifactWindowId('a1'))).toBe(false);
    expect(next.windows.some(w => w.id === programWindowId('word'))).toBe(true);
  });

  it('returns the identical object (toBe) when in sync', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    const next = reconcileArtifacts(s, ['a1'], 100);
    expect(next).toBe(s);
  });

  it('never touches program windows — the program DeskWindow survives a removal by identity', () => {
    // The old version of this test reconciled a desk holding ONLY a program window and asserted
    // `next === s`, which is the in-sync case above under a different name: it never ran the
    // removal path at all. To test "never touches", the removal has to actually happen — and the
    // assertion has to be about the program window's own z/rect/minimized/openedAt, not merely
    // that its id is still in the list.
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    const before = s.windows.find(w => w.id === programWindowId('word'))!;
    const next = reconcileArtifacts(s, [], 100);
    expect(next).not.toBe(s);                                             // the removal really ran
    expect(next.windows.map(w => w.id)).toEqual([programWindowId('word')]);
    expect(next.windows.find(w => w.id === programWindowId('word'))).toBe(before);
  });

  it('cascades two new artifacts in one call to distinct rects', () => {
    const s = initialDeskState('word', R);
    const next = reconcileArtifacts(s, ['a1', 'a2'], 100);
    const a1 = next.windows.find(w => w.id === artifactWindowId('a1'))!;
    const a2 = next.windows.find(w => w.id === artifactWindowId('a2'))!;
    expect(a1.rect).toEqual(ARTIFACT_BASE_RECT);
    expect(a2.rect).toEqual({ x: ARTIFACT_BASE_RECT.x + 16, y: ARTIFACT_BASE_RECT.y + 24, w: ARTIFACT_BASE_RECT.w, h: ARTIFACT_BASE_RECT.h });
  });
});

describe('fitWindows', () => {
  const plane = { width: 1200, height: 800 };

  it('returns an EMPTY list when every window already fits — the guard that makes the boot-fit effect a no-op', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    expect(fitWindows(s, plane)).toEqual([]);
  });

  it('pulls a window whose bottom edge overflows back inside the plane', () => {
    // The I1 case: a desk restored (or booted) with the PRE-clamp default onto a short viewport.
    // 48 + 620 = 668 > 640, so the resize corner is off-plane. clampWindow caps h at the plane
    // height first (620 still fits in 640) and then pulls y up to 640 - 620 = 20.
    const s = initialDeskState('word', { x: 48, y: 48, w: 680, h: 620 });
    const fits = fitWindows(s, { width: 1280, height: 640 });
    expect(fits).toEqual([{ id: programWindowId('word'), rect: { x: 48, y: 20, w: 680, h: 620 } }]);
  });

  it('recovers a window parked entirely below the fold — the unreachable case', () => {
    // Saved on a tall display at y=700, reopened on a 600-tall one: with no title bar on the
    // plane there is nothing to drag, so nothing but this can bring it back.
    const s = initialDeskState('word', { x: 40, y: 700, w: 500, h: 400 });
    const fits = fitWindows(s, { width: 900, height: 600 });
    expect(fits).toEqual([{ id: programWindowId('word'), rect: { x: 40, y: 200, w: 500, h: 400 } }]);
  });

  it('lists ONLY the windows that need moving, and includes minimized ones', () => {
    // A minimized window must be fitted too: it is restored at its stored rect, so leaving it
    // off-plane just defers the trap to the moment the user asks for it back.
    let s = initialDeskState('word', { x: 10, y: 10, w: 400, h: 300 });   // already fits
    s = deskReduce(s, { type: 'window.open', id: artifactWindowId('a1'), kind: 'artifact', refId: 'a1',
      rect: { x: 800, y: 40, w: 380, h: 300 }, origin: 'agent', at: 10 });                 // off the right edge
    s = deskReduce(s, { type: 'window.minimize', id: artifactWindowId('a1') });
    const fits = fitWindows(s, { width: 900, height: 600 });
    expect(fits.map(f => f.id)).toEqual([artifactWindowId('a1')]);
    expect(fits[0].rect).toEqual({ x: 520, y: 40, w: 380, h: 300 });
  });
});
