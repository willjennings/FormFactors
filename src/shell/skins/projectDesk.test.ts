import { describe, expect, it } from 'vitest';
import { projectDesk } from './projectDesk';
import { resolveSkin } from './registry';
import { deskReduce, initialDeskState, artifactWindowId, programWindowId } from '../desk/deskStore';

const PLANE = { width: 1600, height: 1000 };
const skin = (k: string) => resolveSkin(k)!;
const withArtifact = () => deskReduce(initialDeskState('word', { x: 48, y: 48, w: 680, h: 620 }), {
  type: 'window.open', id: artifactWindowId('a1'), kind: 'artifact', refId: 'a1',
  rect: { x: 560, y: 80, w: 380, h: 300 }, origin: 'agent', at: 10,
});

// Two artifacts on the desk, opened at DIFFERENT authored rects — the point of the tests below is
// that Material's slots, not the authored rects, are what keep them apart.
const withTwoArtifacts = () => deskReduce(withArtifact(), {
  type: 'window.open', id: artifactWindowId('a2'), kind: 'artifact', refId: 'a2',
  rect: { x: 600, y: 120, w: 380, h: 300 }, origin: 'agent', at: 20,
});
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('projectDesk', () => {
  it('familiar and provenance project identity', () => {
    const d = withArtifact();
    for (const k of ['familiar', 'provenance']) {
      for (const p of projectDesk(skin(k), d, PLANE)) {
        expect(p.rect).toEqual(d.windows.find(w => w.id === p.id)!.rect);
      }
    }
  });

  it('material makes the artifact larger than the program window', () => {
    const d = withArtifact();
    const p = projectDesk(skin('material'), d, PLANE);
    const area = (id: string) => { const r = p.find(x => x.id === id)!.rect; return r.w * r.h; };
    expect(area(artifactWindowId('a1'))).toBeGreaterThan(area(programWindowId('word')));
  });

  it('material gives every artifact its own slot — two artifacts do not overlap at all', () => {
    const p = projectDesk(skin('material'), withTwoArtifacts(), PLANE);
    const r1 = p.find(x => x.id === artifactWindowId('a1'))!.rect;
    const r2 = p.find(x => x.id === artifactWindowId('a2'))!.rect;
    expect(r1).not.toEqual(r2);
    expect(overlaps(r1, r2)).toBe(false);
    // still the largest thing on the desk, which is the whole point of the skin
    expect(r1.w * r1.h).toBeGreaterThan(p.find(x => x.id === programWindowId('word'))!.rect.w * p.find(x => x.id === programWindowId('word'))!.rect.h);
  });

  it('material slots survive a promotion — placing one artifact does not move the other', () => {
    const d = withTwoArtifacts();
    const before = projectDesk(skin('material'), d, PLANE).find(x => x.id === artifactWindowId('a1'))!.rect;
    const promoted = deskReduce(d, { type: 'window.move', id: artifactWindowId('a2'),
      rect: { x: 40, y: 500, w: 400, h: 300 }, byUser: true });
    expect(projectDesk(skin('material'), promoted, PLANE).find(x => x.id === artifactWindowId('a1'))!.rect).toEqual(before);
  });

  it('a PLACED window is never projected — identity in every skin', () => {
    let d = withArtifact();
    const id = artifactWindowId('a1');
    const mine = { x: 120, y: 400, w: 300, h: 200 };
    d = deskReduce(d, { type: 'window.move', id, rect: mine, byUser: true });
    for (const k of ['familiar', 'material', 'provenance', 'conversation']) {
      expect(projectDesk(skin(k), d, PLANE).find(p => p.id === id)!.rect).toEqual(mine);
    }
  });

  it('every projected rect stays inside the plane, on every skin, on a cramped plane', () => {
    const d = withTwoArtifacts();
    const tight = { width: 1024, height: 620 };
    for (const k of ['familiar', 'material', 'provenance', 'conversation']) {
      for (const p of projectDesk(skin(k), d, tight)) {
        expect(p.rect.x).toBeGreaterThanOrEqual(0);
        expect(p.rect.y).toBeGreaterThanOrEqual(0);
        expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(tight.width);
        expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(tight.height);
      }
    }
  });

  it('projection is stable — projecting a projection changes nothing', () => {
    const d = withTwoArtifacts();
    for (const k of ['material', 'conversation']) {
      const once = projectDesk(skin(k), d, PLANE);
      const asDesk = { ...d, windows: d.windows.map(w => ({ ...w, rect: once.find(p => p.id === w.id)!.rect })) };
      expect(projectDesk(skin(k), asDesk, PLANE)).toEqual(once);
    }
  });
});
