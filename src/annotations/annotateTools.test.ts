import { describe, it, expect } from 'vitest';
import { ANNOTATE_TOOLS, annotateCallToEvent } from './annotateTools';
import type { SceneEntity, EntityId } from '../entities/registry';

const ent = (id: string, title: string): SceneEntity => ({
  id: id as EntityId, title, url: '', category: 'content',
  aliases: [title.toLowerCase()], bbox: [100, 100, 200, 200], sub: false,
});
const entities = [ent('word-2', 'Bold button'), ent('word-4', 'Title text'), ent('word-1', 'Home ribbon')];

describe('ANNOTATE_TOOLS', () => {
  it('exposes the four tools', () => {
    expect(ANNOTATE_TOOLS.map((t) => t.name)).toEqual(
      ['annotate_arrow', 'annotate_shape', 'annotate_label', 'annotate_clear']);
  });
});

describe('annotateCallToEvent', () => {
  it('maps annotate_arrow to an add event with resolved ids', () => {
    const e = annotateCallToEvent({ name: 'annotate_arrow', args: { from: 'Bold button', to: 'Title text', label: 'applies to' } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'arrow', from: 'word-2', to: 'word-4', label: 'applies to' } });
  });

  it('maps annotate_shape (group) resolving every target', () => {
    const e = annotateCallToEvent({ name: 'annotate_shape', args: { shape: 'box', targets: ['Bold button', 'Home ribbon'] } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'shape', shape: 'box', targets: ['word-2', 'word-1'] } });
  });

  it('maps annotate_label with a default placement of top', () => {
    const e = annotateCallToEvent({ name: 'annotate_label', args: { anchor: 'Title text', text: 'goes here' } }, entities);
    expect(e).toEqual({ type: 'annotate.add', spec: { kind: 'label', anchor: 'word-4', text: 'goes here', placement: 'top' } });
  });

  it('maps annotate_clear', () => {
    expect(annotateCallToEvent({ name: 'annotate_clear', args: {} }, entities)).toEqual({ type: 'annotate.clear' });
  });

  it('fails the whole call on any unresolvable target', () => {
    expect(annotateCallToEvent({ name: 'annotate_arrow', args: { from: 'Bold button', to: 'Nonexistent Thing' } }, entities))
      .toHaveProperty('error');
    expect(annotateCallToEvent({ name: 'annotate_shape', args: { shape: 'circle', targets: [] } }, entities))
      .toHaveProperty('error');
    expect(annotateCallToEvent({ name: 'annotate_label', args: { anchor: 'ghost', text: 'x' } }, entities))
      .toHaveProperty('error');
  });
});
