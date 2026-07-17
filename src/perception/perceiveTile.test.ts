import { describe, it, expect } from 'vitest';
import { perceivePrompt, cleanPerceivedLabel, resolveTileName, perceiveTileLabel } from './perceiveTile';
import type { PerceivedCache } from './perceiveTile';

describe('perceivePrompt', () => {
  it('asks for a short noun phrase', () => {
    const p = perceivePrompt();
    expect(p.toLowerCase()).toContain('noun phrase');
    expect(p.length).toBeGreaterThan(10);
  });
});

describe('cleanPerceivedLabel', () => {
  it('strips quotes, trailing punctuation, and a leading article', () => {
    expect(cleanPerceivedLabel('  "A window with curtains."  ')).toBe('window with curtains');
  });
  it('collapses whitespace and caps at 6 words', () => {
    expect(cleanPerceivedLabel('The  San Francisco skyline at dusk over the bay'))
      .toBe('San Francisco skyline at dusk over');
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(cleanPerceivedLabel('')).toBe('');
    expect(cleanPerceivedLabel('   ')).toBe('');
  });
});

describe('resolveTileName', () => {
  const cache: PerceivedCache = {
    'u-done': { status: 'done', label: 'window with curtains' },
    'u-pending': { status: 'pending' },
    'u-failed': { status: 'failed' },
    'u-empty': { status: 'done', label: '' },
  };
  it('returns the perceived label when done and non-empty', () => {
    expect(resolveTileName('Word Ribbon', 'u-done', cache)).toBe('window with curtains');
  });
  it('falls back to the title when pending, failed, empty, or absent', () => {
    expect(resolveTileName('Word Ribbon', 'u-pending', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-failed', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-empty', cache)).toBe('Word Ribbon');
    expect(resolveTileName('Word Ribbon', 'u-missing', cache)).toBe('Word Ribbon');
  });
});

describe('perceiveTileLabel', () => {
  const stub = (text: string) => ({
    models: { generateContent: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) },
  });

  it('reads the model text and returns a cleaned label', async () => {
    const label = await perceiveTileLabel(stub('  "A window with curtains."  ') as any, 'BASE64');
    expect(label).toBe('window with curtains');
  });

  it('returns empty string when the response has no text', async () => {
    const noText = { models: { generateContent: async () => ({ candidates: [{ content: { parts: [] } }] }) } };
    expect(await perceiveTileLabel(noText as any, 'BASE64')).toBe('');
  });
});
