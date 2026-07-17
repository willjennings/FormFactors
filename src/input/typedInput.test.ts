import { describe, it, expect } from 'vitest';
import { parseTypedSubmit } from './typedInput';

describe('parseTypedSubmit', () => {
  it('trims and passes through normal commands', () => {
    expect(parseTypedSubmit('  make this bold  ')).toBe('make this bold');
  });
  it('returns empty string for empty/whitespace input', () => {
    expect(parseTypedSubmit('')).toBe('');
    expect(parseTypedSubmit('   ')).toBe('');
  });
  it('caps at 500 characters', () => {
    expect(parseTypedSubmit('x'.repeat(600))).toHaveLength(500);
  });
});
