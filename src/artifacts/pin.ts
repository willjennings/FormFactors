// Pin: a response becomes durable material (spec §4). USER-ONLY, like artifact.close and
// artifact.revertTo — no agent tool maps to this. The user decides what is worth keeping.
//
// Always a doc: a card is prose, and doc is the prose artifact kind. Widgets stay
// agent-authored through `combine`, where the model chooses the feed bindings.
import type { ArtifactEvent } from './types';
import type { RailCard } from '../rail/types';
import { cardTitle, cardParagraphs } from '../rail/cardContent';

const KICKER: Record<RailCard['t'], string> = {
  do: 'DO', answer: 'ANSWER', orient: 'ORIENT', check: 'CHECK',
  caution: 'CAUTION', concept: 'CONCEPT', try: 'TRY', recap: 'RECAP',
};

export function pinEventFor(card: RailCard, seq: string, now: number): { event: ArtifactEvent } | { error: string } {
  const paragraphs = cardParagraphs(card);
  if (!paragraphs.length) return { error: 'That card has no text to pin.' };
  return {
    event: {
      type: 'artifact.create',
      artifact: {
        kind: 'doc',
        title: cardTitle(card),
        // A provenance RECORD, not a live reference: deliberately not a valid combine source-id.
        // A model that tries read_sources on it gets the existing honest rejection naming the
        // ids that would work. (There is no turnId in this codebase — that arrives with the
        // journal in S5-S6. Citing one here would invent a value that does not exist.)
        sources: [`${KICKER[card.t]} card (${seq})`],
        content: paragraphs.join('\n\n'),
        createdAt: now,
      },
    },
  };
}
