import React, { useState } from 'react';
import { Mic, MicOff, CornerDownLeft } from 'lucide-react';

export type Suggestion = { key: string; label: string; phrase: string; color: string };

export function Omnibox({ isLive, isConnecting, error, transcript, suggestions, firstRunHint, onSubmit, onMicToggle, onChipTap }: {
  isLive: boolean; isConnecting: boolean; error: string | null; transcript: string | null;
  suggestions: Suggestion[]; firstRunHint: boolean;
  onSubmit: (text: string) => void; onMicToggle: () => void; onChipTap: (s: Suggestion) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 w-[min(640px,90vw)] flex flex-col items-stretch gap-2" onPointerDown={(e) => e.stopPropagation()}>
      {firstRunHint && !isLive && (
        <p className="text-center text-[11px] font-mono text-[var(--text-secondary)]">Point at things and ask — or type.</p>
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
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask or tell me anything — point while you type"
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
