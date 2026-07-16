// src/voice/gemini.ts
// Gemini Live backend behind the VoiceProvider interface. Thin on purpose: model-audio
// playback and response/interruption UI handling stay in the component (delegated via the
// optional callbacks), so today's polished Gemini audio path is untouched.
import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks, VoiceTool } from './types';
import { geminiUserTurns } from './frames';

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
  if (schema.items) out.items = toGeminiParams(schema.items);
  if (schema.required) out.required = schema.required;
  return out;
}

/** VAD tuning → live connect config fragment. Empty when unset so server defaults stand.
 *  Exported for tests. */
export function toRealtimeInputConfig(vad?: { silenceDurationMs?: number; prefixPaddingMs?: number }): Record<string, any> {
  if (!vad) return {};
  const aad: Record<string, number> = {};
  if (vad.silenceDurationMs != null) aad.silenceDurationMs = vad.silenceDurationMs;
  if (vad.prefixPaddingMs != null) aad.prefixPaddingMs = vad.prefixPaddingMs;
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
  let inputCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let ended = false;

  // Release the mic capture pipeline. MUST run on SERVER-initiated closes too (live smoke
  // 2026-07-16 console: after the server dropped the session, the ScriptProcessorNode kept
  // pumping ~4x/s into the dead socket — endless "WebSocket is already in CLOSING or CLOSED
  // state" spam AND a hot microphone the user never turned off).
  function teardownAudio() {
    ended = true;
    try { processor?.disconnect(); } catch {}
    try { inputCtx?.close(); } catch {}
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    processor = null; inputCtx = null; micStream = null;
  }

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      const ai = new GoogleGenAI({ apiKey });
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      sessionPromise = ai.live.connect({
        model: MODEL,
        callbacks: {
          onopen: () => {
            cb.onOpen();
            inputCtx = new AudioContext({ sampleRate: 16000 });
            const source = inputCtx.createMediaStreamSource(micStream!);
            processor = inputCtx.createScriptProcessor(4096, 1, 1);
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0;
            processor.onaudioprocess = (e) => {
              if (ended) return; // belt-and-braces: disconnect() can race one last tick
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const binary = String.fromCharCode(...new Uint8Array(int16.buffer));
              sessionPromise?.then(s => { if (!ended) s.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }); });
            };
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
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
      session = await sessionPromise;
      onSessionReady?.(session);
    },

    sendTextHint(text: string) { session?.sendRealtimeInput({ text }); },
    sendUserText(text: string) { session?.sendClientContent(geminiUserTurns(text)); },
    sendVideoFrame(jpegBase64: string) { session?.sendRealtimeInput({ video: { data: jpegBase64, mimeType: 'image/jpeg' } }); },
    sendToolResponse(id: string, name: string, result: any) {
      session?.sendToolResponse({ functionResponses: [{ id, name, response: result }] });
    },
    close() {
      teardownAudio();
      try { session?.close(); } catch {}
      session = null;
      onSessionReady?.(null);
    },
  };
}
