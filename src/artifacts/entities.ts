// Pure mapper: synthesized artifacts → pointable SceneEntities (spec §3/R2 — everything on
// screen is grounded through the same id/alias/bbox contract, artifacts included). Layout is
// keyed by the same `${'artifact-' + id}` DOM id ArtifactWindow puts on its measured region;
// a missing entry degrades honestly to a zero bbox rather than guessing a position.
import { asId, normText, type SceneEntity } from '../entities/registry';
import type { ArtifactState } from './types';
import { artifactParts } from './parts';
import { PROGRAM_IDS } from '../scenarios';

type Layout = Record<string, [number, number, number, number]>;

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** First few words, for "the part about the budget" — but only when there are enough of them to
 *  be a safe handle. resolveEchoedTarget's ≥2-token overlap floor (registry.ts MIN_OVERLAP_TOKENS)
 *  does NOT protect a short alias here: that floor only guards the bare-overlap FALLBACK branch,
 *  reached when neither "alias is a token-subset of the echo" nor "echo is a token-subset of the
 *  alias" holds. A one-word alias like "approved" IS a token-subset of a one-word echo "approved",
 *  so it scores via the subset branch (or exact-match, score 1000) and wins outright — the
 *  ≥2-token floor is never consulted. So this function enforces its own floor: fewer than 2
 *  tokens and it emits no alias at all. The part stays reachable via "paragraph N" and its
 *  ordinal form, which are unambiguous by construction and need no such guard. */
function firstWords(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 5);
  return words.length >= 2 ? words.join(' ') : null;
}

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
      const fw = p.text ? firstWords(p.text) : null;
      const partAliases = a.kind === 'widget'
        ? [normText(p.label ?? ''), normText(`${noun} ${p.index}`)]
        : [normText(`${noun} ${p.index}`),
           ...(ORDINALS[p.index] ? [normText(`${ORDINALS[p.index]} ${noun}`)] : []),
           ...(fw ? [normText(fw)] : [])];
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

// The SINGLE answer to "can this be combined?" (spec §5.1). Every combinability decision and
// every message naming valid sources derives from this — never a hardcoded list. PROGRAM_IDS
// is imported from scenarios.ts, the single source of truth for the valid program list.
export function entityToSourceId(entity: { id: string; sub?: boolean }): string | null {
  const id = String(entity.id);
  // Artifact PARTS (paragraphs, fields) are not sources; the artifact is. `artifact-a1` has
  // exactly two segments, `artifact-a1-para-2` has more.
  if (id.startsWith('artifact-')) {
    const rest = id.slice('artifact-'.length);
    return rest.includes('-') ? null : rest;
  }
  const program = PROGRAM_IDS.find((p) => id.startsWith(`${p}-`));
  return program ?? null;   // rail cards and anything else: not a source
}
