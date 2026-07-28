import { describe, it, expect } from 'vitest';
import { applyAction, initialMockDoc, serializeMockDoc, ACT_TOOL, classOf } from './scenarios';
import type { MockDoc } from './scenarios';
import { seedCorpus } from './artifacts/seeds';

describe('applyAction — functional surface verbs', () => {
  it('word: Save As marks saved and records the copy filename', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Save As button', detail: 'Save As' });
    expect(doc.kind).toBe('word');
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toMatch(/copy/i);
  });

  it('word: plain Save does not set savedAs', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Save button' });
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toBeUndefined();
  });

  it('word: export "as a PDF" is a plain save, not Save As', () => {
    const doc = applyAction(initialMockDoc('word'), 'save_file', { target: 'Document', detail: 'as a PDF' });
    if (doc.kind !== 'word') return;
    expect(doc.saved).toBe(true);
    expect(doc.savedAs).toBeUndefined();
  });

  it('excel: SUM writes the column total into the next empty A cell', () => {
    const doc = applyAction(initialMockDoc('excel'), 'insert_object', { target: 'SUM function', detail: 'SUM' });
    if (doc.kind !== 'excel') return;
    expect(doc.cells.A4).toBe('60'); // A1=10, A2=20, A3=30
    expect(doc.chart).toBe(false);
  });

  it('excel: AVERAGE aggregates every numeric A cell', () => {
    const summed = applyAction(initialMockDoc('excel'), 'insert_object', { detail: 'SUM' });
    const doc = applyAction(summed, 'insert_object', { target: 'AVERAGE function', detail: 'AVERAGE' });
    if (doc.kind !== 'excel') return;
    expect(doc.cells.A5).toBe('30'); // (10+20+30+60)/4
  });

  it('excel: no empty A cell → doc unchanged (safe by default)', () => {
    let doc = initialMockDoc('excel');
    for (const ref of ['A4', 'A5', 'A6']) doc = applyAction(doc, 'edit_content', { target: ref, detail: '1' });
    expect(applyAction(doc, 'insert_object', { detail: 'SUM' })).toBe(doc);
  });

  it('excel: detail-less insert no longer defaults to a chart — it does nothing (honest gate, Task 4)', () => {
    const before = initialMockDoc('excel');
    const doc = applyAction(before, 'insert_object', { target: 'Cell A1' });
    if (doc.kind !== 'excel') return;
    expect(doc.chart).toBe(false);
    expect(doc).toEqual(before);
  });

  it('excel: insert_object with "chart" in the detail creates a chart', () => {
    const doc = applyAction(seedCorpus().excel, 'insert_object', { target: 'grid', detail: 'Make a chart from this' });
    if (doc.kind !== 'excel') return;
    expect(doc.chart).toBe(true);
  });

  it('powerpoint: duplicate copies the last slide', () => {
    const doc = applyAction(initialMockDoc('powerpoint'), 'insert_object', { target: 'Duplicate Slide button', detail: 'duplicate' });
    if (doc.kind !== 'powerpoint') return;
    expect(doc.slides).toEqual(['Title slide', 'Title slide (copy)']);
  });

  it('powerpoint: plain insert appends a numbered slide (existing behavior)', () => {
    const doc = applyAction(initialMockDoc('powerpoint'), 'insert_object', { target: 'New Slide button' });
    if (doc.kind !== 'powerpoint') return;
    expect(doc.slides).toEqual(['Title slide', 'Slide 2']);
  });

  it('photo: resize sets resized without cropping', () => {
    const doc = applyAction(initialMockDoc('photo'), 'photo_edit', { target: 'Resize tool', detail: 'resize' });
    if (doc.kind !== 'photo') return;
    expect(doc.resized).toBe(true);
    expect(doc.cropped).toBe(false);
  });

  it('serializeMockDoc surfaces savedAs and resized', () => {
    const word = applyAction(initialMockDoc('word'), 'save_file', { detail: 'Save As' });
    expect(serializeMockDoc(word)).toContain('copy');
    const photo = applyAction(initialMockDoc('photo'), 'photo_edit', { detail: 'resize' });
    expect(serializeMockDoc(photo)).toContain('resized');
  });
});

describe('act_on tool', () => {
  it('is defined with the outward-action params and simulation note', () => {
    expect(ACT_TOOL.name).toBe('act_on');
    const props = (ACT_TOOL.parameters as { properties: Record<string, unknown>; required: string[] });
    expect(Object.keys(props.properties)).toEqual(expect.arrayContaining(['target', 'intent', 'details', 'confirm']));
    expect(props.required).toEqual(['target', 'intent']);
    expect(ACT_TOOL.description.toLowerCase()).toContain('simulated');
  });

  it('classifies act_on as an outward (share-class) verb', () => {
    expect(classOf('act_on')).toBe('share');
  });
});

describe('revise_text splice', () => {
  // narrowed so { ...d, text } is the word variant → assignable to MockDoc (no `as const`).
  const word = (): MockDoc => {
    const d = initialMockDoc('word');
    return d.kind === 'word' ? { ...d, text: 'The quarterly report summary.' } : d;
  };

  it('replaces a mid-text span', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 4, charEnd: 13, newText: 'annual' });
    expect((d as { text: string }).text).toBe('The annual report summary.');
  });

  it('clamps a span past the end and treats start>len as end', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 100, charEnd: 200, newText: '!' });
    expect((d as { text: string }).text).toBe('The quarterly report summary.!');
  });

  it('empty newText deletes the span', () => {
    const d = applyAction(word(), 'revise_text', { charStart: 3, charEnd: 13, newText: '' });
    expect((d as { text: string }).text).toBe('The report summary.');
  });

  it('leaves non-word docs unchanged', () => {
    const excel = initialMockDoc('excel');
    expect(applyAction(excel, 'revise_text', { charStart: 0, charEnd: 1, newText: 'x' })).toEqual(excel);
  });
});
