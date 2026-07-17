import { describe, it, expect } from 'vitest';
import { initialAnnotationState, reduce, MAX_ANNOTATIONS } from './annotationStore';
import type { AnnotationSpec } from './types';
import type { EntityId } from '../entities/registry';

const arrowSpec = (from: string, to: string): AnnotationSpec =>
  ({ kind: 'arrow', from: from as EntityId, to: to as EntityId });

describe('annotationStore.reduce', () => {
  it('stamps sequential ids and appends on add', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('a', 'b') });
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('c', 'd') });
    expect(s.annotations.map((a) => a.id)).toEqual(['1', '2']);
    expect(s.nextId).toBe(3);
    expect(s.annotations[0]).toMatchObject({ kind: 'arrow', from: 'a', to: 'b' });
  });

  it('drops the oldest past the cap', () => {
    let s = initialAnnotationState();
    for (let i = 0; i < MAX_ANNOTATIONS + 3; i++) {
      s = reduce(s, { type: 'annotate.add', spec: arrowSpec(`x${i}`, `y${i}`) });
    }
    expect(s.annotations.length).toBe(MAX_ANNOTATIONS);
    // oldest three dropped → first surviving is the 4th added (from 'x3')
    expect(s.annotations[0]).toMatchObject({ from: 'x3' });
    // ids keep climbing monotonically
    expect(s.annotations[s.annotations.length - 1].id).toBe(String(MAX_ANNOTATIONS + 3));
  });

  it('clear empties annotations but keeps nextId monotonic', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('a', 'b') });
    s = reduce(s, { type: 'annotate.clear' });
    expect(s.annotations).toEqual([]);
    expect(s.nextId).toBe(2); // not reset — next id never collides with a prior one
    s = reduce(s, { type: 'annotate.add', spec: arrowSpec('c', 'd') });
    expect(s.annotations[0].id).toBe('2');
  });
});
