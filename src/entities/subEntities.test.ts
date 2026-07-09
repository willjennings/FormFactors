import { describe, it, expect } from 'vitest';
import { deriveSpreadsheetSubEntities, derivePptSubEntities, SUB_ENTITY_DERIVERS } from './subEntities';
import { initialMockDoc, applyAction } from '../scenarios';

describe('sub-entity derivers', () => {
  it('excel: one spec per grid cell (A1..D6 = 24), correct id/title/aliases', () => {
    const specs = deriveSpreadsheetSubEntities(initialMockDoc('excel'));
    expect(specs).toHaveLength(24);
    const a3 = specs.find(s => s.idSuffix === 'cell-A3')!;
    expect(a3).toMatchObject({ title: 'Cell A3', category: 'content' });
    expect(a3.aliases).toContain('a3');
    // dense-set sanity: A3 and A13 do not exist together to collide, but A1 and A3 are distinct
    expect(specs.find(s => s.idSuffix === 'cell-A1')!.title).toBe('Cell A1');
  });
  it('powerpoint: one spec per slide, count grows with the deck', () => {
    let doc = initialMockDoc('powerpoint');                 // 1 slide
    expect(derivePptSubEntities(doc)).toHaveLength(1);
    doc = applyAction(doc, 'insert_object', { target: 'New Slide button' }); // +1
    const specs = derivePptSubEntities(doc);
    expect(specs).toHaveLength(2);
    expect(specs[1]).toMatchObject({ idSuffix: 'slide-2', title: 'Slide 2', category: 'content' });
    expect(specs[1].aliases).toContain('slide 2');
  });
  it('word and photo derive nothing (deferred / no sub-elements)', () => {
    expect(SUB_ENTITY_DERIVERS.word?.(initialMockDoc('word')) ?? []).toEqual([]);
    expect(SUB_ENTITY_DERIVERS.photo?.(initialMockDoc('photo')) ?? []).toEqual([]);
  });
  it('registry maps excel + powerpoint to their derivers', () => {
    expect(SUB_ENTITY_DERIVERS.excel).toBe(deriveSpreadsheetSubEntities);
    expect(SUB_ENTITY_DERIVERS.powerpoint).toBe(derivePptSubEntities);
  });
});
