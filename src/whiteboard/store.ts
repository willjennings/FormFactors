import type { WhiteboardState, WbEvent, WbMark } from './types';

export const MAX_MARKS = 32;

export function initialWhiteboardState(): WhiteboardState {
  return { marks: [], nextId: 1, droppedAtCap: 0 };
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
        const grown = [...state.marks, spec];
        const marks = grown.slice(-MAX_MARKS);
        // No silent truncation (probe 2026-07-16): count evictions so [WHITEBOARD] can say so.
        return { ...state, marks, droppedAtCap: state.droppedAtCap + (grown.length - marks.length) };
      }
      // connector | label: stamp a deterministic id.
      const mark = { ...spec, id: String(state.nextId) } as WbMark;
      const grown = [...state.marks, mark];
      const marks = grown.slice(-MAX_MARKS);
      return { marks, nextId: state.nextId + 1, droppedAtCap: state.droppedAtCap + (grown.length - marks.length) };
    }
    case 'wb.clear':
      return { marks: [], nextId: state.nextId, droppedAtCap: 0 };
    default:
      return state;
  }
}
