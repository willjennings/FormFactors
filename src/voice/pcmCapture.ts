// Mic capture via AudioWorkletNode — replaces the deprecated ScriptProcessorNode pump in
// gemini + azure. The worklet is deliberately dumb (post every 128-frame quantum); the pure
// Float32Chunker on the main thread accumulates to socket-sized chunks, and the pure
// floatToPcm16Base64 converts with clamping (the retired gemini inline conversion multiplied
// by 32768 without clamping, so a full-scale +1.0 sample wrapped negative).

/** Matches the retired createScriptProcessor(4096, …) buffer: ~4 sends/s at 16 kHz. */
export const CHUNK_SAMPLES = 4096;

export class Float32Chunker {
  private buf: Float32Array;
  private len = 0;
  constructor(private emit: (chunk: Float32Array) => void, private size = CHUNK_SAMPLES) {
    this.buf = new Float32Array(size);
  }
  push(samples: Float32Array): void {
    let off = 0;
    while (off < samples.length) {
      const n = Math.min(samples.length - off, this.size - this.len);
      this.buf.set(samples.subarray(off, off + n), this.len);
      this.len += n;
      off += n;
      if (this.len === this.size) {
        this.emit(this.buf.slice(0));
        this.len = 0;
      }
    }
  }
}

export function floatToPcm16Base64(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  let binary = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export const PCM_WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

/**
 * Load the worklet (inlined via Blob URL — no separate asset to serve) and return a node
 * whose port streams each 128-frame quantum to `onQuantum`. Caller wires it into the graph
 * (source → node → silent gain → destination) and disconnects it on teardown.
 */
export async function createPcmCaptureNode(
  ctx: AudioContext, onQuantum: (samples: Float32Array) => void,
): Promise<AudioWorkletNode> {
  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  });
  node.port.onmessage = (e) => onQuantum(e.data as Float32Array);
  return node;
}
