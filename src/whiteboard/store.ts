import type { WhiteboardState, WbEvent, WbMark } from './types';

export const MAX_MARKS = 32;

export function initialWhiteboardState(): WhiteboardState {
  return { marks: [], nextId: 1 };
}

export function reduce(state: WhiteboardState, event: WbEvent): WhiteboardState {
  switch (event.type) {
    case 'wb.add': {
      const spec = event.spec;
      if (spec.kind === 'node') {
        // Replace-by-key in place if the key exists, else append (capped).
        const idx = state.marks.findIndex((m) => m.kind === 'node' && m.key === spec.key);
        if (idx >= 0) {
          const marks = state.marks.map((m, i) => (i === idx ? spec : m));
          return { ...state, marks };
        }
        const marks = [...state.marks, spec].slice(-MAX_MARKS);
        return { ...state, marks };
      }
      // connector | label: stamp a deterministic id.
      const mark = { ...spec, id: String(state.nextId) } as WbMark;
      const marks = [...state.marks, mark].slice(-MAX_MARKS);
      return { marks, nextId: state.nextId + 1 };
    }
    case 'wb.clear':
      return { marks: [], nextId: state.nextId };
    default:
      return state;
  }
}
