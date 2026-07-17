import React from 'react';
import { X } from 'lucide-react';
import type { Artifact } from './types';
import { FEEDS } from './feeds';

// Status of one widget field bound to a feed: `failed` never clears a previously-fetched
// value/stamp — the renderer shows "feed unavailable" plus the stale value labeled as stale
// with its OLD timestamp, never a stale value passing as fresh (spec §8/§9).
interface FieldStatus { value?: string; updatedAt?: number; failed: boolean }

// Same locale format as the clock feed's value — a clock reading "2:30:05 PM" must not sit
// over an "updated 14:30:05" stamp (final review M5).
function fmtStamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

// A synthesized artifact rendered as a floating window (whiteboard-panel styling family).
// Create-only: the agent has no tool that maps to closing one — the × below is the ONLY
// close path (spec §7). Cascades by index so several artifacts don't stack exactly on top
// of each other or cover the program window.
export function ArtifactWindow({ artifact, index, onClose }: {
  artifact: Artifact; index: number; onClose: () => void;
}) {
  const fields = artifact.fields ?? [];
  const [statuses, setStatuses] = React.useState<Record<number, FieldStatus>>({});

  // Per-window ticker (spec §8): one interval per window, cadence = the fastest bound feed's
  // refreshMs (floored at 1s), cleaned up on unmount. The interval is the heartbeat, not a
  // per-field read cadence — each field is only actually re-read once ITS OWN refreshMs has
  // elapsed (lastAttemptRef), so e.g. a 10-minute weather feed isn't hit every second just
  // because it shares a window with a 1s clock. Fields are create-only (the agent never
  // mutates an artifact after creation — spec §7), so the bound-feed set is stable for the
  // window's lifetime.
  const lastAttemptRef = React.useRef<Record<number, number>>({});
  React.useEffect(() => {
    if (artifact.kind !== 'widget') return;
    const bound = fields
      .map((f, i) => ({ i, feed: f.feed ? FEEDS[f.feed] : undefined }))
      .filter((b): b is { i: number; feed: typeof FEEDS[keyof typeof FEEDS] } => !!b.feed);
    if (!bound.length) return;
    lastAttemptRef.current = {};

    let cancelled = false;
    const tick = () => {
      const now = Date.now();
      for (const { i, feed } of bound) {
        const last = lastAttemptRef.current[i] ?? -Infinity;
        if (now - last < feed.refreshMs) continue; // not due yet at this feed's own cadence
        lastAttemptRef.current[i] = now;
        Promise.resolve(feed.read(now)).then((value) => {
          if (cancelled) return;
          setStatuses((prev) => ({ ...prev, [i]: { value, updatedAt: now, failed: false } }));
        }).catch(() => {
          if (cancelled) return;
          // Keep the stale value + its OLD stamp untouched — only flip `failed`.
          setStatuses((prev) => ({ ...prev, [i]: { value: prev[i]?.value, updatedAt: prev[i]?.updatedAt, failed: true } }));
        });
      }
    };
    tick();
    const intervalMs = Math.max(1000, Math.min(...bound.map(({ feed }) => feed.refreshMs)));
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.kind, artifact.id]);

  // No root stopPropagation (unlike WhiteboardPanel): pointer events must reach <main> so the
  // plane's data-entity-id carve-out can make the CONTENT region pointable. data-shell still
  // marks the chrome (title bar, provenance line, ×) as not-the-plane via that same carve-out.
  return (
    <div
      className="artifact-window absolute z-30 flex flex-col w-[min(360px,42vw)] max-h-[min(420px,60vh)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 backdrop-blur shadow-lg overflow-hidden"
      style={{ top: `calc(5rem + ${index * 24}px)`, left: `calc(55% + ${index * 16}px)` }}
      data-shell
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
          <div className="flex flex-col gap-2">
            {fields.map((f, i) => {
              const descriptor = f.feed ? FEEDS[f.feed] : undefined;
              const status = statuses[i];
              const displayValue = descriptor
                ? (status?.failed ? 'feed unavailable' : status?.value ?? '…')
                : (f.value ?? '');
              return (
                <div key={i} className="flex flex-col gap-0.5 text-[11px] font-mono">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--text-secondary)]">{f.label}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {descriptor && (
                        <span
                          className={`text-[8px] font-mono uppercase tracking-widest px-1 py-0.5 rounded ${
                            descriptor.provenance === 'live'
                              ? 'bg-emerald-500/15 text-emerald-600'
                              : 'bg-amber-500/15 text-amber-600'
                          }`}
                        >
                          {descriptor.provenance === 'live' ? 'LIVE' : 'SIMULATED'}
                        </span>
                      )}
                      <span className="text-[var(--text-primary)]">{displayValue}</span>
                    </span>
                  </div>
                  {descriptor && status?.updatedAt !== undefined && (
                    <div className="text-right text-[9px] text-[var(--text-secondary)]">
                      {status.failed ? `stale — updated ${fmtStamp(status.updatedAt)}` : `updated ${fmtStamp(status.updatedAt)}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
