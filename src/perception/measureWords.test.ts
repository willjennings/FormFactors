import { describe, it, expect } from 'vitest';
import { tokenizeWords, rectToBox } from './measureWords';

describe('tokenizeWords', () => {
  it('splits into non-whitespace runs with exact char offsets', () => {
    expect(tokenizeWords('The quarterly report')).toEqual([
      { text: 'The', charStart: 0, charEnd: 3 },
      { text: 'quarterly', charStart: 4, charEnd: 13 },
      { text: 'report', charStart: 14, charEnd: 20 },
    ]);
  });

  it('handles padded/irregular whitespace and keeps punctuation attached', () => {
    expect(tokenizeWords('  Hello,  world!  ')).toEqual([
      { text: 'Hello,', charStart: 2, charEnd: 8 },
      { text: 'world!', charStart: 10, charEnd: 16 },
    ]);
  });

  it('returns [] for empty or whitespace-only text', () => {
    expect(tokenizeWords('')).toEqual([]);
    expect(tokenizeWords('   \n  ')).toEqual([]);
  });
});

describe('rectToBox', () => {
  const plane = { top: 100, left: 200, width: 1000, height: 800 };

  it('maps a client rect into 0-1000 plane space (matches toBBox)', () => {
    // a rect flush with the plane origin, 100px wide x 80px tall
    const box = rectToBox({ top: 100, left: 200, bottom: 180, right: 300 }, plane);
    // ymin=(0/800)*1000=0, xmin=(0/1000)*1000=0, ymax=(80/800)*1000=100, xmax=(100/1000)*1000=100
    expect(box).toEqual([0, 0, 100, 100]);
  });

  it('maps an interior rect proportionally on both axes', () => {
    // rect at (left+500px, top+400px) size 100x80 within a 1000x800 plane
    const box = rectToBox({ top: 500, left: 700, bottom: 580, right: 800 }, plane);
    // ymin=(400/800)*1000=500, xmin=(500/1000)*1000=500, ymax=(480/800)*1000=600, xmax=(600/1000)*1000=600
    expect(box).toEqual([500, 500, 600, 600]);
  });
});
