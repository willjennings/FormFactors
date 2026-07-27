import { describe, it, expect } from 'vitest';
import { buildCombineRequest } from './combineRequest';
import type { TrayMember } from './combineTray';

const m = (sourceId: string, title: string): TrayMember =>
  ({ entityId: `e-${sourceId}`, sourceId, title, color: '#000' });

describe('buildCombineRequest', () => {
  const tray = [m('word', 'Quarterly report'), m('excel', 'Q3 numbers')];

  it('names the exact source ids and kind in the hint', () => {
    const { hint } = buildCombineRequest(tray, 'doc');
    expect(hint).toContain('sources=["word","excel"]');
    expect(hint).toContain('kind="doc"');
  });

  it('the hint tells the model to read before authoring', () => {
    expect(buildCombineRequest(tray, 'doc').hint.toLowerCase()).toContain('read');
  });

  it('the user turn reads naturally from the titles, not the ids', () => {
    const { userText } = buildCombineRequest(tray, 'doc');
    expect(userText).toBe('Combine Quarterly report and Q3 numbers into a doc.');
    expect(userText).not.toContain('word');
  });

  it('three or more members read with commas and a final and', () => {
    const { userText } = buildCombineRequest([...tray, m('a1', 'Trip brief')], 'widget');
    expect(userText).toBe('Combine Quarterly report, Q3 numbers and Trip brief into a widget.');
  });

  it('preserves tray order in both the hint and the sentence', () => {
    const { hint, userText } = buildCombineRequest([m('a1', 'B'), m('word', 'A')], 'doc');
    expect(hint).toContain('sources=["a1","word"]');
    expect(userText).toBe('Combine B and A into a doc.');
  });
});
