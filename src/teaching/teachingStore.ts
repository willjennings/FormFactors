import type { TeachingState, TeachingEvent, TeachStep, TeachSequence } from './types';

export function initialTeachingState(): TeachingState {
  return { posture: 'guide', sequence: null, highlights: [], relations: [], competence: {}, revealRequested: false };
}

const MAX_HIGHLIGHTS = 8;
const MAX_RELATIONS = 6;

function fade(state: TeachingState, taskKey: string): number {
  return Math.min(2, state.competence[taskKey] ?? 0);
}

/** Mark the active step done and activate the next; on completion, credit competence. */
function advance(state: TeachingState, seq: TeachSequence): TeachingState {
  if (seq.activeIndex === null) return state;
  const steps = seq.steps.map((s, i): TeachStep =>
    i === seq.activeIndex ? { ...s, state: 'done' }
    : i === seq.activeIndex! + 1 ? { ...s, state: 'active' }
    : s);
  const nextIndex = seq.activeIndex + 1 < seq.steps.length ? seq.activeIndex + 1 : null;
  const completed = nextIndex === null;
  return {
    ...state,
    revealRequested: false,
    sequence: { ...seq, steps, activeIndex: nextIndex },
    competence: completed
      ? { ...state.competence, [seq.taskKey]: (state.competence[seq.taskKey] ?? 0) + 1 }
      : state.competence,
  };
}

export function reduce(state: TeachingState, event: TeachingEvent, now: number): TeachingState {
  switch (event.type) {
    case 'teach.highlight':
      return { ...state, highlights: [...state.highlights, { entityId: event.entityId, note: event.note, at: now }].slice(-MAX_HIGHLIGHTS) };
    case 'teach.sequence': {
      if (!event.steps.length) return state;
      const steps: TeachStep[] = event.steps.map((s, i) => ({ ...s, state: i === 0 ? 'active' : 'pending' }));
      return {
        ...state,
        posture: event.posture,
        revealRequested: false,
        sequence: {
          title: event.title, taskKey: event.taskKey, posture: event.posture, steps,
          activeIndex: 0, softBlock: fade(state, event.taskKey) === 0,
          paused: false, blockedAttempts: 0,
        },
      };
    }
    case 'teach.stepAdvance': {
      const seq = state.sequence;
      if (!seq || seq.paused || seq.activeIndex === null) return state;
      // teach posture: the agent may only advance the worked first step.
      if (seq.posture === 'teach' && seq.activeIndex > 0) return state;
      return advance(state, seq);
    }
    case 'user.stepAction': {
      const seq = state.sequence;
      if (!seq || seq.paused || seq.activeIndex === null) return state;
      const target = seq.steps[seq.activeIndex];
      if (event.entityId === target.entityId) return advance(state, seq);
      if (seq.softBlock) {
        return { ...state, sequence: { ...seq, blockedAttempts: seq.blockedAttempts + 1, lastBlocked: { entityId: event.entityId, at: now } } };
      }
      return state;
    }
    case 'teach.relate':
      return { ...state, relations: event.relations.slice(0, MAX_RELATIONS) };
    case 'teach.clear':
      return { ...state, sequence: null, highlights: [], relations: [], revealRequested: false };
    case 'user.reveal':
      return { ...state, revealRequested: true };
    case 'user.pause':
      return state.sequence ? { ...state, sequence: { ...state.sequence, paused: true } } : state;
    case 'user.resume':
      return state.sequence ? { ...state, sequence: { ...state.sequence, paused: false } } : state;
    case 'user.dismiss':
      return { ...state, sequence: null, revealRequested: false };
    default:
      return state;
  }
}
