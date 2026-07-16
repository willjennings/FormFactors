import React from 'react';
import { X } from 'lucide-react';
import type { Artifact } from './types';

// A synthesized artifact rendered as a floating window (whiteboard-panel styling family).
// Create-only: the agent has no tool that maps to closing one — the × below is the ONLY
// close path (spec §7). Cascades by index so several artifacts don't stack exactly on top
// of each other or cover the program window.
export function ArtifactWindow({ artifact, index, onClose }: {
  artifact: Artifact; index: number; onClose: () => void;
}) {
  return (
    <div
      className="artifact-window absolute z-30 flex flex-col w-[min(360px,42vw)] max-h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden"
      style={{ top: `calc(5rem + ${index * 24}px)`, left: `calc(55% + ${index * 16}px)` }}
      data-shell
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 px-3 h-8 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[var(--accent-color)]">{artifact.kind}</span>
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{artifact.title}</span>
        </div>
        <button aria-label="Close artifact" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0" onClick={onClose}><X size={13} /></button>
      </div>
      {/* Provenance is permanent, not a hover tooltip — the honesty floor for a synthesized
          artifact is that its origin is always visible, never buried behind an interaction. */}
      <div className="px-3 py-1 text-[9px] font-mono text-[var(--text-secondary)] border-b border-[var(--card-border)] truncate" title={`from: ${artifact.sources.join(' + ')}`}>
        from: {artifact.sources.join(' + ')}
      </div>
      <div data-entity-id={`artifact-${artifact.id}`} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] text-[var(--text-primary)] leading-relaxed">
        {artifact.kind === 'doc' && (artifact.content ?? '').split(/\n+/).filter(Boolean).map((p, i) => (
          <p key={i} className="mb-2 last:mb-0">{p}</p>
        ))}
        {artifact.kind === 'widget' && (
          <div className="flex flex-col gap-1">
            {(artifact.fields ?? []).map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--text-secondary)]">{f.label}</span>
                <span className="text-[var(--text-primary)]">{f.value ?? (f.feed ? `[${f.feed}]` : '')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
