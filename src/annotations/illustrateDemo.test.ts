import { describe, it, expect } from 'vitest';
import { buildIllustrateScript } from './illustrateDemo';
import type { SceneEntity, EntityId } from '../entities/registry';
import type { Program } from '../scenarios';

const ent = (id: string): SceneEntity => ({
  id: id as EntityId, title: id, url: '', category: 'content', aliases: [id], bbox: [100, 100, 200, 200], sub: false,
});
const program = { id: 'word', label: 'Word' } as Program;
const entities = [ent('word-1'), ent('word-2'), ent('word-3'), ent('word-4')];

describe('buildIllustrateScript', () => {
  it('returns an empty script when the expected elements are absent', () => {
    expect(buildIllustrateScript(program, [ent('word-1')])).toEqual([]);
  });

  it('scripts circle → arrow → label → clear over real elements, in time order', () => {
    const script = buildIllustrateScript(program, entities);
    expect(script.map((s) => s.event.type)).toEqual(['annotate.add', 'annotate.add', 'annotate.add', 'annotate.clear']);
    expect(script.map((s) => s.at)).toEqual([...script.map((s) => s.at)].sort((a, b) => a - b)); // ascending
    const kinds = script.filter((s) => s.event.type === 'annotate.add')
      .map((s) => (s.event as { type: 'annotate.add'; spec: { kind: string } }).spec.kind);
    expect(kinds).toEqual(['shape', 'arrow', 'label']);
  });
});
