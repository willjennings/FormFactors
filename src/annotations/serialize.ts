// The [ANNOTATIONS] text channel: pairs with the WYSIWYG marks (learnings §4: never labels-only).
// Names, never coordinates — the model reads what it drew instead of OCRing its own strokes.
import type { AnnotationState } from './types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { entityById, displayName } from '../entities/registry';

const nameOf = (entities: SceneEntity[], id: EntityId): string =>
  displayName(entityById(entities, id)) || String(id);

export function serializeAnnotations(state: AnnotationState, entities: SceneEntity[]): string | null {
  if (!state.annotations.length) return null;
  const parts = state.annotations.map((a) => {
    switch (a.kind) {
      case 'arrow': return `arrow ${nameOf(entities, a.from)}→${nameOf(entities, a.to)}${a.label ? ` ("${a.label}")` : ''}`;
      case 'shape': return `${a.shape} ${a.targets.map((t) => nameOf(entities, t)).join('+')}${a.label ? ` ("${a.label}")` : ''}`;
      case 'label': return `label "${a.text}" on ${nameOf(entities, a.anchor)}`;
    }
  });
  return `[ANNOTATIONS: ${parts.join('; ')}. DO NOT acknowledge this message.]`;
}
