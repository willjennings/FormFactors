import React, { useEffect, useReducer, useRef } from 'react';
import type { SceneEntity } from '../entities/registry';
import type { Program } from '../scenarios';
import type { AnnotationState, AnnotationEvent } from './types';
import { initialAnnotationState, reduce } from './annotationStore';
import { bboxOf, center, unionBbox, placementPoint } from './geometry';
import { buildIllustrateScript } from './illustrateDemo';
import { seedFrom, roughLine } from '../ink/rough';
import { inkLine, inkQuad, inkRect, inkEllipse, inkArrowhead } from '../ink/stroke';
import { useAspect } from '../ink/useAspect';

const pct = (v: number) => v / 10; // 0-1000 → percent (SVG viewBox is 0..100)

type Props = {
  entities: SceneEntity[];
  program: Program;
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: AnnotationEvent) => void) | null>;
  onStateChange?: (s: AnnotationState) => void;
};

const INK = 'rgb(99,102,241)'; // indigo — matches the relate arc

export function AnnotationLayer({ entities, program, demo = false, dispatchRef, onStateChange }: Props) {
  const [state, dispatch] = useReducer(reduce, undefined, initialAnnotationState);
  const [svgRef, aspect] = useAspect<SVGSVGElement>();

  useEffect(() => {
    if (!dispatchRef) return;
    dispatchRef.current = dispatch;
    return () => { dispatchRef.current = null; };
  }, [dispatchRef]);

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  // Demo driver: play the illustration script once entities exist. StrictMode-safe — `played`
  // is set when the first event FIRES, and cleanup re-arms only if nothing fired yet.
  const scheduled = useRef(false);
  const played = useRef(false);
  useEffect(() => {
    if (!demo || scheduled.current || entities.length < 4) return;
    scheduled.current = true;
    const timers = buildIllustrateScript(program, entities).map(({ at, event }) =>
      setTimeout(() => { played.current = true; dispatch(event); }, at));
    return () => {
      timers.forEach(clearTimeout);
      if (!played.current) scheduled.current = false;
    };
  }, [demo, entities, program]);

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none" data-annotation-layer>
      <svg ref={svgRef} className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        {state.annotations.map((a) => {
          if (a.kind === 'arrow') {
            const bf = bboxOf(entities, a.from), bt = bboxOf(entities, a.to);
            if (!bf || !bt) return null;
            const p = center(bf), q = center(bt);
            const mx = (pct(p.x) + pct(q.x)) / 2, my = (pct(p.y) + pct(q.y)) / 2 - 6;
            const angle = Math.atan2(pct(q.y) - my, pct(q.x) - mx); // approach direction from ctrl → tip
            return (
              <g key={a.id} fill={INK}>
                <path d={inkQuad(pct(p.x), pct(p.y), mx, my, pct(q.x), pct(q.y), seedFrom(a.id), { aspect })} />
                <path d={inkArrowhead(pct(q.x), pct(q.y), angle, seedFrom(a.id + '/head'), { aspect })} />
                {a.label && <text x={mx} y={my - 1} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{a.label}</text>}
              </g>
            );
          }
          if (a.kind === 'shape') {
            const u = unionBbox(a.targets.map((t) => bboxOf(entities, t)).filter((b): b is NonNullable<typeof b> => b !== null));
            if (!u) return null;
            const x = pct(u[1]) - 1, y = pct(u[0]) - 1, w = pct(u[3] - u[1]) + 2, h = pct(u[2] - u[0]) + 2;
            const d = a.shape === 'circle'
              ? inkEllipse(x + w / 2, y + h / 2, w / 2, h / 2, seedFrom(a.id), { aspect })
              : a.shape === 'box'
                ? inkRect(x, y, w, h, seedFrom(a.id), { aspect })
                : [inkLine(x, y, x - 1.5, y, seedFrom(a.id), { aspect }),
                   inkLine(x - 1.5, y, x - 1.5, y + h, seedFrom(a.id + '/2'), { aspect }),
                   inkLine(x - 1.5, y + h, x, y + h, seedFrom(a.id + '/3'), { aspect })].join(' ');
            return (
              <g key={a.id}>
                <path d={d} fill={INK} />
                {a.label && <text x={x + w / 2} y={y - 1} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{a.label}</text>}
              </g>
            );
          }
          // label
          const b = bboxOf(entities, a.anchor);
          if (!b) return null;
          const anchor = placementPoint(b, a.placement);
          const dy = a.placement === 'top' ? -4 : a.placement === 'bottom' ? 4 : 0;
          const dx = a.placement === 'left' ? -6 : a.placement === 'right' ? 6 : 0;
          const lx = pct(anchor.x) + dx, ly = pct(anchor.y) + dy;
          return (
            <g key={a.id}>
              <path d={roughLine(pct(anchor.x), pct(anchor.y), lx, ly, seedFrom(a.id))} fill="none" stroke={INK} strokeWidth="0.3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <text x={lx} y={ly} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{a.text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
