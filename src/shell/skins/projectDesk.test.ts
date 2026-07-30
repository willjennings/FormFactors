import { describe, expect, it } from 'vitest';
import { projectDesk } from './projectDesk';
import { resolveSkin } from './registry';
import { deskReduce, initialDeskState, artifactWindowId, programWindowId } from '../desk/deskStore';
import { MIN_W, MIN_H } from '../windowState';
import { BOTTOM_INSET, COLUMN_CSS_LEFT, COLUMN_CSS_W, COLUMN_MAX_W, OMNIBOX_H, SOURCE_RAIL_W, TOP_BAR_H, conversationColumnW } from './furniture';

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

  // I4 (Task 4 review). Material's probe is "what you have made is the desk" — and below a
  // ~1455px plane the old 0.22 fraction put the dock under MIN_W, which returned the program
  // window to its authored rect: on a 1200×800 laptop Word was once again the largest object on
  // screen, which is the sentence this whole phase exists to falsify. 1200×800 is the floor the
  // arithmetic is now chosen against.
  it('material holds its probe at a 1200x800 laptop plane — the dock stays docked and the piece is bigger', () => {
    const floor = { width: 1200, height: 800 };
    const d = withArtifact();
    const p = projectDesk(skin('material'), d, floor);
    const prog = p.find(x => x.id === programWindowId('word'))!.rect;
    const art = p.find(x => x.id === artifactWindowId('a1'))!.rect;
    // Projected, not fallen back: the dock is not the authored rect this fixture opened Word at
    // ({48,48,680,620} — the pre-SH2 default, kept here because these tests pin the arithmetic,
    // not the current default), nor anything MIN_W would have had to stretch.
    expect(prog).not.toEqual(d.windows.find(w => w.id === programWindowId('word'))!.rect);
    expect(prog.w).toBeGreaterThanOrEqual(MIN_W);
    expect(prog.h).toBeGreaterThanOrEqual(MIN_H);
    expect(art.w * art.h).toBeGreaterThan(prog.w * prog.h);
    // Docked against the source rail, clear of it — the rail is 56px of z-30 furniture and the
    // old fixed x: 24 put ~30px of the window underneath it.
    expect(prog.x).toBeGreaterThanOrEqual(SOURCE_RAIL_W);
    // And clear of the furniture above and below: a row drawn under a data-shell bar cannot be
    // pointed at, so drawing one there is a false claim that it is on the desk.
    for (const r of [prog, art]) {
      expect(r.y).toBeGreaterThanOrEqual(TOP_BAR_H);
      expect(r.y + r.h).toBeLessThanOrEqual(floor.height - (BOTTOM_INSET.shelf + OMNIBOX_H));
    }
  });

  // I2 (Task 4 review). The single-column band put a slot under MIN_H at four artifacts on a
  // 1600×1000 plane, and the per-window MIN fallback then returned EVERY artifact to its
  // authored rect — the cascaded default stack, silently, with no surface saying Material had
  // stopped projecting. The band may get denser; it may not disappear.
  it('material keeps every artifact in a legible slot at n=4 — the band gets denser, it never reverts', () => {
    let d = withTwoArtifacts();
    for (const id of ['a3', 'a4']) {
      d = deskReduce(d, { type: 'window.open', id: artifactWindowId(id), kind: 'artifact', refId: id,
        rect: { x: 600, y: 80, w: 344, h: 300 }, origin: 'agent', at: 30 });
    }
    const p = projectDesk(skin('material'), d, PLANE);
    const rects = ['a1', 'a2', 'a3', 'a4'].map(id => p.find(x => x.id === artifactWindowId(id))!.rect);
    for (const r of rects) {
      expect(r.w).toBeGreaterThanOrEqual(MIN_W);
      expect(r.h).toBeGreaterThanOrEqual(MIN_H);
      // Not the authored rect — the whole point of the finding is that four of them silently were.
      expect(r).not.toEqual({ x: 600, y: 80, w: 344, h: 300 });
    }
    // Four distinct slots, none on top of another: at this count the grid takes a second column.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  });

  // I3 (Task 4 review). Minimize is one click, with a button in every artifact window's title
  // bar, and the window it puts away is not drawn at all — so a slot held for it is a visible
  // hole AND a step toward the density ceiling above.
  it('a minimized artifact gives its slot back — the rest re-slot as if it were not there', () => {
    let d = withTwoArtifacts();
    d = deskReduce(d, { type: 'window.open', id: artifactWindowId('a3'), kind: 'artifact', refId: 'a3',
      rect: { x: 616, y: 104, w: 344, h: 300 }, origin: 'agent', at: 30 });
    const withThree = projectDesk(skin('material'), d, PLANE);
    const minimized = deskReduce(d, { type: 'window.minimize', id: artifactWindowId('a3') });
    const withA3Away = projectDesk(skin('material'), minimized, PLANE);
    // a1 and a2 lay out exactly as they would on a desk that only ever held the two of them.
    const twoOnly = projectDesk(skin('material'), withTwoArtifacts(), PLANE);
    for (const id of ['a1', 'a2']) {
      const away = withA3Away.find(x => x.id === artifactWindowId(id))!.rect;
      expect(away).toEqual(twoOnly.find(x => x.id === artifactWindowId(id))!.rect);
      expect(away).not.toEqual(withThree.find(x => x.id === artifactWindowId(id))!.rect);
    }
    // And the put-away window itself is projected to nothing at all — it comes back where it was.
    expect(withA3Away.find(x => x.id === artifactWindowId('a3'))!.rect).toEqual({ x: 616, y: 104, w: 344, h: 300 });
  });

  // IMPORTANT-1 (Task 5 review, confirmed by the 2026-07-30 drive at both laptop planes).
  // Conversation's whole claim is "the agent holds the centre; windows orbit the talk" — so a
  // window drawn ON the centre column is not a smaller version of that claim, it is the opposite
  // of it, and the drive measured exactly that: with the column fixed at 680, `columnLeft − rw −
  // GAP` went negative at 1200×800 and 1024×620, every orbiting window clamped to x=0, and 60–148px
  // of window sat under the column's own chip strip. That is the whole 1366×768 laptop class, i.e.
  // the class D's spatial probe would have been run on. The column is plane-relative now
  // (`conversationColumnW`), and this is the interval assertion that says so: every projected
  // window ends before the column starts or starts after it ends.
  it('conversation orbits clear the centre column at 1200x800 and at 1024x620', () => {
    const d = withTwoArtifacts();
    for (const plane of [{ width: 1200, height: 800 }, { width: 1024, height: 620 }]) {
      const colW = conversationColumnW(plane.width);
      const columnLeft = (plane.width - colW) / 2;
      const columnRight = columnLeft + colW;
      // The column is genuinely there to clear — a formula that "solved" this by collapsing the
      // column to nothing would pass an interval test and draw no column at all.
      expect(colW).toBeGreaterThan(0);
      const p = projectDesk(skin('conversation'), d, plane);
      expect(p.length).toBe(3);
      let leftSide = 0, rightSide = 0;
      for (const { id, rect } of p) {
        const clearsLeft = rect.x + rect.w <= columnLeft;
        const clearsRight = rect.x >= columnRight;
        expect(clearsLeft || clearsRight,
          `${id} @ ${plane.width}x${plane.height}: ${JSON.stringify(rect)} overlaps the column ${columnLeft}..${columnRight}`).toBe(true);
        if (clearsLeft) leftSide++; else rightSide++;
        // …and still on the plane, which is the other half of "outward" meaning anything.
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(plane.width);
      }
      // Both sides in use: a projection that pushed everything to one side would clear the column
      // and still not be an orbit.
      expect(leftSide).toBeGreaterThan(0);
      expect(rightSide).toBeGreaterThan(0);
    }
  });

  // The cap has to still bind on a desk-class plane: this fix narrows the column where it must,
  // and nowhere else. 1416 is where `width − 2·368` reaches 680 (furniture.ts's derivation).
  it('the conversation column keeps its designed 680 on a desk-class plane', () => {
    expect(conversationColumnW(PLANE.width)).toBe(COLUMN_MAX_W);
    expect(conversationColumnW(1416)).toBe(COLUMN_MAX_W);
    expect(conversationColumnW(1415)).toBeLessThan(COLUMN_MAX_W);
    // And the two laptop planes get exactly what the derivation says they get.
    expect(conversationColumnW(1200)).toBe(464);
    expect(conversationColumnW(1024)).toBe(288);
  });

  // The formula has two renderings — the number `projectDesk` reserves and the CSS `surfaceBox`
  // draws — because `surfaceBox` returns a style and has no plane number to hand. This evaluates
  // the CSS's own arithmetic (parsed back out of the strings, so a hand-edit to either side is
  // caught here rather than by a person noticing a window under the column) against the function,
  // at the three planes the browser drive measured. The drive's own numbers are the cross-check:
  // it read the rendered column at left=460/w=680, left=368/w=464 and left=368/w=288.
  it('the column CSS and the reserved column width are the same formula', () => {
    const w = COLUMN_CSS_W.match(/^min\((\d+)px, calc\(100% - (\d+)px\)\)$/);
    const l = COLUMN_CSS_LEFT.match(/^calc\(50% - min\((\d+)px, calc\(50% - (\d+)px\)\)\)$/);
    expect(w, `unparsed width CSS: ${COLUMN_CSS_W}`).toBeTruthy();
    expect(l, `unparsed left CSS: ${COLUMN_CSS_LEFT}`).toBeTruthy();
    const [cap, twiceReserve] = [Number(w![1]), Number(w![2])];
    const [half, reserve] = [Number(l![1]), Number(l![2])];
    expect(half * 2).toBe(cap);
    expect(reserve * 2).toBe(twiceReserve);
    for (const planeW of [1600, 1200, 1024]) {
      // What a browser computes for `width` and `left` on this box.
      expect(Math.min(cap, planeW - twiceReserve)).toBe(conversationColumnW(planeW));
      expect(planeW / 2 - Math.min(half, planeW / 2 - reserve)).toBe((planeW - conversationColumnW(planeW)) / 2);
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
