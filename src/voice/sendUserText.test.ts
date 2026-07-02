import { describe, it, expect } from 'vitest';
import { createGeminiProvider } from './gemini';
import { createOpenAIRealtimeProvider } from './openai';
import { createAzureRealtimeProvider } from './azure';

// sendUserText must be a null-safe no-op before/without a live session (same
// contract as sendTextHint). The factories build closures without touching the
// network, so constructing them in node is safe; connect() is never called.
describe('sendUserText before connect', () => {
  it('gemini: no-throw when session is null', () => {
    expect(() => createGeminiProvider('test-key').sendUserText('hi')).not.toThrow();
  });
  it('openai: no-throw when data channel is absent', () => {
    expect(() => createOpenAIRealtimeProvider().sendUserText('hi')).not.toThrow();
  });
  it('azure: no-throw when websocket is absent', () => {
    expect(() => createAzureRealtimeProvider('https://x.example', 'dep', 'key', 'trans').sendUserText('hi')).not.toThrow();
  });
});
