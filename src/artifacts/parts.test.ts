import { describe, it, expect } from 'vitest';
import { splitParagraphs, artifactParts, applyPatch } from './parts';
import type { Artifact } from './types';

const doc = (content: string): Artifact => ({
  id: 'a1', kind: 'doc', title: 'Brief', sources: ['word', 'excel'], content,
  createdAt: 1000, rev: 1, meta: { rev: 1, at: 1000, owner: 'agent' }, history: [],
});

const widget = (fields: Artifact['fields']): Artifact => ({
  id: 'a2', kind: 'widget', title: 'Board', sources: ['word', 'excel'], fields,
  createdAt: 1000, rev: 1, meta: { rev: 1, at: 1000, owner: 'agent' }, history: [],
});

describe('splitParagraphs', () => {
  it('matches the renderer split exactly — blank runs collapse, empties drop', () => {
    expect(splitParagraphs('one\n\ntwo\n\n\nthree\n')).toEqual(['one', 'two', 'three']);
  });
  it('is empty for undefined content', () => {
    expect(splitParagraphs(undefined)).toEqual([]);
  });
});

describe('artifactParts', () => {
  it('numbers doc paragraphs 1-based — the language the user speaks', () => {
    expect(artifactParts(doc('alpha\n\nbeta'))).toEqual([
      { index: 1, id: 'para-1', text: 'alpha' },
      { index: 2, id: 'para-2', text: 'beta' },
    ]);
  });
  it('numbers widget fields 1-based, carrying labels', () => {
    expect(artifactParts(widget([{ label: 'Lead', value: 'Harbor' }, { label: 'Time', feed: 'clock' }])))
      .toEqual([
        { index: 1, id: 'field-1', label: 'Lead', text: 'Harbor' },
        { index: 2, id: 'field-2', label: 'Time', text: '' },
      ]);
  });
});

describe('applyPatch', () => {
  it('replaces a doc paragraph', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'replace-part', index: 2, text: 'gamma' });
    expect(next?.content).toBe('alpha\n\ngamma');
  });
  it('inserts at the 1-based position the new part will occupy, shifting the rest down', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'add-part', index: 2, text: 'mid' });
    expect(splitParagraphs(next?.content)).toEqual(['alpha', 'mid', 'beta']);
  });
  it('appends when index is omitted', () => {
    const next = applyPatch(doc('alpha'), { op: 'add-part', text: 'beta' });
    expect(splitParagraphs(next?.content)).toEqual(['alpha', 'beta']);
  });
  it('removes a paragraph', () => {
    const next = applyPatch(doc('alpha\n\nbeta'), { op: 'remove-part', index: 1 });
    expect(splitParagraphs(next?.content)).toEqual(['beta']);
  });
  it('retitles', () => {
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: 'Shorter' })?.title).toBe('Shorter');
  });

  // The null cases — "no legal result". Each one is a distinct honesty rule.
  it('refuses an out-of-range index', () => {
    expect(applyPatch(doc('alpha'), { op: 'replace-part', index: 4, text: 'x' })).toBeNull();
  });
  it('refuses to leave an artifact with no content', () => {
    expect(applyPatch(doc('alpha'), { op: 'remove-part', index: 1 })).toBeNull();
  });
  it('refuses a no-op replace — the text already reads exactly that', () => {
    expect(applyPatch(doc('alpha\n\nbeta'), { op: 'replace-part', index: 1, text: 'alpha' })).toBeNull();
  });
  it('refuses a replace carrying neither text nor label', () => {
    expect(applyPatch(doc('alpha'), { op: 'replace-part', index: 1 })).toBeNull();
  });
  it('refuses a VALUE write to a feed-bound field — that value is LIVE, not authored', () => {
    const w = widget([{ label: 'Time', feed: 'clock' }]);
    expect(applyPatch(w, { op: 'replace-part', index: 1, text: '9:00 AM' })).toBeNull();
  });
  it('ALLOWS renaming a feed-bound field — only its value is the feed\'s', () => {
    const w = widget([{ label: 'Time', feed: 'clock' }, { label: 'Lead', value: 'Harbor' }]);
    const next = applyPatch(w, { op: 'replace-part', index: 1, label: 'Local time' });
    expect(next?.fields?.[0]).toEqual({ label: 'Local time', feed: 'clock' });
  });
  it('refuses an empty or unchanged retitle', () => {
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: '  ' })).toBeNull();
    expect(applyPatch(doc('alpha'), { op: 'retitle', title: 'Brief' })).toBeNull();
  });
});
