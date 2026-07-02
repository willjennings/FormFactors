// Pure builders for the realtime wire frames used by sendUserText.
// openai.ts and azure.ts speak the same protocol; gemini uses client-content turns.

export function userTextItemFrame(text: string) {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  };
}

export function responseCreateFrame() {
  return { type: 'response.create' };
}

export function geminiUserTurns(text: string) {
  return { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true };
}
