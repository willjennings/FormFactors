import React from 'react';
import { Minus, X } from 'lucide-react';
import type { Artifact, ArtifactPatch } from './types';
import { FEEDS } from './feeds';
import { artifactParts, splitParagraphs } from './parts';
import type { WindowRect } from '../shell/windowState';
import type { WindowOrigin } from '../shell/desk/types';
import type { ShellSkin } from '../shell/skins/types';

type Chrome = ShellSkin['slots']['windowChrome'];

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
// Revisable in place by both the agent (refine_artifact) and the user (double-click to edit),
// with a revert-capable history — but closing stays USER-ONLY: the agent has no tool that maps
// to closing one, the × below is the ONLY close path (spec §7).
//
// Geometry, stacking and visibility come from the desk (spec §1) — the window no longer cascades
// itself off its array index, which is why two artifacts could previously sit at the same place
// after a third was closed. `rect.h` is the window's MAX height: the content is short and
// self-sizing, and nothing drags or resizes an artifact window in this phase.
export function ArtifactWindow({ artifact, rect, zIndex, chrome, origin, onFocus, onMinimize, onClose, onRevert, onEditPart }: {
  artifact: Artifact;
  rect: WindowRect;
  zIndex: number;
  chrome: Chrome;
  origin: WindowOrigin;
  onFocus: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onRevert: (toRev: number) => void;
  onEditPart: (patch: ArtifactPatch, baseRev: number) => void;
}) {
  const fields = artifact.fields ?? [];
  const [statuses, setStatuses] = React.useState<Record<number, FieldStatus>>({});
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // Direct editing: the user changing their own material needs no witness — the witness gate
  // exists for the agent's INTERPRETATION being wrong. A commit mints a revision owned by the
  // user. `editing` SNAPSHOTS the 1-based part index, the original text, AND the artifact's rev
  // at edit-START time — never read live from the `artifact` prop at commit time. The editor
  // reconciles in place (same React key), so if an agent revise or a revert lands while it's
  // open, the component re-renders with a bumped `artifact.rev` and new content while the open
  // editor and the user's draft sit undisturbed with no visible sign. Reading `artifact.rev` at
  // commit time (round 1 review finding) would hand the reducer's `baseRev !== a.rev` check an
  // ALREADY-CURRENT rev, defeating the staleness guard entirely and letting a stale draft
  // silently overwrite the agent's work.
  const [editing, setEditing] = React.useState<{ index1: number; original: string; baseRev: number } | null>(null);
  const [draft, setDraft] = React.useState('');

  // Derived, not stored — true the instant the artifact moves out from under an open editor,
  // whether or not the user has attempted to commit yet, and independent of whether the part
  // being edited still exists in the (possibly now-shorter) part list. The banner driven by this
  // is rendered OUTSIDE the per-part .map below (round 1 review finding) so a `remove-part` that
  // deletes the very paragraph being edited can't unmount the note along with it — it lives at
  // window level, keyed off this component's own state, never off one array slot.
  // Conflict = the material moved under the open editor. Two independent ways that happens:
  // the revision advanced, OR the slot the editor is attached to no longer holds the text it
  // was opened on. The second matters because part indices DRIFT: removing an earlier
  // paragraph shifts every later one down, so index 2 can still be in range while now
  // referring to a different paragraph. Without the occupant check, a retry would silently
  // replace-part over a paragraph the user never opened.
  const occupantText = editing ? artifactParts(artifact)[editing.index1 - 1]?.text : undefined;
  const conflicted = editing !== null
    && (editing.baseRev !== artifact.rev || occupantText !== editing.original);

  const startEdit = (index1: number, text: string) => {
    setEditing({ index1, original: text, baseRev: artifact.rev });
    setDraft(text);
  };
  const commitEdit = () => {
    if (!editing) return;
    const text = draft.trim();
    if (!text || text === editing.original) { setEditing(null); return; } // no-op edits mint no revision
    if (conflicted) {
      // Stale snapshot: the artifact changed underneath while the editor was open. Do NOT
      // apply, do NOT touch the draft, keep the editor open — the conflict banner is already
      // showing via `conflicted`. Re-snapshot BOTH the rev and the occupant text so a second,
      // deliberate commit (the user having now SEEN the conflict and chosen to proceed) goes
      // through the normal path below against whatever is current at that moment — that is the
      // user witnessing the overwrite. Re-snapshotting only the rev would leave a drifted slot
      // permanently conflicted, since its occupant would never match the original again.
      setEditing((e) => (e ? { ...e, baseRev: artifact.rev, original: occupantText ?? e.original } : e));
      return;
    }
    onEditPart({ op: 'replace-part', index: editing.index1, text }, editing.baseRev);
    setEditing(null);
  };

  // Per-window ticker (spec §8): one interval per window, cadence = the fastest bound feed's
  // refreshMs (floored at 1s), cleaned up on unmount. The interval is the heartbeat, not a
  // per-field read cadence — each field is only actually re-read once ITS OWN refreshMs has
  // elapsed (lastAttemptRef), so e.g. a 10-minute weather feed isn't hit every second just
  // because it shares a window with a 1s clock.
  //
  // Keyed on `feedSignature` (2026-07-26 revise core, round 1 fix) — the ordered `index:feedId`
  // pairs of currently bound fields, joined to a string — NOT on `artifact.rev`. `statuses` is
  // keyed by field ARRAY INDEX, so re-running this effect on every revision (keying on rev) made
  // two things wrong: (1) a revision that reindexes a bound feed without changing the set — e.g.
  // remove-part on a field before it — would still be "the same rev-triggered reset", but a
  // revision that DIDN'T touch feeds at all (a retitle, an edit to an unrelated field) also
  // forced `lastAttemptRef` to clear and `tick()` to fire immediately, refetching every bound
  // feed — including a real network call like weather (refreshMs: 600000) — far more often than
  // its own cadence promises. Keying on the bound-feed signature instead means unrelated
  // revisions leave it unchanged (no reset, no refetch, cadence honored), while ANY change to
  // the set of (index, feed) pairs — a feed field added, removed, or shifted to a new index by a
  // neighboring field's removal — changes the signature and re-runs the effect, which resets
  // BOTH `lastAttemptRef` and `statuses` so a reindexed slot starts from the honest "…"
  // placeholder instead of rendering a stale value from whatever used to sit at that index under
  // a LIVE badge that isn't really that field's. Do not "simplify" this back to `artifact.rev` —
  // that reintroduces both the wrong-feed-stale-value bug and the cadence-defeating refetch.
  const lastAttemptRef = React.useRef<Record<number, number>>({});
  const feedSignature = fields
    .map((f, i) => (f.feed ? `${i}:${f.feed}` : null))
    .filter((s): s is string => s !== null)
    .join('|');
  React.useEffect(() => {
    if (artifact.kind !== 'widget') return;
    const bound = fields
      .map((f, i) => ({ i, feed: f.feed ? FEEDS[f.feed] : undefined }))
      .filter((b): b is { i: number; feed: typeof FEEDS[keyof typeof FEEDS] } => !!b.feed);
    lastAttemptRef.current = {};
    setStatuses({});
    if (!bound.length) return;

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
  }, [artifact.kind, artifact.id, feedSignature]);

  // No root stopPropagation (unlike WhiteboardPanel): pointer events must reach <main> so the
  // plane's data-entity-id carve-out can make the CONTENT region pointable. data-shell still
  // marks the chrome (title bar, provenance line, ×) as not-the-plane via that same carve-out.
  // Chrome variants are furniture only. The honesty floor renders in EVERY variant: the "from:"
  // provenance line, the rev chip, and the × (the sole close path) are outside this switch.
  const frameClass = chrome === 'minimal'
    ? 'rounded-lg border border-[var(--card-border)]/50 bg-[var(--card-bg)]/95 shadow-md'
    : chrome === 'provenance'
      ? 'rounded-lg border border-[var(--accent-color)]/40 bg-[var(--card-bg)]/95 shadow-lg'
      : 'rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/95 shadow-lg';

  return (
    <div
      className={`artifact-window absolute flex flex-col backdrop-blur overflow-hidden ${frameClass}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, maxHeight: rect.h, zIndex }}
      // Capture phase so a click anywhere in the window raises it even where a child stops
      // propagation. It does NOT stop propagation itself — the root deliberately lets pointer
      // events reach <main> (see the note above) so the content region stays pointable.
      onPointerDownCapture={onFocus}
      data-shell
    >
      <div className={`flex items-center justify-between gap-2 px-3 h-8 ${chrome === 'minimal' ? '' : 'border-b border-[var(--card-border)]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {chrome === 'provenance' && (
            <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[var(--accent-color)] shrink-0">
              {origin === 'you' ? 'yours' : 'agent'}
            </span>
          )}
          <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[var(--accent-color)]">{artifact.kind}</span>
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{artifact.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* The rev chip is the user-facing half of the (baseRev, index) handshake the model
              uses — and the entry to the history. It is always visible, like provenance. */}
          <button
            aria-label={`Revision ${artifact.rev} — show history`}
            aria-expanded={historyOpen}
            className="hit-24 text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--card-border)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setHistoryOpen((o) => !o)}
          >rev {artifact.rev}</button>
          {/* Minimize is NOT close: the artifact keeps existing, its window goes to the restore
              surface. Without it `minimized` would be unreachable for artifact windows. */}
          <button aria-label="Minimize artifact window" className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onMinimize}><Minus size={13} /></button>
          <button aria-label="Close artifact" className="hit-24 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={onClose}><X size={13} /></button>
        </div>
      </div>
      {/* Provenance is permanent, not a hover tooltip — the honesty floor for a synthesized
          artifact is that its origin is always visible, never buried behind an interaction. */}
      <div className="px-3 py-1 text-[9px] font-mono text-[var(--text-secondary)] border-b border-[var(--card-border)] truncate" title={`from: ${artifact.sources.join(' + ')}`}>
        from: {artifact.sources.join(' + ')}
      </div>
      {historyOpen && (
        <div data-shell className="px-3 py-1.5 border-b border-[var(--card-border)] flex flex-col gap-1 max-h-28 overflow-y-auto">
          {artifact.history.length === 0 && (
            <div className="text-[9px] font-mono text-[var(--text-secondary)]">No earlier revisions — this is the original.</div>
          )}
          {artifact.history.map((v) => (
            <div key={v.rev} className="flex items-center justify-between gap-2 text-[9px] font-mono">
              <span className="text-[var(--text-secondary)] truncate">
                rev {v.rev} · {v.meta.owner === 'user' ? 'you' : 'agent'}{v.meta.note ? ` · ${v.meta.note}` : ''}
              </span>
              <button
                aria-label={`Revert to revision ${v.rev}`}
                className="hit-24 shrink-0 px-1.5 text-[var(--accent-color)] hover:underline"
                onClick={() => { onRevert(v.rev); setHistoryOpen(false); }}
              >revert</button>
            </div>
          ))}
          <div className="text-[9px] font-mono text-[var(--text-primary)]">
            rev {artifact.rev} · {artifact.meta.owner === 'user' ? 'you' : 'agent'}{artifact.meta.note ? ` · ${artifact.meta.note}` : ''} · now
          </div>
        </div>
      )}
      {/* Window-level, not per-part: this must survive a `remove-part` that deletes the very
          paragraph/field being edited, which unmounts that .map iteration entirely. Anchored to
          `conflicted` (component state), so it can't disappear along with a deleted array slot. */}
      {conflicted && (
        // M1 (final review): "press Escape to discard" was only true while the edited part's
        // textarea/input was still mounted and focused. If the conflicting revision REMOVED that
        // very part, the editor unmounts along with it — nothing is focused, no key handler is
        // listening, and the banner had no way to clear itself. A dedicated button works
        // regardless of whether the editor is still on screen, so the wording no longer depends
        // on it either.
        <div className="px-3 py-1.5 text-[9px] font-mono text-amber-600 border-b border-[var(--card-border)] bg-amber-500/10 flex items-center justify-between gap-2">
          <span>This artifact changed while you were editing (now at rev {artifact.rev}) — your edit was not applied. Edit again to apply it on top of the latest version, or discard your draft.</span>
          <button
            aria-label="Discard draft"
            className="hit-24 shrink-0 px-1.5 text-amber-700 hover:underline"
            onClick={() => setEditing(null)}
          >discard</button>
        </div>
      )}
      <div data-entity-id={`artifact-${artifact.id}`} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[12px] text-[var(--text-primary)] leading-relaxed">
        {artifact.kind === 'doc' && splitParagraphs(artifact.content).map((p, i) => (
          editing?.index1 === i + 1 ? (
            // A textarea is an editable target, so isEditableTarget (src/shell/quickFire.ts:25)
            // already stops the backtick register chord and quick-fire digits from firing here.
            <textarea
              key={i}
              autoFocus
              aria-label={`Edit paragraph ${i + 1}`}
              // Spec §8: "parts keep their data-entity-id while editable, so an edited paragraph
              // stays pointable" — same value the resting <p> below carries, so a point-and-talk
              // reference resolves identically whether or not the paragraph happens to be open
              // for editing right now. The measurement scan (App.tsx updateLayout) selects
              // `.artifact-window [data-entity-id]`, which this satisfies exactly like the <p>.
              data-entity-id={`artifact-${artifact.id}-para-${i + 1}`}
              className="w-full mb-2 min-h-6 rounded border border-[var(--accent-color)] bg-transparent p-1 text-[12px] leading-relaxed text-[var(--text-primary)]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitEdit()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
              }}
            />
          ) : (
            <p
              key={i}
              data-entity-id={`artifact-${artifact.id}-para-${i + 1}`}
              className="mb-2 last:mb-0 cursor-text hover:bg-[var(--card-border)]/20 rounded"
              onDoubleClick={() => startEdit(i + 1, p)}
              title="Double-click to edit"
            >{p}</p>
          )
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
                <div key={i} data-entity-id={`artifact-${artifact.id}-field-${i + 1}`} className="flex flex-col gap-0.5 text-[11px] font-mono">
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
                      {editing?.index1 === i + 1 && !descriptor ? (
                        <input
                          autoFocus
                          aria-label={`Edit ${f.label}`}
                          className="min-h-6 w-24 rounded border border-[var(--accent-color)] bg-transparent px-1 text-[11px] text-[var(--text-primary)]"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={() => commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                          }}
                        />
                      ) : (
                        <span
                          className={descriptor ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)] cursor-text hover:bg-[var(--card-border)]/20 rounded px-0.5'}
                          onDoubleClick={descriptor ? undefined : () => startEdit(i + 1, f.value ?? '')}
                          title={descriptor ? 'Live feed value — not editable' : 'Double-click to edit'}
                        >{displayValue}</span>
                      )}
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
