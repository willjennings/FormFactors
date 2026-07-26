// Pure mapper: synthesized artifacts → pointable SceneEntities (spec §3/R2 — everything on
// screen is grounded through the same id/alias/bbox contract, artifacts included). Layout is
// keyed by the same `${'artifact-' + id}` DOM id ArtifactWindow puts on its measured region;
// a missing entry degrades honestly to a zero bbox rather than guessing a position.
import { asId, normText, type SceneEntity } from '../entities/registry';
import type { ArtifactState } from './types';
import { artifactParts } from './parts';

type Layout = Record<string, [number, number, number, number]>;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** First few words, for "the part about the budget". resolveEchoedTarget's ≥2-token overlap
 *  floor (R2) is what stops a one-word coincidence from grounding here. */
function firstWords(text: string): string { return text.split(/\s+/).slice(0, 5).join(' '); }

export function artifactEntities(state: ArtifactState, layout: Layout): SceneEntity[] {
  // "the doc"/"the widget" only while unambiguous: with two artifacts of one kind the alias
  // would resolve to one of them silently — drop it and let id/title carry the reference.
  const kindCount = new Map<string, number>();
  for (const a of state.artifacts) kindCount.set(a.kind, (kindCount.get(a.kind) ?? 0) + 1);
  // Wholes are emitted in original artifact order first, all parts appended after — NOT
  // interleaved per-artifact. This keeps the whole-artifact slice of the result byte-identical
  // (same ids, same order, same indices) to the pre-Task-4 output, which is load-bearing for
  // callers/tests that index into it positionally; part entities are always addressed by id,
  // never by position, so grouping them at the end costs nothing on that side.
  const wholes: SceneEntity[] = [];
  const parts: SceneEntity[] = [];
  for (const a of state.artifacts) {
    const id = `artifact-${a.id}`;
    const aliases = Array.from(new Set([
      normText(a.id), normText(a.title),
      ...(kindCount.get(a.kind) === 1 ? [normText(`the ${a.kind}`)] : []),
    ]));
    wholes.push({
      id: asId(id), title: a.title, url: '', category: 'content',
      aliases, bbox: layout[id] ?? [0, 0, 0, 0], sub: false,
    });
    // Parts are `sub: true` — the C1 discriminator. It is also what keeps them out of
    // blockedElementNumbers; the C1 final review caught slide ordinals leaking into the
    // soft-block set for exactly this reason.
    for (const p of artifactParts(a)) {
      const partId = `${id}-${p.id}`;
      const noun = a.kind === 'widget' ? 'field' : 'paragraph';
      const partAliases = a.kind === 'widget'
        ? [normText(p.label ?? ''), normText(`${noun} ${p.index}`)]
        : [normText(`${noun} ${p.index}`),
           ...(ORDINALS[p.index] ? [normText(`${ORDINALS[p.index]} ${noun}`)] : []),
           ...(p.text ? [normText(firstWords(p.text))] : [])];
      parts.push({
        id: asId(partId),
        title: a.kind === 'widget' ? `${p.label} — "${a.title}"` : `Paragraph ${p.index} — "${a.title}"`,
        url: '', category: 'content',
        aliases: Array.from(new Set(partAliases.filter(Boolean))),
        bbox: layout[partId] ?? [0, 0, 0, 0],
        sub: true,
      });
    }
  }
  return [...wholes, ...parts];
}
