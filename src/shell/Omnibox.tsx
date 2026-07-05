import React, { useState } from 'react';
import { Mic, MicOff, CornerDownLeft, X } from 'lucide-react';

export type Suggestion = { key: string; label: string; phrase: string; color: string };
export type GroundingChip = { id: string; title: string; color: string };

export function Omnibox({ isLive, isConnecting, error, transcript, suggestions, firstRunHint, restoredDraft, modelCaption, grounding = [], onRemoveGrounding, onSubmit, onMicToggle, onChipTap }: {
  isLive: boolean; isConnecting: boolean; error: string | null; transcript: string | null;
  suggestions: Suggestion[]; firstRunHint: boolean;
  restoredDraft?: { text: string; at: number } | null;
  /** The model's speech as text — the response window for muted speakers. Persists post-query. */
  modelCaption?: { text: string; final: boolean } | null;
  /** Elements the user selected on screen — mirrored 1:1 as chips; sent with the query. */
  grounding?: GroundingChip[];
  onRemoveGrounding?: (id: string) => void;
  onSubmit: (text: string) => void; onMicToggle: () => void; onChipTap: (s: Suggestion) => void;
}) {
  const [draft, setDraft] = useState('');
  // Restore typed text that was lost when a cold-start connect failed (R1 path).
  React.useEffect(() => { if (restoredDraft) setDraft(restoredDraft.text); }, [restoredDraft?.at]);
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(640px,90vw)] flex flex-col items-stretch gap-2" onPointerDown={(e) => e.stopPropagation()}>
      {firstRunHint && !isLive && (
        <p className="text-center text-[11px] font-mono text-[var(--text-secondary)]">Point at things and ask — or type.</p>
      )}
      {modelCaption?.text && (
        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg px-3 py-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-secondary)]">assistant</span>
          <p className="text-[12px] text-[var(--text-primary)] leading-snug">
            {modelCaption.text}
            {!modelCaption.final && <span className="inline-block w-1.5 h-3 ml-0.5 bg-[var(--accent-color)] animate-pulse align-middle" />}
          </p>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto custom-scrollbar pb-0.5">
          {suggestions.map(s => (
            <button key={s.key}
              onClick={() => { setDraft(s.phrase); onChipTap(s); }}
              className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-mono border bg-[var(--card-bg)]/85 backdrop-blur border-[var(--card-border)] text-[var(--text-primary)] hover:border-[var(--accent-color)] transition-colors"
              style={{ boxShadow: `inset 2px 0 0 rgb(${s.color})` }}
              title={s.label}
            >
              {s.phrase}
            </button>
          ))}
        </div>
      )}
      {(error || transcript) && (
        <p className={`text-center text-[11px] font-mono ${error ? 'text-red-500' : 'text-[var(--text-secondary)] italic'}`}>
          {error ?? transcript}
        </p>
      )}
      <form
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 backdrop-blur shadow-lg"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onSubmit(draft); setDraft(''); } }}
      >
        <button type="button" onClick={onMicToggle} disabled={isConnecting}
          title={isLive ? 'End voice session' : 'Start voice session'}
          className={`p-2 rounded-xl transition-all active:scale-90 ${isLive ? 'bg-green-500/15 text-green-500' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-color)]'} disabled:opacity-40`}>
          {isLive ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        {grounding.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 max-w-[45%] overflow-hidden">
            {grounding.map(c => (
              <span key={c.id}
                className="flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-[10px] font-mono border border-[var(--card-border)] bg-[var(--bg-color)] text-[var(--text-primary)] whitespace-nowrap"
                style={{ boxShadow: `inset 2px 0 0 rgb(${c.color})` }}
                title={`Grounded on ${c.title} — sent with your query`}
              >
                {c.title}
                <button type="button" onClick={() => onRemoveGrounding?.(c.id)}
                  className="p-0.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="Remove">
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={grounding.length ? 'Ask about your selection…' : 'Ask or tell me anything — point while you type'}
          disabled={isConnecting}
          className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none disabled:opacity-40"
        />
        <button type="submit" disabled={isConnecting || !draft.trim()}
          className="p-2 rounded-xl text-[var(--accent-color)] hover:bg-[var(--accent-color)]/10 disabled:opacity-30 transition-colors">
          <CornerDownLeft size={15} />
        </button>
      </form>
    </div>
  );
}
