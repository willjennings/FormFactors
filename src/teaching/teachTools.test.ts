import { describe, it, expect } from 'vitest';
import { TEACH_TOOLS, teachCallToEvent } from './teachTools';
import { buildEntities } from '../entities/registry';
import { getProgram, initialMockDoc } from '../scenarios';

const layout = {
  items: getProgram('word').images.map((img, i) => ({ id: `word-${img.id}`, bbox: { ymin: i * 100, xmin: 0, ymax: i * 100 + 90, xmax: 200 } })),
  map: { ymin: 0, xmin: 500, ymax: 400, xmax: 900 },
};
const entities = buildEntities(getProgram('word'), initialMockDoc('word'), {}, layout);

describe('TEACH_TOOLS', () => {
  it('declares the five teaching tools', () => {
    expect(TEACH_TOOLS.map(t => t.name).sort()).toEqual(
      ['teach_clear', 'teach_highlight', 'teach_relate', 'teach_sequence', 'teach_step_done']);
  });
});

describe('teachCallToEvent', () => {
  it('maps teach_highlight with target resolution', () => {
    const ev = teachCallToEvent({ name: 'teach_highlight', args: { target: 'Save button', note: 'here' } }, entities);
    expect(ev).toMatchObject({ type: 'teach.highlight', note: 'here' });
  });
  it('maps teach_sequence resolving every step target', () => {
    const ev = teachCallToEvent({ name: 'teach_sequence', args: {
      title: 'Save', taskKey: 'word.save', posture: 'guide',
      steps: [{ target: 'Save button', subgoal: 'Open save', instruction: 'Click it.' }],
    } }, entities) as any;
    expect(ev.type).toBe('teach.sequence');
    expect(ev.steps[0].subgoal).toBe('Open save');
  });
  it('FAILS THE WHOLE CALL naming an unresolvable step target (honesty over helpfulness)', () => {
    const ev = teachCallToEvent({ name: 'teach_sequence', args: {
      title: 'X', taskKey: 'k', posture: 'guide',
      steps: [
        { target: 'Save button', subgoal: 'A', instruction: 'B.' },
        { target: 'Cell Q99', subgoal: 'C', instruction: 'D.' },
      ],
    } }, entities);
    expect(ev).toEqual({ error: 'Could not resolve target "Cell Q99" to an on-screen element.' });
  });
  it('maps step_done and clear; unknown tool → error', () => {
    expect(teachCallToEvent({ name: 'teach_step_done', args: {} }, entities)).toEqual({ type: 'teach.stepAdvance' });
    expect(teachCallToEvent({ name: 'teach_clear', args: {} }, entities)).toEqual({ type: 'teach.clear' });
    expect(teachCallToEvent({ name: 'nope', args: {} }, entities)).toEqual({ error: 'Unknown teaching tool "nope".' });
  });
  it('maps teach_relate resolving both ends; fails naming the bad end', () => {
    const ok = teachCallToEvent({ name: 'teach_relate', args: { pairs: [{ from: 'Save button', to: 'Document body', label: 'writes to' }] } }, entities) as any;
    expect(ok.type).toBe('teach.relate');
    const bad = teachCallToEvent({ name: 'teach_relate', args: { pairs: [{ from: 'Save button', to: 'Nonsense Widget', label: 'x' }] } }, entities);
    expect(bad).toEqual({ error: 'Could not resolve target "Nonsense Widget" to an on-screen element.' });
  });
});
