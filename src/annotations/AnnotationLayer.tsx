import React, { useEffect, useReducer } from 'react';
import type { SceneEntity } from '../entities/registry';
import type { AnnotationState, AnnotationEvent } from './types';
import { initialAnnotationState, reduce } from './annotationStore';
import { bboxOf, center, unionBbox, placementPoint } from './geometry';

const pct = (v: number) => v / 10; // 0-1000 → percent (SVG viewBox is 0..100)

type Props = {
  entities: SceneEntity[];
  demo?: boolean;
  dispatchRef?: React.MutableRefObject<((e: AnnotationEvent) => void) | null>;
  onStateChange?: (s: AnnotationState) => void;
};

const INK = 'rgb(99,102,241)'; // indigo — matches the relate arc

export function AnnotationLayer({ entities, dispatchRef, onStateChange }: Props) {
  const [state, dispatch] = useReducer(reduce, undefined, initialAnnotationState);

  useEffect(() => {
    if (!dispatchRef) return;
    dispatchRef.current = dispatch;
    return () => { dispatchRef.current = null; };
  }, [dispatchRef]);

  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);

  return (
    <div className="absolute inset-0 z-[55] pointer-events-none" data-annotation-layer>
      <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="ann-arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill={INK} />
          </marker>
        </defs>
        {state.annotations.map((a) => {
          if (a.kind === 'arrow') {
            const bf = bboxOf(entities, a.from), bt = bboxOf(entities, a.to);
            if (!bf || !bt) return null;
            const p = center(bf), q = center(bt);
            const mx = (pct(p.x) + pct(q.x)) / 2, my = (pct(p.y) + pct(q.y)) / 2 - 6;
            return (
              <g key={a.id}>
                <path d={`M ${pct(p.x)} ${pct(p.y)} Q ${mx} ${my} ${pct(q.x)} ${pct(q.y)}`}
                      fill="none" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke"
                      markerEnd="url(#ann-arrowhead)" />
                {a.label && <text x={mx} y={my - 1} textAnchor="middle" fontSize={2.5} className="fill-indigo-500 font-mono">{a.label}</text>}
              </g>
            );
          }
          if (a.kind === 'shape') {
            const u = unionBbox(a.targets.map((t) => bboxOf(entities, t)).filter((b): b is NonNullable<typeof b> => b !== null));
            if (!u) return null;
            const x = pct(u[1]) - 1, y = pct(u[0]) - 1, w = pct(u[3] - u[1]) + 2, h = pct(u[2] - u[0]) + 2;
            const common = { fill: 'none', stroke: INK, strokeWidth: 0.4, vectorEffect: 'non-scaling-stroke' as const };
            return (
              <g key={a.id}>
                {a.shape === 'circle'
                  ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
                  : a.shape === 'box'
                    ? <rect x={x} y={y} width={w} height={h} rx={1} {...common} />
                    : <path d={`M ${x} ${y} L ${x - 1.5} ${y} L ${x - 1.5} ${y + h} L ${x} ${y + h}`} {...common} />}
                {a.label && <text x={x + w / 2} y={y - 1} textAnchor="middle" fontSize={2.5} className="fill-indigo-500 font-mono">{a.label}</text>}
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
              <line x1={pct(anchor.x)} y1={pct(anchor.y)} x2={lx} y2={ly} stroke={INK} strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
              <text x={lx} y={ly} textAnchor="middle" fontSize={2.6} className="fill-indigo-500 font-mono">{a.text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
