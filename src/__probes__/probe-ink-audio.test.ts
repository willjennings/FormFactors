// Adversarial edge-case probes — INK v2 stroke module, v1 rough module, pcmCapture,
// snapshotNode font-embed cache. Goal: BREAK stated invariants (deterministic rendering,
// displacement budgets, vision-frame honesty, fail-soft audio). Probes that expose a real
// bug are left FAILING and documented (not fixed, not weakened) — see
// .superpowers/sdd/probe-ink-audio-findings.md. Passing probes are regression coverage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedFrom, roughLine, roughArc, mulberry32 } from '../ink/rough';
import {
  inkStroke, inkLine, inkQuad, inkRect, inkEllipse, inkArrowhead, STROKE_WIDTH, BODY,
} from '../ink/stroke';
import { Float32Chunker, floatToPcm16Base64 } from '../voice/pcmCapture';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const xs = (d: string) => nums(d).filter((_, i) => i % 2 === 0);
const ys = (d: string) => nums(d).filter((_, i) => i % 2 === 1);
// Envelope tightened in stroke.test.ts (commit af097b9): spec §3.1's invariant is centerline
// displacement + HALF width ≤ 1.5 total, not +full STROKE_WIDTH. Match the current spec here.
const ENV = 1.5;
void STROKE_WIDTH;

// ---------------------------------------------------------------------------------------
// stroke.ts — determinism & purity
// ---------------------------------------------------------------------------------------
describe('stroke.ts — determinism & purity', () => {
  it('inkRect/inkEllipse/inkArrowhead are byte-identical across repeated calls with the same seed', () => {
    expect(inkRect(10, 10, 30, 20, seedFrom('r'))).toBe(inkRect(10, 10, 30, 20, seedFrom('r')));
    expect(inkEllipse(50, 50, 20, 10, seedFrom('e'))).toBe(inkEllipse(50, 50, 20, 10, seedFrom('e')));
    expect(inkArrowhead(50, 50, 0.3, seedFrom('h'))).toBe(inkArrowhead(50, 50, 0.3, seedFrom('h')));
  });

  it('does not mutate the input points array or its point tuples (frozen input survives a call)', () => {
    const pts: [number, number][] = [[0, 0], [10, 10], [20, 0]];
    const snapshot = JSON.stringify(pts);
    Object.freeze(pts);
    pts.forEach((p) => Object.freeze(p));
    expect(() => inkStroke(pts, seedFrom('frz'))).not.toThrow();
    expect(JSON.stringify(pts)).toBe(snapshot);
  });

  it('does not mutate the shared BODY opts object via partial overrides', () => {
    const before = { ...BODY };
    inkLine(0, 0, 30, 0, seedFrom('ov'), { width: 5, jitter: 0.9 });
    expect(BODY).toEqual(before);
  });

  it('seedFrom has no collisions across realistic id families (c1/c10/c100, a1/a10, node-N, wb-N)', () => {
    const seen = new Map<number, string>();
    let collisions = 0;
    for (let i = 0; i < 3000; i++) {
      for (const prefix of ['c', 'a', 'n', 'node', 'wb']) {
        const id = prefix + i;
        const s = seedFrom(id);
        if (seen.has(s) && seen.get(s) !== id) collisions++;
        seen.set(s, id);
      }
    }
    expect(collisions).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// stroke.ts — degenerate geometry
// ---------------------------------------------------------------------------------------
describe('stroke.ts — degenerate geometry stays NaN-free and in-envelope', () => {
  it('zero-length line (x1,y1 === x2,y2) produces a closed, finite, parseable polygon', () => {
    const d = inkLine(10, 10, 10, 10, seedFrom('zl'));
    expect(d).toMatch(/Z\s*$/);
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
  });

  it('single-point centerline via inkStroke does not throw and stays finite', () => {
    expect(() => inkStroke([[5, 5]], seedFrom('sp'))).not.toThrow();
    const d = inkStroke([[5, 5]], seedFrom('sp'));
    expect(d).not.toContain('NaN');
  });

  it('repeated identical points scattered through a polyline resample cleanly (no NaN, no throw)', () => {
    const pts: [number, number][] = [[0, 0], [0, 0], [0, 0], [10, 0], [10, 0], [20, 0], [20, 0], [20, 0], [20, 0]];
    const d = inkStroke(pts, seedFrom('dupe'));
    expect(d).not.toContain('NaN');
  });

  it('backtracking / zig-zag polyline resamples without NaN and stays near the path bbox', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [5, 0], [15, 0], [2, 0], [20, 0]];
    const d = inkStroke(pts, seedFrom('zigzag'));
    expect(d).not.toContain('NaN');
    for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(0 - ENV); expect(x).toBeLessThanOrEqual(20 + ENV); }
  });

  it('inkRect with negative w/h still closes 4 sides and stays within the (normalized) box + envelope', () => {
    const d = inkRect(50, 50, -20, -10, seedFrom('rn'));
    expect((d.match(/Z/g) ?? []).length).toBe(4);
    expect(d).not.toContain('NaN');
    for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(30 - ENV); expect(x).toBeLessThanOrEqual(50 + ENV); }
    for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(40 - ENV); expect(y).toBeLessThanOrEqual(50 + ENV); }
  });

  it('inkEllipse with rx=0 collapses to a thin vertical ring without NaN or a blown-up spread', () => {
    const d = inkEllipse(50, 50, 0, 10, seedFrom('e0'));
    expect(d).not.toContain('NaN');
    const spread = Math.max(...xs(d)) - Math.min(...xs(d));
    expect(spread).toBeLessThan(2); // should hug x=50, not balloon
  });

  it('negative width degrades gracefully to the 0.02 floor (no NaN, no throw, no crash)', () => {
    const d = inkLine(0, 0, 30, 0, seedFrom('nw'), { width: -5 });
    expect(d).not.toContain('NaN');
    expect(() => inkLine(0, 0, 30, 0, seedFrom('nw'), { width: -5 })).not.toThrow();
  });

  it('aspect=0 falls back to 1 (guarded by `o.aspect || 1`) rather than dividing by zero', () => {
    const a0 = inkLine(10, 10, 50, 50, seedFrom('a0'), { aspect: 0 });
    const a1 = inkLine(10, 10, 50, 50, seedFrom('a0'), { aspect: 1 });
    expect(a0).toBe(a1);
    expect(a0).not.toContain('NaN');
  });

  it('negative aspect does not introduce NaN (geometry mirrors, but stays finite)', () => {
    const d = inkLine(10, 10, 50, 50, seedFrom('an'), { aspect: -2 });
    expect(d).not.toContain('NaN');
  });

  it('inkArrowhead with angle=0 anchors a tip point with no NaN', () => {
    const d = inkArrowhead(50, 50, 0, seedFrom('h'));
    expect(d).not.toContain('NaN');
  });
});

// ---------------------------------------------------------------------------------------
// stroke.ts — displacement budget sweep
// ---------------------------------------------------------------------------------------
describe('stroke.ts — displacement budget sweep (spec §5.3: 1.5 centerline + half body width)', () => {
  it('inkLine stays within envelope across many seeds x short/long/degenerate geometries', () => {
    const geoms: [number, number, number, number][] = [
      [0, 0, 0.5, 0], [0, 0, 1, 0], [0, 0, 2, 0], [10, 10, 10.3, 10.3], [5, 5, 5, 5.2],
      [0, 0, 100, 0], [0, 0, 0, 100], [10, 10, 60, 40], [-5, -5, 5, 5],
    ];
    for (const [x1, y1, x2, y2] of geoms) {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      for (let s = 0; s < 200; s++) {
        const d = inkLine(x1, y1, x2, y2, seedFrom('sweep' + s));
        for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(minX - ENV); expect(x).toBeLessThanOrEqual(maxX + ENV); }
        for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(minY - ENV); expect(y).toBeLessThanOrEqual(maxY + ENV); }
      }
    }
  });

  it('inkQuad stays within its control-point hull + envelope across many seeds', () => {
    for (let s = 0; s < 100; s++) {
      const d = inkQuad(10, 30, 35, 10, 60, 30, seedFrom('quadsweep' + s));
      for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(10 - ENV); expect(y).toBeLessThanOrEqual(30 + ENV); }
      for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(10 - ENV); expect(x).toBeLessThanOrEqual(60 + ENV); }
    }
  });

  it('inkEllipse ring points stay within radius + envelope across many seeds', () => {
    for (let s = 0; s < 100; s++) {
      const d = inkEllipse(50, 50, 20, 10, seedFrom('ellsweep' + s));
      for (const x of xs(d)) { expect(x).toBeGreaterThanOrEqual(30 - ENV); expect(x).toBeLessThanOrEqual(70 + ENV); }
      for (const y of ys(d)) { expect(y).toBeGreaterThanOrEqual(40 - ENV); expect(y).toBeLessThanOrEqual(60 + ENV); }
    }
  });
});

// ---------------------------------------------------------------------------------------
// REAL BUG: unbounded `aspect` blows up resample()'s carry loop (O(scaled-length/step))
// ---------------------------------------------------------------------------------------
describe('BUG: stroke.ts resample() has no bound on aspect-scaled segment length', () => {
  // resample() walks a `while (t <= 1) { …; t += step / seg }` carry loop whose iteration
  // count is seg/step. inkStroke scales x by `aspect` BEFORE resampling (stroke.ts:97), so a
  // large aspect turns a short 2-point line into a huge scaled segment length. `useAspect`
  // (src/ink/useAspect.ts:13-18) only guards width>0 && height>0 — a transient near-zero
  // container height (a collapsing panel mid-transition, a flex child briefly at 0.1px)
  // yields an enormous, unclamped aspect that flows straight into inkStroke.
  //
  // Measured (see probe-ink-audio-findings.md): aspect=100 -> 139,885-char path in 6ms;
  // aspect=1,000 -> 1,398,639-char path in ~41ms; aspect=100,000 -> 139,860,348 chars in
  // ~5.1s; aspect=1e9 crashed the Node process with "JavaScript heap out of memory" (V8
  // OOM abort) from a SINGLE inkLine() call on two points. This test uses aspect=1000 —
  // enough to prove the invariant is violated — to stay fast and safe to run.
  it('a single 2-point inkLine at aspect=1000 must not balloon into a megabyte-scale path', () => {
    const t0 = Date.now();
    const d = inkLine(10, 10, 50, 50, seedFrom('perf'), { aspect: 1000 });
    const ms = Date.now() - t0;
    // A single stroke primitive should stay comfortably under a few hundred characters and
    // low-single-digit milliseconds — this is what every other primitive in this suite emits.
    expect(d.length).toBeLessThan(5000);
    expect(ms).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------------------
// rough.ts — bounded regardless of geometry magnitude (contrast with the stroke.ts bug above)
// ---------------------------------------------------------------------------------------
describe('rough.ts — additive-jitter design stays bounded at extreme geometry magnitudes', () => {
  it('a huge line length (1e6 units) still emits a small, fast, budget-bound path', () => {
    const t0 = Date.now();
    const d = roughLine(0, 0, 1e6, 0, seedFrom('huge'));
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(20);
    expect(d.length).toBeLessThan(500);
  });

  it('roughArc with an extreme, far-off control point still bounds jitter to bow*2, not geometry-scaled', () => {
    const d = roughArc(10, 30, 1e6, -1e6, 60, 30, seedFrom('extremearc'));
    const ns = nums(d);
    // control point (index 2,3) should stay within bow*2 + a hair of (1e6, -1e6) — NOT
    // collapse toward the endpoints and not blow up further.
    expect(Math.abs(ns[2] - 1e6)).toBeLessThan(2);
    expect(Math.abs(ns[3] - -1e6)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------------------
// pcmCapture.ts — Float32Chunker
// ---------------------------------------------------------------------------------------
describe('Float32Chunker — degenerate sizes and partial-fill patterns', () => {
  it('size=1 emits one chunk per sample with no loss', () => {
    const out: number[] = [];
    const c = new Float32Chunker((chunk) => out.push(chunk[0]), 1);
    c.push(new Float32Array([1, 2, 3]));
    expect(out).toEqual([1, 2, 3]);
  });

  it('push() with an empty Float32Array is a safe no-op', () => {
    let calls = 0;
    const c = new Float32Chunker(() => { calls++; }, 256);
    c.push(new Float32Array(0));
    expect(calls).toBe(0);
  });

  it('irregular partial-fill push sizes (1, 3, 300, 2) still land every sample exactly once', () => {
    const out: number[] = [];
    const c = new Float32Chunker((chunk) => out.push(...Array.from(chunk)), 50);
    let n = 0;
    for (const size of [1, 3, 300, 2]) {
      const arr = new Float32Array(size).map(() => n++);
      c.push(arr);
    }
    // 306 samples pushed; 50-sample chunks => 6 emitted (300 samples), 6 samples still buffered.
    expect(out).toHaveLength(300);
    expect(out).toEqual(Array.from({ length: 300 }, (_, i) => i));
  });
});

describe('FIXED 2026-07-17: Float32Chunker(size<=0) is clamped, push() bounded', () => {
  // With size=0, `this.size - this.len` is always 0, so `n` is always 0: `off` never
  // advances and the `while (off < samples.length)` loop in push() spins forever — a
  // synchronous, unyielding hang on the thread that calls it (the audio worklet port
  // handler, i.e. the main thread). There is no validation on `size` in the constructor.
  // A real `push()` call here would freeze the tab; this test proves the runaway via an
  // injected safety-valve (the emit callback throws once a call-count guard is hit) so the
  // test process itself terminates instead of hanging the whole suite.
  it('push(3 samples) on a size=0 chunker calls emit far more than a bounded implementation would', () => {
    let calls = 0;
    const guard = 2000;
    const c = new Float32Chunker(() => {
      calls++;
      if (calls >= guard) throw new Error('runaway-guard-hit');
    }, 0);
    // Fixed: size<=0 clamps to 1, so 3 samples → 3 bounded emits, no runaway.
    expect(() => c.push(new Float32Array([1, 2, 3]))).not.toThrow();
    expect(calls).toBe(3);
  });
});

describe('FIXED 2026-07-17: a throwing emit() drops only its own chunk — no data loss after it, no stale resend', () => {
  // `push()` does `this.emit(this.buf.slice(0)); this.len = 0;` (pcmCapture.ts:24-25) with
  // no try/finally. If emit() throws (e.g. a WebSocket send failure), `this.len = 0` never
  // runs, so: (a) any samples later in THIS push() call are silently dropped (the while
  // loop's exception unwinds past them, no buffering/retry), and (b) `this.len` stays
  // stuck at `this.size`, so the NEXT push() call's very first outer-loop check
  // (`len === size`) re-fires and re-emits the STALE already-attempted buffer before it
  // processes any new data — a duplicate/corrupted resend into the audio stream.
  it('samples queued after a throwing emit are dropped, not retried', () => {
    const emitted: number[][] = [];
    let calls = 0;
    const c = new Float32Chunker((chunk) => {
      calls++;
      if (calls === 1) throw new Error('boom-once');
      emitted.push(Array.from(chunk));
    }, 4);
    // Fixed: the emit failure is swallowed (state already reset), the same push continues.
    expect(() => c.push(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]))).not.toThrow();
    c.push(new Float32Array([9, 10, 11, 12]));
    expect(emitted).toEqual([[5, 6, 7, 8], [9, 10, 11, 12]]);
  });

  it('the chunk that failed to emit is not silently re-sent on the next successful push', () => {
    const emitted: number[][] = [];
    let calls = 0;
    const c = new Float32Chunker((chunk) => {
      calls++;
      if (calls === 1) throw new Error('boom-once');
      emitted.push(Array.from(chunk));
    }, 4);
    try { c.push(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch { /* expected */ }
    c.push(new Float32Array([9, 10, 11, 12]));
    // A correct chunker never emits the [1,2,3,4] chunk again after it already failed once —
    // the caller has no way to know [1,2,3,4] was "already attempted" vs. "brand new audio".
    expect(emitted).not.toContainEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------------------
// pcmCapture.ts — floatToPcm16Base64
// ---------------------------------------------------------------------------------------
describe('floatToPcm16Base64 — clamping and encoding edge cases', () => {
  const decode = (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  };

  it('NaN samples clamp to silence (0), not NaN or a wrapped value', () => {
    const pcm = decode(floatToPcm16Base64(new Float32Array([NaN])));
    expect(pcm[0]).toBe(0);
  });

  it('Infinity / -Infinity samples clamp to the int16 extremes', () => {
    const pcm = decode(floatToPcm16Base64(new Float32Array([Infinity, -Infinity])));
    expect(pcm[0]).toBe(0x7fff);
    expect(pcm[1]).toBe(-0x8000);
  });

  it('an empty Float32Array round-trips to an empty PCM buffer, not an error', () => {
    const b64 = floatToPcm16Base64(new Float32Array([]));
    expect(decode(b64)).toHaveLength(0);
  });

  it('every intermediate byte is a valid Latin1 code point for btoa (no non-latin1 feed)', () => {
    // Guards against a class of bug where a PCM byte >255 or a multi-byte artifact would
    // make btoa() throw "characters outside of the Latin1 range".
    const input = new Float32Array(1000).map((_, i) => Math.sin(i) * 2 - 1); // sweeps clamp range
    expect(() => floatToPcm16Base64(input)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------
// snapshotNode.ts — cachedFontCss module-level caching semantics
// ---------------------------------------------------------------------------------------
describe('snapshotNode — cachedFontCss caches the getFontEmbedCSS promise across calls', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const fakeNode = () => ({ ownerDocument: { body: {} } }) as unknown as HTMLElement;

  it('resolved font CSS: getFontEmbedCSS is fetched once across three snapshotNode calls', async () => {
    const getFontEmbedCSS = vi.fn().mockResolvedValue('CSS_CONTENT');
    const toCanvas = vi.fn().mockResolvedValue({} as unknown as HTMLCanvasElement);
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    const node = fakeNode();
    await snapshotNode(node);
    await snapshotNode(node);
    await snapshotNode(node);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(toCanvas).toHaveBeenCalledTimes(3);
  });

  // NOTE: as of commit af097b9 (landed mid-probe, by a concurrent session on this same
  // branch) a persistently-rejecting getFontEmbedCSS RETRIES on later snapshot ticks
  // (bounded, MAX_FONT_ATTEMPTS=3) rather than caching `null` forever on the first
  // failure. These two probes target that current retry-with-cap behavior.
  it('rejected getFontEmbedCSS retries up to a bounded attempt cap, then permanently falls back to skipFonts', async () => {
    const getFontEmbedCSS = vi.fn().mockRejectedValue(new Error('network fail'));
    const toCanvas = vi.fn().mockResolvedValue({} as unknown as HTMLCanvasElement);
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    const node = fakeNode();
    for (let i = 0; i < 6; i++) await snapshotNode(node);
    // Every attempt is a genuine network call — the retry count must stay bounded even
    // after many snapshot ticks (a permanently-offline session must not hammer the network
    // once per ~snapshot-interval forever).
    expect(getFontEmbedCSS.mock.calls.length).toBeLessThanOrEqual(3);
    expect(getFontEmbedCSS.mock.calls.length).toBeGreaterThan(1); // confirms it DOES retry, not single-shot-cache
    for (const call of toCanvas.mock.calls) expect(call[1]).toMatchObject({ skipFonts: true });
  });

  it('a transient failure followed by success stops retrying and caches the successful CSS permanently', async () => {
    let calls = 0;
    const getFontEmbedCSS = vi.fn().mockImplementation(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve('CSS_OK');
    });
    const toCanvas = vi.fn().mockResolvedValue({} as unknown as HTMLCanvasElement);
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    const node = fakeNode();
    await snapshotNode(node); // fails — attempt 1
    await snapshotNode(node); // succeeds — attempt 2
    await snapshotNode(node); // should reuse the cached success, no 3rd network call
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(2);
    expect(toCanvas).toHaveBeenNthCalledWith(3, node, expect.objectContaining({ fontEmbedCSS: 'CSS_OK' }));
  });

  it("an empty-string font CSS ('') is cached distinctly from null — passed through as fontEmbedCSS, not skipFonts", async () => {
    const getFontEmbedCSS = vi.fn().mockResolvedValue('');
    const toCanvas = vi.fn().mockResolvedValue({} as unknown as HTMLCanvasElement);
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    const node = fakeNode();
    await snapshotNode(node);
    await snapshotNode(node);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(toCanvas).toHaveBeenNthCalledWith(1, node, expect.objectContaining({ fontEmbedCSS: '' }));
    expect(toCanvas).not.toHaveBeenNthCalledWith(1, node, expect.objectContaining({ skipFonts: true }));
  });

  it('the cache is shared across DIFFERENT nodes (surface root + instruction-layer root both tick from one fetch)', async () => {
    const getFontEmbedCSS = vi.fn().mockResolvedValue('CSS');
    const toCanvas = vi.fn().mockResolvedValue({} as unknown as HTMLCanvasElement);
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    await snapshotNode(fakeNode());
    await snapshotNode(fakeNode());
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
  });

  it('toCanvas failure still resolves snapshotNode to null (fail-soft), not a rejection', async () => {
    const getFontEmbedCSS = vi.fn().mockResolvedValue('CSS');
    const toCanvas = vi.fn().mockRejectedValue(new Error('taint'));
    vi.doMock('html-to-image', () => ({ getFontEmbedCSS, toCanvas }));
    const { snapshotNode } = await import('../vision/snapshotNode');
    await expect(snapshotNode(fakeNode())).resolves.toBeNull();
  });
});
