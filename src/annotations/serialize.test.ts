import { describe, it, expect } from 'vitest';
import { serializeAnnotations } from './serialize';
import { initialAnnotationState, reduce } from './annotationStore';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});
const entities = [ent('word-2', 'Bold button'), ent('word-4', 'Title text')];

describe('serializeAnnotations', () => {
  it('returns null when there are no annotations', () => {
    expect(serializeAnnotations(initialAnnotationState(), entities)).toBeNull();
  });

  it('describes each mark by name and ends with the silence directive', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2' as EntityId, to: 'word-4' as EntityId } });
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'shape', shape: 'circle', targets: ['word-2' as EntityId] } });
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'label', anchor: 'word-4' as EntityId, text: 'goes here', placement: 'top' } });
    const out = serializeAnnotations(s, entities)!;
    expect(out).toContain('arrow Bold button→Title text');
    expect(out).toContain('circle Bold button');
    expect(out).toContain('label "goes here" on Title text');
    expect(out.startsWith('[ANNOTATIONS:')).toBe(true);
    expect(out.endsWith('DO NOT acknowledge this message.]')).toBe(true);
  });

  it('falls back to the raw id when an entity is missing (never blank)', () => {
    let s = initialAnnotationState();
    s = reduce(s, { type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2' as EntityId, to: 'ghost' as EntityId } });
    const out = serializeAnnotations(s, entities)!;
    expect(out).toContain('Bold button→ghost');
  });
});
