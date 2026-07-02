import { describe, it, expect, beforeEach } from 'vitest';
import { ReferentRegistry } from './referents';
import type { EntityId } from './entities/registry';

const id = (s: string) => s as EntityId;

describe('ReferentRegistry', () => {
  let r: ReferentRegistry;
  beforeEach(() => { r = new ReferentRegistry(); });

  it('stores and refreshes the optional entity id', () => {
    r.note('Save button', 'pointed', id('word-2'));
    expect(r.recent()[0]).toMatchObject({ name: 'Save button', kind: 'pointed', id: 'word-2' });
    r.note('Save button', 'pointed', id('word-2')); // dedupe path refreshes
    expect(r.recent()).toHaveLength(1);
    expect(r.recent()[0].id).toBe('word-2');
  });

  it('id is optional — word/doc referents without entities still work', () => {
    r.note('"beam"', 'pointed');
    r.note('Chart', 'created');
    expect(r.recent().map(x => x.id ?? null)).toEqual([null, null]);
  });

  it('resolveAnaphora still returns names (ported self-checks)', () => {
    r.note('Save button', 'pointed', id('word-2'));
    r.note('Chart', 'created');
    expect(r.resolveAnaphora('make that bold')).toBe('Save button');
    expect(r.resolveAnaphora('send the chart I just made')).toBe('Chart');
    expect(r.resolveAnaphora('what time is it')).toBeNull(); // question guard
    expect(r.resolveAnaphora('open the spreadsheet')).toBeNull();
  });

  it('promptContext renders names', () => {
    r.note('Chart', 'created');
    expect(r.promptContext()).toContain('Chart (created');
  });
});
