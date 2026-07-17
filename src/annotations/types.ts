// The declarative annotation model for the agent-as-illustrator toolkit (C2a-illustrate).
// Every mark is anchored to a resolved entity id; the reducer stamps a deterministic id.
import type { EntityId } from '../entities/registry';

export type AnnotationShape = 'circle' | 'box' | 'bracket';
export type LabelPlacement = 'top' | 'bottom' | 'left' | 'right';

interface Base { id: string; label?: string }

export type Annotation =
  | (Base & { kind: 'arrow'; from: EntityId; to: EntityId })
  | (Base & { kind: 'shape'; shape: AnnotationShape; targets: EntityId[] })
  | (Base & { kind: 'label'; anchor: EntityId; text: string; placement: LabelPlacement });

// A spec is an Annotation minus its id; the reducer assigns the id (deterministic, monotonic).
export type AnnotationSpec =
  | Omit<Extract<Annotation, { kind: 'arrow' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'shape' }>, 'id'>
  | Omit<Extract<Annotation, { kind: 'label' }>, 'id'>;

export type AnnotationEvent =
  | { type: 'annotate.add'; spec: AnnotationSpec }
  | { type: 'annotate.clear' };

export interface AnnotationState { annotations: Annotation[]; nextId: number }
