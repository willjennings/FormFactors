import { describe, expect, it } from 'vitest';
import { deskReduce, initialDeskState, artifactWindowId, programWindowId } from './deskStore';
import { barItems, visibleWindows, deskSummary, reconcileArtifacts, ARTIFACT_BASE_RECT } from './selectors';
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

  it('never touches program windows', () => {
    const s = initialDeskState('word', R);
    const next = reconcileArtifacts(s, [], 100);
    expect(next).toBe(s);
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
