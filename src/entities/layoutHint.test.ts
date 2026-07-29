import { describe, it, expect } from 'vitest';
import { buildLayoutHint } from './layoutHint';
import { asId, type SceneEntity } from './registry';

const ent = (id: string, bbox: [number, number, number, number], perceivedLabel?: string): SceneEntity =>
  ({ id: asId(id), title: id, url: '', category: 'content', aliases: [], bbox, perceivedLabel });

const ON_SCREEN: SceneEntity[] = [
  ent('word-1', [102.4, 35.63, 165.2, 449.38]),
  ent('word-4', [173, 35.63, 635, 449.38]),
];
const ZEROED: SceneEntity[] = [ent('word-1', [0, 0, 0, 0]), ent('word-4', [0, 0, 0, 0])];

describe('buildLayoutHint', () => {
  it('rounds each bbox and names the entity as the user sees it', () => {
    const hint = buildLayoutHint([ent('word-1', [102.4, 35.63, 165.2, 449.38], 'the ribbon')], 'open');
    expect(hint).toContain('the ribbon: [102, 36, 165, 449]');
  });

  it('defines the zero bbox as "not on screen" and forbids resolving to it', () => {
    const hint = buildLayoutHint(ZEROED, 'minimized');
    // The encoding is stated, not left for the model to infer — resolveAt.ts guards the app
    // against the same zeroes, so the message must carry the same rule.
    expect(hint).toContain('[0, 0, 0, 0]');
    expect(hint).toMatch(/NOT on screen/);
    expect(hint).toMatch(/NEVER resolve/);
  });

  it('no longer claims every listed element is on screen', () => {
    expect(buildLayoutHint(ZEROED, 'closed')).not.toContain('The on-screen program elements are at these coordinates');
  });

  it('distinguishes a MINIMIZED program window from a CLOSED one', () => {
    const minimized = buildLayoutHint(ZEROED, 'minimized');
    const closed = buildLayoutHint(ZEROED, 'closed');
    expect(minimized).not.toEqual(closed);
    expect(minimized).toContain('PROGRAM WINDOW: minimized');
    expect(minimized).toMatch(/restore it from the bar/);
    expect(closed).toContain('PROGRAM WINDOW: closed');
    expect(closed).not.toMatch(/restore it from the bar/);
  });

  it('says nothing about the program window while it is open — terse is the point', () => {
    const hint = buildLayoutHint(ON_SCREEN, 'open');
    expect(hint).not.toContain('PROGRAM WINDOW');
    expect(hint).toContain('word-1: [102, 36, 165, 449]\nword-4: [173, 36, 635, 449]');
  });

  it('keeps the silence instruction and the pointing contract', () => {
    for (const st of ['open', 'minimized', 'closed'] as const) {
      const hint = buildLayoutHint(ON_SCREEN, st);
      expect(hint.startsWith('[SYSTEM UPDATE:')).toBe(true);
      expect(hint.endsWith('DO NOT RESPOND TO THIS UPDATE. STAY SILENT UNTIL THE USER SPEAKS.]')).toBe(true);
      expect(hint).toContain('what the user is pointing at when they say "this" or "here"');
    }
  });

  it('an empty scene still produces a well-formed message', () => {
    const hint = buildLayoutHint([], 'closed');
    expect(hint).toContain('PROGRAM WINDOW: closed');
    expect(hint.endsWith('STAY SILENT UNTIL THE USER SPEAKS.]')).toBe(true);
  });
});
