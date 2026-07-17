import type { ArtifactState, ArtifactEvent, Artifact } from './types';

export const MAX_ARTIFACTS = 6;

export function initialArtifactState(): ArtifactState {
  return { artifacts: [], nextId: 1, rejectedAtCap: 0 };
}

export function reduce(state: ArtifactState, event: ArtifactEvent): ArtifactState {
  switch (event.type) {
    case 'artifact.create': {
      // Reject, never evict (spec §7): a creation the user welcomes must never silently
      // destroy something they did not agree to lose. rejectedAtCap surfaces in [ARTIFACTS].
      if (state.artifacts.length >= MAX_ARTIFACTS) return { ...state, rejectedAtCap: state.rejectedAtCap + 1 };
      const artifact: Artifact = { ...event.artifact, id: `a${state.nextId}` };
      return { artifacts: [...state.artifacts, artifact], nextId: state.nextId + 1, rejectedAtCap: state.rejectedAtCap };
    }
    case 'artifact.close':
      return { ...state, artifacts: state.artifacts.filter((a) => a.id !== event.id) };
    default:
      return state;
  }
}
