import { applyPatch } from './parts';
import type { ArtifactState, ArtifactEvent, Artifact, ArtifactVersion } from './types';

export const MAX_ARTIFACTS = 6;

export function initialArtifactState(): ArtifactState {
  return { artifacts: [], nextId: 1, rejectedAtCap: 0, rejectedStale: 0 };
}

export function reduce(state: ArtifactState, event: ArtifactEvent): ArtifactState {
  switch (event.type) {
    case 'artifact.create': {
      // Reject, never evict (spec §7): a creation the user welcomes must never silently
      // destroy something they did not agree to lose. rejectedAtCap surfaces in [ARTIFACTS].
      if (state.artifacts.length >= MAX_ARTIFACTS) return { ...state, rejectedAtCap: state.rejectedAtCap + 1 };
      const artifact: Artifact = {
        ...event.artifact,
        // Always `a${n}`, never hyphenated — entityToSourceId's whole-vs-part split
        // (`artifact-a1` has exactly two `-`-segments, `artifact-a1-para-2` has more)
        // depends on the id itself containing no `-`.
        id: `a${state.nextId}`,
        rev: 1,
        // The creating meta reuses createdAt — the reducer must not read the clock.
        meta: { rev: 1, at: event.artifact.createdAt, owner: 'agent' },
        history: [],
      };
      return { ...state, artifacts: [...state.artifacts, artifact], nextId: state.nextId + 1 };
    }
    case 'artifact.close':
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== event.id) };
    case 'artifact.revise': {
      const i = state.artifacts.findIndex((a) => a.id === event.id);
      if (i < 0) return state;
      const a = state.artifacts[i];
      // Three-layer staleness, layer 3 (tool-time and confirm-time are in refineTools/App):
      // the model addressed a revision that no longer exists. Refuse and COUNT — [ARTIFACTS]
      // surfaces the counter so the model can see it is working from a stale read.
      if (event.baseRev !== a.rev) return { ...state, rejectedStale: state.rejectedStale + 1 };
      const patched = applyPatch(a, event.patch);
      if (!patched) return state;
      const prior: ArtifactVersion = {
        rev: a.rev, title: a.title, content: a.content, fields: a.fields, meta: a.meta,
      };
      const next: Artifact = {
        ...patched,
        rev: a.rev + 1,
        meta: { rev: a.rev + 1, at: event.at, owner: event.owner, note: event.note },
        history: [...a.history, prior],
      };
      // NOTE: no capacity check. A revision creates nothing, so MAX_ARTIFACTS must not apply —
      // otherwise a full desk would silently freeze every artifact on it.
      return { ...state, artifacts: state.artifacts.map((x, j) => (j === i ? next : x)) };
    }
    case 'artifact.revertTo': {
      const i = state.artifacts.findIndex((a) => a.id === event.id);
      if (i < 0) return state;
      const a = state.artifacts[i];
      const target = a.history.find((v) => v.rev === event.toRev);
      if (!target) return state;
      // A revert is itself a FORWARD revision: the abandoned branch stays in history, so the
      // user can revert the revert. Nothing in this store is ever erased.
      const prior: ArtifactVersion = {
        rev: a.rev, title: a.title, content: a.content, fields: a.fields, meta: a.meta,
      };
      const next: Artifact = {
        ...a,
        title: target.title, content: target.content, fields: target.fields,
        rev: a.rev + 1,
        meta: { rev: a.rev + 1, at: event.at, owner: 'user', note: `reverted to rev ${event.toRev}` },
        history: [...a.history, prior],
      };
      return { ...state, artifacts: state.artifacts.map((x, j) => (j === i ? next : x)) };
    }
    default:
      return state;
  }
}
