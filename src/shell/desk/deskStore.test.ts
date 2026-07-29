import { describe, expect, it } from 'vitest';
import { deskReduce, initialDeskState, programWindowId, artifactWindowId } from './deskStore';
import type { DeskState } from './types';

const R = { x: 48, y: 48, w: 680, h: 620 };
const open = (s: DeskState, id: string, kind: 'program' | 'artifact', origin: 'you' | 'agent', at: number): DeskState =>
  deskReduce(s, { type: 'window.open', id, kind, refId: id.split(':')[1], rect: R, origin, at });

describe('deskStore', () => {
  it('sparse start: exactly one window — the active program, origin you, focused', () => {
    const s = initialDeskState('word', R);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0]).toMatchObject({ id: programWindowId('word'), kind: 'program', refId: 'word', origin: 'you', minimized: false });
    expect(s.focusedId).toBe(programWindowId('word'));
    expect(s.skin).toBe('familiar');
  });

  it('open with a NEW id appends on top and focuses', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    expect(s.windows).toHaveLength(2);
    expect(s.focusedId).toBe('artifact:a1');
    const [prog, art] = s.windows;
    expect(art.z).toBeGreaterThan(prog.z);
    expect(art.origin).toBe('agent');
  });

  it('open with a KNOWN id is focus+restore, never a duplicate', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });
    const zBefore = s.windows.find(w => w.id === 'artifact:a1')!.z;
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 99);
    expect(s.windows).toHaveLength(2);                                   // no duplicate
    const a1 = s.windows.find(w => w.id === 'artifact:a1')!;
    expect(a1.minimized).toBe(false);                                    // restored
    expect(a1.z).toBeGreaterThan(zBefore);                               // raised
    expect(a1.openedAt).toBe(10);                                        // openedAt NEVER rewritten (bar order stability)
    expect(s.focusedId).toBe('artifact:a1');
  });

  it('focus raises, un-minimizes, and sets focusedId in one event', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });
    s = deskReduce(s, { type: 'window.focus', id: 'artifact:a1' });
    const a1 = s.windows.find(w => w.id === 'artifact:a1')!;
    expect(a1.minimized).toBe(false);
    expect(s.focusedId).toBe('artifact:a1');
    expect(a1.z).toBe(Math.max(...s.windows.map(w => w.z)));
  });

  it('minimize hands focus to the highest-z non-minimized window, else null', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.minimize', id: 'artifact:a1' });     // focused one goes away
    expect(s.focusedId).toBe(programWindowId('word'));
    s = deskReduce(s, { type: 'window.minimize', id: programWindowId('word') });
    expect(s.focusedId).toBe(null);
  });

  it('close removes and hands focus the same way', () => {
    let s = initialDeskState('word', R);
    s = open(s, artifactWindowId('a1'), 'artifact', 'agent', 10);
    s = deskReduce(s, { type: 'window.close', id: 'artifact:a1' });
    expect(s.windows.map(w => w.id)).toEqual([programWindowId('word')]);
    expect(s.focusedId).toBe(programWindowId('word'));
  });

  it('move replaces rect only; skin switch changes NOTHING but skin', () => {
    let s = initialDeskState('word', R);
    const moved = { x: 100, y: 100, w: 700, h: 500 };
    s = deskReduce(s, { type: 'window.move', id: programWindowId('word'), rect: moved });
    expect(s.windows[0].rect).toEqual(moved);
    const before = s.windows;
    s = deskReduce(s, { type: 'desk.skin', skin: 'material' });
    expect(s.skin).toBe('material');
    expect(s.windows).toBe(before);                                       // identity: no window touched
  });

  it('unknown ids are no-ops (identity), matching artifactStore discipline', () => {
    const s = initialDeskState('word', R);
    for (const e of [
      { type: 'window.close', id: 'artifact:ghost' } as const,
      { type: 'window.focus', id: 'artifact:ghost' } as const,
      { type: 'window.minimize', id: 'artifact:ghost' } as const,
      { type: 'window.move', id: 'artifact:ghost', rect: R } as const,
    ]) expect(deskReduce(s, e)).toBe(s);
  });

  it('desk.restore replaces state wholesale (journal compaction path)', () => {
    const s = initialDeskState('word', R);
    const other = initialDeskState('excel', R);
    expect(deskReduce(s, { type: 'desk.restore', state: other })).toBe(other);
  });
});
