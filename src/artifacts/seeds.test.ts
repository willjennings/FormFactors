import { describe, it, expect } from 'vitest';
import { seedCorpus, MERIDIAN } from './seeds';

// Spec §3.1: the seeds are the GROUND TRUTH for the liberty audit — their cross-references
// must hold or the audit judges syntheses against a drifted baseline.
describe('Meridian seed corpus integrity', () => {
  const c = seedCorpus();
  it('seeds all four programs', () => {
    expect(c.word.kind).toBe('word');
    expect(c.excel.kind).toBe('excel');
    expect(c.powerpoint.kind).toBe('powerpoint');
    expect(c.photo.kind).toBe('photo');
  });
  it('the report cites the exact figures the spreadsheet holds', () => {
    if (c.word.kind !== 'word' || c.excel.kind !== 'excel') throw new Error('kinds');
    expect(c.word.text).toContain(MERIDIAN.revenue);
    expect(c.word.text).toContain(MERIDIAN.margin);
    expect(Object.values(c.excel.cells)).toContain(MERIDIAN.revenue);
    expect(Object.values(c.excel.cells)).toContain(MERIDIAN.margin);
  });
  it('the report and spreadsheet name both projects; the deck highlights are a subset of report facts', () => {
    if (c.word.kind !== 'word' || c.excel.kind !== 'excel' || c.powerpoint.kind !== 'powerpoint') throw new Error('kinds');
    for (const proj of MERIDIAN.projects) {
      expect(c.word.text).toContain(proj);
      expect(Object.values(c.excel.cells)).toContain(proj);
    }
    const highlights = c.powerpoint.slides[1];
    expect(highlights).toContain(MERIDIAN.revenue);
    expect(highlights).toContain(MERIDIAN.projects[0]);
  });
  it('the outlook slide plants the ONE unique fact (in no other doc)', () => {
    if (c.word.kind !== 'word' || c.powerpoint.kind !== 'powerpoint') throw new Error('kinds');
    expect(c.powerpoint.slides[2]).toContain(MERIDIAN.uniqueOutlookFact);
    expect(c.word.text).not.toContain(MERIDIAN.uniqueOutlookFact);
  });
  it('the photo caption names a seeded project (the model may know the caption, never the pixels)', () => {
    if (c.photo.kind !== 'photo') throw new Error('kinds');
    expect(c.photo.caption).toContain(MERIDIAN.projects[0]);
  });
  it('the excel seed stays inside the pointable A1..D6 grid', () => {
    if (c.excel.kind !== 'excel') throw new Error('kinds');
    for (const key of Object.keys(c.excel.cells)) expect(key).toMatch(/^[A-D][1-6]$/);
  });
});
