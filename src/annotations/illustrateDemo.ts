// A scripted illustration over the ACTIVE program's real controls: circle a control, arrow to the
// content it affects, label it, then clear. The no-key proof path for ?illustrate=1. Pure.
import type { SceneEntity, EntityId } from '../entities/registry';
import type { Program } from '../scenarios';
import type { AnnotationEvent } from './types';

export function buildIllustrateScript(program: Program, entities: SceneEntity[]): { at: number; event: AnnotationEvent }[] {
  const el = (n: number) => entities.find((e) => e.id === `${program.id}-${n}`);
  const [primary, content] = [el(2), el(4)];
  if (!primary || !content) return [];
  const pid = primary.id as EntityId, cid = content.id as EntityId;
  return [
    { at: 900,  event: { type: 'annotate.add', spec: { kind: 'shape', shape: 'circle', targets: [pid], label: 'this control' } } },
    { at: 2200, event: { type: 'annotate.add', spec: { kind: 'arrow', from: pid, to: cid, label: 'affects' } } },
    { at: 3500, event: { type: 'annotate.add', spec: { kind: 'label', anchor: cid, text: 'the result lands here', placement: 'bottom' } } },
    { at: 8000, event: { type: 'annotate.clear' } },
  ];
}
