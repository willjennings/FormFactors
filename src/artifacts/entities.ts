// Pure mapper: synthesized artifacts → pointable SceneEntities (spec §3/R2 — everything on
// screen is grounded through the same id/alias/bbox contract, artifacts included). Layout is
// keyed by the same `${'artifact-' + id}` DOM id ArtifactWindow puts on its measured region;
// a missing entry degrades honestly to a zero bbox rather than guessing a position.
import { asId, normText, type SceneEntity } from '../entities/registry';
import type { ArtifactState } from './types';

type Layout = Record<string, [number, number, number, number]>;

export function artifactEntities(state: ArtifactState, layout: Layout): SceneEntity[] {
  return state.artifacts.map((a) => {
    const id = `artifact-${a.id}`;
    const aliases = Array.from(new Set([normText(a.id), normText(a.title), normText(`the ${a.kind}`)]));
    return {
      id: asId(id),
      title: a.title,
      url: '',
      category: 'content',
      aliases,
      bbox: layout[id] ?? [0, 0, 0, 0],
      sub: false,
    };
  });
}
