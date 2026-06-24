// src/voice/gemini.ts
// Gemini Live backend behind the VoiceProvider interface. Thin on purpose: model-audio
// playback and response/interruption UI handling stay in the component (delegated via the
// optional callbacks), so today's polished Gemini audio path is untouched.
import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks, VoiceTool } from './types';

const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const JS_TO_GEMINI: Record<string, any> = {
  string: Type.STRING, number: Type.NUMBER, boolean: Type.BOOLEAN, object: Type.OBJECT, array: Type.ARRAY,
};

function toGeminiParams(schema: Record<string, any>): any {
  const out: any = { type: JS_TO_GEMINI[schema.type] ?? Type.OBJECT };
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries<any>(schema.properties)) {
      out.properties[k] = v.type === 'array'
        ? { type: Type.ARRAY, items: { type: JS_TO_GEMINI[v.items?.type] ?? Type.STRING }, description: v.description }
        : { type: JS_TO_GEMINI[v.type] ?? Type.STRING, description: v.description };
    }
  }
  if (schema.required) out.required = schema.required;
  return out;
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
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const binary = String.fromCharCode(...new Uint8Array(int16.buffer));
              sessionPromise?.then(s => s.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }));
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
            if (msg.serverContent?.inputTranscription) {
              cb.onInputTranscript(msg.serverContent.inputTranscription.text, !!msg.serverContent?.turnComplete);
            }
          },
          onclose: () => cb.onClose(),
          onerror: (e: any) => cb.onError(e?.message ?? String(e)),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice ?? 'Zephyr' } } },
          tools: toGeminiTools(config.tools),
          systemInstruction: config.instructions,
        },
      });
      session = await sessionPromise;
      onSessionReady?.(session);
    },

    sendTextHint(text: string) { session?.sendRealtimeInput({ text }); },
    sendVideoFrame(jpegBase64: string) { session?.sendRealtimeInput({ video: { data: jpegBase64, mimeType: 'image/jpeg' } }); },
    sendToolResponse(id: string, name: string, result: any) {
      session?.sendToolResponse({ functionResponses: [{ id, name, response: result }] });
    },
    close() {
      try { processor?.disconnect(); } catch {}
      try { inputCtx?.close(); } catch {}
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { session?.close(); } catch {}
      session = null;
      onSessionReady?.(null);
    },
  };
}
