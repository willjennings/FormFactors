// src/voice/gemini.ts
// Gemini Live backend behind the VoiceProvider interface. Thin on purpose: model-audio
// playback and response/interruption UI handling stay in the component (delegated via the
// optional callbacks), so today's polished Gemini audio path is untouched.
import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks, VoiceTool } from './types';
import { geminiUserTurns } from './frames';
import { fenceHint, stripToken } from './sentinel';
import { Float32Chunker, floatToPcm16Base64, createPcmCaptureNode } from './pcmCapture';

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const JS_TO_GEMINI: Record<string, any> = {
  string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN, object: Type.OBJECT, array: Type.ARRAY,
};

/** Full-recursion JSON-Schema → Gemini Schema. The old shallow mapping flattened object
 *  array items to a bare type — nested properties/required and ALL enums were silently
 *  dropped, so tools like wb_beautify reached the model schemaless (live smoke 2026-07-16:
 *  marks arrived without `kind`, twice rejected). Exported for tests. */
export function toGeminiParams(schema: Record<string, any>): any {
  const out: any = { type: JS_TO_GEMINI[schema.type] ?? Type.OBJECT };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries<any>(schema.properties)) out.properties[k] = toGeminiParams(v);
  }
  // Tuple-form items (array of schemas) has no Gemini equivalent — take the first schema
  // rather than silently dropping everything (probe 2026-07-16; no live tool uses tuples).
  if (schema.items) out.items = toGeminiParams(Array.isArray(schema.items) ? (schema.items[0] ?? {}) : schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

/** VAD tuning → live connect config fragment. Empty when unset so server defaults stand.
 *  Exported for tests. */
export function toRealtimeInputConfig(vad?: { silenceDurationMs?: number; prefixPaddingMs?: number }): Record<string, any> {
  if (!vad) return {};
  const aad: Record<string, number> = {};
  if (vad.silenceDurationMs != null) aad.silenceDurationMs = Math.max(0, vad.silenceDurationMs);
  if (vad.prefixPaddingMs != null) aad.prefixPaddingMs = Math.max(0, vad.prefixPaddingMs);
  if (!Object.keys(aad).length) return {};
  return { realtimeInputConfig: { automaticActivityDetection: aad } };
}

const toGeminiTools = (tools: VoiceTool[]) =>
  [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: toGeminiParams(t.parameters) })) }];

/**
 * @param apiKey Gemini API key.
 * @param onSessionReady Optional hook to expose the raw live session (so the app's
 *   Gemini-specific auxiliary features that still use it keep working).
 */
export function createGeminiProvider(apiKey: string, onSessionReady?: (session: any) => void): VoiceProvider {
  let session: any = null;
  let sessionPromise: Promise<any> | null = null;
  // Sends issued before connect() assigns sessionPromise (providerRef exists first) buffer
  // here and drain in order once the promise exists. Null after drain — direct .then from
  // then on.
  let preConnectSends: ((s: any) => void)[] | null = [];
  const withSession = (fn: (s: any) => void) => {
    if (sessionPromise) sessionPromise.then(s => { if (!ended) fn(s); });
    else preConnectSends?.push(fn);
  };
  let inputCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let captureNode: AudioWorkletNode | null = null;
  let ended = false;
  let contextToken: string | null = null;

  // Release the mic capture pipeline. MUST run on SERVER-initiated closes too (live smoke
  // 2026-07-16 console: after the server dropped the session, the capture node kept
  // pumping ~4x/s into the dead socket — endless "WebSocket is already in CLOSING or CLOSED
  // state" spam AND a hot microphone the user never turned off).
  function teardownAudio() {
    ended = true;
    try { if (captureNode) captureNode.port.onmessage = null; } catch {}
    try { captureNode?.disconnect(); } catch {}
    try { inputCtx?.close(); } catch {}
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    captureNode = null; inputCtx = null; micStream = null;
  }

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      contextToken = config.contextToken ?? null;
      const ai = new GoogleGenAI({ apiKey });
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      sessionPromise = ai.live.connect({
        model: MODEL,
        callbacks: {
          onopen: () => {
            cb.onOpen();
            inputCtx = new AudioContext({ sampleRate: 16000 });
            const ctx = inputCtx;
            const source = ctx.createMediaStreamSource(micStream!);
            // AudioWorklet capture (ScriptProcessorNode is deprecated): the worklet posts
            // 128-frame quanta; the chunker rebuilds the old 4096-sample cadence.
            const chunker = new Float32Chunker((chunk) => {
              const data = floatToPcm16Base64(chunk);
              sessionPromise?.then(s => { if (!ended) s.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } }); });
            });
            createPcmCaptureNode(ctx, (q) => { if (!ended) chunker.push(q); })
              .then((node) => {
                // teardownAudio may have run while addModule was in flight.
                if (ended || inputCtx !== ctx) { try { node.disconnect(); } catch {} return; }
                captureNode = node;
                const silentGain = ctx.createGain();
                silentGain.gain.value = 0;
                source.connect(node);
                node.connect(silentGain);
                silentGain.connect(ctx.destination);
              })
              .catch((err) => cb.onError(`mic capture failed: ${err?.message ?? err}`));
          },
          onmessage: (msg: any) => {
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) cb.onToolCall({ id: fc.id, name: fc.name, args: fc.args });
            }
            if (msg.serverContent?.modelTurn) {
              cb.onResponseStart?.();
              const audioData = msg.serverContent.modelTurn.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
              if (audioData) cb.onModelAudio?.(audioData);
            }
            if (msg.serverContent?.interrupted) cb.onInterrupted?.();
            // Model speech as text — captions (outputAudioTranscription is already enabled below).
            if (msg.serverContent?.outputTranscription?.text) {
              cb.onModelTranscript?.(msg.serverContent.outputTranscription.text, false);
            }
            if (msg.serverContent?.turnComplete) cb.onModelTranscript?.('', true);
            if (msg.serverContent?.inputTranscription) {
              cb.onInputTranscript(msg.serverContent.inputTranscription.text, !!msg.serverContent?.turnComplete);
            }
          },
          onclose: () => { teardownAudio(); cb.onClose(); },
          onerror: (e: any) => cb.onError(e?.message ?? String(e)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice ?? 'Zephyr' } } },
          tools: toGeminiTools(config.tools),
          systemInstruction: config.instructions,
          ...toRealtimeInputConfig(config.vad),
        },
      });
      // Drain sends buffered before sessionPromise existed — registered FIRST on the
      // promise, so they precede anything the App's onOpen flush queues after open.
      const buffered = preConnectSends;
      preConnectSends = null;
      buffered?.forEach(fn => sessionPromise!.then(s => { if (!ended) fn(s); }));
      session = await sessionPromise;
      onSessionReady?.(session);
    },

    // All sends route through withSession: the SDK invokes callbacks.onopen BEFORE its
    // connect promise resolves (session null during the App's onOpen flush — live smoke
    // 2026-07-16), AND providerRef is set before connect() even runs, so sends can arrive
    // while sessionPromise itself is still null (the getUserMedia await) — the deixis hint
    // of a quick-fired chip died in exactly that window (live smoke 2026-07-18). Pre-promise
    // sends buffer; everything drains FIFO on the one promise, preserving hint-before-text.
    sendTextHint(text: string) {
      withSession(s => s.sendRealtimeInput({ text: contextToken ? fenceHint(contextToken, text) : text }));
    },
    sendUserText(text: string) {
      withSession(s => s.sendClientContent(geminiUserTurns(contextToken ? stripToken(contextToken, text) : text)));
    },
    sendVideoFrame(jpegBase64: string) { withSession(s => s.sendRealtimeInput({ video: { data: jpegBase64, mimeType: 'image/jpeg' } })); },
    sendToolResponse(id: string, name: string, result: any) {
      withSession(s => s.sendToolResponse({ functionResponses: [{ id, name, response: result }] }));
    },
    close() {
      teardownAudio();
      try { session?.close(); } catch {}
      session = null;
      onSessionReady?.(null);
    },
  };
}
