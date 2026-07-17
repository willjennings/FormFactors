import React from 'react';
import type { WhiteboardState, WbMark } from './types';
import { nodeBox, connectorEnds } from './geometry';
import { seedFrom, roughLine, roughRect, roughEllipse, roughArrowhead } from '../ink/rough';

const pct = (v: number) => v / 10; // 0-1000 → percent (viewBox 0..100)
const INK = 'rgb(99,102,241)';

export function WhiteboardMarks({ state }: { state: WhiteboardState }) {
  const nodes = state.marks.filter((m): m is Extract<WbMark, { kind: 'node' }> => m.kind === 'node');
  return (
    <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      {/* connectors first (under nodes) */}
      {state.marks.map((m) => {
        if (m.kind !== 'connector') return null;
        const ends = connectorEnds(state.marks, m);
        if (!ends) return null;
        const x1 = pct(ends.from.x), y1 = pct(ends.from.y), x2 = pct(ends.to.x), y2 = pct(ends.to.y);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        return (
          <g key={m.id} stroke={INK} fill="none" strokeWidth="0.4" strokeLinecap="round" vectorEffect="non-scaling-stroke">
            <path d={roughLine(x1, y1, x2, y2, seedFrom(m.id))} vectorEffect="non-scaling-stroke" />
            <path d={roughArrowhead(x2, y2, angle, seedFrom(m.id + '/head'))} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
      {nodes.map((n) => {
        const [ymin, xmin, ymax, xmax] = nodeBox(n);
        const x = pct(xmin), y = pct(ymin), w = pct(xmax - xmin), h = pct(ymax - ymin);
        return (
          <g key={n.key}>
            {/* crisp fill inset behind the rough stroke keeps text readable over other marks */}
            {n.shape === 'ellipse'
              ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.max(0, w / 2 - 0.4)} ry={Math.max(0, h / 2 - 0.4)} fill="var(--card-bg)" />
              : <rect x={x + 0.4} y={y + 0.4} width={Math.max(0, w - 0.8)} height={Math.max(0, h - 0.8)} rx={1.5} fill="var(--card-bg)" />}
            <path
              d={n.shape === 'ellipse'
                ? roughEllipse(x + w / 2, y + h / 2, w / 2, h / 2, seedFrom(n.key))
                : roughRect(x, y, w, h, seedFrom(n.key))}
              fill="none" stroke={INK} strokeWidth="0.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <text x={x + w / 2} y={y + h / 2 + 0.8} textAnchor="middle" fontSize={3.2} className="fill-[var(--text-primary)] font-ink">{n.text}</text>
          </g>
        );
      })}
      {/* connector labels last (above node fills — Caveat runs wider than the old mono) */}
      {state.marks.map((m) => m.kind === 'connector' && m.label
        ? (() => {
            const ends = connectorEnds(state.marks, m);
            if (!ends) return null;
            return <text key={m.id + '/label'} x={(pct(ends.from.x) + pct(ends.to.x)) / 2} y={(pct(ends.from.y) + pct(ends.to.y)) / 2 - 1} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{m.label}</text>;
          })()
        : null)}
      {state.marks.map((m) => m.kind === 'label'
        ? <text key={m.id} x={pct(m.x)} y={pct(m.y)} textAnchor="middle" fontSize={3.2} className="fill-indigo-500 font-ink">{m.text}</text>
        : null)}
    </svg>
  );
}
