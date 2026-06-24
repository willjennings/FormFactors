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
  /** The model started a response turn (used to clear pending UI). */
  onResponseStart?: () => void;
  /** Raw model audio chunk (base64 PCM). Providers with native audio playback (WebRTC) omit this. */
  onModelAudio?: (base64: string) => void;
  /** The model's turn was interrupted (barge-in). */
  onInterrupted?: () => void;
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

export type ProviderKind = 'gemini' | 'openai' | 'azure';
