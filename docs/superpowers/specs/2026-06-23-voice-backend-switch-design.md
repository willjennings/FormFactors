# Pluggable Voice Backend: Gemini ↔ RTV2 (OpenAI Realtime)

**Date:** 2026-06-23
**Status:** Approved — ready for implementation plan
**Builds on:** the `honest-mode` branch (this feature wraps the existing honest-mode logic; it must be based on that branch, not `main`).

## Context & problem
`AIPointerRemix` runs its point-and-speak interaction on a single voice backend — Google's
**Gemini Live API** (`@google/genai` `ai.live.connect`), wired inline in `startLiveSession`
(`src/App.tsx`). We want to **compare voice experiences** by running the *same* honest-mode interaction
on **OpenAI's Realtime API ("RTV2")** as an alternative backend, selectable from a dropdown.

The honest-mode logic (confidence-carrying hints, the system prompt, the tool router, marker/proposal/
share rendering, the S1–S7 scenarios) must remain **unchanged and shared** — only the voice backend
underneath swaps.

## Goals
- A dropdown that switches the live session between **Gemini** and **RTV2 (OpenAI Realtime)**.
- Both backends **speak** (re-enable Gemini voice playback) so the comparison is fair.
- **Vision parity:** the model "sees" the annotated scene (photos/map + gold M1/M2 markers) on *both*
  backends, so marker-based spatial reasoning ("from here to there", "from M1 to M2") works on each.
- The honest-mode behavior layer is provider-agnostic — written once, driven by either backend.
- OpenAI key stays **server-side**; the browser uses short-lived ephemeral tokens.

## Non-goals
- No change to honest-mode behavior, prompts, tools, or scenarios.
- No new honest-mode capabilities.
- Not aiming for byte-identical feel across backends on pass one (see hint-timing risk).

## Architecture

### Module layout
```
src/voice/
  types.ts     — VoiceProvider interface + config/callback types (provider-agnostic)
  gemini.ts    — GeminiProvider: wraps today's ai.live.connect code + re-enabled playback
  openai.ts    — OpenAIRealtimeProvider: new WebRTC adapter
server.ts      — + POST /api/realtime/session (mints an OpenAI ephemeral token)
src/App.tsx    — builds prompt + tools once; holds providerRef + the backend dropdown
```
Moving the two adapters into `src/voice/` keeps the ~2,800-line `App.tsx` from growing a second
tangled code path.

### The interface — the entire contract between the app and any backend
```ts
type VoiceTool = { name: string; description: string; parameters: JSONSchema };
interface VoiceSessionConfig { instructions: string; tools: VoiceTool[]; voice?: string }
interface VoiceCallbacks {
  onOpen(): void;
  onClose(): void;
  onError(message: string): void;
  onInputTranscript(text: string, isFinal: boolean): void;  // drives keyword/cursor/hint logic
  onToolCall(call: { id: string; name: string; args: any }): void;  // drives the tool switch
}
interface VoiceProvider {
  connect(config: VoiceSessionConfig, cb: VoiceCallbacks): Promise<void>;
  sendTextHint(text: string): void;          // inject context; MUST NOT force a model response
  sendVideoFrame(jpegBase64: string): void;  // current annotated scene (markers); cadence is the adapter's call
  sendToolResponse(id: string, name: string, result: any): void;
  close(): void;
}
```
`sendVideoFrame` is called by the app's existing ~150ms frame loop at a fixed cadence; **each adapter
decides what to do with it** (Gemini streams every frame; OpenAI samples — see Vision parity).

### Provider-agnostic layer (what stays put in App.tsx)
- The system prompt builder (`POINTING_TRUTH_CONFIDENT/HONEST`, `CONFIDENT/HONEST_VERB_RULES`,
  `systemInstruction`) → produces `config.instructions`.
- The tool definitions → produced once in the neutral `VoiceTool[]` shape; each adapter translates
  (Gemini `Type.*`, OpenAI `function` tools).
- The confidence/hint construction (cursor hit-test, `computePointingConfidence`) — unchanged; it now
  calls `providerRef.current.sendTextHint(...)` instead of `sessionRef.current.sendRealtimeInput({text})`.
- The tool-call switch (`update_map`, `show_directions`, `explain`, `synthesize`, `share`) — unchanged;
  fed by `onToolCall`, responds via `providerRef.current.sendToolResponse(...)`.
- Marker rendering, proposal card, share card, the S1–S7 task cards — unchanged.

**App.tsx call-site changes (the only edits to existing logic):** route the existing `sessionRef.current.*`
sites through the interface — text hints (deixis hints, `[SYSTEM UPDATE: layout]`,
`[SYSTEM: TRIP PATTERN]`, the map-pointing system message), the ~150ms annotated-frame loop
(`sendRealtimeInput({video})` → `sendVideoFrame`), `sendToolResponse`, and `close()`.

### Vision parity (how each backend "sees" the markers)
Today the app composites an offscreen canvas (the photos/map layout + gold **M1/M2** marker rings/labels)
and streams it as JPEG **video** to Gemini Live every ~150ms (`sendFrequency`). That is how the model
reads markers for spatial commands. The two backends consume this very differently:
- **Gemini (`gemini.ts`):** unchanged — forward every `sendVideoFrame` as `sendRealtimeInput({ video:
  { data, mimeType: 'image/jpeg' } })` at the current cadence.
- **OpenAI (`openai.ts`):** the Realtime API takes **discrete images**, not a video stream, so the adapter
  **buffers the latest frame** and emits it sparsely as a `conversation.item.create` `input_image`:
  (a) a low-frequency heartbeat (≈ every 1.5–2 s), and (b) **coupled to deixis** — when `sendTextHint`
  fires for a pointing hint, attach the latest buffered frame so the model sees the markers at the exact
  moment the command is interpreted. This keeps the model visually grounded without flooding the
  conversation with ~6 images/second. Cadence/coupling constants are tunable.

### OpenAI Realtime adapter (`openai.ts`, WebRTC)
Auth + connect flow:
1. Browser `POST /api/realtime/session`. `server.ts` calls OpenAI with `OPENAI_API_KEY`, passing model
   (`gpt-realtime`), `instructions`, `tools`, `voice`, input-audio transcription, and server-VAD turn
   detection → returns a short-lived ephemeral client secret.
2. Browser opens an `RTCPeerConnection`: add the mic track, create an `oai-events` data channel,
   exchange SDP with OpenAI using the ephemeral token. Remote audio track → a hidden `<audio>` element
   (this is the voice playback).
3. Data-channel event mapping:
   - `sendTextHint(text)` → `conversation.item.create` with an `input_text` item, **no** `response.create`
     (context only, mirrors Gemini's non-triggering text input).
   - `sendToolResponse(id,name,result)` → `conversation.item.create` (`function_call_output`) +
     `response.create`.
   - inbound `…input_audio_transcription.delta/.completed` → `onInputTranscript(text, isFinal)`.
   - inbound `response.function_call_arguments.done` → `onToolCall({id, name, args})`.
   - `session.update` used to set instructions/tools/voice if not fully set at session creation.

> Exact OpenAI endpoint paths and event field names will be verified against current OpenAI Realtime
> docs at implementation time (the API evolves); the mapping above is the contract, names may adjust.

### Gemini adapter (`gemini.ts`)
Lift today's `startLiveSession` body into `GeminiProvider` with minimal edits: keep its AudioContext/PCM
capture + playback, translate the neutral tools to `functionDeclarations`, and emit the normalized
callbacks (`onInputTranscript` from `inputAudioTranscription`, `onToolCall` from `msg.toolCall`).
**Re-enable voice playback** (the scheduler at `audioQueueRef`/`nextStartTimeRef` already exists; the
"playback removed" step is restored) so Gemini speaks too.

### server.ts — ephemeral token endpoint
Add `POST /api/realtime/session`: reads `OPENAI_API_KEY` from env, requests an ephemeral Realtime session
from OpenAI with the session config, returns the ephemeral token JSON to the browser. The key never
reaches the client. Returns a clear error if `OPENAI_API_KEY` is unset (the dropdown surfaces a
"set OPENAI_API_KEY" state).

### The dropdown switch (UX + state)
- A labeled `<select>` in the Session Controls box, beside the Honest-mode toggle:
  **Voice backend: `Gemini` / `RTV2 (OpenAI Realtime)`**.
- State `provider: 'gemini' | 'openai'` + `providerRef` (mirrors the honest-mode toggle pattern).
- Default `gemini` → nothing changes until the user switches.
- Switching while live closes the current provider and reconnects on the new one (same reconnect pattern
  as the honest-mode toggle); the dropdown is disabled mid-connect.

## Risks & mitigations
- **Hint timing (primary risk):** OpenAI transcription may arrive at end-of-turn vs Gemini's mid-speech
  partials, desyncing the cursor↔hint correlation. *Mitigation:* use OpenAI streaming transcription
  deltas; re-anchor each hint to the cursor position captured when the keyword is detected (the hint text
  already carries the resolved landmark, so the cursor snapshot is what matters). Expect tuning; the two
  backends may not feel identical on pass one.
- **Tool-call shape drift:** OpenAI function-call args arrive as a JSON string to parse vs Gemini's
  structured `fc.args`. The adapter normalizes both to `onToolCall({args})` as a parsed object.
- **WebRTC setup fragility:** mic permissions, SDP exchange, autoplay policy for the `<audio>` element.
  Handle errors through `onError` and surface them in the existing error UI.
- **Vision on OpenAI (second-biggest risk):** Realtime image input support, the right send cadence, added
  latency, and token cost of frames. Mitigation: sparse heartbeat + deixis-coupled frames (above), keep
  frames small (the existing JPEG is already low-res/quality 0.6), and verify image-in-Realtime against
  current OpenAI docs at implementation time. If continuous-enough vision proves impractical, fall back to
  deixis-coupled snapshots only — the text hints already carry the resolved landmark, so spatial commands
  still function, just with less live visual grounding.

## Verification / testing
- `npm run lint` (`tsc --noEmit`) clean and `npm run build` green after each step.
- Live A/B: flip the dropdown and re-run **S1** (London Eye, acts immediately) and **S2** (St Pancras,
  asks) on **each** backend; confirm both speak.
- **Vision check on both backends:** run **S4** ("from here to there", two markers) and confirm the model
  resolves the markers / endpoints — i.e., the annotated frame is actually reaching and being used by each
  model. On OpenAI, confirm frames are sent (debug panel) and not flooding.
- Debug panel: confirm on RTV2 that input transcripts arrive, hints are sent, and tool calls
  (`update_map`/`show_directions`/`explain`/`synthesize`/`share`) fire and get responses.
- Confirm the OpenAI key never appears in browser network traffic (only the ephemeral token does).

## Out of scope (future follow-ups)
- Per-backend voice pickers / model selection beyond a sensible default.
- Persisting the dropdown choice across reloads.
- Full feel-parity tuning of hint timing beyond "works and is demoable."
