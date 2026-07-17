// Pure reducer over the user's strokes. The agent has no tools that reach this store;
// sketch.replace exists solely for the WITNESSED beautify commit (spec §2/§7).
import type { SketchState, SketchEvent, Stroke } from './types';
import { classify, pathLength, MIN_POINTS, MIN_PATH_LEN } from './classify';

export const MAX_STROKES = 64;

export function initialSketchState(): SketchState {
  return { strokes: [], nextId: 1, droppedAtCap: 0 };
}

export function reduce(state: SketchState, event: SketchEvent): SketchState {
  switch (event.type) {
    case 'sketch.strokeAdd': {
      if (event.points.length < MIN_POINTS || pathLength(event.points) < MIN_PATH_LEN) return state; // a tap, not a stroke
      const stroke: Stroke = { id: `s${state.nextId}`, points: event.points, classified: classify(event.points) };
      const strokes = [...state.strokes, stroke];
      const over = strokes.length - MAX_STROKES;
      return {
        strokes: over > 0 ? strokes.slice(over) : strokes,
        nextId: state.nextId + 1,
        droppedAtCap: state.droppedAtCap + Math.max(0, over),
      };
    }
    case 'sketch.clear':
      return { strokes: [], nextId: state.nextId, droppedAtCap: 0 };
    case 'sketch.replace':
      return { ...state, strokes: state.strokes.filter((s) => !event.removeIds.includes(s.id)) };
    default:
      return state;
  }
}
