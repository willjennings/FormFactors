// Rail cards as pointable entities (spec §3). A card's OWN identity — distinct from
// `card.entityId`, which is what the card POINTS AT. Conflating them is the obvious future bug.
//
// Ids are honest only relative to the current rail: cards are replaced wholesale on `rail.set`.
// No handshake is needed because no tool writes through a card id — but the caller MUST
// recompose entities on every rail change, or the registry keeps describing cards that are gone.
import { asId, normText, type SceneEntity } from '../entities/registry';
import { visibleCards, type RailState } from './railStore';
import { cardParagraphs } from './cardContent';
import type { RailCard } from './types';

type Layout = Record<string, [number, number, number, number]>;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

const KICKER: Record<RailCard['t'], string> = {
  do: 'do', answer: 'answer', orient: 'orient', check: 'check',
  caution: 'caution', concept: 'concept', try: 'try', recap: 'recap',
};

/** Slug for the rail id segment: `Explain Save` → `explain-save`. */
export function railSlug(seq: string): string {
  return normText(seq).replace(/ /g, '-') || 'rail';
}

/** First few words, for "the part about overwriting". Returns null below two tokens: a
 *  one-word alias would hit resolveEchoedTarget's exact-match branch (score 1000) regardless
 *  of the MIN_OVERLAP_TOKENS floor, which guards only the bare-overlap fallback. */
function firstWords(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 5);
  return words.length < 2 ? null : words.join(' ');
}

export function railEntities(projected: RailState | null, layout: Layout): SceneEntity[] {
  if (!projected?.rail) return [];
  const slug = railSlug(projected.rail.seq);
  return visibleCards(projected).map(({ card, index }): SceneEntity => {
    // `index` is the position in rail.cards, NOT in the visible window — visibleCards slides
    // as the rail advances, so numbering by window position would renumber every card each
    // time one completed.
    const n = index + 1;
    const id = `rail-${slug}-c${n}`;
    const fw = firstWords(cardParagraphs(card)[0] ?? '');
    const aliases = Array.from(new Set([
      normText(`card ${n}`),
      ...(ORDINALS[n] ? [normText(`${ORDINALS[n]} card`)] : []),
      normText(`the ${KICKER[card.t]} card`),
      ...(fw ? [normText(fw)] : []),
    ].filter(Boolean)));
    return {
      id: asId(id),
      title: `Card ${n} — ${KICKER[card.t].toUpperCase()}`,
      url: '',
      category: 'content',
      aliases,
      bbox: layout[id] ?? [0, 0, 0, 0],
      sub: true,
    };
  });
}
