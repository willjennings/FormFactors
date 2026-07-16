// User sketch strokes on the whiteboard's 0-1000 plane. The agent has NO tools that touch
// these — ownership is the store boundary (spec §2); the one bridge is the witnessed beautify.
export type XY = { x: number; y: number };

export type Classified =
  | { kind: 'box' | 'ellipse' | 'scribble'; bbox: [number, number, number, number] } // [ymin,xmin,ymax,xmax]
  | { kind: 'line' | 'arrow'; bbox: [number, number, number, number]; from: XY; to: XY };

export interface Stroke { id: string; points: XY[]; classified: Classified }

export type SketchEvent =
  | { type: 'sketch.strokeAdd'; points: XY[] }         // complete stroke, on pointer-up
  | { type: 'sketch.clear' }                           // user's clear button
  | { type: 'sketch.replace'; removeIds: string[] };   // beautify commit ONLY (post-confirm)

export interface SketchState { strokes: Stroke[]; nextId: number; droppedAtCap: number }
