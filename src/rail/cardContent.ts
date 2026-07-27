// The SINGLE definition of a card's text. The entity deriver builds aliases from it and the pin
// builder turns it into artifact content — if either reimplemented the extraction, a pinned
// artifact could disagree with the card the user was looking at when they pinned it.
import type { RailCard } from './types';

const TITLE_MAX = 60;

function clean(parts: (string | undefined)[]): string[] {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean);
}

export function cardParagraphs(card: RailCard): string[] {
  switch (card.t) {
    case 'recap':
      // One paragraph per line: preserves the structure the model authored, keeps each line
      // separately pointable and refinable, and gives the deferred annotation phase line-level
      // parts to anchor marks to.
      return clean(card.lines ?? []);
    case 'concept':
      return clean([card.front, card.back, card.analogy]);
    case 'do':
      return clean([card.text, card.result]);
    case 'try':
      return clean([card.prompt, card.notice]);
    default:
      return clean([card.text]);
  }
}

/** First paragraph, truncated on a word boundary. Never invents words that were not there. */
export function cardTitle(card: RailCard): string {
  const first = cardParagraphs(card)[0];
  if (!first) return `${card.t.charAt(0).toUpperCase()}${card.t.slice(1)} card`;
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
