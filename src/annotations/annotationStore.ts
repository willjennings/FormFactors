import type { AnnotationState, AnnotationEvent, Annotation } from './types';

export const MAX_ANNOTATIONS = 8; // matches teaching's highlight cap

export function initialAnnotationState(): AnnotationState {
  return { annotations: [], nextId: 1 };
}

export function reduce(state: AnnotationState, event: AnnotationEvent): AnnotationState {
  switch (event.type) {
    case 'annotate.add': {
      const annotation = { ...event.spec, id: String(state.nextId) } as Annotation;
      const annotations = [...state.annotations, annotation].slice(-MAX_ANNOTATIONS);
      return { annotations, nextId: state.nextId + 1 };
    }
    case 'annotate.clear':
      return { annotations: [], nextId: state.nextId };
    default:
      return state;
  }
}
