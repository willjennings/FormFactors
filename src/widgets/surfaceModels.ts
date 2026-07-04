import type { MockDoc } from '../scenarios';
import { WORD_FILENAME } from '../scenarios';

// Pure view models for the program surfaces (pattern: spreadsheetGrid). Components stay thin.

const status = (saved: boolean, savedAs?: string): string =>
  saved ? (savedAs ? `Saved as ${savedAs}` : 'Saved') : 'Edited';

export function buildWordModel(doc: Extract<MockDoc, { kind: 'word' }>) {
  return { filename: WORD_FILENAME, statusLabel: status(doc.saved, doc.savedAs), heading: doc.heading, text: doc.text, bold: doc.bold };
}

export function buildPptModel(doc: Extract<MockDoc, { kind: 'powerpoint' }>) {
  return { slides: doc.slides, currentTitle: doc.slides[doc.slides.length - 1] ?? '', transition: doc.transition, statusLabel: status(doc.saved) };
}

export function buildPhotoModel(doc: Extract<MockDoc, { kind: 'photo' }>) {
  return {
    filterCss: `brightness(${100 + doc.brightness * 18}%)`, // matches MockPreview's scale
    cropped: doc.cropped, resized: doc.resized, bgRemoved: doc.bgRemoved,
    statusLabel: status(doc.saved),
  };
}
