import { describe, it, expect } from 'vitest';
import { advanceOnClick } from './advanceOnClick';

describe('advanceOnClick — advancement authority (Contract A)', () => {
  it('demo (no agent): clicks pace any sequence', () => {
    expect(advanceOnClick(false, 'guide')).toBe(true);
    expect(advanceOnClick(false, 'teach')).toBe(true);
    expect(advanceOnClick(false, null)).toBe(true);
  });

  it('live guide: agent-paced via teach_step_done — clicks must not advance', () => {
    expect(advanceOnClick(true, 'guide')).toBe(false);
  });

  it('live teach: the user performs the steps — clicks advance', () => {
    expect(advanceOnClick(true, 'teach')).toBe(true);
  });

  it('live with no active sequence: nothing for a click to advance', () => {
    expect(advanceOnClick(true, null)).toBe(false);
  });
});
