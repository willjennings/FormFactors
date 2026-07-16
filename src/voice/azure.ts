// src/voice/azure.ts
// Azure AI Foundry "GPT Realtime" backend behind the shared VoiceProvider interface.
//
// Transport: a browser-direct WebSocket to the Azure Realtime GA endpoint
//   wss://<resource>/openai/v1/realtime?model=<deployment>&api-key=<key>
// Azure allows the api-key as a query param (the header form isn't available in a
// browser). This matches how this app already exposes GEMINI_API_KEY client-side —
// fine for a local personal demo, NOT for a deployed/shared build.
//
// The wire protocol is the OpenAI Realtime event schema. Unlike the WebRTC OpenAI
// provider, audio here is MANUAL PCM: we stream mic PCM16 up as input_audio_buffer
// events and play the model's response.audio.delta PCM16 back via the component's
// existing handleLiveAudio (delivered through the onModelAudio callback). Azure's
// realtime audio is 24 kHz PCM16 mono, which is exactly what handleLiveAudio expects.

import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks } from './types';
import { userTextItemFrame, responseCreateFrame } from './frames';
import { azureRealtimeUrl } from './azureUrl';

const SAMPLE_RATE = 24000; // Azure/OpenAI realtime PCM16 mono
const FRAME_HEARTBEAT_MS = 500; // vision cadence: at most one image per this interval.
// Lowered from 1500ms to narrow the grounding gap vs Gemini's continuous video — fresher
// frames mean "where is this?" lands on the right element far more often. Each frame is a
// persistent conversation item, so this trades some context/cost for accuracy.

const floatToPcm16Base64 = (input: Float32Array): string => {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  let binary = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

/**
 * @param endpoint  Azure resource endpoint, e.g. https://<name>.services.ai.azure.com
 * @param deployment  The realtime deployment name, e.g. gpt-realtime-2
 * @param apiKey  The Azure resource key.
 */
export function createAzureRealtimeProvider(
  endpoint: string,
  deployment: string,
  apiKey: string,
  /**
   * Name of a transcription model DEPLOYMENT in the same Azure resource (e.g.
   * 'gpt-4o-transcribe'). Azure requires a deployment name here, not 'whisper-1'.
   * Without it, the model still talks, but no user-speech transcripts are emitted —
   * which disables this app's deixis ("this"/"here") hint detection.
   */
  transcribeDeployment?: string,
): VoiceProvider {
  let ws: WebSocket | null = null;
  let micStream: MediaStream | null = null;
  let inputCtx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let closed = false;
  let latestFrame: string | null = null;
  let lastFrameSentAt = 0;
  const dispatchedCalls = new Set<string>();

  const send = (obj: unknown) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const sendImage = (jpegBase64: string) => {
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${jpegBase64}` }],
      },
    });
  };

  const maybeDispatchToolCall = (cb: VoiceCallbacks, item: any) => {
    if (!item || item.type !== 'function_call') return;
    const callId: string | undefined = item.call_id;
    const name: string | undefined = item.name;
    if (!callId || !name || dispatchedCalls.has(callId)) return;
    dispatchedCalls.add(callId);
    let args: any = {};
    try { args = JSON.parse(item.arguments || '{}'); } catch { args = {}; }
    cb.onToolCall({ id: callId, name, args });
  };

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      closed = false;
      dispatchedCalls.clear();
      try {
        const url = azureRealtimeUrl(endpoint, deployment, apiKey);
        ws = new WebSocket(url);

        ws.onopen = () => {
          console.log('[azure] ws open → sending session.update (transcribe:', transcribeDeployment || 'NONE', ')');
          // Configure the session: instructions, tools, voice, PCM formats, server VAD.
          // GA Realtime schema: requires session.type='realtime' and nests audio config
          // under audio.input / audio.output (the flat modalities/*_audio_format form is
          // rejected). Formats default to PCM16 @ 24kHz, which is what we stream/play.
          send({
            type: 'session.update',
            session: {
              type: 'realtime',
              instructions: config.instructions,
              audio: {
                input: {
                  turn_detection: { type: 'server_vad' },
                  // Azure requires a transcription DEPLOYMENT name (not 'whisper-1'); omit if none.
                  ...(transcribeDeployment ? { transcription: { model: transcribeDeployment } } : {}),
                },
                output: { voice: config.voice ?? 'alloy' },
              },
              tools: config.tools.map(t => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              tool_choice: 'auto',
            },
          });
          if (!transcribeDeployment) {
            cb.onError('Azure: no transcription deployment set (AZURE_TRANSCRIBE_DEPLOYMENT) — voice works but deixis "this/here" hints are disabled.');
          }

          // Start streaming mic audio as PCM16 @ 24kHz.
          navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
            micStream = stream;
            inputCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
            const source = inputCtx.createMediaStreamSource(stream);
            processor = inputCtx.createScriptProcessor(4096, 1, 1);
            const silentGain = inputCtx.createGain();
            silentGain.gain.value = 0;
            processor.onaudioprocess = (e) => {
              const audio = floatToPcm16Base64(e.inputBuffer.getChannelData(0));
              send({ type: 'input_audio_buffer.append', audio });
            };
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
          }).catch(err => cb.onError(err?.message ?? 'microphone access failed'));

          cb.onOpen();
        };

        ws.onmessage = (e) => {
          let ev: any;
          try { ev = JSON.parse(e.data); } catch { return; }
          // Log only errors + session lifecycle (the per-item churn — conversation.item.*,
          // the 1.5s vision heartbeat — would otherwise flood the console).
          if (ev.type === 'error') console.error('[azure event] error', JSON.stringify(ev.error));
          else if (ev.type === 'session.created' || ev.type === 'session.updated') console.log('[azure event]', ev.type);
          switch (ev.type) {
            case 'conversation.item.input_audio_transcription.delta':
              cb.onInputTranscript(ev.delta ?? '', false);
              break;
            case 'conversation.item.input_audio_transcription.completed':
              cb.onInputTranscript(ev.transcript ?? '', true);
              break;
            case 'response.created':
              cb.onResponseStart?.();
              break;
            // Model speech as text — captions (classic + GA event names).
            case 'response.audio_transcript.delta':
            case 'response.output_audio_transcript.delta':
              cb.onModelTranscript?.(ev.delta ?? '', false);
              break;
            case 'response.audio_transcript.done':
            case 'response.output_audio_transcript.done':
              cb.onModelTranscript?.(ev.transcript ?? '', true);
              break;
            case 'input_audio_buffer.speech_started':
              cb.onInterrupted?.();
              break;
            // Audio output: classic name + GA-renamed name, both carry base64 PCM16 @ 24kHz.
            case 'response.audio.delta':
            case 'response.output_audio.delta':
              if (ev.delta) cb.onModelAudio?.(ev.delta);
              break;
            case 'response.output_item.done':
              maybeDispatchToolCall(cb, ev.item);
              break;
            case 'response.done':
              if (Array.isArray(ev.response?.output)) {
                for (const item of ev.response.output) maybeDispatchToolCall(cb, item);
              }
              break;
            case 'error':
              cb.onError(ev.error?.message ?? 'realtime error');
              break;
            default:
              break;
          }
        };

        ws.onerror = () => { console.log('[azure] ws error'); if (!closed) cb.onError('Azure Realtime WebSocket error'); };
        ws.onclose = (e) => {
          console.log('[azure] ws closed', e.code, e.reason);
          // SERVER-initiated close must release the mic too (same leak as gemini.ts:
          // only app-initiated close() tore down the pipeline — hot mic + dead-socket pump).
          try { processor?.disconnect(); } catch { /* noop */ }
          try { inputCtx?.close(); } catch { /* noop */ }
          try { micStream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
          processor = null; inputCtx = null; micStream = null;
          if (!closed) cb.onClose();
        };
      } catch (err: any) {
        cb.onError(err?.message ?? 'failed to connect to Azure Realtime');
      }
    },

    sendTextHint(text: string) {
      if (latestFrame) { sendImage(latestFrame); lastFrameSentAt = Date.now(); }
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
    },

    sendUserText(text: string) {
      if (latestFrame) { sendImage(latestFrame); lastFrameSentAt = Date.now(); }
      send(userTextItemFrame(text));
      send(responseCreateFrame());
    },

    sendVideoFrame(jpegBase64: string) {
      latestFrame = jpegBase64;
      const now = Date.now();
      if (now - lastFrameSentAt >= FRAME_HEARTBEAT_MS) { sendImage(jpegBase64); lastFrameSentAt = now; }
    },

    sendToolResponse(id: string, _name: string, result: any) {
      send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: id, output: JSON.stringify(result) },
      });
      send({ type: 'response.create' });
    },

    close() {
      closed = true;
      try { processor?.disconnect(); } catch { /* noop */ }
      try { inputCtx?.close(); } catch { /* noop */ }
      try { micStream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      try { ws?.close(); } catch { /* noop */ }
      ws = null; micStream = null; inputCtx = null; processor = null;
      latestFrame = null;
      dispatchedCalls.clear();
    },
  };
}
