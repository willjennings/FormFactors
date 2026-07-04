import { describe, it, expect } from 'vitest';
import { buildDemoScript } from './demoScript';
import { initialTeachingState, reduce } from './teachingStore';
import { buildEntities } from '../entities/registry';
import { getProgram } from '../scenarios';

const layoutFor = (programId: 'word' | 'excel') => ({
  items: getProgram(programId).images.map((img, i) => ({ id: img.id, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
});

describe('demo script', () => {
  it('word: teaches the save task over ribbon → body → Save, then relates the look-alikes', () => {
    const program = getProgram('word');
    const entities = buildEntities(program, {}, layoutFor('word'));
    const script = buildDemoScript(program, entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.title).toBe('Save your document');
    expect(st.sequence!.steps.map(s => s.entityId)).toEqual(['word-1', 'word-4', 'word-2']);
    expect(st.sequence!.softBlock).toBe(true);
    for (const step of [...st.sequence!.steps]) st = reduce(st, { type: 'user.stepAction', entityId: step.entityId }, 30000);
    expect(st.sequence!.activeIndex).toBeNull();
    expect(st.competence['word.save']).toBe(1);
    expect(st.relations).toEqual([{ from: 'word-2', to: 'word-3', label: 'easily confused' }]);
  });

  it('excel: teaches totaling the column', () => {
    const program = getProgram('excel');
    const entities = buildEntities(program, {}, layoutFor('excel'));
    const script = buildDemoScript(program, entities);
    let st = initialTeachingState();
    for (const { at, event } of script) st = reduce(st, event, at);
    expect(st.sequence!.steps.map(s => s.entityId)).toEqual(['excel-1', 'excel-4', 'excel-2']);
    expect(st.sequence!.taskKey).toBe('excel.sum');
  });

  it('returns empty when the program elements are missing (renders nothing, never throws)', () => {
    expect(buildDemoScript(getProgram('word'), [])).toEqual([]);
  });
});
