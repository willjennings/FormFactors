import { describe, it, expect } from 'vitest';
import { validateActionCall, aggregateMode, INSERT_KINDS } from './validate';
import { totalColumn } from './columnTotal';
import { seedCorpus } from '../artifacts/seeds';
import type { MockDoc } from '../scenarios';

const word = () => seedCorpus().word;
const excel = () => seedCorpus().excel;
const ppt = () => seedCorpus().powerpoint;
const cells = () => (excel() as { kind: 'excel'; cells: Record<string, string> }).cells;

describe('unspecified asks — authorial content only', () => {
  it('a heading with no text ASKS the user', () => {
    const v = validateActionCall('edit_content', { target: 'heading' }, word());
    expect(v).toEqual({ needsContent: { field: 'heading', question: 'What would you like the heading to say?' } });
  });
  it('the literal placeholder "heading" is not content', () => {
    const v = validateActionCall('edit_content', { target: 'Document body', detail: 'heading' }, word()) as any;
    expect(v.needsContent?.field).toBe('heading');
  });
  it('blank and whitespace detail ask too', () => {
    expect((validateActionCall('edit_content', { target: 'heading', detail: '   ' }, word()) as any).needsContent).toBeTruthy();
  });
  it('real heading text passes', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'Q3 Summary' }, word())).toEqual({ ok: true });
  });
  it('body text and slide titles ask with their own field and question', () => {
    expect((validateActionCall('edit_content', { target: 'Document body' }, word()) as any).needsContent.field).toBe('body');
    expect((validateActionCall('edit_content', { target: 'Slide canvas' }, ppt()) as any).needsContent.field).toBe('slideTitle');
  });
  it('CONFIRM OVERRIDES the placeholder check — the user has seen the witness card', () => {
    expect(validateActionCall('edit_content', { target: 'heading', detail: 'heading', confirm: true }, word())).toEqual({ ok: true });
  });
});

describe('malformed calls — the model is addressed, never the user', () => {
  it('an Excel cell with no value is an ERROR, not an ask — the classification is the point', () => {
    const v = validateActionCall('edit_content', { target: 'Cell B5' }, excel()) as any;
    expect(v.error).toBeTruthy();
    expect(v.needsContent).toBeUndefined();   // a number the user stated is not authorial
    expect(v.error).toContain('B5');
  });
  it('an unknown object kind names the valid set, derived from the same constant', () => {
    const v = validateActionCall('insert_object', { target: 'grid', detail: 'widget' }, excel()) as any;
    for (const k of INSERT_KINDS) expect(v.error).toContain(k);
  });
  it('aggregate errors match totalColumn EXACTLY, so validator and reducer cannot drift', () => {
    const v = validateActionCall('insert_object', { target: 'Cell A2', detail: 'sum' }, excel()) as any;
    const direct = totalColumn(cells(), 'A', 'sum') as { error: string };
    expect(v.error).toBe(direct.error);
  });
  it('an ambiguous column asks which one', () => {
    const twoNumeric: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: '1', A2: '2', B1: '3', B2: '4' } };
    const v = validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'total' }, twoNumeric) as any;
    expect(v.error).toContain('Which column');
  });
  it('a single numeric column is resolved without asking', () => {
    const one: MockDoc = { kind: 'excel', currency: [], chart: false, saved: false,
      cells: { A1: 'Label', B1: 'n', B2: '10', B3: '20' } };
    expect(validateActionCall('insert_object', { target: 'Spreadsheet grid', detail: 'sum' }, one)).toEqual({ ok: true });
  });
});

describe('exempt verbs and vocabulary', () => {
  it('format_content and save_file never gate', () => {
    expect(validateActionCall('format_content', { target: 'Document body' }, word())).toEqual({ ok: true });
    expect(validateActionCall('save_file', { target: 'Save' }, word())).toEqual({ ok: true });
  });
  it('"total" and "mean" are aggregate words — the observed near-miss that inserted a chart', () => {
    expect(aggregateMode('total')).toBe('sum');
    expect(aggregateMode('sum')).toBe('sum');
    expect(aggregateMode('mean')).toBe('average');
    expect(aggregateMode('avg')).toBe('average');
    expect(aggregateMode('chart')).toBeNull();
  });
});
