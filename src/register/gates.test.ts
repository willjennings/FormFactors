import { describe, it, expect } from 'vitest';
import { visibleSuggestions } from './gates';

const CHIPS = [{ key: 'a' }, { key: 'b' }];

describe('visibleSuggestions', () => {
  it('none → empty (kills the chip row AND quick-fire, whose count comes from the same list)', () => {
    expect(visibleSuggestions(CHIPS, 'none', 0)).toEqual([]);
    expect(visibleSuggestions(CHIPS, 'none', 2)).toEqual([]);
  });
  it('grounded → chips only while the grounding buffer is non-empty', () => {
    expect(visibleSuggestions(CHIPS, 'grounded', 0)).toEqual([]);
    expect(visibleSuggestions(CHIPS, 'grounded', 1)).toEqual(CHIPS);
  });
  it('full → always', () => {
    expect(visibleSuggestions(CHIPS, 'full', 0)).toEqual(CHIPS);
  });
});
