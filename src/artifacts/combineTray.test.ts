import { describe, it, expect } from 'vitest';
import { toggleTray, removeTray, clearTray, canFire, isTrayFull, type TrayMember } from './combineTray';
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
