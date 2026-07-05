// src/voice/openai.ts
// OpenAI Realtime voice backend over WebRTC, behind the shared VoiceProvider
// interface so the app can A/B it against the Gemini backend.
//
// Notable contract details (verified against the GA Realtime docs, 2026-06):
// - Ephemeral token: POST /api/realtime/session (our server proxies to
//   POST https://api.openai.com/v1/realtime/client_secrets). The token lives at
//   the TOP-LEVEL `value` field of the response (NOT `client_secret.value`).
// - SDP exchange: POST https://api.openai.com/v1/realtime/calls with the offer
//   SDP as the raw body, Content-Type: application/sdp, Authorization: Bearer
//   <ephemeral>. The model is NOT a query param on the GA endpoint — it is
//   carried in the session config minted server-side.
// - Data channel: "oai-events".
// - Audio plays NATIVELY via an <audio> element, so we do NOT call onModelAudio.
// - Tool calls: we trigger off `response.output_item.done` whose item is a
//   `function_call`, because that event reliably carries name + call_id +
//   arguments together. The `response.function_call_arguments.done` event is
//   documented WITHOUT a `name` field (and SDKs surface it as null), so it is
//   not a safe single source for routing the call.

import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks } from './types';
import { userTextItemFrame, responseCreateFrame } from './frames';

const FRAME_HEARTBEAT_MS = 1500; // sparse vision: at most one image per this interval

export function createOpenAIRealtimeProvider(): VoiceProvider {
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let latestFrame: string | null = null;
  let lastFrameSentAt = 0;
  let closed = false;
  // De-dupe tool calls: response.output_item.done can be followed by
  // response.done carrying the same function_call output, so we guard by call_id.
  const dispatchedCalls = new Set<string>();

  const send = (obj: unknown) => {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj));
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
    if (!callId || !name) return;
    if (dispatchedCalls.has(callId)) return;
    dispatchedCalls.add(callId);
    let args: any = {};
    try {
      args = JSON.parse(item.arguments || '{}');
    } catch {
      args = {};
    }
    cb.onToolCall({ id: callId, name, args });
  };

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      closed = false;
      // Defensive: tear down any prior connection if connect() is called again without close().
      try { dc?.close(); } catch { /* noop */ }
      try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { pc?.close(); } catch { /* noop */ }
      pc = null; dc = null;
      try {
        const tokenRes = await fetch('/api/realtime/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructions: config.instructions,
            tools: config.tools,
            voice: config.voice ?? 'marin',
          }),
        });
        const tokenJson = await tokenRes.json().catch(() => ({}));
        // GA shape: top-level `value`. Fall back to `client_secret.value` for the
        // older response shape just in case, then to nothing.
        const ephemeral: string | undefined =
          tokenJson?.value ?? tokenJson?.client_secret?.value;
        if (!ephemeral) {
          const errMsg =
            (typeof tokenJson?.error === 'string'
              ? tokenJson.error
              : tokenJson?.error?.message) ??
            'No ephemeral token (is OPENAI_API_KEY set?)';
          cb.onError(errMsg);
          return;
        }

        pc = new RTCPeerConnection();

        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        pc.ontrack = (e) => {
          if (audioEl) audioEl.srcObject = e.streams[0];
        };

        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'failed') {
            cb.onError('WebRTC connection failed');
          } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
            if (!closed) cb.onClose();
          }
        };

        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((t) => pc!.addTrack(t, micStream!));

        dc = pc.createDataChannel('oai-events');
        dc.onopen = () => cb.onOpen();
        dc.onclose = () => {
          if (!closed) cb.onClose();
        };
        dc.onmessage = (e) => {
          let ev: any;
          try {
            ev = JSON.parse(e.data);
          } catch {
            return;
          }
          switch (ev.type) {
            // User-input speech transcription.
            case 'conversation.item.input_audio_transcription.delta':
              cb.onInputTranscript(ev.delta ?? '', false);
              break;
            case 'conversation.item.input_audio_transcription.completed':
              cb.onInputTranscript(ev.transcript ?? '', true);
              break;

            // Model started producing a response turn.
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

            // Barge-in: the user interrupted the model's audio.
            case 'input_audio_buffer.speech_started':
              cb.onInterrupted?.();
              break;

            // Tool calls: primary, reliable source (carries name+call_id+args).
            case 'response.output_item.done':
              maybeDispatchToolCall(cb, ev.item);
              break;

            // response.done can also carry function_call outputs; dispatch any
            // not already handled (the Set guards against duplicates).
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

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // GA endpoint: no `?model=` query param — the model is bound to the
        // ephemeral session that was minted server-side.
        const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${ephemeral}`,
            'Content-Type': 'application/sdp',
          },
        });
        if (!sdpRes.ok) {
          cb.onError(`SDP exchange failed: ${sdpRes.status} ${await sdpRes.text().catch(() => '')}`);
          return;
        }
        const answerSdp = await sdpRes.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      } catch (err: any) {
        cb.onError(err?.message ?? 'failed to connect to OpenAI Realtime');
      }
    },

    sendTextHint(text: string) {
      // Couple the latest scene frame to deixis hints so the model can resolve
      // "this"/"that" against what's on screen, then inject the text.
      if (latestFrame) {
        sendImage(latestFrame);
        lastFrameSentAt = Date.now();
      }
      send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
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
      if (now - lastFrameSentAt >= FRAME_HEARTBEAT_MS) {
        sendImage(jpegBase64);
        lastFrameSentAt = now;
      }
    },

    sendToolResponse(id: string, _name: string, result: any) {
      // OpenAI's function_call_output only needs call_id + output. `name` is part
      // of the shared interface signature but unused here.
      send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: id,
          output: JSON.stringify(result),
        },
      });
      send({ type: 'response.create' });
    },

    close() {
      closed = true;
      try {
        dc?.close();
      } catch {
        /* noop */
      }
      try {
        micStream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* noop */
      }
      try {
        pc?.close();
      } catch {
        /* noop */
      }
      if (audioEl) {
        audioEl.srcObject = null;
        audioEl = null;
      }
      pc = null;
      dc = null;
      micStream = null;
      latestFrame = null;
      dispatchedCalls.clear();
    },
  };
}
