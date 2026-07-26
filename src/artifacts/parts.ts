// Part identity — the SINGLE definition of "paragraph 2" / "field 3", consumed by the reducer,
// the entity deriver, AND the renderer. If any of the three reimplemented the split, the user
// could point at what the screen calls paragraph 2 while the model received paragraph 3.
import type { Artifact, ArtifactPatch, WidgetField } from './types';

export interface Part { index: number; id: string; label?: string; text: string }

/** Byte-identical to the split ArtifactWindow has always rendered with — do not "improve" it
 *  here without changing the renderer in the same commit, or ids drift from pixels. */
export function splitParagraphs(content: string | undefined): string[] {
  return (content ?? '').split(/\n+/).filter(Boolean);
}

export function artifactParts(a: Artifact): Part[] {
  if (a.kind === 'widget') {
    return (a.fields ?? []).map((f, i) => ({
      index: i + 1, id: `field-${i + 1}`, label: f.label, text: f.value ?? '',
    }));
  }
  return splitParagraphs(a.content).map((text, i) => ({ index: i + 1, id: `para-${i + 1}`, text }));
}

/** Apply a patch, or return null meaning "no legal result". Null is not an error message —
 *  validateRefineCall pre-checks each rule so the MODEL gets a specific remedy; null is the
 *  reducer's last line of defence and the no-op detector. */
export function applyPatch(a: Artifact, p: ArtifactPatch): Artifact | null {
  if (p.op === 'retitle') {
    const title = p.title.trim();
    if (!title || title === a.title) return null;
    return { ...a, title };
  }

  const parts = artifactParts(a);

  if (p.op === 'add-part') {
    const at = p.index ?? parts.length + 1;
    if (at < 1 || at > parts.length + 1) return null;
    const text = (p.text ?? '').trim();
    if (!text) return null;
    if (a.kind === 'widget') {
      const label = (p.label ?? '').trim();
      if (!label) return null;                       // a nameless field is unpointable
      const fields = [...(a.fields ?? [])];
      fields.splice(at - 1, 0, { label, value: text });
      return { ...a, fields };
    }
    const paras = splitParagraphs(a.content);
    paras.splice(at - 1, 0, text);
    return { ...a, content: paras.join('\n\n') };
  }

  // replace-part / remove-part address an EXISTING part.
  if (p.index < 1 || p.index > parts.length) return null;

  if (p.op === 'remove-part') {
    if (parts.length === 1) return null;             // never leave an artifact with nothing
    if (a.kind === 'widget') {
      return { ...a, fields: (a.fields ?? []).filter((_, i) => i !== p.index - 1) };
    }
    return { ...a, content: splitParagraphs(a.content).filter((_, i) => i !== p.index - 1).join('\n\n') };
  }

  const text = p.text?.trim();
  const label = p.label?.trim();
  if (text === undefined && label === undefined) return null;
  if (text !== undefined && !text) return null;
  if (label !== undefined && !label) return null;

  if (a.kind === 'widget') {
    const fields = [...(a.fields ?? [])];
    const current = fields[p.index - 1];
    // A feed-bound field's VALUE is fetched live and chipped LIVE/SIMULATED. Letting a refine
    // write it would launder authored text as real data — the exact seam the chips protect.
    if (text !== undefined && current.feed) return null;
    const next: WidgetField = { ...current };
    if (label !== undefined) next.label = label;
    if (text !== undefined) next.value = text;
    if (next.label === current.label && next.value === current.value) return null;
    fields[p.index - 1] = next;
    return { ...a, fields };
  }

  if (label !== undefined) return null;              // docs have no field labels
  const paras = splitParagraphs(a.content);
  if (paras[p.index - 1] === text) return null;      // already reads exactly that
  paras[p.index - 1] = text!;
  return { ...a, content: paras.join('\n\n') };
}
