import type { Program } from '../scenarios';
import type { MockDoc } from '../scenarios';
import type { SceneEntity } from '../entities/registry';
import type { Rail } from './types';
import { respondCallToRail } from './respondCallToRail';

/** The no-key proof path for the rail: a canned respond payload pushed through the REAL
 *  mapper (validation, budgets, band) — if the contract breaks, the demo breaks. */
export function buildRailDemo(program: Program, entities: SceneEntity[], doc: MockDoc, now: number): Rail | null {
  const el = (n: number) => program.images.find(i => i.id === n)?.title ?? '';
  const payload = program.id === 'word'
    ? { seq: 'word.save', guideLine: 'One click and your work is safe.', cards: [
        { t: 'orient', text: 'Your report is open; nothing saved yet.' },
        { t: 'do', verb: 'click', target: el(2), text: `Click ${el(2)}.`, result: 'The title bar reads Saved.',
          why: 'Save writes the working copy; Save As forks a new file next to it.' },
        { t: 'check', verify: 'auto', expect: { path: 'saved', equals: true }, text: 'The window shows Saved.' },
        { t: 'recap', lines: ['Your work is saved.', 'Save As makes a copy.'] },
      ] }
    : { seq: `${program.id}.identify`, guideLine: 'Here is what you are looking at.', cards: [
        { t: 'answer', text: `That's the ${el(2)}.`, target: el(2) },
      ] };
  const mapped = respondCallToRail(payload, entities, doc, now);
  return 'error' in mapped ? null : mapped.rail;
}
