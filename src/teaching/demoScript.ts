import type { SceneEntity } from '../entities/registry';
import type { Program, ProgramId } from '../scenarios';
import type { TeachingEvent } from './types';

// Per-program authored copy. Element convention: 1 = chrome, 2 = primary control,
// 3 = its look-alike, 4 = content. Steps run chrome → content → primary so every
// sequence ends on the button whose REAL effect proves the task worked.
const COPY: Record<ProgramId, {
  title: string; taskKey: string; highlightNote: string;
  steps: [subgoal: string, instruction: string][]; // [chrome, content, primary]
}> = {
  word: {
    title: 'Save your document', taskKey: 'word.save', highlightNote: 'your tools',
    steps: [
      ['Find your tools', 'Click the Home ribbon.'],
      ['Write the report', 'Click the document body.'],
      ['Save your work', 'Click Save.'],
    ],
  },
  excel: {
    title: 'Total the column', taskKey: 'excel.sum', highlightNote: 'formulas',
    steps: [
      ['Find your tools', 'Click the Formulas ribbon.'],
      ['Check the data', 'Click cell A1.'],
      ['Total the column', 'Click SUM.'],
    ],
  },
  powerpoint: {
    title: 'Add a slide', taskKey: 'ppt.new-slide', highlightNote: 'insert tools',
    steps: [
      ['Find your tools', 'Click the Insert ribbon.'],
      ['Review the slide', 'Click the slide canvas.'],
      ['Add a slide', 'Click New Slide.'],
    ],
  },
  photo: {
    title: 'Crop the image', taskKey: 'photo.crop', highlightNote: 'edit tools',
    steps: [
      ['Find your tools', 'Click the toolbar.'],
      ['Frame the shot', 'Click the image.'],
      ['Crop the image', 'Click Crop.'],
    ],
  },
};

/**
 * A scripted teaching session over the ACTIVE program's real controls: highlight →
 * 3-step guide sequence (soft-block on) → relate the look-alike pair. Timing offsets in
 * ms; the driver replays the same taskKey to demonstrate fade 1. Pure — inputs injected.
 */
export function buildDemoScript(program: Program, entities: SceneEntity[]): { at: number; event: TeachingEvent }[] {
  const el = (n: number) => entities.find((e) => e.id === `${program.id}-${n}`);
  const [chrome, primary, lookalike, content] = [el(1), el(2), el(3), el(4)];
  if (!chrome || !primary || !lookalike || !content) return [];
  const c = COPY[program.id];
  const targets = [chrome, content, primary];
  return [
    { at: 800,  event: { type: 'teach.highlight', entityId: chrome.id, note: c.highlightNote } },
    { at: 2600, event: { type: 'teach.clear' } },
    { at: 3000, event: { type: 'teach.sequence', title: c.title, taskKey: c.taskKey, posture: 'guide',
      steps: c.steps.map(([subgoal, instruction], i) => ({ entityId: targets[i].id, subgoal, instruction })) } },
    { at: 20000, event: { type: 'teach.relate', relations: [{ from: primary.id, to: lookalike.id, label: 'easily confused' }] } },
  ];
}
