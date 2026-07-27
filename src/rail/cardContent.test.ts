import { describe, it, expect } from 'vitest';
import { cardTitle, cardParagraphs } from './cardContent';
import type { RailCard } from './types';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'active', ...over } as RailCard);

describe('cardParagraphs', () => {
  it('answer/orient/caution/check carry their text', () => {
    expect(cardParagraphs(card({ t: 'answer', text: 'The Save As button.' })))
      .toEqual(['The Save As button.']);
  });
  it('recap yields ONE PARAGRAPH PER LINE — each line stays separately pointable', () => {
    expect(cardParagraphs(card({ t: 'recap', lines: ['Opened the deck.', 'Retitled slide 1.'] })))
      .toEqual(['Opened the deck.', 'Retitled slide 1.']);
  });
  it('concept yields front, back and analogy as separate paragraphs', () => {
    expect(cardParagraphs(card({ t: 'concept', front: 'What is a cell?', back: 'One box.', analogy: 'Like a mailbox.' })))
      .toEqual(['What is a cell?', 'One box.', 'Like a mailbox.']);
  });
  it('concept omits an absent analogy rather than emitting a blank paragraph', () => {
    expect(cardParagraphs(card({ t: 'concept', front: 'Q', back: 'A' }))).toEqual(['Q', 'A']);
  });
  it('do carries its text and result', () => {
    expect(cardParagraphs(card({ t: 'do', text: 'Click Save As.', result: 'The dialog opens.' })))
      .toEqual(['Click Save As.', 'The dialog opens.']);
  });
  it('try carries its prompt and notice', () => {
    expect(cardParagraphs(card({ t: 'try', prompt: 'Now you try.', notice: 'The icon changes.' })))
      .toEqual(['Now you try.', 'The icon changes.']);
  });
  it('an empty card yields nothing — the pin builder refuses on this', () => {
    expect(cardParagraphs(card({ t: 'answer' }))).toEqual([]);
    expect(cardParagraphs(card({ t: 'recap', lines: [] }))).toEqual([]);
  });
  it('drops blank and whitespace-only entries', () => {
    expect(cardParagraphs(card({ t: 'recap', lines: ['Real line.', '   ', ''] })))
      .toEqual(['Real line.']);
  });
});

describe('cardTitle', () => {
  it('is the first paragraph when it is short', () => {
    expect(cardTitle(card({ t: 'answer', text: 'The Save As button.' }))).toBe('The Save As button.');
  });
  it('truncates at 60 chars on a word boundary with an ellipsis', () => {
    const long = 'Revenue reached twelve million dollars at an eighteen percent margin this quarter';
    const out = cardTitle(card({ t: 'answer', text: long }));
    expect(out.length).toBeLessThanOrEqual(61);        // 60 + the ellipsis character
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe('Revenue reached twelve million dollars at an eighteen…');
    expect(long.startsWith(out.slice(0, -1))).toBe(true); // never invents words
  });
  it('falls back to the card type when the card has no text', () => {
    expect(cardTitle(card({ t: 'caution' }))).toBe('Caution card');
  });
});
