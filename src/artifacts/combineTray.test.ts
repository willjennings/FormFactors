import { describe, it, expect } from 'vitest';
import { toggleTray, removeTray, clearTray, canFire, isTrayFull, pruneTray, restoreTray, type TrayMember } from './combineTray';
import { MAX_ARTIFACTS } from './artifactStore';

const m = (sourceId: string): TrayMember =>
  ({ entityId: `artifact-${sourceId}`, sourceId, title: sourceId.toUpperCase(), color: '#000' });

describe('combineTray', () => {
  it('adds a member that is absent', () => {
    expect(toggleTray([], m('a1')).map((x) => x.sourceId)).toEqual(['a1']);
  });
  it('removes a member that is present — toggle', () => {
    expect(toggleTray([m('a1')], m('a1'))).toEqual([]);
  });
  it('preserves selection order', () => {
    const t = toggleTray(toggleTray(toggleTray([], m('word')), m('a1')), m('excel'));
    expect(t.map((x) => x.sourceId)).toEqual(['word', 'a1', 'excel']);
  });
  it('dedupes by sourceId, not by entityId', () => {
    // Two different program elements resolve to the SAME source — the doc must appear once.
    const fromButton: TrayMember = { entityId: 'word-3', sourceId: 'word', title: 'Word', color: '#000' };
    const fromCell: TrayMember = { entityId: 'word-5', sourceId: 'word', title: 'Word', color: '#000' };
    expect(toggleTray([fromButton], fromCell)).toEqual([]);   // same source → toggles it off
  });
  it('caps at MAX_ARTIFACTS', () => {
    let t: TrayMember[] = [];
    for (let i = 0; i < MAX_ARTIFACTS + 2; i++) t = toggleTray(t, m(`a${i}`));
    expect(t).toHaveLength(MAX_ARTIFACTS);
  });
  it('removeTray drops exactly one by sourceId; unknown is a no-op', () => {
    const t = [m('a1'), m('a2')];
    expect(removeTray(t, 'a1').map((x) => x.sourceId)).toEqual(['a2']);
    expect(removeTray(t, 'zzz')).toEqual(t);
  });
  it('clearTray empties it', () => {
    expect(clearTray()).toEqual([]);
  });
  it('needs two to fire — combine rejects fewer', () => {
    expect(canFire([])).toBe(false);
    expect(canFire([m('a1')])).toBe(false);
    expect(canFire([m('a1'), m('word')])).toBe(true);
  });
  it('isTrayFull is false below cap', () => {
    let t: TrayMember[] = [];
    for (let i = 0; i < MAX_ARTIFACTS - 1; i++) t = toggleTray(t, m(`a${i}`));
    expect(isTrayFull(t)).toBe(false);
  });
  it('isTrayFull is true at cap', () => {
    let t: TrayMember[] = [];
    for (let i = 0; i < MAX_ARTIFACTS; i++) t = toggleTray(t, m(`a${i}`));
    expect(isTrayFull(t)).toBe(true);
  });
  it('full tray can still toggle off existing member (removing is not adding)', () => {
    let t: TrayMember[] = [];
    for (let i = 0; i < MAX_ARTIFACTS; i++) t = toggleTray(t, m(`a${i}`));
    expect(t).toHaveLength(MAX_ARTIFACTS);
    expect(isTrayFull(t)).toBe(true);
    // Toggle off a member when full — should succeed since removing is not adding
    const afterToggleOff = toggleTray(t, m('a0'));
    expect(afterToggleOff).toHaveLength(MAX_ARTIFACTS - 1);
    expect(afterToggleOff.map((x) => x.sourceId)).not.toContain('a0');
  });
});

describe('pruneTray', () => {
  it('drops members whose artifact id is not in the live set', () => {
    const t = [m('a1'), m('a2')];
    const { tray, dropped } = pruneTray(t, ['a2']);
    expect(tray.map((x) => x.sourceId)).toEqual(['a2']);
    expect(dropped.map((x) => x.sourceId)).toEqual(['a1']);
  });
  it('keeps program members regardless of the live artifact set', () => {
    const t = [m('word'), m('a1')];
    const { tray, dropped } = pruneTray(t, []);
    expect(tray.map((x) => x.sourceId)).toEqual(['word']);
    expect(dropped.map((x) => x.sourceId)).toEqual(['a1']);
  });
  it('preserves order among survivors', () => {
    const t = [m('a1'), m('word'), m('a2'), m('excel')];
    const { tray } = pruneTray(t, ['a1', 'a2']);
    expect(tray.map((x) => x.sourceId)).toEqual(['a1', 'word', 'a2', 'excel']);
  });
  it('no-op returns the SAME array reference so React can bail', () => {
    const t = [m('a1'), m('word')];
    const { tray, dropped } = pruneTray(t, ['a1']);
    expect(tray).toBe(t);
    expect(dropped).toEqual([]);
  });
  it('empty tray is a no-op', () => {
    const { tray, dropped } = pruneTray([], ['a1']);
    expect(tray).toEqual([]);
    expect(dropped).toEqual([]);
  });
});

describe('restoreTray', () => {
  it('stash members come first, in the stash order', () => {
    const stash = [m('excel'), m('a1')];
    const { tray } = restoreTray([], stash, ['a1']);
    expect(tray.map((x) => x.sourceId)).toEqual(['excel', 'a1']);
  });
  it('current members not already in the stash are appended after it', () => {
    const stash = [m('a1')];
    const current = [m('a1'), m('word')]; // added mid-connect, while the fire was in flight
    const { tray } = restoreTray(current, stash, ['a1']);
    expect(tray.map((x) => x.sourceId)).toEqual(['a1', 'word']);
  });
  it('dedupes by sourceId — the stash copy wins, the current copy is discarded silently (same value either way)', () => {
    const stash = [m('a1')];
    const current = [m('a1')];
    const { tray } = restoreTray(current, stash, ['a1']);
    expect(tray).toHaveLength(1);
  });
  it('drops a stash member whose artifact was closed during the connect — the resurrection case', () => {
    const stash = [m('a1'), m('a2')];
    const { tray, dropped } = restoreTray([], stash, ['a2']); // a1 no longer exists
    expect(tray.map((x) => x.sourceId)).toEqual(['a2']);
    expect(dropped.map((x) => x.sourceId)).toEqual(['a1']);
  });
  it('program-id members always survive, live artifact set notwithstanding', () => {
    const stash = [m('word'), m('excel')];
    const { tray, dropped } = restoreTray([], stash, []);
    expect(tray.map((x) => x.sourceId)).toEqual(['word', 'excel']);
    expect(dropped).toEqual([]);
  });
  it('caps at MAX_ARTIFACTS, keeping stash members first and dropping the overflow (reported, not silently discarded)', () => {
    const stash = Array.from({ length: MAX_ARTIFACTS }, (_, i) => m(`a${i}`));
    const current = [m('word')]; // added mid-connect, pushed past the cap
    const liveIds = stash.map((x) => x.sourceId);
    const { tray, dropped } = restoreTray(current, stash, liveIds);
    expect(tray).toHaveLength(MAX_ARTIFACTS);
    expect(tray.map((x) => x.sourceId)).toEqual(stash.map((x) => x.sourceId));
    expect(dropped.map((x) => x.sourceId)).toEqual(['word']);
  });
  it('empty stash falls back to whatever survives in current', () => {
    const current = [m('a1'), m('a2')];
    const { tray, dropped } = restoreTray(current, [], ['a1']);
    expect(tray.map((x) => x.sourceId)).toEqual(['a1']);
    expect(dropped.map((x) => x.sourceId)).toEqual(['a2']);
  });
  it('empty stash and empty current is a no-op', () => {
    const { tray, dropped } = restoreTray([], [], []);
    expect(tray).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
