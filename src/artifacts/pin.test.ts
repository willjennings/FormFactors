import { describe, it, expect } from 'vitest';
import { pinEventFor } from './pin';
import { initialArtifactState, reduce, MAX_ARTIFACTS } from './artifactStore';
import type { RailCard } from '../rail/types';

const card = (over: Partial<RailCard>): RailCard =>
  ({ t: 'answer', band: 'solid', state: 'active', ...over } as RailCard);

describe('pinEventFor', () => {
  it('builds a doc artifact from the card, with card provenance', () => {
    const v = pinEventFor(card({ text: 'The Save As button opens a dialog.' }), 'Explain Save', 5000);
    expect(v).toEqual({ event: { type: 'artifact.create', artifact: {
      kind: 'doc',
      title: 'The Save As button opens a dialog.',
      sources: ['ANSWER card (Explain Save)'],
      content: 'The Save As button opens a dialog.',
      createdAt: 5000,
    } } });
  });

  it('is ALWAYS a doc, even for a widget-ish card', () => {
    const v = pinEventFor(card({ t: 'recap', lines: ['a', 'b'] }), 'Seq', 1) as { event: any };
    expect(v.event.artifact.kind).toBe('doc');
  });

  it('a recap becomes one paragraph per line', () => {
    const v = pinEventFor(card({ t: 'recap', lines: ['Opened the deck.', 'Retitled slide 1.'] }), 'Seq', 1) as { event: any };
    expect(v.event.artifact.content).toBe('Opened the deck.\n\nRetitled slide 1.');
  });

  it('refuses an empty card instead of minting a blank artifact', () => {
    expect(pinEventFor(card({ t: 'answer' }), 'Seq', 1)).toEqual({
      error: 'That card has no text to pin.',
    });
  });

  it('the event it produces is accepted by the REAL reducer', () => {
    const v = pinEventFor(card({ text: 'Pin me.' }), 'Seq', 1) as { event: any };
    const st = reduce(initialArtifactState(), v.event);
    expect(st.artifacts).toHaveLength(1);
    expect(st.artifacts[0].id).toBe('a1');
    expect(st.artifacts[0].rev).toBe(1);
  });

  it('at the cap the REAL reducer refuses it — pin never evicts', () => {
    let st = initialArtifactState();
    for (let i = 0; i < MAX_ARTIFACTS; i++) {
      const v = pinEventFor(card({ text: `Card ${i}` }), 'Seq', 1) as { event: any };
      st = reduce(st, v.event);
    }
    const v = pinEventFor(card({ text: 'One too many' }), 'Seq', 1) as { event: any };
    const after = reduce(st, v.event);
    expect(after.artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(after.artifacts.map((a) => a.title)).not.toContain('One too many');
    expect(after.rejectedAtCap).toBe(1);
  });
});
