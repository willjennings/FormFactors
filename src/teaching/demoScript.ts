import type { SceneEntity } from '../entities/registry';
import type { TeachingEvent } from './types';

/**
 * A scripted teaching session over the real scene: highlight → 3-step guide sequence
 * (soft-block on) → relate. Timing offsets in ms; the driver replays completion of the
 * same taskKey to demonstrate fade 1 on the second run. Pure — entities injected.
 */
export function buildDemoScript(entities: SceneEntity[]): { at: number; event: TeachingEvent }[] {
  const tiles = entities.filter((e) => e.category !== 'map');
  if (tiles.length < 3) return [];
  const [a, b, c] = tiles;
  return [
    { at: 800,  event: { type: 'teach.highlight', entityId: a.id, note: 'start here' } },
    { at: 2600, event: { type: 'teach.clear' } },
    { at: 3000, event: { type: 'teach.sequence', title: 'Tour the scene', taskKey: 'demo.tour', posture: 'guide',
      steps: [
        { entityId: a.id, subgoal: 'Find the anchor', instruction: 'Click the first tile.' },
        { entityId: b.id, subgoal: 'Compare the pair', instruction: 'Click the second tile.' },
        { entityId: c.id, subgoal: 'Close the loop', instruction: 'Click the third tile.' },
      ] } },
    { at: 20000, event: { type: 'teach.relate', relations: [{ from: a.id, to: b.id, label: 'compares with' }] } },
  ];
}
