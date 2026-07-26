// The model's standing view of the combinable world: gists only (full text via read_sources).
import type { MockDoc, ProgramId } from '../scenarios';
import type { Artifact, ArtifactState } from './types';
import { MAX_ARTIFACTS } from './artifactStore';
import { feedsSummary } from './feeds';

// Shared by serializeArtifacts (the standing [ARTIFACTS] hint) and combineTools.sourceDetail
// (the [CORPUS DETAIL]-style read) — one template for the id/title/kind/rev/provenance header
// so the two model-facing surfaces can never drift on the rev value the handshake depends on.
export function artifactHeader(a: Artifact): string {
  const feeds = a.kind === 'widget' ? feedsSummary(a.fields) : null;
  return `${a.id} "${a.title}" (${a.kind}, rev ${a.rev}, from: ${a.sources.join(' + ')}${feeds ? `; feeds: ${feeds}` : ''})`;
}

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
  const items = state.artifacts.map(artifactHeader);
  const capNote = state.rejectedAtCap > 0 ? ` ${state.rejectedAtCap} creation${state.rejectedAtCap === 1 ? ' was' : 's were'} rejected at the ${MAX_ARTIFACTS}-artifact cap — the user must close one first.` : '';
  // The rev in each item IS the handshake: refine_artifact must echo it back as baseRev, which
  // is what makes positional part ids ("paragraph 2") safe across revisions.
  const staleNote = state.rejectedStale > 0 ? ` ${state.rejectedStale} revision${state.rejectedStale === 1 ? ' was' : 's were'} rejected as stale — read the current rev before revising.` : '';
  return `[ARTIFACTS: ${items.join('; ') || 'none'}.${capNote}${staleNote} Artifacts are valid combine sources; refine_artifact changes one in place. DO NOT acknowledge this update.]`;
}
