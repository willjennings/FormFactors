import { describe, it, expect } from 'vitest';
import { evaluatePredicate } from './predicate';
import { initialMockDoc, applyAction } from '../scenarios';

describe('evaluatePredicate', () => {
  it('resolves top-level and dotted paths', () => {
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'saved', equals: false })).toBe(true);
    const saved = applyAction(initialMockDoc('word'), 'save_file', {});
    expect(evaluatePredicate(saved, { path: 'saved', equals: true })).toBe(true);
    expect(evaluatePredicate(initialMockDoc('excel'), { path: 'cells.A1', equals: '10' })).toBe(true);
  });
  it('returns null for unknown paths (never throws)', () => {
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'cells.A1', equals: '10' })).toBeNull();
    expect(evaluatePredicate(initialMockDoc('word'), { path: 'a.b.c.d', equals: 1 })).toBeNull();
  });
});
