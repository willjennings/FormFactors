// Edge-case probes for the SKETCH + WHITEBOARD + TEACHING pure cores. Not a spec — a fault-finding
// pass. Each probe asserts what the HONEST behavior should be (no crash, finite geometry, no silent
// truncation without a signal, no confirmation-card text that overstates what the store will keep).
// A failing probe = a finding for the controller to triage. See .superpowers/sdd/probe-report-1.md.
import { describe, it, expect } from 'vitest';

import { classify } from '../sketch/classify';
import { serializeSketch } from '../sketch/serialize';
import { initialSketchState, reduce as skReduce, MAX_STROKES } from '../sketch/sketchStore';
import { validateBeautifyCall } from '../sketch/beautify';
import type { XY } from '../sketch/types';

import { initialWhiteboardState, reduce as wbReduce, MAX_MARKS } from '../whiteboard/store';
import { serializeWhiteboard } from '../whiteboard/serialize';
import { clipSegmentToBoxEdge, connectorEnds, nodeBox } from '../whiteboard/geometry';
import type { WbSpec, WbEvent } from '../whiteboard/types';

import { teachCallToEvent } from '../teaching/teachTools';
import { initialTeachingState, reduce as tReduce } from '../teaching/teachingStore';
import type { TeachingEvent } from '../teaching/types';
import { buildEntities, type EntityId } from '../entities/registry';
import { getProgram, initialMockDoc } from '../scenarios';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const layout = {
  items: getProgram('word').images.map((img, i) => ({ id: `word-${img.id}`, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
};
const entities = buildEntities(getProgram('word'), initialMockDoc('word'), {}, layout);

const node = (key: string, x = 500, y = 500, text = key): WbSpec => ({ kind: 'node', key, x, y, text, shape: 'box' });
const applyAll = (state: ReturnType<typeof initialWhiteboardState>, events: WbEvent[]) =>
  events.reduce((s, e) => wbReduce(s, e), state);

// A short valid diagonal line stroke: >=3 points, path length >= MIN_PATH_LEN(8).
const diag = (n = 0): XY[] => Array.from({ length: 4 }, (_, i) => ({ x: 10 + n + i * 5, y: 10 + n + i * 5 }));
// A genuine zigzag scribble (mirrors classify.test.ts's fixture).
const zigzag = (n = 0): XY[] => Array.from({ length: 30 }, (_, i) => ({ x: 200 + n + i * 15, y: 400 + (i % 2 ? 60 : -60) }));

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SKETCH
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('SKETCH — classify edge cases', () => {
  it('1. closed-flat stroke (all points on one horizontal line, endpoint near start) → scribble, not a crash', () => {
    const pts: XY[] = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }, { x: 105, y: 100 }];
    const c = classify(pts);
    expect(c.kind).toBe('scribble');
    expect(c.bbox.every(Number.isFinite)).toBe(true);
  });

  it('2. stroke goes straight out and exactly back to start (zero-gap, zero-height bbox) → scribble, finite bbox', () => {
    const pts: XY[] = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 100 }, { x: 100, y: 100 }];
    const c = classify(pts);
    expect(c.kind).toBe('scribble');
    expect(c.bbox).toEqual([100, 100, 100, 300]); // [ymin,xmin,ymax,xmax]: h=0 exactly
    expect(c.bbox.every(Number.isFinite)).toBe(true);
  });

  it('3. negative coordinates classify without NaN/crash, and bbox carries them through unclamped', () => {
    const pts: XY[] = [{ x: -100, y: -100 }, { x: 100, y: 100 }, { x: 500, y: 500 }];
    const c = classify(pts);
    expect(c.kind).toBe('line');
    if (c.kind === 'line') {
      expect(c.from).toEqual({ x: -100, y: -100 });
      expect(c.bbox.every(Number.isFinite)).toBe(true);
    }
  });

  it('3b. coordinates > 1000 (plane escape) classify fine and are NOT clamped by classify', () => {
    const pts: XY[] = [{ x: 100, y: 100 }, { x: 800, y: 800 }, { x: 1600, y: 1700 }];
    const c = classify(pts);
    expect(c.kind).toBe('line');
    if (c.kind === 'line') expect(c.to).toEqual({ x: 1600, y: 1700 });
  });

  it('3c. FINDING: an out-of-plane stroke\'s [SKETCH] hint reports positions outside 0-1000 verbatim — ' +
     'SketchLayer.toPlane has no clamp, classify has no clamp, serializeSketch has no clamp', () => {
    const outOfPlane: XY[] = [{ x: -50, y: -50 }, { x: 300, y: 300 }, { x: 1500, y: 1800 }];
    let st = initialSketchState();
    st = skReduce(st, { type: 'sketch.strokeAdd', points: outOfPlane });
    const hint = serializeSketch(st)!;
    // The model is told "0-1000 space" nowhere in this hint, yet these numbers can exceed it.
    expect(hint).toContain('(-50,-50)');
    expect(hint).toContain('(1500,1800)');
  });
});

describe('SKETCH — sketchStore cap + dedup boundaries', () => {
  it('4a. cap boundary at EXACTLY MAX_STROKES: no drop, droppedAtCap stays 0', () => {
    let st = initialSketchState();
    for (let i = 0; i < MAX_STROKES; i++) st = skReduce(st, { type: 'sketch.strokeAdd', points: diag(i) });
    expect(st.strokes.length).toBe(MAX_STROKES);
    expect(st.droppedAtCap).toBe(0);
    expect(st.strokes[0].id).toBe('s1'); // oldest survives exactly at the boundary
  });

  it('4b. one stroke past the cap: oldest dropped, droppedAtCap becomes 1', () => {
    let st = initialSketchState();
    for (let i = 0; i < MAX_STROKES + 1; i++) st = skReduce(st, { type: 'sketch.strokeAdd', points: diag(i) });
    expect(st.strokes.length).toBe(MAX_STROKES);
    expect(st.droppedAtCap).toBe(1);
    expect(st.strokes[0].id).toBe('s2'); // s1 was dropped
  });

  it('4c. sketch.replace with an empty removeIds array is a no-op (nothing removed)', () => {
    let st = initialSketchState();
    st = skReduce(st, { type: 'sketch.strokeAdd', points: diag(0) });
    const before = st.strokes.length;
    st = skReduce(st, { type: 'sketch.replace', removeIds: [] });
    expect(st.strokes.length).toBe(before);
  });

  it('4d. double-add of identical points: both kept, with distinct ids', () => {
    let st = initialSketchState();
    const pts = diag(0);
    st = skReduce(st, { type: 'sketch.strokeAdd', points: pts });
    st = skReduce(st, { type: 'sketch.strokeAdd', points: pts });
    expect(st.strokes.length).toBe(2);
    expect(st.strokes[0].id).not.toBe(st.strokes[1].id);
    expect(st.strokes[0].points).toEqual(st.strokes[1].points);
  });
});

describe('SKETCH — serialize wording + hint size', () => {
  it('5a. exactly one scribble uses singular wording: "1 scribble (sN)"', () => {
    let st = initialSketchState();
    st = skReduce(st, { type: 'sketch.strokeAdd', points: zigzag(0) });
    const hint = serializeSketch(st)!;
    expect(hint).toContain('1 scribble (s1)');
    expect(hint).not.toContain('1 scribbles');
  });

  it('5b. a sketch of ONLY scribbles: plural wording lists every scribble id, no leading "; "', () => {
    let st = initialSketchState();
    st = skReduce(st, { type: 'sketch.strokeAdd', points: zigzag(0) });
    st = skReduce(st, { type: 'sketch.strokeAdd', points: zigzag(50) });
    st = skReduce(st, { type: 'sketch.strokeAdd', points: zigzag(100) });
    const hint = serializeSketch(st)!;
    expect(hint).toContain('3 scribbles (s1, s2, s3)');
    expect(hint).not.toContain(': ;');
    expect(hint.includes('  ')).toBe(false); // no double space from an empty shaped[] join
  });

  it('5c. hint length with 64 (MAX_STROKES) strokes: measure it — report the number', () => {
    let st = initialSketchState();
    for (let i = 0; i < MAX_STROKES; i++) st = skReduce(st, { type: 'sketch.strokeAdd', points: diag(i * 3) });
    const hint = serializeSketch(st)!;
    // eslint-disable-next-line no-console
    console.log(`[probe] 64-stroke [SKETCH] hint length = ${hint.length} chars`);
    expect(hint.length).toBeGreaterThan(0);
    expect(hint.length).toBeLessThan(10_000); // sanity ceiling; a fail here IS the finding
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHITEBOARD
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('WHITEBOARD — store overflow has NO signal (asymmetry with sketchStore.droppedAtCap)', () => {
  it('6a. FINDING (fails): WhiteboardState should carry SOME truncation signal on overflow, like SketchState.droppedAtCap — it has none', () => {
    let st = initialWhiteboardState();
    for (let i = 0; i < MAX_MARKS + 5; i++) st = wbReduce(st, { type: 'wb.add', spec: node(`n${i}`) });
    expect(st.marks.length).toBe(MAX_MARKS); // evidence: 5 marks WERE silently dropped
    // Honest expectation: some field should let a caller detect the drop, the way
    // SketchState.droppedAtCap does. Actual WhiteboardState = { marks, nextId } — nothing else.
    expect('droppedAtCap' in st || 'truncated' in st || 'droppedCount' in st).toBe(true);
  });

  it('6b. FINDING (fails): serializeWhiteboard never mentions a cap, even when marks were just silently dropped', () => {
    let st = initialWhiteboardState();
    for (let i = 0; i < MAX_MARKS + 5; i++) st = wbReduce(st, { type: 'wb.add', spec: node(`n${i}`) });
    const hint = serializeWhiteboard(st)!;
    // Honest expectation: if the model's own drawing got truncated, the hint it reads should say so
    // (mirrors serializeSketch's capNote). Actual: silence.
    expect(hint.toLowerCase()).toMatch(/dropped|cap|truncat/);
  });

  it('6c. FIXED 2026-07-16: a proposal that would evict existing marks past MAX_MARKS is REJECTED', () => {
    let wb = initialWhiteboardState();
    for (let i = 0; i < 30; i++) wb = wbReduce(wb, { type: 'wb.add', spec: node(`existing${i}`) });
    let sketch = initialSketchState();
    sketch = skReduce(sketch, { type: 'sketch.strokeAdd', points: diag(0) });
    const marks = Array.from({ length: 5 }, (_, i) => ({ kind: 'node', key: `new${i}`, x: 100, y: 100, text: `New ${i}`, shape: 'box' }));
    const r = validateBeautifyCall({ strokeIds: [sketch.strokes[0].id], marks }, sketch, wb);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('capacity');
    expect((r as { error: string }).error).toContain('evict 3 existing marks');
  });
});

describe('WHITEBOARD — beautify proposal integrity', () => {
  it('7a. FIXED 2026-07-16: duplicate node keys in one proposal count ONCE in the summary', () => {
    let sketch = initialSketchState();
    sketch = skReduce(sketch, { type: 'sketch.strokeAdd', points: diag(0) });
    const r = validateBeautifyCall({
      strokeIds: [sketch.strokes[0].id],
      marks: [
        { kind: 'node', key: 'a', x: 100, y: 100, text: 'First', shape: 'box' },
        { kind: 'node', key: 'a', x: 900, y: 900, text: 'Second', shape: 'box' },
      ],
    }, sketch, initialWhiteboardState());
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.summary).toBe('Replace 1 stroke with 1 node?');
    const after = applyAll(initialWhiteboardState(), r.events);
    expect(after.marks.filter((m) => m.kind === 'node' && m.key === 'a').length).toBe(1);
  });

  it('7b. a connector referencing a node key that exists only in COMMITTED marks (not the proposal) validates OK and renders', () => {
    let wb = initialWhiteboardState();
    wb = wbReduce(wb, { type: 'wb.add', spec: node('already-there', 200, 200, 'X') });
    let sketch = initialSketchState();
    sketch = skReduce(sketch, { type: 'sketch.strokeAdd', points: diag(0) });
    const r = validateBeautifyCall({
      strokeIds: [sketch.strokes[0].id],
      marks: [{ kind: 'connector', from: 'already-there', to: 'ghost' }],
    }, sketch, initialWhiteboardState());
    expect('error' in r).toBe(false); // wb_connect never key-checks (by design, per code comment)
    if ('error' in r) return;
    const after = applyAll(wb, r.events);
    const conn = after.marks.find((m) => m.kind === 'connector') as any;
    expect(conn.from).toBe('already-there');
    // 'ghost' resolves against nothing → fail-soft: renders nothing (intentional, documented).
    expect(connectorEnds(after.marks, conn)).toBeNull();
  });

  it('7c. FIXED 2026-07-16: duplicate strokeIds are deduped in count and removal', () => {
    let sketch = initialSketchState();
    sketch = skReduce(sketch, { type: 'sketch.strokeAdd', points: diag(0) });
    const id = sketch.strokes[0].id;
    const r = validateBeautifyCall({
      strokeIds: [id, id],
      marks: [{ kind: 'node', key: 'a', x: 1, y: 1, text: 'x', shape: 'box' }],
    }, sketch, initialWhiteboardState());
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.removeIds).toEqual([id]);
    expect(r.summary).toBe('Replace 1 stroke with 1 node?');
  });
});

describe('WHITEBOARD — geometry edge cases', () => {
  it('8a. clipSegmentToBoxEdge with from === to (zero-length segment) does not crash / NaN', () => {
    const p = { x: 500, y: 500 };
    const box = nodeBox({ x: 500, y: 500 });
    const result = clipSegmentToBoxEdge(p, p, box);
    expect(result).toEqual(p);
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
  });

  it('8b. two overlapping node boxes: connector resolves to a straight center-to-center line (fail-soft, intentional)', () => {
    let wb = initialWhiteboardState();
    wb = wbReduce(wb, { type: 'wb.add', spec: node('a', 500, 500) });
    wb = wbReduce(wb, { type: 'wb.add', spec: node('b', 550, 520) }); // heavily overlapping box
    wb = wbReduce(wb, { type: 'wb.add', spec: { kind: 'connector', from: 'a', to: 'b' } });
    const conn = wb.marks.find((m) => m.kind === 'connector') as any;
    const ends = connectorEnds(wb.marks, conn)!;
    expect(ends.from).toEqual({ x: 500, y: 500 });
    expect(ends.to).toEqual({ x: 550, y: 520 }); // "starts inside" branch: raw endpoint, not a clipped edge
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// TEACHING
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('TEACHING — teachTools edge cases', () => {
  it('9a. teach_sequence with the SAME target for every step is legal (no uniqueness check)', () => {
    const ev = teachCallToEvent({
      name: 'teach_sequence',
      args: {
        title: 'Repeat', taskKey: 'k.repeat', posture: 'guide',
        steps: Array.from({ length: 5 }, (_, i) => ({ target: 'Save button', subgoal: `s${i}`, instruction: `i${i}.` })),
      },
    }, entities) as any;
    expect(ev.type).toBe('teach.sequence');
    expect(ev.steps).toHaveLength(5);
    expect(new Set(ev.steps.map((s: any) => s.entityId)).size).toBe(1); // all 5 steps target the same entity
  });

  it('9b. teach_relate with from === to (self-loop) is legal and produces a degenerate relation', () => {
    const ev = teachCallToEvent({
      name: 'teach_relate',
      args: { pairs: [{ from: 'Save button', to: 'Save button', label: 'self' }] },
    }, entities) as any;
    expect(ev.type).toBe('teach.relate');
    expect(ev.relations[0].from).toBe(ev.relations[0].to);
    // TeachingLayer.tsx renders relations as an SVG arc between entity centers (cx/cy from bbox);
    // from===to means cx(a)===cx(b2), cy(a)===cy(b2) — a degenerate loop through the midpoint
    // offset, not a crash, but a visually meaningless mark for a self-referential relation.
  });

  it('9c. FIXED 2026-07-16: teach_sequence rejects more than MAX_SEQUENCE_STEPS with an honest error', () => {
    const steps = Array.from({ length: 50 }, () => ({ target: 'Save button', subgoal: 'A', instruction: 'B.' }));
    const r = teachCallToEvent({ name: 'teach_sequence', args: { title: 'T', taskKey: 'k', posture: 'guide', steps } }, entities);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('at most 12 steps');
  });
});

describe('TEACHING — teachingStore reduce past completion', () => {
  const id = (s: string) => s as EntityId;
  const SEQ: TeachingEvent = {
    type: 'teach.sequence', title: 'Save a file', taskKey: 'word.save', posture: 'guide',
    steps: [
      { entityId: id('word-2'), subgoal: 'Open the save action', instruction: 'Click the Save button.' },
      { entityId: id('word-4'), subgoal: 'Confirm the document', instruction: 'Click the document body.' },
    ],
  };

  it('10a. teach.stepAdvance past the LAST step (completion), then another stepAdvance is a no-op', () => {
    let st = tReduce(initialTeachingState(), SEQ, 1000);
    st = tReduce(st, { type: 'teach.stepAdvance' }, 1100); // step 0 → 1
    st = tReduce(st, { type: 'teach.stepAdvance' }, 1200); // step 1 → complete (activeIndex null)
    expect(st.sequence!.activeIndex).toBeNull();
    expect(st.competence['word.save']).toBe(1);
    const again = tReduce(st, { type: 'teach.stepAdvance' }, 1300); // one more, past completion
    expect(again).toEqual(st); // fully idempotent: same sequence object shape, no double-credit
    expect(again.competence['word.save']).toBe(1); // NOT incremented a second time
  });

  it('10b. user.stepAction on a completed sequence (activeIndex null) is a no-op, not a crash', () => {
    let st = tReduce(initialTeachingState(), SEQ, 1000);
    st = tReduce(st, { type: 'teach.stepAdvance' }, 1100);
    st = tReduce(st, { type: 'teach.stepAdvance' }, 1200); // completed
    const before = st;
    const after = tReduce(st, { type: 'user.stepAction', entityId: id('word-2') }, 1300);
    expect(after).toEqual(before);
    expect(after.competence['word.save']).toBe(1);
  });
});
