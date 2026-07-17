// The model's standing view of the combinable world: gists only (full text via read_sources).
import type { MockDoc, ProgramId } from '../scenarios';
import type { ArtifactState } from './types';
import { MAX_ARTIFACTS } from './artifactStore';
import { feedsSummary } from './feeds';

function gist(id: string, doc: MockDoc): string {
  switch (doc.kind) {
    case 'word': return `${id}: "${doc.text.slice(0, 40)}${doc.text.length > 40 ? '…' : ''}" (${doc.text.split(/\s+/).length} words)`;
    case 'excel': return `${id}: ${Object.keys(doc.cells).length} filled cells`;
    case 'powerpoint': return `${id}: ${doc.slides.length} slides ("${doc.slides[0]}")`;
    case 'photo': return `${id}: photo${doc.caption ? ` — caption "${doc.caption}"` : ''}`;
  }
}

export function serializeCorpus(corpus: Partial<Record<ProgramId, MockDoc>>): string | null {
  const entries = (Object.entries(corpus) as [ProgramId, MockDoc][]).filter(([, d]) => d);
  if (!entries.length) return null;
  return `[CORPUS: sources available to combine — ${entries.map(([id, d]) => gist(id, d)).join(' · ')}. Call read_sources for full content before combining. DO NOT acknowledge this update.]`;
}

export function serializeArtifacts(state: ArtifactState): string | null {
  if (!state.artifacts.length && state.rejectedAtCap === 0) {
    // Boot (nothing ever created) stays silent; but once artifacts HAVE existed, an empty
    // desk must be said out loud — a model that saw a1 keeps believing in it otherwise
    // (final review M1: the map self-corrected only through a failed combine).
    if (state.nextId === 1) return null;
    return '[ARTIFACTS: none — the user closed every artifact window. DO NOT acknowledge this update.]';
  }
  // Widget entries append per-field feed provenance (spec §8): the hint carries the same
  // LIVE/SIMULATED labels the chips render, so the model never claims simulated data is real.
  const items = state.artifacts.map((a) => {
    const feeds = a.kind === 'widget' ? feedsSummary(a.fields) : null;
    return `${a.id} "${a.title}" (${a.kind}, from: ${a.sources.join(' + ')}${feeds ? `; feeds: ${feeds}` : ''})`;
  });
  const capNote = state.rejectedAtCap > 0 ? ` ${state.rejectedAtCap} creation${state.rejectedAtCap === 1 ? ' was' : 's were'} rejected at the ${MAX_ARTIFACTS}-artifact cap — the user must close one first.` : '';
  return `[ARTIFACTS: ${items.join('; ') || 'none'}.${capNote} Artifacts are valid combine sources. DO NOT acknowledge this update.]`;
}
