import { describe, it, expect } from 'vitest';
import { azureRealtimeUrl } from './azureUrl';

describe('azureRealtimeUrl', () => {
  it('builds the GA realtime URL from a bare resource endpoint', () => {
    expect(azureRealtimeUrl('https://res.services.ai.azure.com', 'gpt-realtime-1.5', 'k'))
      .toBe('wss://res.services.ai.azure.com/openai/v1/realtime?model=gpt-realtime-1.5&api-key=k');
  });
  it('strips a Foundry project path — the 1006 regression', () => {
    expect(azureRealtimeUrl('https://res.services.ai.azure.com/api/projects/proj', 'd', 'k'))
      .toBe('wss://res.services.ai.azure.com/openai/v1/realtime?model=d&api-key=k');
  });
  it('tolerates trailing slashes and missing protocol; encodes params', () => {
    expect(azureRealtimeUrl('res.services.ai.azure.com/', 'my dep', 'a&b'))
      .toBe('wss://res.services.ai.azure.com/openai/v1/realtime?model=my%20dep&api-key=a%26b');
  });
});
