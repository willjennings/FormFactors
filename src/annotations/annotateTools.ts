// Model-facing illustration tools + a pure name→entity mapper. Mirrors teachTools.ts: an
// unresolvable target fails the WHOLE call (no partial annotation).
import type { VoiceTool } from '../voice/types';
import type { SceneEntity, EntityId } from '../entities/registry';
import { resolveEchoedTarget } from '../entities/registry';
import type { AnnotationEvent, AnnotationShape, LabelPlacement } from './types';

export const ANNOTATE_TOOLS: VoiceTool[] = [
  { name: 'annotate_arrow',
    description: 'Draw an arrow from one on-screen element to another to show a connection. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'annotate_shape',
    description: 'Encircle, box, or bracket one or more on-screen elements to group or spotlight them. shape: circle|box|bracket. Label ≤4 words.',
    parameters: { type: 'object', properties: {
      shape: { type: 'string', enum: ['circle', 'box', 'bracket'] },
      targets: { type: 'array', items: { type: 'string' } }, label: { type: 'string' } }, required: ['shape', 'targets'] } },
  { name: 'annotate_label',
    description: 'Attach a short text callout to an on-screen element, placed in the nearby margin with a leader line. text ≤6 words.',
    parameters: { type: 'object', properties: {
      anchor: { type: 'string' }, text: { type: 'string' },
      placement: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] } }, required: ['anchor', 'text'] } },
  { name: 'annotate_clear',
    description: 'Remove all drawn annotations.',
    parameters: { type: 'object', properties: {}, required: [] } },
];

const unresolved = (target: string) => ({ error: `Could not resolve target "${target}" to an on-screen element.` });

function resolve(entities: SceneEntity[], target: string): EntityId | null {
  return resolveEchoedTarget(entities, target)?.entity.id ?? null;
}

/** Pure mapping from an annotate tool call to a store event. Unresolvable targets fail the whole call. */
export function annotateCallToEvent(
  call: { name: string; args: any }, entities: SceneEntity[],
): AnnotationEvent | { error: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'annotate_arrow': {
      const from = resolve(entities, String(a.from ?? ''));
      if (!from) return unresolved(String(a.from ?? ''));
      const to = resolve(entities, String(a.to ?? ''));
      if (!to) return unresolved(String(a.to ?? ''));
      return { type: 'annotate.add', spec: { kind: 'arrow', from, to, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'annotate_shape': {
      const raw = Array.isArray(a.targets) ? a.targets : [];
      const targets: EntityId[] = [];
      for (const t of raw) {
        const id = resolve(entities, String(t ?? ''));
        if (!id) return unresolved(String(t ?? ''));
        targets.push(id);
      }
      if (!targets.length) return { error: 'annotate_shape requires at least one target.' };
      const shape = (['circle', 'box', 'bracket'] as AnnotationShape[]).includes(a.shape) ? a.shape as AnnotationShape : 'circle';
      return { type: 'annotate.add', spec: { kind: 'shape', shape, targets, ...(a.label ? { label: String(a.label) } : {}) } };
    }
    case 'annotate_label': {
      const anchor = resolve(entities, String(a.anchor ?? ''));
      if (!anchor) return unresolved(String(a.anchor ?? ''));
      const placement = (['top', 'bottom', 'left', 'right'] as LabelPlacement[]).includes(a.placement) ? a.placement as LabelPlacement : 'top';
      return { type: 'annotate.add', spec: { kind: 'label', anchor, text: String(a.text ?? ''), placement } };
    }
    case 'annotate_clear': return { type: 'annotate.clear' };
    default: return { error: `Unknown annotation tool "${call.name}".` };
  }
}
