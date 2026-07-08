import { describe, it, expect } from 'vitest';
import { withTrafficCount } from './traffic';
import type { VoiceProvider } from '../voice/types';

const fake = (log: string[]): VoiceProvider => ({
  connect: async () => {}, close: () => {},
  sendTextHint: () => log.push('hint'), sendUserText: () => log.push('text'),
  sendVideoFrame: () => log.push('frame'), sendToolResponse: () => log.push('tool'),
});

describe('withTrafficCount', () => {
  it('counts frames and hints/texts, forwards every call, leaves tool responses uncounted', () => {
    const log: string[] = [];
    let latest = { frames: 0, hints: 0 };
    const p = withTrafficCount(fake(log), t => { latest = t; });
    p.sendVideoFrame('f'); p.sendVideoFrame('f'); p.sendTextHint('h'); p.sendUserText('u'); p.sendToolResponse('1', 'n', {});
    expect(latest).toEqual({ frames: 2, hints: 2 });
    expect(log).toEqual(['frame', 'frame', 'hint', 'text', 'tool']);
  });
});
