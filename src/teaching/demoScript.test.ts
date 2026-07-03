import { describe, it, expect } from 'vitest';
import { buildDemoScript } from './demoScript';
import { initialTeachingState, reduce } from './teachingStore';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';

const layout = {
  items: getProgram('word').images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
};

describe('demo script', () => {
  const entities = buildEntities(getProgram('word'), {}, layout);
  it('drives the store to an active soft-blocked sequence, then completes via user actions', () => {
    const script = buildDemoScript(entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.activeIndex).toBe(0);
    expect(st.sequence!.softBlock).toBe(true);
    // learner clicks the three targets in order
    for (const step of [...st.sequence!.steps]) st = reduce(st, { type: 'user.stepAction', entityId: step.entityId }, 30000);
    expect(st.sequence!.activeIndex).toBeNull();
    expect(st.competence['demo.tour']).toBe(1);
    expect(st.relations).toHaveLength(1);
  });
  it('returns empty for scenes with <3 tiles (renders nothing, never throws)', () => {
    expect(buildDemoScript([])).toEqual([]);
  });
});
