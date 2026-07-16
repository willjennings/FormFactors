import React from 'react';
import type { WhiteboardState, WbMark } from './types';
import { nodeBox, connectorEnds } from './geometry';

const pct = (v: number) => v / 10; // 0-1000 → percent (viewBox 0..100)
const INK = 'rgb(99,102,241)';

export function WhiteboardMarks({ state }: { state: WhiteboardState }) {
  const nodes = state.marks.filter((m): m is Extract<WbMark, { kind: 'node' }> => m.kind === 'node');
  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <marker id="wb-arrow" markerWidth="6" markerHeight="6" refX="4" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill={INK} />
        </marker>
      </defs>
      {/* connectors first (under nodes) */}
      {state.marks.map((m) => {
        if (m.kind !== 'connector') return null;
        const ends = connectorEnds(state.marks, m);
        if (!ends) return null;
        const x1 = pct(ends.from.x), y1 = pct(ends.from.y), x2 = pct(ends.to.x), y2 = pct(ends.to.y);
        return (
          <g key={m.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" markerEnd="url(#wb-arrow)" />
            {m.label && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 1} textAnchor="middle" fontSize={2.4} className="fill-indigo-500 font-mono">{m.label}</text>}
          </g>
        );
      })}
      {nodes.map((n) => {
        const [ymin, xmin, ymax, xmax] = nodeBox(n);
        const x = pct(xmin), y = pct(ymin), w = pct(xmax - xmin), h = pct(ymax - ymin);
        return (
          <g key={n.key}>
            {n.shape === 'ellipse'
              ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="var(--card-bg)" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
              : <rect x={x} y={y} width={w} height={h} rx={1.5} fill="var(--card-bg)" stroke={INK} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />}
            <text x={x + w / 2} y={y + h / 2 + 0.8} textAnchor="middle" fontSize={2.6} className="fill-[var(--text-primary)] font-mono">{n.text}</text>
          </g>
        );
      })}
      {state.marks.map((m) => m.kind === 'label'
        ? <text key={m.id} x={pct(m.x)} y={pct(m.y)} textAnchor="middle" fontSize={2.6} className="fill-indigo-500 font-mono">{m.text}</text>
        : null)}
    </svg>
  );
}
