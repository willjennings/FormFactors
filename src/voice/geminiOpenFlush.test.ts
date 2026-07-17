import { describe, it, expect, vi, beforeEach } from 'vitest';

// The App flushes queued typed text + the stashed deixis hint inside cb.onOpen. The real
// SDK (dist live.connect) invokes callbacks.onopen BEFORE its connect promise resolves —
// so at flush time the provider's `session` local is still null, and a bare
// `session?.send…` silently drops the first user turn (live smoke 2026-07-16, ×2:
// generic "what would you like to do" + spurious teach overlay driven by hints alone).
// These tests pin the fix: sends must queue on sessionPromise, like the audio pump.

const fakeSession = {
  sendClientContent: vi.fn(),
  sendRealtimeInput: vi.fn(),
  sendToolResponse: vi.fn(),
  close: vi.fn(),
};

vi.mock('@google/genai', () => ({
  Modality: { AUDIO: 'AUDIO' },
  Type: { STRING: 'S', NUMBER: 'N', BOOLEAN: 'B', OBJECT: 'O', ARRAY: 'A' },
  GoogleGenAI: class {
    live = {
      // Faithful to the real SDK's ordering: the websocket open is a network event, so
      // callbacks.onopen fires AFTER connect() returns (sessionPromise already assigned)
      // but BEFORE the connect promise resolves with the session object.
      connect: ({ callbacks }: any) =>
        (async () => {
          await Promise.resolve();
          callbacks.onopen();
          return fakeSession;
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
  onClose: noop, onError: noop, onInputTranscript: noop, onToolCall: noop,
} as any;

describe('gemini: sends issued from cb.onOpen reach the session', () => {
  beforeEach(() => {
    stubBrowserAudio();
    fakeSession.sendClientContent.mockClear();
    fakeSession.sendRealtimeInput.mockClear();
  });

  it('delivers hint then user text queued during onOpen, in order', async () => {
    const provider = createGeminiProvider('test-key');
    await provider.connect(
      { instructions: 'x', tools: [] } as any,
      {
        ...baseCallbacks,
        onOpen: () => {
          provider.sendTextHint('[POINTER] hint');
          provider.sendUserText('combine this and that');
        },
      },
    );
    // Drain the sessionPromise queue.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const hintCall = fakeSession.sendRealtimeInput.mock.calls.find(c => c[0]?.text === '[POINTER] hint');
    expect(hintCall, 'hint queued in onOpen must reach the session').toBeTruthy();
    expect(fakeSession.sendClientContent, 'typed text queued in onOpen must reach the session')
      .toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fakeSession.sendClientContent.mock.calls[0][0])).toContain('combine this and that');

    // Hint arrives before the text (the model reads pointer context first).
    const hintOrder = fakeSession.sendRealtimeInput.mock.invocationCallOrder[
      fakeSession.sendRealtimeInput.mock.calls.indexOf(hintCall!)
    ];
    expect(hintOrder).toBeLessThan(fakeSession.sendClientContent.mock.invocationCallOrder[0]);
  });

  it('drops nothing but sends nothing after close() (ended guard)', async () => {
    const provider = createGeminiProvider('test-key');
    await provider.connect(
      { instructions: 'x', tools: [] } as any,
      { ...baseCallbacks, onOpen: () => { provider.close(); provider.sendUserText('late'); } },
    );
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(fakeSession.sendClientContent).not.toHaveBeenCalled();
  });
});
