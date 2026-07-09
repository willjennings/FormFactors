import type { MockDoc, ProgramId, ElementCategory } from '../scenarios';
import { buildGridModel } from '../widgets/spreadsheetGrid';

/** A pointable sub-element a surface exposes, derived purely from its document state.
 *  The extension point for going wide: a new surface implements one of these. */
export interface SubEntitySpec {
  idSuffix: string;          // unique within the program, e.g. 'cell-A3', 'slide-2'
  title: string;             // registered name, e.g. 'Cell A3', 'Slide 2'
  aliases: string[];         // extra normalized names the model may echo (title added downstream)
  category: ElementCategory;
}
export type SubEntityDeriver = (doc: MockDoc) => SubEntitySpec[];

/** Every grid cell in the model's range is a pointable content entity. */
export const deriveSpreadsheetSubEntities: SubEntityDeriver = (doc) => {
  const model = buildGridModel(doc, null);
  const specs: SubEntitySpec[] = [];
  for (const row of model.cells) {
    for (const cell of row) {
      specs.push({ idSuffix: `cell-${cell.ref}`, title: `Cell ${cell.ref}`, aliases: [cell.ref.toLowerCase()], category: 'content' });
    }
  }
  return specs;
};

/** Every slide in the deck is a pointable content entity. */
export const derivePptSubEntities: SubEntityDeriver = (doc) => {
  if (doc.kind !== 'powerpoint') return [];
  return doc.slides.map((_, i) => {
    const n = i + 1;
    return { idSuffix: `slide-${n}`, title: `Slide ${n}`, aliases: [`slide ${n}`, ...(n === 2 ? ['second slide'] : n === 1 ? ['first slide'] : [])], category: 'content' as ElementCategory };
  });
};

const NONE: SubEntityDeriver = () => [];

export const SUB_ENTITY_DERIVERS: Partial<Record<ProgramId, SubEntityDeriver>> = {
  excel: deriveSpreadsheetSubEntities,
  powerpoint: derivePptSubEntities,
  word: NONE,
  photo: NONE,
};
