import { describe, it, expect } from 'vitest';
import { buildWordModel, buildPptModel, buildPhotoModel, docStatusLabel } from './surfaceModels';
import { initialMockDoc, applyAction, WORD_FILENAME } from '../scenarios';

const word = () => { const d = initialMockDoc('word'); return d.kind === 'word' ? d : (() => { throw new Error('kind'); })(); };
const ppt = () => { const d = initialMockDoc('powerpoint'); return d.kind === 'powerpoint' ? d : (() => { throw new Error('kind'); })(); };
const photo = () => { const d = initialMockDoc('photo'); return d.kind === 'photo' ? d : (() => { throw new Error('kind'); })(); };

describe('surface view models', () => {
  it('word: unsaved doc reads Edited; saved reads Saved; Save As names the copy', () => {
    expect(buildWordModel(word()).statusLabel).toBe('Edited');
    expect(buildWordModel({ ...word(), saved: true }).statusLabel).toBe('Saved');
    const savedAs = buildWordModel({ ...word(), saved: true, savedAs: 'X (copy).docx' });
    expect(savedAs.statusLabel).toBe('Saved as X (copy).docx');
    expect(buildWordModel(word()).filename).toBe(WORD_FILENAME);
  });

  it('ppt: currentTitle is the last slide', () => {
    const d = applyAction(ppt(), 'insert_object', {});
    if (d.kind !== 'powerpoint') return;
    expect(buildPptModel(d).currentTitle).toBe('Slide 2');
    expect(buildPptModel(d).slides).toHaveLength(2);
  });

  it('photo: brightness maps to a CSS brightness filter', () => {
    expect(buildPhotoModel(photo()).filterCss).toBe('brightness(100%)');
    expect(buildPhotoModel({ ...photo(), brightness: 2 }).filterCss).toBe('brightness(136%)');
    expect(buildPhotoModel({ ...photo(), resized: true }).resized).toBe(true);
  });

  it('docStatusLabel covers every doc kind', () => {
    expect(docStatusLabel(initialMockDoc('word'))).toBe('Edited');
    expect(docStatusLabel({ ...word(), saved: true })).toBe('Saved');
    expect(docStatusLabel({ ...word(), saved: true, savedAs: 'X.docx' })).toBe('Saved as X.docx');
    expect(docStatusLabel(initialMockDoc('photo'))).toBe('Edited');
  });
});
