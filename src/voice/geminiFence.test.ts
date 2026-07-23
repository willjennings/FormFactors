import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what reaches the wire. Mirror geminiOpenFlush.test.ts's mock contract exactly:
// Type must be mocked too (gemini.ts's JS_TO_GEMINI reads Type.STRING at module scope —
// an unmocked Type throws before any test body runs). onopen fires AFTER connect() returns
// (sessionPromise assigned) but BEFORE the connect promise resolves with the session object,
// matching the real SDK's ordering.
const sent: { realtime: any[]; client: any[] } = { realtime: [], client: [] };

vi.mock('@google/genai', () => ({
  Modality: { AUDIO: 'AUDIO' },
  Type: { STRING: 'S', NUMBER: 'N', BOOLEAN: 'B', OBJECT: 'O', ARRAY: 'A' },
  GoogleGenAI: class {
    live = {
      connect: ({ callbacks }: any) =>
        (async () => {
          await Promise.resolve();
          callbacks.onopen();
          return {
            sendRealtimeInput: (x: any) => sent.realtime.push(x),
            sendClientContent: (x: any) => sent.client.push(x),
            sendToolResponse: () => {},
            close: () => {},
          };
        })(),
    };
  },
}));

import { createGeminiProvider } from './gemini';

function stubBrowserAudio() {
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  });
  (globalThis as any).AudioContext = class {
    destination = {};
    createMediaStreamSource() { return { connect: () => {} }; }
    createScriptProcessor() { return { connect: () => {}, disconnect: () => {}, onaudioprocess: null }; }
    createGain() { return { gain: { value: 0 }, connect: () => {} }; }
    close() {}
  };
}

const noop = () => {};
const baseCallbacks = {
  onOpen: noop, onClose: noop, onError: noop, onInputTranscript: noop, onToolCall: noop,
} as any;

describe('gemini fence wiring', () => {
  beforeEach(() => {
    stubBrowserAudio();
    sent.realtime.length = 0; sent.client.length = 0;
  });

  it('fences sendTextHint, leaves sendUserText unfenced and token-stripped', async () => {
    const p = createGeminiProvider('test-key');
    await p.connect(
      { instructions: 'sys', tools: [], contextToken: 'tok-9' } as any,
      baseCallbacks,
    );
    p.sendTextHint('[ARTIFACTS: none]');
    p.sendUserText('do the thing tok-9 please');
    await new Promise(r => setTimeout(r, 10)); // let withSession drain
    const hint = sent.realtime.find(m => typeof m.text === 'string');
    expect(hint.text).toBe('⟦ctx:tok-9⟧\n[ARTIFACTS: none]\n⟦/ctx:tok-9⟧');
    const turn = sent.client[0];
    expect(turn.turns[0].parts[0].text).toBe('do the thing  please'); // token stripped
    expect(turn.turns[0].parts[0].text).not.toContain('⟦');
  });

  it('no token → legacy passthrough (hints unfenced)', async () => {
    const p = createGeminiProvider('test-key');
    await p.connect(
      { instructions: 'sys', tools: [] } as any,
      baseCallbacks,
    );
    p.sendTextHint('[ARTIFACTS: none]');
    await new Promise(r => setTimeout(r, 10));
    expect(sent.realtime.find(m => typeof m.text === 'string').text).toBe('[ARTIFACTS: none]');
  });

  it('a hint sent BEFORE connect() is buffered and still fences with the token connect() assigns', async () => {
    // providerRef exists before connect() runs, so a hint can fire in the window before
    // sessionPromise (or contextToken) is assigned — same pre-connect race as
    // geminiOpenFlush.test.ts's "still awaiting the mic" case, but here we're pinning that
    // the FENCE (not just delivery) is computed at drain time. The ternary in sendTextHint
    // lives inside the withSession callback, so it reads contextToken lazily, at drain —
    // by which point connect() has assigned it. A regression that hoists the ternary to
    // call time would capture contextToken while it's still null and ship this hint
    // unfenced; today's other tests all send after connect() resolves, so none of them
    // would catch that regression.
    const p = createGeminiProvider('test-key');
    p.sendTextHint('[EARLY HINT]'); // same tick — before connect() has even run
    await p.connect(
      { instructions: 'sys', tools: [], contextToken: 'tok-early' } as any,
      baseCallbacks,
    );
    await new Promise(r => setTimeout(r, 10)); // let withSession drain
    const hint = sent.realtime.find(m => typeof m.text === 'string');
    expect(hint.text).toBe('⟦ctx:tok-early⟧\n[EARLY HINT]\n⟦/ctx:tok-early⟧');
  });
});
