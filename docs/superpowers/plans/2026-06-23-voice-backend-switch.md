# Pluggable Voice Backend (Gemini ↔ RTV2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dropdown that swaps the live voice backend between Gemini Live and OpenAI Realtime (WebRTC), with the honest-mode logic unchanged and shared, both backends speaking, and the marker vision working on each.

**Architecture:** Introduce a small `VoiceProvider` interface (`src/voice/types.ts`). The honest-mode layer (prompt, confidence/hint logic, tool switch, marker/proposal/share UI) stays in `App.tsx` and sits *above* the interface. Today's Gemini code is wrapped in `GeminiProvider` (`src/voice/gemini.ts`); a new `OpenAIRealtimeProvider` (`src/voice/openai.ts`) is a WebRTC adapter. `server.ts` mints OpenAI ephemeral tokens so the key stays server-side. A dropdown selects the provider.

**Tech Stack:** React 19, TypeScript, Vite, `@google/genai` (Gemini Live), OpenAI Realtime API over WebRTC, Express (`server.ts`).

**Verification model (read first):** This repo has no unit-test runner, and the feature is WebRTC/voice (not unit-testable here). Each task is gated by:
- `npm run lint` → runs `tsc --noEmit`, must be clean.
- `npm run build` → `vite build`, must succeed (catches JSX/bundle errors).
- A **manual/live check** described per task (the dev server runs on `http://localhost:3000`; HMR is live).
Commit after each task. Do **not** add a test framework — out of scope.

**Spec:** `docs/superpowers/specs/2026-06-23-voice-backend-switch-design.md`

**Branch:** Work on `voice-backend-switch` (already created off `honest-mode`). All of the honest-mode code is present.

---

## File Structure

- `src/voice/types.ts` — **create.** The `VoiceProvider` interface + config/callback/tool types. No dependencies.
- `src/voice/gemini.ts` — **create.** `createGeminiProvider()`: owns the GoogleGenAI live connect, mic capture (16 kHz PCM), audio playback (re-enabled), and translates Gemini messages → normalized callbacks.
- `src/voice/openai.ts` — **create.** `createOpenAIRealtimeProvider()`: WebRTC peer connection, ephemeral-token fetch, audio element playback, data-channel event translation, sparse vision frames.
- `server.ts` — **modify.** Add `express.json()` + `POST /api/realtime/session` (mint ephemeral token).
- `.env.example` — **modify.** Add `OPENAI_API_KEY`.
- `src/App.tsx` — **modify.** Extract `buildInstructions`, `VOICE_TOOLS`, `handleVoiceToolCall`, `processInputTranscript`; add `provider` state + `providerRef` + dropdown; route `startLiveSession` and the frame loop through the provider.

---

## Task 1: Provider interface

**Files:**
- Create: `src/voice/types.ts`

- [ ] **Step 1: Write the interface file**

```ts
// src/voice/types.ts
// Provider-agnostic contract between the app's honest-mode logic and any voice backend.

export interface VoiceTool {
  name: string;
  description: string;
  /** JSON Schema for the function arguments. */
  parameters: Record<string, any>;
}

export interface VoiceSessionConfig {
  instructions: string;
  tools: VoiceTool[];
  /** Provider-specific voice name (e.g. Gemini 'Zephyr', OpenAI 'marin'). */
  voice?: string;
}

export interface VoiceCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (message: string) => void;
  /** A chunk of the user's speech transcription. isFinal=true when the turn's transcript is complete. */
  onInputTranscript: (text: string, isFinal: boolean) => void;
  /** The model called one of the declared tools. args is already parsed to an object. */
  onToolCall: (call: { id: string; name: string; args: any }) => void;
}

export interface VoiceProvider {
  connect: (config: VoiceSessionConfig, callbacks: VoiceCallbacks) => Promise<void>;
  /** Inject context (deixis hint, system update). MUST NOT force a model response on its own. */
  sendTextHint: (text: string) => void;
  /** The current annotated scene as a base64 JPEG (no data: prefix). Cadence is the adapter's choice. */
  sendVideoFrame: (jpegBase64: string) => void;
  sendToolResponse: (id: string, name: string, result: any) => void;
  close: () => void;
}

export type ProviderKind = 'gemini' | 'openai';
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: PASS (no output errors).

- [ ] **Step 3: Commit**

```bash
git add src/voice/types.ts
git commit -m "feat(voice): add VoiceProvider interface"
```

---

## Task 2: Extract provider-neutral config (instructions + tools) in App.tsx

This lifts the system-prompt string and the 5 tool declarations out of `startLiveSession` so both providers can share them. No behavior change yet.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a neutral tool list near the top-level consts**

Add after the `CONFUSABLE_PAIRS` / `computePointingConfidence` block (module scope, ~line 110). These mirror the existing `functionDeclarations` but as plain JSON Schema (no `Type.*`):

```ts
import type { VoiceTool } from './voice/types';

const VOICE_TOOLS: VoiceTool[] = [
  {
    name: 'update_map',
    description: 'Update the map to show a specific location or search for nearby places. ONLY call this tool if the user EXPLICITLY asks you to update the map or search for something verbally.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'The location name or search query.' } }, required: ['query'] },
  },
  {
    name: 'show_directions',
    description: 'Show directions between two locations on the map. ONLY call this tool if the user EXPLICITLY asks you for directions or how to get somewhere verbally.',
    parameters: { type: 'object', properties: { origin: { type: 'string', description: 'The starting location.' }, destination: { type: 'string', description: 'The destination location.' } }, required: ['origin', 'destination'] },
  },
  {
    name: 'explain',
    description: 'Verbally name or describe what the user is pointing at (e.g. "what is this?", "what am I looking at?"). LOW-COMMITMENT: it does NOT change the map. Call it when the user asks to identify something rather than navigate.',
    parameters: { type: 'object', properties: { subject: { type: 'string', description: 'The landmark or thing being identified.' } }, required: ['subject'] },
  },
  {
    name: 'synthesize',
    description: 'Plan a multi-stop day itinerary from several landmarks (e.g. "plan a day from these"). Call WITHOUT confirm to PROPOSE the plan as a hypothesis first; call with confirm=true only after the user explicitly approves, to build the route.',
    parameters: { type: 'object', properties: { places: { type: 'array', items: { type: 'string' }, description: 'Ordered list of stops for the day.' }, plan: { type: 'string', description: 'A short human-readable description of the proposed day.' }, confirm: { type: 'boolean', description: 'Set true ONLY after the user has explicitly confirmed they want it built.' } }, required: ['places'] },
  },
  {
    name: 'share',
    description: 'Share something (e.g. an itinerary) with another person (e.g. "share this with Lia"). OUTWARD, high-commitment action. Call WITHOUT confirm to witness-render the recipient and payload first; call with confirm=true only after the user explicitly approves sending.',
    parameters: { type: 'object', properties: { recipient: { type: 'string', description: 'Who to send to.' }, payload: { type: 'string', description: 'A short description of what is being shared.' }, confirm: { type: 'boolean', description: 'Set true ONLY after the user has explicitly confirmed they want it sent.' } }, required: ['recipient'] },
  },
];
```

- [ ] **Step 2: Extract the system instruction into a builder**

Inside the component, just above `startLiveSession`, add a function that returns the exact instruction string currently built inline (move the whole backtick template from the `systemInstruction:` field, including the `${honest ? POINTING_TRUTH_HONEST : POINTING_TRUTH_CONFIDENT}` and `${honest ? HONEST_VERB_RULES : CONFIDENT_VERB_RULES}` interpolations, and the `POINTING_TRUTH_*` / `*_VERB_RULES` const definitions that precede the connect call):

```ts
const buildInstructions = (honest: boolean): string => {
  const POINTING_TRUTH_CONFIDENT = `...`;   // move existing const here verbatim
  const POINTING_TRUTH_HONEST = `...`;      // move existing const here verbatim
  const CONFIDENT_VERB_RULES = `...`;       // move existing const here verbatim
  const HONEST_VERB_RULES = `...`;          // move existing const here verbatim
  return `You are a helpful London tour guide.
...`;                                       // the full existing template, using `honest` where `${honest ? ...}` was
};
```

Leave the Gemini `ai.live.connect` call temporarily using `systemInstruction: buildInstructions(honestModeRef.current)` and keep its `functionDeclarations` as-is for now (Task 4 replaces them). Remove the now-moved `const POINTING_TRUTH_*` / `*_VERB_RULES` from inside `startLiveSession`.

- [ ] **Step 3: Type-check and build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 4: Manual check — Gemini still works**

In the browser, start a session and confirm the existing behavior is unchanged (point at the London Eye, "show me this", map updates; debug panel logs `Prompt variant`).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(voice): extract buildInstructions + VOICE_TOOLS"
```

---

## Task 3: Extract the tool switch and input-transcript handler as component methods

Today the tool switch lives in the Gemini `onmessage` and the deixis-hint logic lives in the transcription handler. Lift both into provider-agnostic component methods so any provider can drive them via callbacks. Keep the existing Gemini code calling them so behavior is unchanged.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Create `handleVoiceToolCall`**

Add a component method that contains the exact body of the current `for (const fc of msg.toolCall.functionCalls)` switch (the `update_map` / `show_directions` / `explain` / `synthesize` / `share` branches), parameterized by a normalized call and using `providerRef.current` for responses:

```ts
const handleVoiceToolCall = (call: { id: string; name: string; args: any }) => {
  const fc = { id: call.id, name: call.name, args: call.args };
  // ... paste the existing switch body verbatim, replacing:
  //   sessionRef.current?.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: R }] })
  // with:
  //   providerRef.current?.sendToolResponse(fc.id, fc.name, R)
};
```

Replace the inline switch in the Gemini `onmessage` with: `for (const fc of msg.toolCall.functionCalls) { handleVoiceToolCall({ id: fc.id, name: fc.name, args: fc.args }); }`.

- [ ] **Step 2: Create `processInputTranscript`**

Move the deixis-hint logic (the keyword/cursor hit-test + `computePointingConfidence` + Phase B marker threading + Phase F trip-pattern + the `[USER JUST SAID ...]` hint send) out of the Gemini transcription handler into:

```ts
const processInputTranscript = (text: string) => {
  // ... paste the existing transcript→keyword→cursor→confidence→hint block verbatim,
  // replacing every `sessionRef.current.sendRealtimeInput({ text: X })` with
  // `providerRef.current?.sendTextHint(X)`.
};
```

Have the Gemini transcription handler call `processInputTranscript(transcriptText)` where it previously ran that block. Also update `setLiveTranscription` usage to remain in the transcription handler (UI state), calling `processInputTranscript` for the hint logic only.

- [ ] **Step 3: Add `providerRef`**

Near the other refs (~line 370), add:

```ts
import type { VoiceProvider } from './voice/types';
const providerRef = useRef<VoiceProvider | null>(null);
```

Keep `sessionRef` for now (Gemini still uses it internally until Task 4).

- [ ] **Step 4: Type-check, build, manual check**

Run: `npm run lint && npm run build`
Expected: PASS. In the browser, confirm Gemini behavior unchanged (S1 + S2 + a tool call all still work; debug panel still logs confidence).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(voice): extract handleVoiceToolCall + processInputTranscript"
```

---

## Task 4: GeminiProvider + route App through providerRef

Wrap the Gemini connect/audio/message code in `createGeminiProvider`, re-enable voice playback, and make `startLiveSession` drive it through the interface.

**Files:**
- Create: `src/voice/gemini.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the Gemini provider**

```ts
// src/voice/gemini.ts
import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks, VoiceTool } from './types';

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

export function createGeminiProvider(apiKey: string): VoiceProvider {
  let session: any = null;
  let sessionPromise: Promise<any> | null = null;
  let inputCtx: AudioContext | null = null;
  let outputCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let nextStartTime = 0;

  // --- audio playback (re-enabled): schedule 24kHz PCM chunks from the model ---
  const playPcm = (base64: string) => {
    if (!outputCtx) return;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const int16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = outputCtx.createBuffer(1, f32.length, 24000);
    buf.getChannelData(0).set(f32);
    const src = outputCtx.createBufferSource();
    src.buffer = buf; src.connect(outputCtx.destination);
    const now = outputCtx.currentTime;
    const start = Math.max(now + 0.02, nextStartTime);
    src.start(start);
    nextStartTime = start + buf.duration;
  };

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      const ai = new GoogleGenAI({ apiKey });
      outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await outputCtx.resume();
      inputCtx = new AudioContext({ sampleRate: 16000 });
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            cb.onOpen();
            const source = inputCtx!.createMediaStreamSource(micStream!);
            processor = inputCtx!.createScriptProcessor(4096, 1, 1);
            source.connect(processor); processor.connect(inputCtx!.destination);
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i++) pcm[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
              let binary = ''; const b = new Uint8Array(pcm.buffer);
              for (let i = 0; i < b.length; i++) binary += String.fromCharCode(b[i]);
              session?.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } });
            };
          },
          onmessage: (msg: any) => {
            const inputT = msg.serverContent?.inputTranscription?.text;
            if (inputT) cb.onInputTranscript(inputT, !!msg.serverContent?.turnComplete);
            const audio = msg.serverContent?.modelTurn?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
            if (audio) playPcm(audio);
            if (msg.toolCall) for (const fc of msg.toolCall.functionCalls) cb.onToolCall({ id: fc.id, name: fc.name, args: fc.args });
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
    },
    sendTextHint(text) { session?.sendRealtimeInput({ text }); },
    sendVideoFrame(jpegBase64) { session?.sendRealtimeInput({ video: { data: jpegBase64, mimeType: 'image/jpeg' } }); },
    sendToolResponse(id, name, result) { session?.sendToolResponse({ functionResponses: [{ id, name, response: result }] }); },
    close() {
      try { processor?.disconnect(); } catch {}
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { session?.close(); } catch {}
      session = null;
    },
  };
}
```

> Note: the exact `onmessage` field names (`inputTranscription`, `turnComplete`, `modelTurn.parts[].inlineData`) must match what the current code reads — copy them from the existing `startLiveSession` `onmessage` handler to stay faithful.

- [ ] **Step 2: Rewrite `startLiveSession` to use the provider**

Replace the body of `startLiveSession` (after the mic/key guards) with:

```ts
const ai = process.env.GEMINI_API_KEY!;
providerRef.current = createGeminiProvider(ai);   // OpenAI added in Task 7
await providerRef.current.connect(
  { instructions: buildInstructions(honestModeRef.current), tools: VOICE_TOOLS, voice: 'Zephyr' },
  {
    onOpen: () => { setIsLive(true); addLog('info', `Prompt variant: ${honestModeRef.current ? 'HONEST' : 'CONFIDENT'}`); identifiedLandmarksRef.current = new Set(); hasOfferedTripRef.current = false; },
    onClose: () => { setIsLive(false); providerRef.current = null; addLog('info', 'Live Link Closed'); },
    onError: (m) => { setLastError(m); addLog('info', `Session Error: ${m}`); },
    onInputTranscript: (text) => { setLiveTranscription(text); lastTranscriptionTimeRef.current = Date.now(); processInputTranscript(text); },
    onToolCall: handleVoiceToolCall,
  },
);
```

Delete the now-unused inline `ai.live.connect` block and `sessionRef` usages. Update the "End Session" button and the honest-mode reconnect effect to call `providerRef.current?.close()`.

- [ ] **Step 3: Route the frame loop through the provider**

In the ~150ms frame `useEffect` (~line 2432), replace `sessionRef.current?.sendRealtimeInput({ video: ... })` with `providerRef.current?.sendVideoFrame(base64)`.

- [ ] **Step 4: Type-check, build, manual check**

Run: `npm run lint && npm run build`
Expected: PASS. In the browser: start a session — **now Gemini should SPEAK** (voice playback re-enabled). Re-run S1 and S2; confirm map updates, hints in the debug panel, and a tool call all still work.

- [ ] **Step 5: Commit**

```bash
git add src/voice/gemini.ts src/App.tsx
git commit -m "feat(voice): GeminiProvider via VoiceProvider + re-enable voice playback"
```

---

## Task 5: Server ephemeral-token endpoint

**Files:**
- Modify: `server.ts`
- Modify: `.env.example`

- [ ] **Step 1: Verify the current OpenAI Realtime session API**

Use WebFetch on `https://platform.openai.com/docs/api-reference/realtime-sessions` (and the Realtime WebRTC guide) to confirm: the session-create endpoint path, the model id (`gpt-realtime`), the ephemeral-token field, and the session config keys (`voice`, `instructions`, `tools`, `input_audio_transcription`, `turn_detection`, `modalities`). Adjust the code below to match current field names.

- [ ] **Step 2: Add the endpoint**

In `server.ts`, after `const app = express();` add `app.use(express.json());`, then add before the static middleware:

```ts
app.post("/api/realtime/session", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "OPENAI_API_KEY not set" });
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-realtime",
        voice: req.body?.voice ?? "marin",
        instructions: req.body?.instructions,
        tools: (req.body?.tools ?? []).map((t: any) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })),
        modalities: ["audio", "text"],
        input_audio_transcription: { model: "gpt-4o-transcribe" },
        turn_detection: { type: "server_vad" },
      }),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "token request failed" });
  }
});
```

- [ ] **Step 3: Add the key to `.env.example`**

```
GEMINI_API_KEY="MY_GEMINI_API_KEY"
OPENAI_API_KEY="MY_OPENAI_API_KEY"
```

- [ ] **Step 4: Verify the endpoint**

Set `OPENAI_API_KEY` in `.env.local`, restart `npm run dev`, then:
Run: `curl -s -X POST localhost:3000/api/realtime/session -H 'Content-Type: application/json' -d '{"instructions":"test","tools":[]}' | head -c 400`
Expected: JSON containing an ephemeral client secret (not an error). If `OPENAI_API_KEY not set`, the key isn't loaded.

- [ ] **Step 5: Commit**

```bash
git add server.ts .env.example
git commit -m "feat(voice): /api/realtime/session ephemeral token endpoint"
```

---

## Task 6: OpenAIRealtimeProvider (WebRTC)

**Files:**
- Create: `src/voice/openai.ts`

- [ ] **Step 1: Verify the Realtime WebRTC event shapes**

Use WebFetch on the OpenAI Realtime WebRTC guide and events reference to confirm: the SDP exchange URL (`https://api.openai.com/v1/realtime?model=...`), the data-channel name (`oai-events`), the input-image content shape (`input_image` / `image_url`), and the event types used below (`response.function_call_arguments.done`, `conversation.item.input_audio_transcription.completed`/`.delta`). Adjust to match.

- [ ] **Step 2: Write the provider**

```ts
// src/voice/openai.ts
import type { VoiceProvider, VoiceSessionConfig, VoiceCallbacks } from './types';

const MODEL = 'gpt-realtime';
const FRAME_HEARTBEAT_MS = 1500;   // sparse vision: at most one image per this interval

export function createOpenAIRealtimeProvider(): VoiceProvider {
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let micStream: MediaStream | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let latestFrame: string | null = null;
  let lastFrameSentAt = 0;

  const send = (obj: any) => { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(obj)); };

  const sendImage = (jpegBase64: string) => {
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user',
      content: [{ type: 'input_image', image_url: `data:image/jpeg;base64,${jpegBase64}` }] } });
  };

  return {
    async connect(config: VoiceSessionConfig, cb: VoiceCallbacks) {
      // 1) ephemeral token from our server
      const tokenRes = await fetch('/api/realtime/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: config.instructions, tools: config.tools, voice: config.voice ?? 'marin' }),
      });
      const tokenJson = await tokenRes.json();
      const ephemeral = tokenJson?.client_secret?.value;
      if (!ephemeral) { cb.onError(tokenJson?.error ?? 'No ephemeral token (is OPENAI_API_KEY set?)'); return; }

      // 2) peer connection + audio playback
      pc = new RTCPeerConnection();
      audioEl = document.createElement('audio'); audioEl.autoplay = true;
      pc.ontrack = (e) => { if (audioEl) audioEl.srcObject = e.streams[0]; };
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.getTracks().forEach(t => pc!.addTrack(t, micStream!));

      // 3) data channel for events
      dc = pc.createDataChannel('oai-events');
      dc.onopen = () => {
        // belt-and-suspenders: ensure tools/instructions/transcription are set
        send({ type: 'session.update', session: {
          instructions: config.instructions,
          tools: config.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
          input_audio_transcription: { model: 'gpt-4o-transcribe' },
        } });
        cb.onOpen();
      };
      dc.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        if (ev.type === 'conversation.item.input_audio_transcription.delta') cb.onInputTranscript(ev.delta ?? '', false);
        else if (ev.type === 'conversation.item.input_audio_transcription.completed') cb.onInputTranscript(ev.transcript ?? '', true);
        else if (ev.type === 'response.function_call_arguments.done') {
          let args = {}; try { args = JSON.parse(ev.arguments || '{}'); } catch {}
          cb.onToolCall({ id: ev.call_id, name: ev.name, args });
        } else if (ev.type === 'error') cb.onError(ev.error?.message ?? 'realtime error');
      };

      // 4) SDP exchange
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${MODEL}`, {
        method: 'POST', body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      });
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    },

    sendTextHint(text) {
      // couple vision to deixis: show the latest annotated frame right before the hint lands
      if (latestFrame) { sendImage(latestFrame); lastFrameSentAt = Date.now(); }
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    },

    sendVideoFrame(jpegBase64) {
      latestFrame = jpegBase64;
      const now = Date.now();
      if (now - lastFrameSentAt >= FRAME_HEARTBEAT_MS) { sendImage(jpegBase64); lastFrameSentAt = now; }
    },

    sendToolResponse(id, name, result) {
      send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(result) } });
      send({ type: 'response.create' });
    },

    close() {
      try { dc?.close(); } catch {}
      try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
      try { pc?.close(); } catch {}
      if (audioEl) { audioEl.srcObject = null; audioEl = null; }
      pc = null; dc = null;
    },
  };
}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run lint && npm run build`
Expected: PASS (provider not wired into the UI yet).

- [ ] **Step 4: Commit**

```bash
git add src/voice/openai.ts
git commit -m "feat(voice): OpenAIRealtimeProvider (WebRTC) with sparse vision frames"
```

---

## Task 7: The dropdown + provider selection

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add provider state + ref mirror**

Near the `honestMode` state (~line 325):

```ts
import { createOpenAIRealtimeProvider } from './voice/openai';
import type { ProviderKind } from './voice/types';
const [voiceBackend, setVoiceBackend] = useState<ProviderKind>('gemini');
const voiceBackendRef = useRef<ProviderKind>(voiceBackend);
useEffect(() => { voiceBackendRef.current = voiceBackend; if (isLive && providerRef.current) { addLog('info', `Switching backend to ${voiceBackend} — reconnecting...`); providerRef.current.close(); setTimeout(() => startLiveSession(), 800); } }, [voiceBackend]);
```

- [ ] **Step 2: Select the provider in `startLiveSession`**

Replace the `providerRef.current = createGeminiProvider(...)` line from Task 4 with:

```ts
providerRef.current = voiceBackendRef.current === 'openai'
  ? createOpenAIRealtimeProvider()
  : createGeminiProvider(process.env.GEMINI_API_KEY!);
const voice = voiceBackendRef.current === 'openai' ? 'marin' : 'Zephyr';
await providerRef.current.connect({ instructions: buildInstructions(honestModeRef.current), tools: VOICE_TOOLS, voice }, { /* same callbacks as Task 4 */ });
```

- [ ] **Step 3: Add the dropdown UI**

In the Session Controls box (just below the Honest-mode toggle button, ~line 2480), add:

```tsx
<div className="w-full mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border bg-[var(--inner-box-bg)] border-[var(--card-border)]">
  <span className="text-[12px] font-bold text-[var(--text-primary)]">Voice backend</span>
  <select
    value={voiceBackend}
    onChange={(e) => setVoiceBackend(e.target.value as ProviderKind)}
    disabled={isLive && !providerRef.current}
    className="text-[12px] font-mono bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg px-2 py-1 text-[var(--text-primary)]"
  >
    <option value="gemini">Gemini</option>
    <option value="openai">RTV2 (OpenAI Realtime)</option>
  </select>
</div>
```

- [ ] **Step 4: Type-check, build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual A/B check (the payoff)**

With both `GEMINI_API_KEY` and `OPENAI_API_KEY` set:
1. Default (Gemini): run S1 (London Eye → acts, speaks) and S2 (St Pancras → asks).
2. Switch the dropdown to **RTV2**, confirm it reconnects (debug log), then re-run S1 and S2 — confirm it **speaks**, hints appear in the debug panel, and a tool call fires.
3. **Vision check on RTV2:** run S4 ("from here to there", two markers) and confirm the model resolves the two endpoints (frames are reaching it). Watch the network tab to confirm only the ephemeral token — never `OPENAI_API_KEY` — leaves the browser.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(voice): backend dropdown (Gemini / RTV2) with reconnect"
```

---

## Task 8: README + finalize

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the backend switch**

Add a short subsection under the honest-mode section: a "Voice backend" note explaining the dropdown, that both speak, that `OPENAI_API_KEY` must be set in `.env.local` for RTV2, and that the key stays server-side (ephemeral tokens). Mention the known hint-timing caveat (the two backends may not feel identical).

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add README.md
git commit -m "docs: document the Gemini/RTV2 voice backend switch"
```

- [ ] **Step 3: Push**

```bash
git push -u origin voice-backend-switch
```

---

## Self-review notes (coverage vs spec)
- Interface (`VoiceProvider`, `sendVideoFrame`) → Task 1. ✓
- Provider-agnostic layer (instructions, tools, hint logic, tool switch) → Tasks 2–3. ✓
- GeminiProvider + re-enabled voice → Task 4. ✓
- Ephemeral token endpoint, key server-side → Task 5. ✓
- OpenAIRealtimeProvider WebRTC + sparse/deixis-coupled vision → Task 6. ✓
- Dropdown + reconnect → Task 7. ✓
- Vision parity verification (S4 on both) → Task 7 Step 5. ✓
- Hint-timing risk: surfaced in spec; validated live in Task 7; tunable via `FRAME_HEARTBEAT_MS` and the deixis-coupling in `openai.ts`.

## Known unknowns to resolve during execution (do not skip the WebFetch steps)
- Exact OpenAI session-create endpoint/field names (Task 5 Step 1).
- Exact Realtime WebRTC SDP URL, data-channel name, `input_image` shape, and event type names (Task 6 Step 1).
- Whether `session.update` is needed in addition to session-create config (kept as belt-and-suspenders).
