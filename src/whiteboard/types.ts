// Free-coordinate diagram marks (the whiteboard). Nodes carry a model-supplied key so connectors
// wire to them; connectors/labels get a deterministic id from the store.
export type WbShape = 'box' | 'ellipse';

export type WbMark =
  | { kind: 'node'; key: string; x: number; y: number; text: string; shape: WbShape } // (x,y) 0-1000, box center
  | { kind: 'connector'; id: string; from: string; to: string; label?: string }        // from/to = node keys
  | { kind: 'label'; id: string; x: number; y: number; text: string };

export type WbSpec =
  | Extract<WbMark, { kind: 'node' }>
  | Omit<Extract<WbMark, { kind: 'connector' }>, 'id'>
  | Omit<Extract<WbMark, { kind: 'label' }>, 'id'>;

export type WbEvent =
  | { type: 'wb.add'; spec: WbSpec }
  | { type: 'wb.clear' };

export interface WhiteboardState { marks: WbMark[]; nextId: number }
