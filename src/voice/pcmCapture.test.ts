import { describe, it, expect } from 'vitest';
import { Float32Chunker, floatToPcm16Base64, PCM_WORKLET_SOURCE, CHUNK_SAMPLES } from './pcmCapture';

describe('Float32Chunker — worklet 128-frame quanta → socket-sized chunks', () => {
  it('accumulates quanta and emits fixed-size chunks', () => {
    const out: Float32Array[] = [];
    const c = new Float32Chunker((chunk) => out.push(chunk), 256);
    for (let i = 0; i < 4; i++) c.push(new Float32Array(128).fill(i + 1));
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(256);
    expect(out[0][0]).toBe(1);
    expect(out[0][255]).toBe(2);
    expect(out[1][0]).toBe(3);
  });
  it('splits an oversized push across chunk boundaries losing nothing', () => {
    const out: Float32Array[] = [];
    const c = new Float32Chunker((chunk) => out.push(chunk), 100);
    const big = new Float32Array(250).map((_, i) => i);
    c.push(big);
    expect(out).toHaveLength(2);
    expect(out[0][99]).toBe(99);
    expect(out[1][0]).toBe(100);
    // 50 samples still buffered — emitted once the next push completes the chunk.
    c.push(new Float32Array(50).fill(-1));
    expect(out).toHaveLength(3);
    expect(out[2][49]).toBe(249);
    expect(out[2][50]).toBe(-1);
  });
  it('emitted chunks are copies — later quanta cannot mutate a shipped chunk', () => {
    const out: Float32Array[] = [];
    const c = new Float32Chunker((chunk) => out.push(chunk), 4);
    c.push(new Float32Array([1, 2, 3, 4]));
    c.push(new Float32Array([9, 9, 9, 9]));
    expect(Array.from(out[0])).toEqual([1, 2, 3, 4]);
  });
  it('defaults to the retired ScriptProcessor buffer size', () => {
    expect(CHUNK_SAMPLES).toBe(4096);
  });
});

describe('floatToPcm16Base64 — clamped 16-bit little-endian PCM', () => {
  const decode = (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  };
  it('maps the full range with clamping (the retired gemini inline conversion overflowed at +1.0)', () => {
    const pcm = decode(floatToPcm16Base64(new Float32Array([0, 1, -1, 2, -2, 0.5])));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(0x7fff);
    expect(pcm[2]).toBe(-0x8000);
    expect(pcm[3]).toBe(0x7fff);   // clamped, not wrapped
    expect(pcm[4]).toBe(-0x8000);  // clamped, not wrapped
    expect(pcm[5]).toBeGreaterThan(16000); // positive scale uses 0x7fff

    expect(pcm[5]).toBeLessThan(16600);
  });
});

describe('PCM_WORKLET_SOURCE', () => {
  it('registers the pcm-capture processor and keeps processing (returns true)', () => {
    expect(PCM_WORKLET_SOURCE).toContain("registerProcessor('pcm-capture'");
    expect(PCM_WORKLET_SOURCE).toContain('return true');
    expect(PCM_WORKLET_SOURCE).toContain('postMessage');
  });
});
