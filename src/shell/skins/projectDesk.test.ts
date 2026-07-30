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
    const d = withArtifact();
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
    const d = withArtifact();
    for (const k of ['material', 'conversation']) {
      const once = projectDesk(skin(k), d, PLANE);
      const asDesk = { ...d, windows: d.windows.map(w => ({ ...w, rect: once.find(p => p.id === w.id)!.rect })) };
      expect(projectDesk(skin(k), asDesk, PLANE)).toEqual(once);
    }
  });
});
