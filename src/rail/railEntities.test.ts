import { describe, it, expect } from 'vitest';
import { railEntities } from './railEntities';
import { projectedRailState } from './railStore';
import type { Rail, RailCard } from './types';
import type { RailState } from './railStore';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'pending', ...over } as RailCard);

const rail = (cards: RailCard[]): Rail =>
  ({ seq: 'Explain Save', cards, activeIndex: 0, startedAt: 1 });

const st = (r: Rail): RailState => ({ rail: r, openWhy: null, flipped: [] });

describe('railEntities', () => {
  it('mints one 1-based, sub:true entity per visible card', () => {
    const es = railEntities(st(rail([
      card({ text: 'The Save As button opens a dialog.' }),
      card({ t: 'caution', text: 'This overwrites the original file.' }),
    ])), {});
    expect(es.map((e) => e.id)).toEqual(['rail-explain-save-c1', 'rail-explain-save-c2']);
    expect(es.every((e) => e.sub === true)).toBe(true);
  });

  it('numbers by index in rail.cards, NOT by position in the visible window', () => {
    // visibleCards shows a sliding window around the active card. With 6 cards and the 5th
    // active, the window starts partway in — the ids must still name the real card numbers,
    // or "card 5" would mean a different card each time one completes.
    const cards = Array.from({ length: 6 }, (_, i) => card({ text: `Line ${i + 1}` }));
    const r: Rail = { seq: 'Long', cards, activeIndex: 4, startedAt: 1 };
    const ids = railEntities(st(r), {}).map((e) => e.id);
    expect(ids).toContain('rail-long-c5');
    expect(ids).not.toContain('rail-long-c1');   // scrolled out of the window
  });

  it('aliases a card by number, ordinal and kicker', () => {
    const e = railEntities(st(rail([
      card({ text: 'first' }),
      card({ t: 'caution', text: 'This overwrites the original file.' }),
    ])), {})[1];
    expect(e.aliases).toContain('card 2');
    expect(e.aliases).toContain('second card');
    expect(e.aliases).toContain('the caution card');
  });

  it('aliases by first words so "the part about overwriting" resolves', () => {
    const e = railEntities(st(rail([card({ text: 'This overwrites the original file.' })])), {})[0];
    expect(e.aliases.some((a) => a.includes('overwrites'))).toBe(true);
  });

  it('drops a one-word first-words alias — the exact-match branch would ground it falsely', () => {
    // registry.ts's MIN_OVERLAP_TOKENS floor guards only the bare-overlap fallback; an exact
    // match scores 1000 regardless. Same guard as artifact paragraphs.
    const e = railEntities(st(rail([card({ text: 'Saved' })])), {})[0];
    expect(e.aliases).not.toContain('saved');
    expect(e.aliases).toContain('card 1');
  });

  it('degrades to a zero bbox when a card was not measured', () => {
    expect(railEntities(st(rail([card({ text: 'unmeasured' })])), {})[0].bbox).toEqual([0, 0, 0, 0]);
  });

  it('reads a measured bbox by the card entity id', () => {
    const es = railEntities(st(rail([card({ text: 'measured' })])), { 'rail-explain-save-c1': [1, 2, 3, 4] });
    expect(es[0].bbox).toEqual([1, 2, 3, 4]);
  });

  it('is empty when no rail is showing', () => {
    expect(railEntities(null, {})).toEqual([]);
  });
});

describe('projectedRailState', () => {
  const respond = rail([card({ text: 'from the model' })]);
  const teaching = rail([card({ text: 'from a sequence' })]);

  it('prefers the respond rail', () => {
    expect(projectedRailState(st(respond), teaching)?.rail?.cards[0].text).toBe('from the model');
  });
  it('falls back to the teaching rail with no why/flip state', () => {
    const p = projectedRailState({ rail: null, openWhy: 3, flipped: [1] }, teaching);
    expect(p?.rail?.cards[0].text).toBe('from a sequence');
    expect(p?.openWhy).toBeNull();
    expect(p?.flipped).toEqual([]);
  });
  it('is null when neither is present', () => {
    expect(projectedRailState({ rail: null, openWhy: null, flipped: [] }, null)).toBeNull();
  });
});
