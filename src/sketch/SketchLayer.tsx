import React, { useRef, useState } from 'react';
import type { Stroke, XY } from './types';

const pct = (v: number) => v / 10; // 0-1000 → viewBox 0..100 (same transform as WhiteboardMarks)
const USER_INK = 'rgb(107,114,128)'; // graphite gray — the third ink, distinct from agent inks

/** Pointer-capture + render layer for USER strokes. Sits UNDER WhiteboardMarks (agent ink
 *  annotates over the user's sketch); marks are pointer-events-none so ink can start anywhere. */
export function SketchLayer({ strokes, onStroke }: { strokes: Stroke[]; onStroke: (points: XY[]) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawingRef = useRef<XY[] | null>(null);
  const [livePoints, setLivePoints] = useState<XY[] | null>(null);

  const toPlane = (e: React.PointerEvent): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 1000 };
  };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = [toPlane(e)];
    setLivePoints(drawingRef.current.slice());
  };
  const move = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current.push(toPlane(e));
    setLivePoints(drawingRef.current.slice());
  };
  const up = () => {
    if (drawingRef.current) onStroke(drawingRef.current);
    drawingRef.current = null;
    setLivePoints(null);
  };

  const poly = (points: XY[], key: string, faint = false) => (
    <polyline
      key={key}
      points={points.map((p) => `${pct(p.x)},${pct(p.y)}`).join(' ')}
      fill="none" stroke={USER_INK} strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"
      vectorEffect="non-scaling-stroke" opacity={faint ? 0.6 : 0.9}
    />
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full cursor-crosshair"
      style={{ touchAction: 'none' }}
      viewBox="0 0 100 100" preserveAspectRatio="none"
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
    >
      {strokes.map((s) => poly(s.points, s.id))}
      {livePoints && poly(livePoints, 'live', true)}
    </svg>
  );
}
