import { describe, it, expect } from 'vitest';
import { userTextItemFrame, responseCreateFrame, geminiUserTurns, imageItemFrame } from './frames';

describe('realtime frames', () => {
  it('builds the user input_text item frame (openai/azure protocol)', () => {
    expect(userTextItemFrame('make this bold')).toEqual({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'make this bold' }] },
    });
  });
  it('builds the response.create frame', () => {
    expect(responseCreateFrame()).toEqual({ type: 'response.create' });
  });
  it('builds the gemini client-content turns (turnComplete forces a response)', () => {
    expect(geminiUserTurns('undo that')).toEqual({
      turns: [{ role: 'user', parts: [{ text: 'undo that' }] }],
      turnComplete: true,
    });
  });
});

describe('imageItemFrame (R1 #3 — one builder for the openai/azure vision frame)', () => {
  it('wraps the jpeg as a data-url input_image user item', () => {
    const f = imageItemFrame('QUJD');
    expect(f).toEqual({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD' }] },
    });
  });
});
